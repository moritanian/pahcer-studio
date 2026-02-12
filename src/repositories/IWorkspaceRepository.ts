import type { Workspace } from '../schemas/workspace';

/**
 * ワークスペースの状態管理を行うリポジトリのインターフェース
 */
export interface IWorkspaceRepository {
  /**
   * workspace IDをキーにworkspaceを保存する
   */
  saveWorkspace(workspace: Workspace): void;

  /**
   * workspace IDでworkspaceを取得する
   */
  getWorkspace(id: string): Workspace | null;

  /**
   * すべてのworkspaceを取得する
   */
  listWorkspaces(): Workspace[];

  /**
   * workspace IDでworkspaceを削除する
   */
  deleteWorkspace(id: string): boolean;
}
