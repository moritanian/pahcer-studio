import type { TestExecution, TestExecutionStatus, TestCase } from '../schemas/execution';
import type { Workspace } from '../schemas/workspace';

/**
 * テスト実行データアクセス層のインターフェース。
 *
 * `TestExecution` スキーマに準拠したデータの永続化を責務に持つ。
 */
export interface IExecutionRepository {
  /**
   * テスト実行情報を保存する
   */
  save(execution: TestExecution, workspace: Workspace): Promise<void>;

  /**
   * IDでテスト実行情報を取得する
   */
  findById(id: string, workspace: Workspace): Promise<TestExecution | null>;

  /**
   * 全てのテスト実行情報を取得する
   */
  findAll(workspace: Workspace): Promise<TestExecution[]>;

  /**
   * 実行ステータスを更新する
   */
  updateStatus(id: string, status: TestExecutionStatus, workspace: Workspace): Promise<void>;

  /**
   * 実行進行状況を更新する
   */
  updateProgress(id: string, data: Partial<TestExecution>, workspace: Workspace): Promise<void>;

  /**
   * 実行を削除する
   */
  delete(id: string, workspace: Workspace): Promise<void>;

  /**
   * 実行IDでテストケース一覧を取得する
   */
  findTestCasesByExecutionId(id: string, workspace: Workspace): Promise<TestCase[]>;

  /**
   * 実行IDとシード値でテストケースの結果（標準出力）を取得する
   */
  findTestCaseResult(id: string, seed: number, workspace: Workspace): Promise<string | null>;

  /**
   * executionId から summary.json の絶対パスを取得する
   * ファイル読み込みは行わず、呼び出し側が必要に応じて利用します。
   */
  getSummaryPath(id: string, workspace: Workspace): string;
}
