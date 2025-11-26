import type { Workspace } from '../schemas/execution';

/**
 * ワークスペースの状態管理を行うリポジトリのインターフェース
 */
export interface IWorkspaceRepository {
  /**
   * 現在のワークスペースを設定する
   */
  setWorkspace(workspace: Workspace): void;

  /**
   * 現在のワークスペースを取得する
   */
  getWorkspace(): Workspace | null;
}
