#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EventSource } from 'eventsource';
import packageJson from '../../package.json';
import { PathHelper } from '../infrastructure/PathHelper';
import type { Workspace } from '../schemas/workspace';
import type { TestExecution } from '../schemas/execution';

// Check if running in WSL
function isWSL(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }

  // Check for WSL-specific files/environment
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    return true;
  }

  // Check /proc/version for WSL signature
  try {
    const procVersion = fs.readFileSync('/proc/version', 'utf8');
    return /microsoft|WSL/i.test(procVersion);
  } catch {
    return false;
  }
}

// Open URL in default browser (cross-platform)
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;
  let args: string[] = [];
  let useShell = true;

  if (isWSL()) {
    // WSL: Use cmd.exe to open browser in Windows
    command = 'cmd.exe';
    args = ['/c', 'start', url];
    useShell = false;
  } else if (platform === 'win32') {
    command = `start ${url}`;
  } else if (platform === 'darwin') {
    command = `open ${url}`;
  } else {
    command = `xdg-open ${url}`;
  }

  return new Promise((resolve, reject) => {
    const proc = useShell
      ? spawn(command, { shell: true, stdio: 'ignore', detached: true })
      : spawn(command, args, { stdio: 'ignore', detached: true });

    proc.on('error', reject).unref();
    resolve();
  });
}

const program = new Command();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '127.0.0.1';
const SERVER_URL = `http://${HOST}:${PORT}`;

// PID file path (in user's home directory or temp)
const PID_FILE = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'pahcer-studio.pid');

// Check if server is running
async function isServerRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    await fetch(`${SERVER_URL}/api/settings`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
}

// Start the server
async function startServer(
  shouldOpenBrowser: boolean = true,
  force: boolean = false,
): Promise<void> {
  const isRunning = await isServerRunning();

  if (isRunning) {
    if (force) {
      console.log('Server is already running. Force terminating...');
      await terminateServer();
      // Wait a bit for the server to fully terminate
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      console.log('Server is already running');
      if (shouldOpenBrowser) {
        console.log(`Opening browser at ${SERVER_URL}`);
        await openBrowser(SERVER_URL);
      }
      return;
    }
  }

  console.log('Starting server...');

  // Find the root directory (where package.json is located)
  // When installed globally, __dirname is in node_modules/.../dist/cli
  // When run locally, __dirname is in dist/cli
  let rootDir = path.resolve(__dirname, '../..');

  // Check if package.json exists, if not, try to find it
  if (!fs.existsSync(path.join(rootDir, 'package.json'))) {
    // Might be installed globally, look for it in the current working directory
    rootDir = process.cwd();

    // Check if pahcer-studio folder exists in current directory
    const pahcerStudioDir = path.join(rootDir, 'pahcer-studio');
    if (
      fs.existsSync(pahcerStudioDir) &&
      fs.existsSync(path.join(pahcerStudioDir, 'package.json'))
    ) {
      rootDir = pahcerStudioDir;
    }
  }

  // Always use production build
  const serverPath = path.join(rootDir, 'dist/server/server.js');
  if (!fs.existsSync(serverPath)) {
    console.error(
      'Error: Server not built. Please run "yarn build" in the pahcer-studio directory first.',
    );
    console.error(`Expected server at: ${serverPath}`);
    process.exit(1);
  }

  const serverProcess = spawn('node', [serverPath], {
    cwd: rootDir,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, NODE_ENV: 'production' },
    shell: false,
  });

  // Handle process errors
  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

  // Detach the child process so it continues running after CLI exits
  serverProcess.unref();

  // Save PID to file
  if (serverProcess.pid) {
    fs.writeFileSync(PID_FILE, serverProcess.pid.toString());
  } else {
    console.error('Failed to get server process PID');
    process.exit(1);
  }

  // Wait for server to start
  console.log('Waiting for server to start...');
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await isServerRunning()) {
      console.log(`Server started at ${SERVER_URL}`);
      if (shouldOpenBrowser) {
        console.log('Opening browser...');
        await openBrowser(SERVER_URL);
      }
      return;
    }
    attempts++;
  }

  console.error('Error: Server failed to start within 30 seconds');
  console.error('Check if port 3000 is already in use or check server logs');
  try {
    if (serverProcess.pid) {
      process.kill(serverProcess.pid, 'SIGTERM');
    }
  } catch (err) {
    // Process may have already exited
  }
  // Clean up PID file
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
  process.exit(1);
}

// Terminate the server
async function terminateServer(): Promise<void> {
  if (!fs.existsSync(PID_FILE)) {
    console.log('No server PID file found. Server may not be running.');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());

  try {
    // Try to kill the process
    process.kill(pid, 'SIGTERM');
    console.log(`Terminated server (PID: ${pid})`);

    // Wait a bit and verify it's stopped
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if still running
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
      console.warn('Server may still be running. Try using task manager to force quit.');
    } catch {
      // Process doesn't exist anymore, good
      console.log('Server stopped successfully');
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      console.log('Server process not found. It may have already stopped.');
    } else {
      console.error('Error terminating server:', error);
    }
  } finally {
    // Clean up PID file
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  }
}

// Launch command
program
  .command('launch')
  .description('Launch the pahcer-studio server in background and open browser')
  .option('--no-browser', 'Do not open browser automatically')
  .option('-f, --force', 'Force restart server if already running', false)
  .action(async (options) => {
    try {
      await startServer(options.browser !== false, options.force);
      // Server is running in background, exit the CLI
      process.exit(0);
    } catch (error) {
      console.error('Error launching server:', error);
      process.exit(1);
    }
  });

// Parse seed option into startSeed and testCaseCount
function parseSeedOption(
  seedArg: string | undefined,
  countArg: string | undefined,
): { startSeed: number | null; testCaseCount: number | null } {
  if (seedArg !== undefined && /[:-]/.test(seedArg) && /^\d/.test(seedArg)) {
    // Range format: "10:20" or "10-20" (hyphen at end of class = literal hyphen)
    const parts = seedArg.split(/[:-]/);
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    if (isNaN(start) || isNaN(end) || start > end) {
      console.error(
        'Error: Invalid seed range. Use format start:end or start-end (e.g., 10:20 or 10-20)',
      );
      process.exit(1);
    }
    if (countArg !== undefined) {
      console.warn('Warning: --count is ignored when a seed range is specified');
    }
    return { startSeed: start, testCaseCount: end - start + 1 };
  } else if (seedArg !== undefined && countArg === undefined) {
    // Single seed, no count → run only that one seed
    const seed = parseInt(seedArg, 10);
    if (isNaN(seed) || seed < 0) {
      console.error('Error: Invalid seed value. Must be a non-negative integer.');
      process.exit(1);
    }
    return { startSeed: seed, testCaseCount: 1 };
  } else {
    // seed/count が未指定ならnull（設定ファイルの値を使う）
    const startSeed = seedArg !== undefined ? parseInt(seedArg, 10) : null;
    const testCaseCount = countArg !== undefined ? parseInt(countArg, 10) : null;
    if (startSeed != null && (isNaN(startSeed) || startSeed < 0)) {
      console.error('Error: Invalid seed value. Must be a non-negative integer.');
      process.exit(1);
    }
    if (testCaseCount != null && (isNaN(testCaseCount) || testCaseCount < 1)) {
      console.error('Error: Invalid count value. Must be a positive integer.');
      process.exit(1);
    }
    return { startSeed, testCaseCount };
  }
}

// Run pahcer tests
async function runTests(options: {
  testCaseCount: number | null;
  startSeed: number | null;
  comment?: string;
  shuffle?: boolean;
  freeze?: boolean;
  directory?: string;
  settingFile?: string;
  lambda?: boolean;
  local?: boolean;
}): Promise<void> {
  const isRunning = await isServerRunning();

  if (!isRunning) {
    console.log('Server not running, starting server first...');
    await startServer(false);
  }

  // Determine target directory
  let targetDir = options.directory ? options.directory : process.cwd();

  // Expand tilde if present
  targetDir = PathHelper.expandTilde(targetDir);

  // Resolve to absolute path
  if (!path.isAbsolute(targetDir)) {
    targetDir = path.resolve(process.cwd(), targetDir);
  }

  // Check if setting file exists
  if (options.settingFile) {
    const settingFilePath = path.isAbsolute(options.settingFile)
      ? options.settingFile
      : path.resolve(targetDir, options.settingFile);
    if (!fs.existsSync(settingFilePath)) {
      console.error(`Error: Setting file not found: ${settingFilePath}`);
      process.exit(1);
    }
  } else {
    const configPath = path.join(targetDir, 'pahcer_config.toml');
    if (!fs.existsSync(configPath)) {
      console.error(`Error: pahcer_config.toml not found in directory: ${targetDir}`);
      console.error('Please specify a valid AHC project directory (where pahcer is initialized)');
      process.exit(1);
    }
  }

  // Create or get workspace
  let workspace;
  try {
    workspace = await getWorkspace(targetDir);
    console.log(`Using workspace: ${workspace.id} (${workspace.targetDirectory})`);
  } catch (error) {
    console.error('Error creating workspace:', error);
    process.exit(1);
  }

  // Determine Lambda/Local mode
  let useLambda: boolean | null = null;
  if (options.lambda) useLambda = true;
  if (options.local) useLambda = false;

  // Start test execution
  const executionRequest = {
    comment: options.comment || null,
    shuffle: options.shuffle || false,
    freezeBestScores: options.freeze || false,
    testCaseCount: options.testCaseCount,
    startSeed: options.startSeed,
    settingFile: options.settingFile
      ? path.isAbsolute(options.settingFile)
        ? options.settingFile
        : path.resolve(targetDir, options.settingFile)
      : null,
    useLambda,
  };

  try {
    const response = await fetch(`${SERVER_URL}/api/workspaces/${workspace.id}/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(executionRequest),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to start execution:', errorData.error || 'Unknown error');
      process.exit(1);
    }

    const { id } = await response.json();
    console.log(`Test execution started (ID: ${id})`);

    // Flag to prevent duplicate completion handling
    let isCompleted = false;
    let poller: NodeJS.Timeout | null = null;
    let es: EventSource | null = null;

    // Cleanup function
    const cleanup = () => {
      if (poller) {
        clearInterval(poller);
        poller = null;
      }
      if (es) {
        es.close();
        es = null;
      }
      process.off('SIGINT', sigintHandler);
      process.off('SIGTERM', sigintHandler);
    };

    // Handle Ctrl+C to stop execution gracefully
    const sigintHandler = async () => {
      if (isCompleted) return;
      console.log('\nStopping execution...');
      try {
        const stopResponse = await fetch(
          `${SERVER_URL}/api/workspaces/${workspace.id}/executions/${id}/stop`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
        );
        if (!stopResponse.ok) {
          console.error('Failed to stop execution');
        }
      } catch (error) {
        console.error('Error stopping execution:', error);
      }
      isCompleted = true;
      cleanup();
      process.exit(0);
    };

    const handleCompletion = () => {
      if (isCompleted) return;
      isCompleted = true;
      cleanup();
      process.exit(0);
    };

    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigintHandler);

    // Start polling in background as a safety measure
    // This ensures we catch completion even if SSE events are missed or reader blocks
    poller = setInterval(async () => {
      if (isCompleted) {
        if (poller) clearInterval(poller);
        return;
      }
      try {
        const res = await fetch(`${SERVER_URL}/api/workspaces/${workspace.id}/executions/${id}`);
        if (res.ok) {
          const data = await res.json();
          if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) {
            // Wait a moment to allow pending logs to flush via SSE
            setTimeout(() => {
              handleCompletion();
            }, 500);
          }
        }
      } catch (e) {
        console.error('Polling error:', e);
      }
    }, 2000);

    es = new EventSource(`${SERVER_URL}/api/events`);

    es.addEventListener('execution:log', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.executionId === id && data.log) {
          process.stdout.write(data.log.message + '\n');
        }
      } catch (e) {
        console.error('Error handling execution:log event:', e);
      }
    });

    es.addEventListener('execution:status', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.executionId === id && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) {
          // Wait a brief moment for any pending logs
          setTimeout(() => {
            handleCompletion();
            if (es) es.close();
          }, 100);
        }
      } catch (e) {
        console.error('Error handling execution:status event:', e);
      }
    });

    es.onerror = (err: unknown) => {
      if (!isCompleted) {
        // Only log if we haven't completed yet
        console.error('EventSource error:', err);
      }
    };
  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

// Run command
program
  .command('run [directory]')
  .description('Run pahcer tests (starts server if not running)')
  .option(
    '-n, --count <number>',
    'Number of test cases to run (default: 100; ignored when --seed is a range)',
  )
  .option(
    '-s, --seed <value>',
    'Seed value, starting seed, or seed range.\n' +
      '  Single seed:  --seed 42       → runs only seed 42\n' +
      '  Seed range:   --seed 10:20    → runs seeds 10–20 (inclusive)\n' +
      '                --seed 10-20    → same as above\n' +
      '  With --count: --seed 10 -n 50 → runs seeds 10–59',
  )
  .option('-c, --comment <string>', 'Comment for this execution')
  .option('--shuffle', 'Shuffle test case order', false)
  .option('--freeze', 'Freeze best scores', false)
  .option('-f, --setting-file <path>', 'Path to the setting file')
  .option('--lambda', 'Run on AWS Lambda')
  .option('--local', 'Run locally')
  .action(async (directory, options) => {
    try {
      const { startSeed, testCaseCount } = parseSeedOption(options.seed, options.count);
      await runTests({
        testCaseCount,
        startSeed,
        comment: options.comment,
        shuffle: options.shuffle,
        freeze: options.freeze,
        directory: directory,
        settingFile: options.settingFile,
        lambda: options.lambda,
        local: options.local,
      });
    } catch (error) {
      console.error('Error running tests:', error);
      process.exit(1);
    }
  });

// Terminate command
program
  .command('terminate')
  .description('Terminate the running pahcer-studio server')
  .action(async () => {
    try {
      await terminateServer();
    } catch (error) {
      console.error('Error terminating server:', error);
      process.exit(1);
    }
  });

// Results commands
const resultsCommand = program.command('results').description('Manage execution results');

// Helper function to get workspace from directory
async function getWorkspace(directory?: string): Promise<Workspace> {
  let targetDir = directory ? directory : process.cwd();
  targetDir = PathHelper.expandTilde(targetDir);
  if (!path.isAbsolute(targetDir)) {
    targetDir = path.resolve(process.cwd(), targetDir);
  }

  // Create or get workspace using POST (idempotent)
  const workspaceResponse = await fetch(`${SERVER_URL}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetDirectory: targetDir,
      useWsl: false,
    }),
  });

  if (!workspaceResponse.ok) {
    throw new Error('Failed to get workspace');
  }

  return workspaceResponse.json();
}

// Helper function to get workspace ID from directory
async function getWorkspaceId(directory?: string): Promise<string> {
  const workspace = await getWorkspace(directory);
  return workspace.id;
}

// Results list command
resultsCommand
  .command('list')
  .description('List execution history')
  .option('-d, --directory <path>', 'Target directory (defaults to current directory)')
  .option('--limit <number>', 'Limit number of results', '10')
  .option('--json', 'Output in JSON format', false)
  .action(async (options) => {
    const isRunning = await isServerRunning();
    if (!isRunning) {
      console.error('Error: Server is not running. Start it with "phst launch"');
      process.exit(1);
    }

    try {
      const workspaceId = await getWorkspaceId(options.directory);
      const response = await fetch(`${SERVER_URL}/api/workspaces/${workspaceId}/executions`);
      if (!response.ok) {
        console.error('Failed to fetch execution history');
        process.exit(1);
      }

      const data = await response.json();
      const limited = data.slice(0, parseInt(options.limit, 10));

      if (options.json) {
        console.log(JSON.stringify(limited, null, 2));
      } else {
        if (limited.length === 0) {
          console.log('No execution history found');
          return;
        }

        // Table header
        const header = [
          'ID'.padEnd(10),
          'Time'.padEnd(22),
          'Avg Score'.padStart(12),
          'Relative'.padStart(10),
          'Log10'.padStart(8),
          'Max Time'.padStart(10),
          'Cases'.padStart(10),
          'Comment',
        ].join(' | ');
        console.log(header);
        console.log('-'.repeat(header.length));

        limited.forEach((exec: TestExecution) => {
          const avgScore = exec.averageScore
            ? Math.round(exec.averageScore).toLocaleString('en-US')
            : '-';
          const relative = exec.averageRelativeScore != null
            ? `${(exec.averageRelativeScore * 100).toFixed(2)}%`
            : '-';
          const log10 = exec.averageScore && exec.averageScore > 0
            ? Math.log10(exec.averageScore).toFixed(4)
            : '-';
          const maxTime = exec.maxExecutionTime != null
            ? `${exec.maxExecutionTime.toFixed(0)}ms`
            : '-';
          const cases = exec.acceptedCount != null && exec.totalCount != null
            ? `${exec.acceptedCount}/${exec.totalCount}`
            : '-';
          const time = exec.startTime
            ? new Date(exec.startTime).toLocaleString()
            : '-';
          const comment = exec.comment || '';

          console.log([
            exec.id.padEnd(10),
            time.padEnd(22),
            avgScore.padStart(12),
            relative.padStart(10),
            log10.padStart(8),
            maxTime.padStart(10),
            cases.padStart(10),
            comment,
          ].join(' | '));
        });
      }
    } catch (error) {
      console.error('Error fetching results:', error);
      process.exit(1);
    }
  });

// Results get command
resultsCommand
  .command('get <execution-id>')
  .description('Get detailed results for a specific execution')
  .option('-d, --directory <path>', 'Target directory (defaults to current directory)')
  .option('--json', 'Output in JSON format', false)
  .action(async (executionId, options) => {
    const isRunning = await isServerRunning();
    if (!isRunning) {
      console.error('Error: Server is not running. Start it with "phst launch"');
      process.exit(1);
    }

    try {
      const workspaceId = await getWorkspaceId(options.directory);

      // Fetch execution summary and test cases in parallel
      const [execResponse, casesResponse] = await Promise.all([
        fetch(`${SERVER_URL}/api/workspaces/${workspaceId}/executions/${executionId}`),
        fetch(`${SERVER_URL}/api/workspaces/${workspaceId}/executions/${executionId}/cases`),
      ]);

      if (!execResponse.ok) {
        console.error(`Failed to fetch execution result: ${executionId}`);
        process.exit(1);
      }

      const exec = await execResponse.json();
      const cases = casesResponse.ok ? await casesResponse.json() : [];

      if (options.json) {
        console.log(JSON.stringify({ ...exec, cases }, null, 2));
      } else {
        // Summary
        const time = exec.startTime ? new Date(exec.startTime).toLocaleString() : '-';
        const avgScore = exec.averageScore
          ? Math.round(exec.averageScore).toLocaleString('en-US')
          : '-';
        const relative = exec.averageRelativeScore != null
          ? `${(exec.averageRelativeScore * 100).toFixed(2)}%`
          : '-';
        const log10 = exec.averageScore && exec.averageScore > 0
          ? Math.log10(exec.averageScore).toFixed(4)
          : '-';
        const maxTime = exec.maxExecutionTime != null
          ? `${exec.maxExecutionTime.toFixed(0)}ms`
          : '-';
        const accepted = exec.acceptedCount != null && exec.totalCount != null
          ? `${exec.acceptedCount}/${exec.totalCount}`
          : '-';

        console.log(`ID               : ${exec.id}`);
        console.log(`Status           : ${exec.status}`);
        console.log(`Time             : ${time}`);
        console.log(`Comment          : ${exec.comment || '-'}`);
        console.log(`Average Score    : ${avgScore}`);
        console.log(`Avg Relative     : ${relative}`);
        console.log(`Avg Score (log10): ${log10}`);
        console.log(`Max Exec Time    : ${maxTime}`);
        console.log(`Accepted         : ${accepted}`);

        // Test cases table
        if (cases.length > 0) {
          console.log('');
          const caseHeader = [
            'Seed'.padStart(6),
            'Score'.padStart(10),
            'Relative'.padStart(10),
            'Time'.padStart(10),
            'Status'.padEnd(10),
          ].join(' | ');
          console.log(caseHeader);
          console.log('-'.repeat(caseHeader.length));

          cases.forEach((c: { seed: number; score: number | null; relativeScore: number | null; executionTime: number | null; status: string }) => {
            const score = c.score != null ? Math.round(c.score).toLocaleString('en-US') : '-';
            const rel = c.relativeScore != null ? `${(c.relativeScore * 100).toFixed(2)}%` : '-';
            const caseTime = c.executionTime != null ? `${Math.round(c.executionTime * 1000)}ms` : '-';
            console.log([
              String(c.seed).padStart(6),
              score.padStart(10),
              rel.padStart(10),
              caseTime.padStart(10),
              c.status.padEnd(10),
            ].join(' | '));
          });
        }
      }
    } catch (error) {
      console.error('Error fetching result:', error);
      process.exit(1);
    }
  });

// Results latest command
resultsCommand
  .command('latest')
  .description('Get the latest execution result')
  .option('-d, --directory <path>', 'Target directory (defaults to current directory)')
  .action(async (options) => {
    const isRunning = await isServerRunning();
    if (!isRunning) {
      console.error('Error: Server is not running. Start it with "phst launch"');
      process.exit(1);
    }

    try {
      const workspaceId = await getWorkspaceId(options.directory);
      const response = await fetch(`${SERVER_URL}/api/workspaces/${workspaceId}/executions`);
      if (!response.ok) {
        console.error('Failed to fetch execution history');
        process.exit(1);
      }

      const data = await response.json();
      if (data.length === 0) {
        console.error('No execution results found');
        process.exit(1);
      }

      const latest = data[0];
      console.log(JSON.stringify(latest, null, 2));
    } catch (error) {
      console.error('Error fetching latest result:', error);
      process.exit(1);
    }
  });

// Results update command
resultsCommand
  .command('update <execution-id>')
  .description('Update execution data (e.g., comment)')
  .option('-d, --directory <path>', 'Target directory (defaults to current directory)')
  .option('-c, --comment <string>', 'New comment for the execution')
  .action(async (executionId, options) => {
    const isRunning = await isServerRunning();
    if (!isRunning) {
      console.error('Error: Server is not running. Start it with "phst launch"');
      process.exit(1);
    }

    if (options.comment === undefined) {
      console.error('Error: At least one field to update must be provided (--comment)');
      process.exit(1);
    }

    try {
      const workspaceId = await getWorkspaceId(options.directory);
      const updateData: { comment?: string | null } = {};

      if (options.comment !== undefined) {
        updateData.comment = options.comment || null;
      }

      const response = await fetch(
        `${SERVER_URL}/api/workspaces/${workspaceId}/executions/${executionId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`Failed to update execution: ${errorData.error || 'Unknown error'}`);
        process.exit(1);
      }

      const updated = await response.json();
      console.log('Execution updated successfully:');
      console.log(JSON.stringify(updated, null, 2));
    } catch (error) {
      console.error('Error updating execution:', error);
      process.exit(1);
    }
  });

// AWS commands
const awsCommand = program.command('aws').description('AWS Lambda related commands');

awsCommand
  .command('deploy-tools [directory]')
  .description(
    'Upload built tool binaries (gen, tester, vis) to S3 for Lambda execution\n\n' +
    'Requires [aws_lambda] section in pahcer_config.toml:\n\n' +
    '  [aws_lambda]\n' +
    '  region = "ap-northeast-1"\n' +
    '  function_name = "ahc-tester"\n' +
    '  tools_bucket = "ahc-tester-tools-XXXX"\n' +
    '  parallel = 10\n' +
    '  # profile = "admin"  # optional: AWS profile (default: credential chain)',
  )
  .action(async (directory) => {
    const isRunning = await isServerRunning();
    if (!isRunning) {
      console.log('Server not running, starting server first...');
      await startServer(false);
    }

    try {
      const workspace = await getWorkspace(directory);
      console.log(`Deploying tools for workspace: ${workspace.targetDirectory}`);

      const response = await fetch(
        `${SERVER_URL}/api/workspaces/${workspace.id}/aws/deploy-tools`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to deploy tools:', errorData.error || 'Unknown error');
        process.exit(1);
      }

      const result = await response.json();
      console.log(`Uploaded tools: ${result.uploaded.join(', ')}`);
    } catch (error) {
      console.error('Error deploying tools:', error);
      process.exit(1);
    }
  });

awsCommand
  .command('status [directory]')
  .description('Show AWS Lambda configuration status')
  .action(async (directory) => {
    const isRunning = await isServerRunning();
    if (!isRunning) {
      console.log('Server not running, starting server first...');
      await startServer(false);
    }

    try {
      const workspace = await getWorkspace(directory);
      const response = await fetch(
        `${SERVER_URL}/api/workspaces/${workspace.id}/config`,
      );

      if (!response.ok) {
        console.error('Failed to fetch config');
        process.exit(1);
      }

      const config = await response.json();
      const lambdaConfig = config.aws_lambda;

      if (!lambdaConfig) {
        console.log('No [aws_lambda] section found in pahcer_config.toml');
        console.log('Lambda execution is not configured.');
        return;
      }

      console.log('AWS Lambda Configuration:');
      console.log(`  Default: ${lambdaConfig.default ? 'Lambda' : 'Local'}`);
      console.log(`  Region: ${lambdaConfig.region}`);
      console.log(`  Function: ${lambdaConfig.function_name}`);
      console.log(`  Parallel: ${lambdaConfig.parallel || 10}`);
      console.log(`  Tools Bucket: ${lambdaConfig.tools_bucket}`);
      if (lambdaConfig.profile) console.log(`  Profile: ${lambdaConfig.profile}`);
    } catch (error) {
      console.error('Error fetching status:', error);
      process.exit(1);
    }
  });

program
  .name('pahcer-studio')
  .description('CLI tool for pahcer-studio')
  .version(packageJson.version);

program.parse(process.argv);
