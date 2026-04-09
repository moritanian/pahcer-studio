import base64
import json
import os
import subprocess
import stat
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import cpu_count

import boto3

TOOLS_BUCKET = os.environ.get("TOOLS_BUCKET", "")
TOOLS_CACHE_DIR = "/tmp/tools"
s3_client = boto3.client("s3")


def get_physical_core_count():
    """Get physical core count (vCPU / 2 for hyperthreading)."""
    vcpus = cpu_count() or 1
    return max(1, vcpus // 2)


def ensure_tools(contest_id, tool_names):
    """Download tools from S3 if not cached. Returns tool directory path."""
    tool_dir = os.path.join(TOOLS_CACHE_DIR, contest_id)

    # Check if all tools are already cached
    all_cached = all(
        os.path.exists(os.path.join(tool_dir, name)) for name in tool_names
    )
    if all_cached:
        return tool_dir

    os.makedirs(tool_dir, exist_ok=True)
    s3 = boto3.client("s3")
    for name in tool_names:
        local_path = os.path.join(tool_dir, name)
        if not os.path.exists(local_path):
            s3.download_file(TOOLS_BUCKET, f"{contest_id}/{name}", local_path)
            os.chmod(local_path, stat.S_IRWXU)

    return tool_dir


def replace_placeholders(s, seed):
    """Replace pahcer-style placeholders in a string."""
    return s.replace("{SEED}", str(seed)).replace("{SEED04}", f"{seed:04d}")


def resolve_path(path, seed, work_dir, cwd=None):
    """Resolve a relative path to absolute, replacing placeholders."""
    path = replace_placeholders(path, seed)
    if os.path.isabs(path):
        return path
    base = cwd or work_dir
    return os.path.join(base, path)


def handler(event, context):
    """
    Lambda handler for running AHC test cases.

    Input event:
        binary_base64: base64 encoded C++ binary
        seeds: list of seed values to test
        contest_id: contest identifier (e.g. "ahc061")
        test_steps: list of test step definitions from pahcer_config.toml
        score_regex: regex pattern to extract score
        tool_names: list of tool binary names to download from S3

    Returns:
        dict of {scores, vcpus, workers}
    """
    binary_base64 = event["binary_base64"]
    seeds = event["seeds"]
    contest_id = event["contest_id"]
    test_steps = event["test_steps"]
    score_regex = event["score_regex"]
    tool_names = event.get("tool_names", [])
    execution_id = event.get("execution_id")

    tool_dir = ensure_tools(contest_id, tool_names)

    # Decode binary and write to /tmp
    binary_path = "/tmp/solution"
    binary_data = base64.b64decode(binary_base64)
    with open(binary_path, "wb") as f:
        f.write(binary_data)
    os.chmod(binary_path, stat.S_IRWXU)

    num_workers = get_physical_core_count()

    results = {}
    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = [
            executor.submit(
                run_single_test, seed, binary_path, test_steps, score_regex, tool_dir
            )
            for seed in seeds
        ]
        for future in futures:
            seed, result = future.result()
            if isinstance(result, dict):
                score = result.get("score")
                exec_time = result.get("execution_time", 0)
                results[str(seed)] = {"score": score, "execution_time": exec_time}

                # Upload stdout/stderr to S3
                if execution_id and "stdout" in result:
                    upload_result_to_s3(contest_id, execution_id, seed, result)
            else:
                results[str(seed)] = {"score": result, "execution_time": 0}

    vcpus = cpu_count() or 1
    return {
        "scores": results,
        "vcpus": vcpus,
        "workers": num_workers,
    }


def convert_cargo_run_step(step, tool_dir):
    """Convert 'cargo run --bin <name>' to direct binary execution."""
    if step.get("program") != "cargo":
        return step
    args = step.get("args", [])
    if "run" not in args or "--bin" not in args:
        return step

    bin_idx = args.index("--bin")
    if bin_idx + 1 >= len(args):
        return step
    bin_name = args[bin_idx + 1]

    # Remaining args after stripping cargo run --bin <name> [--release]
    remaining = []
    skip = {"run", "--bin", bin_name, "--release"}
    for a in args:
        if a not in skip:
            remaining.append(a)

    binary_path = os.path.join(tool_dir, bin_name)
    new_step = dict(step)
    new_step["program"] = binary_path
    new_step["args"] = remaining
    return new_step


def upload_result_to_s3(contest_id, execution_id, seed, result):
    """Upload test result (stdout/stderr) to S3."""
    try:
        key = f"results/{contest_id}/{execution_id}/{seed:04d}.json"
        s3_client.put_object(
            Bucket=TOOLS_BUCKET,
            Key=key,
            Body=json.dumps(result),
            ContentType="application/json",
        )
    except Exception:
        pass  # Don't fail the test if S3 upload fails


def run_single_test(seed, binary_path, test_steps, score_regex, tool_dir):
    """Run test steps for a single seed. Returns (seed, result_dict)."""
    import time as _time
    start_time = _time.monotonic()
    try:
        with tempfile.TemporaryDirectory(dir="/tmp") as work_dir:
            # Create directory structure matching pahcer's expectations
            tools_dir = os.path.join(work_dir, "tools")
            in_dir = os.path.join(tools_dir, "in")
            out_dir = os.path.join(tools_dir, "out")
            err_dir = os.path.join(tools_dir, "err")
            for d in [in_dir, out_dir, err_dir]:
                os.makedirs(d, exist_ok=True)

            # Generate input using gen from tool_dir
            gen_path = os.path.join(tool_dir, "gen")
            if os.path.exists(gen_path):
                seeds_file = os.path.join(work_dir, "seeds.txt")
                with open(seeds_file, "w") as f:
                    f.write(f"{seed}\n")
                subprocess.run(
                    [gen_path, seeds_file, "-d", in_dir],
                    check=True,
                    capture_output=True,
                    timeout=10,
                )
                # gen outputs 0000.txt, rename to match {SEED04}
                gen_output = os.path.join(in_dir, "0000.txt")
                expected = os.path.join(in_dir, f"{seed:04d}.txt")
                if os.path.exists(gen_output) and gen_output != expected:
                    os.rename(gen_output, expected)

            # Symlink solution binary to work_dir
            solution_link = os.path.join(work_dir, "a.out")
            if os.path.exists(solution_link):
                os.remove(solution_link)
            os.symlink(binary_path, solution_link)

            # Execute test steps
            all_stderr = ""
            all_stdout = ""
            for step in test_steps:
                # Convert cargo run --bin to direct binary execution
                step = convert_cargo_run_step(step, tool_dir)

                # Determine working directory for this step
                cwd = work_dir
                current_dir = step.get("current_dir")
                if current_dir:
                    cwd = resolve_path(current_dir, seed, work_dir)

                # Resolve program path
                program = replace_placeholders(step["program"], seed)
                if program.startswith("./"):
                    program = os.path.join(cwd, program[2:])
                elif not os.path.isabs(program):
                    # Check tool_dir first, then rely on PATH
                    tool_path = os.path.join(tool_dir, program)
                    if os.path.exists(tool_path):
                        program = tool_path

                # Resolve args
                args = [replace_placeholders(a, seed) for a in step.get("args", [])]

                # Handle stdin/stdout/stderr redirection
                stdin_file = None
                stdout_file = None
                stderr_file = None

                try:
                    if step.get("stdin"):
                        path = resolve_path(step["stdin"], seed, work_dir)
                        stdin_file = open(path, "r")
                    if step.get("stdout"):
                        path = resolve_path(step["stdout"], seed, work_dir)
                        stdout_file = open(path, "w")
                    if step.get("stderr"):
                        path = resolve_path(step["stderr"], seed, work_dir)
                        stderr_file = open(path, "w")

                    result = subprocess.run(
                        [program] + args,
                        stdin=stdin_file,
                        stdout=stdout_file or subprocess.PIPE,
                        stderr=stderr_file or subprocess.PIPE,
                        text=True,
                        timeout=30,
                        cwd=cwd,
                    )

                    if not stdout_file and result.stdout:
                        all_stdout += result.stdout
                    if not stderr_file and result.stderr:
                        all_stderr += result.stderr

                finally:
                    if stdin_file:
                        stdin_file.close()
                    if stdout_file:
                        stdout_file.close()
                    if stderr_file:
                        stderr_file.close()

            # Read redirected output files
            solution_output = ""
            out_file = os.path.join(out_dir, f"{seed:04d}.txt")
            if os.path.exists(out_file):
                with open(out_file, "r") as f:
                    solution_output = f.read()

            # Also read redirected stderr/stdout files for score extraction
            for dir_path in [err_dir, out_dir]:
                f_path = os.path.join(dir_path, f"{seed:04d}.txt")
                if os.path.exists(f_path):
                    with open(f_path, "r") as f:
                        content = f.read()
                    if dir_path == err_dir:
                        all_stderr += content
                    else:
                        all_stdout += content

            # Extract score
            combined_output = all_stderr + all_stdout
            score = parse_score(combined_output, score_regex)

            elapsed = _time.monotonic() - start_time
            return (seed, {"score": score, "stdout": all_stdout, "stderr": all_stderr, "output": solution_output, "execution_time": elapsed})

    except subprocess.TimeoutExpired:
        elapsed = _time.monotonic() - start_time
        return (seed, {"error": "timeout", "execution_time": elapsed})
    except Exception as e:
        elapsed = _time.monotonic() - start_time
        return (seed, {"error": str(e), "execution_time": elapsed})


def parse_score(output, score_regex):
    """Extract score using the provided regex pattern."""
    match = re.search(score_regex, output)
    if match:
        try:
            return int(match.group("score"))
        except (IndexError, ValueError):
            pass
        try:
            return int(match.group(1))
        except (IndexError, ValueError):
            pass
    return {"error": f"score not found in: {output[:200]}"}
