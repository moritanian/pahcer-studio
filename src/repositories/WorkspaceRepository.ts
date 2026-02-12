import * as fs from 'fs/promises';
import * as path from 'path';
import type { Workspace } from '../schemas/workspace';
import type { IWorkspaceRepository } from './IWorkspaceRepository';

/**
 * ワークスペースの状態管理を行うリポジトリ
 * workspace IDをキーに複数のworkspaceを管理し、永続化する
 */
export class WorkspaceRepository implements IWorkspaceRepository {
  private workspaces: Map<string, Workspace> = new Map();
  private readonly storageDir: string;
  private readonly storageFile: string;
  private readonly enablePersistence: boolean;

  /**
   * @param storageDir ストレージディレクトリ（テスト用にカスタマイズ可能）
   * @param enablePersistence 永続化を有効にするか（テスト時はfalse推奨）
   */
  constructor(storageDir?: string, enablePersistence: boolean = true) {
    // ストレージディレクトリのデフォルトは [app dir]/data/settings
    this.storageDir = storageDir || path.join(process.cwd(), 'data', 'settings');
    this.storageFile = path.join(this.storageDir, 'workspaces.json');
    this.enablePersistence = enablePersistence;

    // 初期化時にファイルから読み込む（永続化が有効な場合のみ）
    if (this.enablePersistence) {
      this.load().catch((error) => {
        console.error('Failed to load workspaces:', error);
      });
    }
  }

  /**
   * workspace IDをキーにworkspaceを保存する
   */
  saveWorkspace(workspace: Workspace): void {
    this.workspaces.set(workspace.id, workspace);
    if (this.enablePersistence) {
      this.persist().catch((error) => {
        console.error('Failed to persist workspaces:', error);
      });
    }
  }

  /**
   * workspace IDでworkspaceを取得する
   */
  getWorkspace(id: string): Workspace | null {
    return this.workspaces.get(id) || null;
  }

  /**
   * すべてのworkspaceを取得する
   */
  listWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * workspace IDでworkspaceを削除する
   */
  deleteWorkspace(id: string): boolean {
    const deleted = this.workspaces.delete(id);
    if (deleted && this.enablePersistence) {
      this.persist().catch((error) => {
        console.error('Failed to persist workspaces after deletion:', error);
      });
    }
    return deleted;
  }

  /**
   * すべてのworkspaceをクリアする（テスト用）
   */
  clear(): void {
    this.workspaces.clear();
  }

  /**
   * ファイルからworkspaceデータを読み込む
   */
  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storageFile, 'utf-8');
      const workspacesArray: Workspace[] = JSON.parse(data);
      this.workspaces = new Map(workspacesArray.map((ws) => [ws.id, ws]));
    } catch (error) {
      // ファイルが存在しない場合は空のMapから開始
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * workspaceデータをファイルに永続化する
   */
  private async persist(): Promise<void> {
    try {
      // ディレクトリが存在しない場合は作成
      await fs.mkdir(this.storageDir, { recursive: true });

      const workspacesArray = Array.from(this.workspaces.values());
      await fs.writeFile(this.storageFile, JSON.stringify(workspacesArray, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to persist workspaces to file:', error);
      throw error;
    }
  }
}
