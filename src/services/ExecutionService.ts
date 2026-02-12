import { EventEmitter } from 'events';

import type {
  TestExecution,
  TestExecutionRequest,
  TestExecutionStatus,
  LogMessage,
  TestCase,
} from '../schemas/execution';
import type { Workspace } from '../schemas/workspace';
import type { IExecutionRepository } from '../repositories/IExecutionRepository';
import type { IWorkspaceRepository } from '../repositories/IWorkspaceRepository';
import type { ProcessManager } from '../infrastructure/ProcessManager';
import { ConfigService } from './ConfigService';
import { ScoreAnalysisService } from './ScoreAnalysisService';

/**
 * pacherツール実行のオーケストレーションを行うサービスクラス。
 * PythonのPahcerServiceのロジックを参考に、関心事を分離した形で実装。
 */
export class ExecutionService extends EventEmitter {
  private readonly configService: ConfigService;
  private readonly scoreAnalysisService: ScoreAnalysisService;

  constructor(
    private readonly executionRepository: IExecutionRepository,
    private readonly workspaceRepository: IWorkspaceRepository,
    private readonly processManager: ProcessManager,
    configService: ConfigService,
    scoreAnalysisService: ScoreAnalysisService,
  ) {
    super();
    this.configService = configService;
    this.scoreAnalysisService = scoreAnalysisService;
  }

  /**
   * テスト実行を開始する
   */
  async startExecution(request: TestExecutionRequest, workspace: Workspace): Promise<string> {
    const executionId = await this.generateNextExecutionId(workspace);

    // Python側と同じように、pahcer_config.tomlを更新
    this.emitLog(executionId, 'info', 'Updating pahcer_config.toml for test execution...');
    const configUpdated = await this.configService.updateConfigForTest(
      request.testCaseCount,
      request.startSeed,
      workspace,
    );

    if (!configUpdated) {
      this.emitLog(
        executionId,
        'warn',
        'Failed to update pahcer_config.toml, but continuing execution...',
      );
    } else {
      this.emitLog(
        executionId,
        'info',
        `Config updated: start_seed=${request.startSeed}, end_seed=${
          request.startSeed + request.testCaseCount
        }`,
      );
    }

    // リポジトリに初期状態を保存させる。
    // ProcessManagerが実行前にexecution_info.jsonを作成するが、
    // ここでもリポジトリ層に初期データを渡しておく。
    const initialExecution: TestExecution = {
      id: executionId,
      status: 'IDLE',
      startTime: new Date().toISOString(),
      comment: request.comment,
      averageScore: 0,
      averageRelativeScore: 0,
      acceptedCount: null,
      totalCount: request.testCaseCount,
      maxExecutionTime: null,
    };
    await this.executionRepository.save(initialExecution, workspace);

    // 非同期でpacher実行を開始
    this.executePacher(executionId, request, workspace).catch((error) => {
      console.error(`Execution ${executionId} failed fatally:`, error);
      this.updateExecutionStatus(executionId, 'FAILED', workspace);
    });

    return executionId;
  }

  /**
   * テスト実行を停止する
   */
  async stopExecution(executionId: string, workspace: Workspace): Promise<void> {
    const killed = this.processManager.killProcess(executionId);
    if (killed) {
      // プロセス停止直後にconfigを復元
      const configRestored = await this.configService.restoreConfig(workspace);

      if (!configRestored) {
        this.emitLog(executionId, 'warn', 'Failed to restore pahcer_config.toml from backup');
      }

      await this.updateExecutionStatus(executionId, 'CANCELLED', workspace);
    }
  }

  /**
   * 実行ステータスを取得する
   */
  async getExecutionStatus(
    executionId: string,
    workspace: Workspace,
  ): Promise<TestExecution | null> {
    return await this.executionRepository.findById(executionId, workspace);
  }

  /**
   * 全ての実行を取得する
   */
  async getAllExecutions(workspace: Workspace): Promise<TestExecution[]> {
    return await this.executionRepository.findAll(workspace);
  }

  /**
   * 指定された実行のテストケース一覧を取得する
   */
  async getTestCases(executionId: string, workspace: Workspace): Promise<TestCase[]> {
    return await this.executionRepository.findTestCasesByExecutionId(executionId, workspace);
  }

  /**
   * 指定された実行の特定のテストケースの結果（標準出力）を取得する
   */
  async getTestCaseResult(
    executionId: string,
    seed: number,
    workspace: Workspace,
  ): Promise<string | null> {
    return await this.executionRepository.findTestCaseResult(executionId, seed, workspace);
  }

  /**
   * テスト実行履歴を削除する
   */
  async deleteExecution(executionId: string, workspace: Workspace): Promise<void> {
    // 稼働中かもしれないプロセスを停止しようと試みる
    this.processManager.killProcess(executionId);
    // その後、関連ディレクトリを削除
    await this.executionRepository.delete(executionId, workspace);
    this.emitLog(executionId, 'info', `Execution data deleted.`);
    // TODO: UIに削除を通知するためのイベントを発行することもできる
    // this.emit("execution:deleted", { executionId });
  }

  /**
   * pacher実行のメインロジック
   */
  private async executePacher(
    executionId: string,
    request: TestExecutionRequest,
    workspace: Workspace,
  ): Promise<void> {
    try {
      await this.updateExecutionStatus(executionId, 'RUNNING', workspace);
      this.emitLog(executionId, 'info', `pacher test execution started: ${executionId}`);

      const result = await this.processManager.executePacher(
        request,
        workspace,
        executionId,
        (log: string) => {
          // ログの各行を個別にemitする
          this.logProcessOutput(executionId, log, 'info');
        },
      );

      // pacher実行完了直後にconfigを復元
      const configRestored = await this.configService.restoreConfig(workspace);

      if (!configRestored) {
        this.emitLog(executionId, 'warn', 'Failed to restore pahcer_config.toml from backup');
      }

      if (result.success) {
        await this.finalizeExecution(executionId, 'COMPLETED', workspace);
      } else {
        await this.finalizeExecution(executionId, 'FAILED', workspace);
      }
    } catch (error) {
      // エラーが発生した場合もconfigを復元
      const configRestored = await this.configService.restoreConfig(workspace);

      if (!configRestored) {
        this.emitLog(
          executionId,
          'warn',
          'Failed to restore pahcer_config.toml from backup after error',
        );
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emitLog(executionId, 'error', `pacher execution error: ${errorMessage}`);
      await this.finalizeExecution(executionId, 'FAILED', workspace);
    }
  }

  /**
   * 実行完了または失敗後の最終処理
   */
  private async finalizeExecution(
    executionId: string,
    status: TestExecutionStatus,
    workspace: Workspace,
  ): Promise<void> {
    // リポジトリから最新の情報を読み込む（summary.jsonとのマージ結果）
    const finalExecution = await this.executionRepository.findById(executionId, workspace);

    if (finalExecution) {
      // ステータスを更新して保存
      finalExecution.status = status;
      await this.executionRepository.save(finalExecution, workspace);

      // テスト実行が完了した場合のみ、すべての実行の相対スコアを再計算
      if (status === 'COMPLETED') {
        try {
          await this.scoreAnalysisService.recalculateAllRelativeScores(
            this.executionRepository,
            workspace,
          );
        } catch (error) {
          this.emitLog(
            executionId,
            'error',
            `Relative score recalculation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        // 相対スコア再計算後に最新のデータを再読み込み
        const updatedExecution = await this.executionRepository.findById(executionId, workspace);
        if (updatedExecution) {
          updatedExecution.status = status;

          // UIに最終結果を通知（相対スコア再計算後の最新データで）
          this.emit('execution:status', {
            executionId,
            status,
            execution: updatedExecution,
          });
          this.emit('execution:progress', { executionId, ...updatedExecution });
        }
      } else {
        // 失敗の場合は相対スコア再計算なしで即座に通知
        this.emit('execution:status', {
          executionId,
          status,
          execution: finalExecution,
        });
        this.emit('execution:progress', { executionId, ...finalExecution });

        const resultText = 'Execution failed.';
        this.emitLog(executionId, 'info', `Final result: ${resultText}`);
      }
    } else {
      // フォールバック
      await this.updateExecutionStatus(executionId, status, workspace);
    }
  }

  /**
   * 次の実行IDを生成する (id_xxxx形式)
   */
  private async generateNextExecutionId(workspace: Workspace): Promise<string> {
    const executions = await this.executionRepository.findAll(workspace);
    let maxId = 0;
    const idPattern = /^id_(\d+)$/;

    for (const execution of executions) {
      const match = execution.id.match(idPattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxId) {
          maxId = num;
        }
      }
    }

    const nextId = maxId + 1;
    return `id_${nextId.toString().padStart(4, '0')}`;
  }

  private logProcessOutput(executionId: string, output: string, level: 'info' | 'error') {
    if (output) {
      output
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line) => this.emitLog(executionId, level, line));
    }
  }

  /**
   * 実行ステータスを更新（UI通知も行う）
   */
  private async updateExecutionStatus(
    executionId: string,
    status: TestExecutionStatus,
    workspace: Workspace,
  ): Promise<void> {
    await this.executionRepository.updateStatus(executionId, status, workspace);
    const execution = await this.executionRepository.findById(executionId, workspace);
    if (execution) {
      this.emit('execution:status', { executionId, status, execution });
    }
  }

  /**
   * ログメッセージを発行
   */
  private emitLog(
    executionId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
  ): void {
    const logMessage: LogMessage = {
      timestamp: new Date().toISOString(),
      message,
    };
    this.emit('execution:log', { executionId, log: logMessage });
  }
}
