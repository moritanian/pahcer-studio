import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { TestExecutionRequest } from '../schemas/execution';
import type { Workspace } from '../schemas/workspace';
import type { CaseOutputSpec } from '../services/ConfigService';
import { PathHelper } from './PathHelper';

export interface PacherExecutionResult {
  success: boolean;
  executionTime: number;
  stdout: string;
  stderr: string;
  exitCode?: number;
  errorMessage?: string;
}

/**
 * pacherツール実行と、それに伴うファイル操作を管理するクラス
 */
export class ProcessManager {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private resultsDir: string;

  constructor() {
    this.resultsDir = path.join(process.cwd(), 'data', 'results');
  }

  private processKey(workspaceId: string, executionId: string): string {
    return `${workspaceId}:${executionId}`;
  }

  /**
   * pacherツールを実行する
   */
  async executePacher(
    request: TestExecutionRequest,
    workspace: Workspace,
    executionId: string,
    onLog: (log: string) => void,
    outDir?: string | null,
    caseOutput?: CaseOutputSpec | null,
  ): Promise<PacherExecutionResult> {
    const startTime = Date.now();

    // 1. 実行ディレクトリ(CWD)の解決
    // fs操作のためにWindowsからアクセス可能なパス(UNC)が必要
    const executionCwd = workspace.targetDirectory;

    // 3. ディレクトリの準備
    const resultsDir = PathHelper.getResultsDirectory(executionCwd);
    const executionDir = path.join(resultsDir, executionId);

    try {
      // 実行ディレクトリと初期情報JSONを作成
      await fs.mkdir(executionDir, { recursive: true });
      const initialInfo = {
        id: executionId,
        status: 'RUNNING',
        startTime: new Date().toISOString(),
        comment: request.comment,
        totalCount: request.testCaseCount,
      };
      await fs.writeFile(
        PathHelper.getExecutionInfoPath(executionCwd, executionId),
        JSON.stringify(initialInfo, null, 2),
      );

      // tools/out を削除（pahcer が新しい結果を出力するため）
      const outDir = PathHelper.getOutputDirectory(executionCwd);
      try {
        await fs.rm(outDir, { recursive: true, force: true });
      } catch {
        // tools/out が存在しない場合は無視
      }

      // tools/out 以外に出力する設定では古い出力が残るので、今回の seed 分だけ消しておく
      if (caseOutput) {
        const outputPaths = await this.resolveCaseOutputPaths(caseOutput, workspace);
        await Promise.all(
          [...outputPaths.values()].map((p) => fs.rm(p, { force: true }).catch(() => {})),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${executionId}] Failed to create execution directory or initial info: ${message}`,
      );
      // この時点で失敗した場合は、プロセスを実行せずにエラーを返す
      return {
        success: false,
        executionTime: Date.now() - startTime,
        stdout: '',
        stderr: `Failed to create execution directory or initial info: ${message}`,
        errorMessage: `Failed to create execution directory or initial info: ${message}`,
      };
    }

    // 4. プロセスの実行
    // コマンドの構築をここで行う
    let cmd: string[];
    try {
      cmd = await this.buildPacherCommand(request, workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${executionId}] Failed to build command: ${message}`);
      return {
        success: false,
        executionTime: Date.now() - startTime,
        stdout: '',
        stderr: `Failed to build command: ${message}`,
        errorMessage: `Failed to build command: ${message}`,
      };
    }

    return new Promise((resolve) => {
      try {
        const child = spawn(cmd[0], cmd.slice(1), {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: executionCwd,
          // On POSIX, make the execution the leader of a new process group so
          // cancellation can also terminate descendants such as a.out.
          detached: process.platform !== 'win32',
        });

        const pKey = this.processKey(workspace.id, executionId);
        this.activeProcesses.set(pKey, child);

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
          const log = data.toString();
          stdout += log;
          onLog(log);
        });
        child.stderr?.on('data', (data) => {
          const log = data.toString();
          stderr += log;
          onLog(log);
        });

        child.on('close', async (code) => {
          this.activeProcesses.delete(pKey);
          const executionTime = Date.now() - startTime;
          const success = code === 0;

          if (success) {
            try {
              await this.saveTestResults(executionId, executionCwd, workspace, outDir, caseOutput);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error(`[${executionId}] Failed to save results: ${message}`);
            }
          }

          resolve({
            success,
            executionTime,
            stdout,
            stderr,
            exitCode: code ?? undefined,
            errorMessage: success ? undefined : stderr || `Process exited with code ${code}`,
          });
        });

        child.on('error', async (error) => {
          this.activeProcesses.delete(pKey);

          resolve({
            success: false,
            executionTime: Date.now() - startTime,
            stdout,
            stderr,
            errorMessage: error.message,
          });
        });

        child.stdin?.end();
      } catch (error) {
        // spawn自体のエラー
        const message = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          executionTime: Date.now() - startTime,
          stdout: '',
          stderr: message,
          errorMessage: message,
        });
      }
    });
  }

  /**
   * pacherコマンドの引数配列を構築する
   * Pythonコード(pahcer_service.py)の仕様に合わせる
   */
  private async buildPacherCommand(
    request: TestExecutionRequest,
    workspace: Workspace,
  ): Promise<string[]> {
    const cmd = ['pahcer', 'run'];

    if (request.comment) cmd.push('-c', request.comment);
    if (request.shuffle) cmd.push('--shuffle');
    if (request.freezeBestScores) cmd.push('--freeze-best-scores');
    if (request.settingFile) cmd.push('--setting-file', request.settingFile);

    // WSL モードの場合、linuxExecutionCwd を使用
    if (workspace.useWsl) {
      // Windows パスまたは UNC パスを WSL パスに変換
      const linuxExecutionCwd = await PathHelper.windowsToWsl(workspace.targetDirectory);

      // WSLモード: wsl --shell-type login --cd <path> pahcer run ...
      cmd.unshift('wsl', '--shell-type', 'login', '--cd', linuxExecutionCwd);
    }

    return cmd;
  }

  /**
   * プロセスを強制終了する
   */
  killProcess(workspaceId: string, executionId: string): boolean {
    const key = this.processKey(workspaceId, executionId);
    const child = this.activeProcesses.get(key);
    if (child) {
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try {
          // A negative PID targets the process group created with detached.
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The group may already have exited between lookup and cancellation.
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
      this.activeProcesses.delete(key);
      return true;
    }
    return false;
  }

  /**
   * テスト結果を実行IDごとのフォルダに保存する
   * Pythonコード(_save_test_results)のロジックを再現
   */
  private async saveTestResults(
    executionId: string,
    workingDir: string,
    workspace: Workspace,
    outDir?: string | null,
    caseOutput?: CaseOutputSpec | null,
  ): Promise<void> {
    const targetDir = workspace.targetDirectory;

    // out_dir に基づいてディレクトリを解決
    const pahcerOutDir = outDir
      ? path.resolve(workingDir, outDir)
      : path.join(workingDir, 'pahcer');

    // 1. 最新のサマリーJSONをコピー
    const jsonDir = path.join(pahcerOutDir, 'json');
    try {
      // コピー元のディレクトリが存在するか確認
      await fs.access(jsonDir);

      const jsonFiles = (await fs.readdir(jsonDir)).filter((f) => f.endsWith('.json'));
      if (jsonFiles.length > 0) {
        const fileStats = await Promise.all(
          jsonFiles.map(async (file) => {
            const filePath = path.join(jsonDir, file);
            const stat = await fs.stat(filePath);
            return { file, stat };
          }),
        );
        const latestFile = fileStats.sort(
          (a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime(),
        )[0];

        const srcPath = path.join(jsonDir, latestFile.file);
        const destPath = PathHelper.getSummaryPath(targetDir, executionId);
        await fs.copyFile(srcPath, destPath);
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        console.error(`[${executionId}] Source directory for summary not found: ${jsonDir}`);
      } else {
        console.error(`[${executionId}] Could not save summary.json. Error:`, error);
      }
    }

    // 2. ケースごとの出力ファイルをコピー
    const caseOutputsDir = PathHelper.getCaseOutputsDirectory(targetDir, executionId);
    await fs.mkdir(caseOutputsDir, { recursive: true }).catch(() => {});

    if (caseOutput) {
      // 設定の test_steps[].stdout から各 seed の出力先を解決してコピーする
      const outputPaths = await this.resolveCaseOutputPaths(caseOutput, workspace);
      for (const [seed, srcPath] of outputPaths) {
        const destPath = path.join(caseOutputsDir, `${String(seed).padStart(4, '0')}.txt`);
        await fs.copyFile(srcPath, destPath).catch(() => {
          // 出力が無い seed（実行失敗など）はスキップ
        });
      }
      return;
    }

    const caseOutDir = PathHelper.getOutputDirectory(workingDir);
    try {
      const outFiles = await fs.readdir(caseOutDir);
      for (const file of outFiles) {
        if (file.endsWith('.txt')) {
          const caseNum = parseInt(path.basename(file, '.txt'));
          if (!isNaN(caseNum)) {
            const destName = `${String(caseNum).padStart(4, '0')}.txt`;
            const srcPath = path.join(caseOutDir, file);
            const destPath = path.join(caseOutputsDir, destName);
            await fs.copyFile(srcPath, destPath);
          }
        }
      }
    } catch {
      // tools/out not found is normal in some cases
    }
  }

  /**
   * stdout テンプレートの {SEED} / {SEED04} を置換し、seed ごとの出力ファイルパスを返す。
   * pahcer と同じく、相対パスはワークスペース（pahcer の実行ディレクトリ）基準で解決する。
   */
  private async resolveCaseOutputPaths(
    caseOutput: CaseOutputSpec,
    workspace: Workspace,
  ): Promise<Map<number, string>> {
    const { stdoutTemplate, startSeed, endSeed } = caseOutput;
    const replaceSeed = (s: string, seed: number) =>
      s.split('{SEED}').join(String(seed)).split('{SEED04}').join(String(seed).padStart(4, '0'));

    // WSL モードでは設定内の絶対パスは Linux パスなので、fs から触れる Windows パスに変換する
    let toFsPath = (p: string) => path.resolve(workspace.targetDirectory, p);
    if (workspace.useWsl && stdoutTemplate.startsWith('/')) {
      const dir = path.posix.dirname(stdoutTemplate);
      if (dir.includes('{SEED')) {
        // ディレクトリ名に seed を含む稀なケースは変換できないのでスキップ
        console.warn(`Unsupported stdout template on WSL: ${stdoutTemplate}`);
        return new Map();
      }
      const windowsDir = await PathHelper.wslToWindows(dir);
      toFsPath = (p: string) => path.join(windowsDir, path.posix.basename(p));
    }

    const result = new Map<number, string>();
    for (let seed = startSeed; seed < endSeed; seed++) {
      result.set(seed, toFsPath(replaceSeed(stdoutTemplate, seed)));
    }
    return result;
  }
}
