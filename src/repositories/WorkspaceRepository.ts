import type { Workspace } from '../schemas/execution';
import type { IWorkspaceRepository } from './IWorkspaceRepository';

/**
 * ワークスペースの状態管理を行うリポジトリ
 * メモリ上に現在のワークスペース情報を保持する
 */
export class WorkspaceRepository implements IWorkspaceRepository {
  private currentWorkspace: Workspace | null = null;

  /**
   * 現在のワークスペースを設定する
   */
  setWorkspace(workspace: Workspace): void {
    this.currentWorkspace = workspace;
  }

  /**
   * 現在のワークスペースを取得する
   */
  getWorkspace(): Workspace | null {
    return this.currentWorkspace;
  }
}
