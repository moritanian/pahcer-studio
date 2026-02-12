import * as fs from 'fs/promises';
import * as path from 'path';
import {
  type TestExecution,
  type TestExecutionStatus,
  TestExecutionSchema,
  type TestCase,
} from '../schemas/execution';
import type { Workspace } from '../schemas/workspace';
import type { IExecutionRepository } from './IExecutionRepository';
import { PathHelper } from '../infrastructure/PathHelper';
import { ScoreAnalysisService } from '../services/ScoreAnalysisService';
import type { SummaryJson, SummaryCaseRaw } from '../types/summary';

/**
 * ファイルシステムベースのExecutionRepository実装。
 * PythonのPahcerServiceのファイル構造（results/{id}/...）を模倣する。
 */
export class ExecutionRepository implements IExecutionRepository {
  private scoreAnalysisService: ScoreAnalysisService;

  constructor() {
    this.scoreAnalysisService = new ScoreAnalysisService();
  }

  /**
   * resultsDirectory を取得する
   */
  private getResultsDirectory(workspace: Workspace): string {
    return PathHelper.getResultsDirectory(workspace.targetDirectory);
  }

  private getExecutionDirPath(id: string, workspace: Workspace): string {
    return PathHelper.getExecutionDirectory(workspace.targetDirectory, id);
  }

  private getExecutionInfoPath(id: string, workspace: Workspace): string {
    return PathHelper.getExecutionInfoPath(workspace.targetDirectory, id);
  }

  getSummaryPath(id: string, workspace: Workspace): string {
    return PathHelper.getSummaryPath(workspace.targetDirectory, id);
  }

  /**
   * 共通ユーティリティ: JSONファイルを読み込んでオブジェクトを返します。
   * ファイルが存在しない場合は null を返し、それ以外のエラーは上位に伝播させます。
   */
  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** ファイル/ディレクトリの存在確認 */
  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * テスト実行情報（execution_info.json）を保存/更新する
   */
  async save(execution: TestExecution, workspace: Workspace): Promise<void> {
    const executionDir = this.getExecutionDirPath(execution.id, workspace);
    await fs.mkdir(executionDir, { recursive: true });

    const filePath = this.getExecutionInfoPath(execution.id, workspace);
    const validated = TestExecutionSchema.safeParse(execution);
    if (!validated.success) {
      throw new Error(`Invalid execution object supplied for id ${execution.id}`);
    }

    await fs.writeFile(filePath, JSON.stringify(validated.data, null, 2), 'utf8');
  }

  /**
   * IDでテスト実行情報を取得する。
   * execution_info.json と summary.json をマージして返す。
   */
  async findById(id: string, workspace: Workspace): Promise<TestExecution | null> {
    // execution_info.json
    const infoData = await this.readJsonFile<unknown>(this.getExecutionInfoPath(id, workspace));
    let execution: TestExecution | null = null;

    if (infoData) {
      const parsed = TestExecutionSchema.safeParse(infoData);
      if (parsed.success) {
        execution = parsed.data;
      } else {
        console.error(`execution_info.json for ${id} is invalid, ignoring.`);
      }
    }

    // summary.json
    const summaryData = await this.readJsonFile<SummaryJson>(this.getSummaryPath(id, workspace));
    if (summaryData) {
      if (!execution) {
        execution = {
          id,
          status: 'COMPLETED',
          startTime: new Date().toISOString(),
          comment: null,
          averageScore: 0,
          averageRelativeScore: 0,
          acceptedCount: null,
          totalCount: null,
          maxExecutionTime: null,
        } as TestExecution;
      }
      execution = await this.mergeWithSummary(execution, summaryData, workspace);
    }

    // ディレクトリ自体が存在しない場合は null
    if (!(await this.exists(this.getExecutionDirPath(id, workspace)))) {
      return null;
    }

    return execution;
  }

  /**
   * テストケースの出力ファイルパスを取得
   */
  private getTestCaseOutputFilePath(
    executionId: string,
    seed: number,
    workspace: Workspace,
  ): string {
    const outputFileName = `${String(seed).padStart(4, '0')}.txt`;
    return path.join(
      PathHelper.getCaseOutputsDirectory(workspace.targetDirectory, executionId),
      outputFileName,
    );
  }

  /**
   * 実行IDでテストケース一覧を取得する
   */
  async findTestCasesByExecutionId(id: string, workspace: Workspace): Promise<TestCase[]> {
    const summaryData = await this.readJsonFile<SummaryJson>(this.getSummaryPath(id, workspace));
    if (!summaryData?.cases || !Array.isArray(summaryData.cases)) {
      return [];
    }

    return await this.scoreAnalysisService.enrichTestCasesWithRelativeScore(
      summaryData.cases,
      workspace,
    );
  }

  /**
   * 実行IDとシード値でテストケースの結果（標準出力）を取得する
   */
  async findTestCaseResult(id: string, seed: number, workspace: Workspace): Promise<string | null> {
    const summaryData = await this.readJsonFile<SummaryJson>(this.getSummaryPath(id, workspace));
    if (!summaryData?.cases || !Array.isArray(summaryData.cases)) {
      return null;
    }

    const caseIndex = summaryData.cases.findIndex((c: SummaryCaseRaw) => c.seed === seed);
    if (caseIndex === -1) return null;

    const outputFilePath = this.getTestCaseOutputFilePath(id, seed, workspace);

    try {
      return await fs.readFile(outputFilePath, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * 全てのテスト実行情報を取得する
   */
  async findAll(workspace: Workspace): Promise<TestExecution[]> {
    try {
      const resultsDir = this.getResultsDirectory(workspace);
      const entries = await fs.readdir(resultsDir, { withFileTypes: true });
      const executionIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      const executions = await Promise.all(
        executionIds.map((id) =>
          this.findById(id, workspace).catch((err) => {
            console.error(`Failed to load execution ${id}:`, err);
            return null;
          }),
        ),
      );

      const validExecutions = executions.filter((e): e is TestExecution => e !== null);

      return validExecutions.sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
        return timeB - timeA;
      });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to load all executions: ${error}`);
    }
  }

  /**
   * 実行ステータスを更新する
   */
  async updateStatus(id: string, status: TestExecutionStatus, workspace: Workspace): Promise<void> {
    const execution = await this.findById(id, workspace);
    if (!execution) {
      // ステータス更新時に実行が見つからない場合、警告を出すか、何もしない。
      // ここでは何もしないことを選択するが、プロジェクトによってはエラーを投げるべきかもしれない。
      console.error(`Execution ${id} not found for status update, skipping.`);
      return;
    }
    execution.status = status;
    await this.save(execution, workspace);
  }

  /**
   * 実行進行状況を更新する
   */
  async updateProgress(
    id: string,
    data: Partial<TestExecution>,
    workspace: Workspace,
  ): Promise<void> {
    let execution = await this.findById(id, workspace);
    if (!execution) {
      // 実行情報がない場合は、最低限の情報で新規作成する
      execution = {
        id: id,
        status: 'RUNNING',
        startTime: new Date().toISOString(),
        comment: null,
        averageScore: 0,
        averageRelativeScore: 0,
        acceptedCount: null,
        totalCount: null,
        maxExecutionTime: null,
      };
    }

    Object.assign(execution, data);
    await this.save(execution, workspace);
  }

  /**
   * 実行を削除する
   */
  async delete(id: string, workspace: Workspace): Promise<void> {
    try {
      const executionDir = this.getExecutionDirPath(id, workspace);
      await fs.rm(executionDir, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Failed to delete execution directory ${id}: ${error}`);
    }
  }

  /**
   * summary.json のデータで TestExecution オブジェクトを更新するヘルパー
   */
  private async mergeWithSummary(
    execution: TestExecution,
    summary: SummaryJson,
    workspace: Workspace,
  ): Promise<TestExecution> {
    // ScoreAnalysisServiceを使って統計情報を計算
    const stats = await this.scoreAnalysisService.calculateExecutionStats(summary, workspace);

    return {
      ...execution,
      comment: execution.comment || summary.comment || '',
      totalCount: stats.totalCount,
      acceptedCount: stats.acceptedCount,
      averageScore: stats.averageScore,
      averageRelativeScore: stats.averageRelativeScore,
      maxExecutionTime: stats.maxExecutionTime,
    };
  }
}
