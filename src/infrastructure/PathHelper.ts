import { spawn } from 'child_process';
import * as path from 'path';

/**
 * WSLおよびパス処理に関するヘルパークラス
 */
export class PathHelper {
  /** pahcer-studio のデータディレクトリ名 */
  private static readonly PAHCER_STUDIO_DIR = 'pahcer-studio';

  /**
   * シェルコマンドの引数をエスケープする（単一引用符方式）
   */
  static escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}`;
  }

  /**
   * 実行IDごとのディレクトリパスを取得
   */
  static getExecutionDirectory(workspaceDir: string, executionId: string): string {
    return path.join(this.getResultsDirectory(workspaceDir), executionId);
  }

  /**
   * execution_info.json のパスを取得
   */
  static getExecutionInfoPath(workspaceDir: string, executionId: string): string {
    return path.join(this.getExecutionDirectory(workspaceDir, executionId), 'execution_info.json');
  }

  /**
   * summary.json のパスを取得
   */
  static getSummaryPath(workspaceDir: string, executionId: string): string {
    return path.join(this.getExecutionDirectory(workspaceDir, executionId), 'summary.json');
  }

  /**
   * case_outputs ディレクトリのパスを取得
   */
  static getCaseOutputsDirectory(workspaceDir: string, executionId: string): string {
    return path.join(this.getExecutionDirectory(workspaceDir, executionId), 'case_outputs');
  }

  /**
   * ワークスペースのルートディレクトリにある pahcer_config.toml のパスを取得
   */
  static getConfigPath(workspaceDir: string): string {
    return path.join(workspaceDir, 'pahcer_config.toml');
  }

  /**
   * アプリケーション設定ファイル (pahcer_studio_settings.json) のパスを取得
   */
  static getAppSettingsPath(userDataDir: string): string {
    return path.join(userDataDir, 'pahcer_studio_settings.json');
  }

  /**
   * pahcer_config.toml.bak のパスを取得
   */
  static getBackupPath(workspaceDir: string): string {
    return path.join(workspaceDir, 'pahcer_config.toml.bak');
  }

  /**
   * best_scores.json のパスを取得
   */
  static getBestScoresPath(workspaceDir: string): string {
    return path.join(workspaceDir, 'pahcer', 'best_scores.json');
  }

  /**
   * results ディレクトリのパスを取得
   */
  static getResultsDirectory(workspaceDir: string): string {
    return path.join(workspaceDir, this.PAHCER_STUDIO_DIR, 'data', 'results');
  }

  /**
   * analysis データディレクトリのパスを取得
   */
  static getAnalysisDataDirectory(workspaceDir: string): string {
    return path.join(workspaceDir, this.PAHCER_STUDIO_DIR, 'data', 'analysis');
  }

  /**
   * input ディレクトリのパスを取得
   */
  static getInputDirectory(workspaceDir: string): string {
    return path.join(workspaceDir, 'tools', 'in');
  }

  /**
   * visualizer ディレクトリのパスを取得
   */
  static getVisualizerDirectory(workspaceDir: string): string {
    return path.join(workspaceDir, this.PAHCER_STUDIO_DIR, 'visualizer');
  }

  /**
   * output ディレクトリのパスを取得
   */
  static getOutputDirectory(workspaceDir: string): string {
    return path.join(workspaceDir, 'tools', 'out');
  }

  /**
   * output バックアップディレクトリのパスを取得
   */
  static getOutputBackupDirectory(workspaceDir: string): string {
    return path.join(workspaceDir, 'tools', 'out_bak');
  }

  /**
   * json ディレクトリのパスを取得
   */
  static getJsonDirectory(workspaceDir: string): string {
    return path.join(workspaceDir, 'pahcer', 'json');
  }

  /**
   * wslpath コマンドを実行する（内部ヘルパー）
   * @param flag '-a' (Windows → WSL) または '-w' (WSL → Windows)
   * @param inputPath 変換するパス
   */
  private static async execWslPath(flag: '-a' | '-w', inputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('wsl', ['wslpath', flag, inputPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`WSL wslpath ${flag} command timed out (input: ${inputPath})`));
      }, 10000);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(`WSL wslpath ${flag} failed (input: ${inputPath}, stderr: ${stderr.trim()})`),
          );
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.stdin?.end();
    });
  }

  /**
   * UNC パス（\\wsl.localhost\Ubuntu-22.04\home\...）を WSL パス（/home/...）に変換する（内部ヘルパー）
   * @param uncPath UNC パス
   * @returns WSL パス、変換できない場合は null
   */
  private static convertUncToWslPath(uncPath: string): string | null {
    // \\wsl.localhost\<distro>\<path> の形式をチェック
    const match = uncPath.match(/^\\\\wsl\.localhost\\[^\\]+\\(.+)$/);
    if (match) {
      // Windows のバックスラッシュを Linux のスラッシュに変換
      return '/' + match[1].replace(/\\/g, '/');
    }
    return null;
  }

  /**
   * Windows パス（C:\... または \\wsl.localhost\...）を WSL パス（/home/...）に変換する
   * @param windowsPath Windows パス
   * @returns WSL パス
   */
  static async windowsToWsl(windowsPath: string): Promise<string> {
    // UNC パス（\\wsl.localhost\...）の場合は文字列変換
    if (windowsPath.startsWith('\\\\')) {
      const converted = this.convertUncToWslPath(windowsPath);
      if (converted) {
        return converted;
      }
      throw new Error(`Failed to convert UNC path to WSL path: ${windowsPath}`);
    }

    // Windows パス（C:\... または C:/...）の場合は wslpath -a で変換
    if (/^[a-zA-Z]:[/\\]/.test(windowsPath)) {
      return await this.execWslPath('-a', windowsPath);
    }

    // その他（既に WSL パス）はそのまま返す
    return windowsPath;
  }

  /**
   * WSL パス（/home/...）を Windows パス（C:\...）に変換する
   * @param wslPath WSL パス
   * @returns Windows パス
   */
  static async wslToWindows(wslPath: string): Promise<string> {
    return await this.execWslPath('-w', wslPath);
  }
}
