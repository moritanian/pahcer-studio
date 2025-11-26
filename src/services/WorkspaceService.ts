import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * ワークスペースの履歴
 */
export interface WorkspaceHistory {
  path: string;
  useWsl: boolean;
  lastOpened: number; // timestamp
}

/**
 * アプリケーション全体の設定（app_setting.json）
 */
export interface AppSettings {
  projects: WorkspaceHistory[];
}

/**
 * アプリケーション全体の設定（app_setting.json）の操作を行うサービス
 */
import type { IWorkspaceRepository } from '../repositories/IWorkspaceRepository';
import type { Workspace } from '../schemas/execution';

/**
 * アプリケーション全体の設定（app_setting.json）の操作を行うサービス
 */
export class WorkspaceService {
  private readonly settingsPath: string;
  private readonly workspaceRepository: IWorkspaceRepository;

  constructor(settingsPath: string, workspaceRepository: IWorkspaceRepository) {
    this.settingsPath = settingsPath;
    this.workspaceRepository = workspaceRepository;
  }

  /**
   * ワークスペースを設定する
   */
  setWorkspace(workspace: Workspace): void {
    this.workspaceRepository.setWorkspace(workspace);
  }

  /**
   * 現在のワークスペースを取得する
   */
  getWorkspace(): Workspace | null {
    return this.workspaceRepository.getWorkspace();
  }

  /**
   * ワークスペースのディレクトリパスを取得する
   */
  getWorkspaceDirectory(): string | null {
    const workspace = this.workspaceRepository.getWorkspace();
    return workspace?.targetDirectory ?? null;
  }

  /**
   * アプリケーション全体設定（app_setting.json）を取得
   */
  async getAppSettings(): Promise<AppSettings> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      // 配列（旧形式）の場合は移行する
      if (Array.isArray(settings)) {
        return { projects: settings };
      }

      return settings as AppSettings;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return { projects: [] };
      }
      console.error(`Error loading app settings: ${error}`);
      return { projects: [] };
    }
  }

  /**
   * アプリケーション全体設定（app_setting.json）を更新
   */
  async updateAppSettings(settings: AppSettings): Promise<AppSettings> {
    try {
      // ディレクトリを作成
      await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

      // JSON ファイルに書き込む
      await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      return settings;
    } catch (error) {
      console.error(`Error updating app settings: ${error}`);
      return settings;
    }
  }
}
