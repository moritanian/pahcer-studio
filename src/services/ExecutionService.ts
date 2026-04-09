import { EventEmitter } from 'events';

import type {
  TestExecution,
  TestExecutionRequest,
  TestExecutionStatus,
  LogMessage,
  TestCase,
} from '../schemas/execution';
import type { Workspace } from '../schemas/workspace';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { IExecutionRepository } from '../repositories/IExecutionRepository';
import type { IWorkspaceRepository } from '../repositories/IWorkspaceRepository';
import type { ProcessManager } from '../infrastructure/ProcessManager';
import { ConfigService } from './ConfigService';
import { ScoreAnalysisService } from './ScoreAnalysisService';
import { LambdaService } from './LambdaService';
import { ResultProcessor } from './ResultProcessor';
import type { SeedResult } from './ResultProcessor';

/**
 * pacherツール実行のオーケストレーションを行うサービスクラス。
 * PythonのPahcerServiceのロジックを参考に、関心事を分離した形で実装。
 */
export class ExecutionService extends EventEmitter {
  private readonly configService: ConfigService;
  private readonly scoreAnalysisService: ScoreAnalysisService;
  private readonly lambdaService: LambdaService;
  private readonly resultProcessor: ResultProcessor;
  private readonly runningExecutions = new Set<string>();
  private readonly executionTempConfigs = new Map<string, string>();
  private readonly lambdaAbortControllers = new Map<string, AbortController>();

  constructor(
    private readonly executionRepository: IExecutionRepository,
    private readonly workspaceRepository: IWorkspaceRepository,
    private readonly processManager: ProcessManager,
    configService: ConfigService,
    scoreAnalysisService: ScoreAnalysisService,
    lambdaService: LambdaService,
    resultProcessor: ResultProcessor,
  ) {
    super();
    this.configService = configService;
    this.scoreAnalysisService = scoreAnalysisService;
    this.lambdaService = lambdaService;
    this.resultProcessor = resultProcessor;
  }

  /**
   * テスト実行を開始する
   */
  async startExecution(request: TestExecutionRequest, workspace: Workspace): Promise<string> {
    // 同時実行チェック
    if (this.runningExecutions.has(workspace.id)) {
      throw new Error('このワークスペースでは既に実行が進行中です');
    }

    const executionId = await this.generateNextExecutionId(workspace);
    this.runningExecutions.add(workspace.id);

    // 一時設定ファイルを作成（元のファイルには触れない）
    this.emitLog(executionId, 'info', 'Creating temp config for test execution...');
    const tempConfigPath = await this.configService.createTempConfigForTest(
      request.testCaseCount,
      request.startSeed,
      workspace,
      request.settingFile,
    );

    if (!tempConfigPath) {
      this.emitLog(
        executionId,
        'warn',
        'Failed to create temp config, but continuing execution...',
      );
    } else {
      this.executionTempConfigs.set(executionId, tempConfigPath);
      // 一時ファイルを --setting-file として使うようリクエストを上書き
      request = { ...request, settingFile: tempConfigPath };
      this.emitLog(
        executionId,
        'info',
        `Temp config created: ${tempConfigPath}`,
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

    // Lambda or Local execution
    const pahcerConfig = await this.configService.getConfig(workspace);
    const useLambda = request.useLambda ?? pahcerConfig.aws_lambda?.default ?? false;

    if (useLambda) {
      this.executeLambda(executionId, request, pahcerConfig, workspace).catch((error) => {
        console.error(`Lambda execution ${executionId} failed fatally:`, error);
        this.updateExecutionStatus(executionId, 'FAILED', workspace);
        this.runningExecutions.delete(workspace.id);
      });
    } else {
      // 非同期でpacher実行を開始
      this.executePacher(executionId, request, workspace).catch((error) => {
        console.error(`Execution ${executionId} failed fatally:`, error);
        this.updateExecutionStatus(executionId, 'FAILED', workspace);
        this.runningExecutions.delete(workspace.id);
      });
    }

    return executionId;
  }

  /**
   * テスト実行を停止する
   */
  async stopExecution(executionId: string, workspace: Workspace): Promise<void> {
    // Try local process first
    const killed = this.processManager.killProcess(executionId);
    if (killed) {
      await this.cleanupTempConfig(executionId);
      await this.updateExecutionStatus(executionId, 'CANCELLED', workspace);
      this.runningExecutions.delete(workspace.id);
      return;
    }

    // Try Lambda abort
    const controller = this.lambdaAbortControllers.get(executionId);
    if (controller) {
      controller.abort();
      this.lambdaAbortControllers.delete(executionId);
      await this.cleanupTempConfig(executionId);
      await this.updateExecutionStatus(executionId, 'CANCELLED', workspace);
      this.runningExecutions.delete(workspace.id);
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
    // 実行中フラグをクリア
    this.runningExecutions.delete(workspace.id);
    // その後、関連ディレクトリを削除
    await this.executionRepository.delete(executionId, workspace);
    this.emitLog(executionId, 'info', `Execution data deleted.`);
    // TODO: UIに削除を通知するためのイベントを発行することもできる
    // this.emit("execution:deleted", { executionId });
  }

  /**
   * 一時設定ファイルを削除する
   */
  private async cleanupTempConfig(executionId: string): Promise<void> {
    const tempPath = this.executionTempConfigs.get(executionId);
    if (tempPath) {
      await this.configService.cleanupTempConfig(tempPath);
      this.executionTempConfigs.delete(executionId);
    }
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

      // 一時設定ファイルを削除
      await this.cleanupTempConfig(executionId);

      if (result.success) {
        await this.finalizeExecution(executionId, 'COMPLETED', workspace);
      } else {
        await this.finalizeExecution(executionId, 'FAILED', workspace);
      }
    } catch (error) {
      // エラーが発生した場合も一時ファイルを削除
      await this.cleanupTempConfig(executionId);

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emitLog(executionId, 'error', `pacher execution error: ${errorMessage}`);
      await this.finalizeExecution(executionId, 'FAILED', workspace);
    }
  }

  /**
   * Lambda実行のメインロジック
   */
  private async executeLambda(
    executionId: string,
    request: TestExecutionRequest,
    pahcerConfig: import('./ConfigService').PahcerConfig,
    workspace: Workspace,
  ): Promise<void> {
    const abortController = new AbortController();
    this.lambdaAbortControllers.set(executionId, abortController);
    const startTime = new Date().toISOString();
    try {
      await this.updateExecutionStatus(executionId, 'RUNNING', workspace);

      const lambdaConfig = pahcerConfig.aws_lambda;
      if (!lambdaConfig) {
        throw new Error('[aws_lambda] section not found in pahcer_config.toml');
      }

      // Determine seed range
      const startSeed = request.startSeed ?? pahcerConfig.test?.start_seed ?? 0;
      const endSeed = request.testCaseCount != null
        ? startSeed + request.testCaseCount
        : (pahcerConfig.test?.end_seed ?? startSeed + 100);
      const seeds: number[] = [];
      for (let i = startSeed; i < endSeed; i++) {
        seeds.push(i);
      }

      const parallel = lambdaConfig.parallel || 10;

      // Run compile_steps locally before Lambda invoke
      const compileSteps = pahcerConfig.test?.compile_steps || [];
      if (compileSteps.length > 0) {
        const execFileAsync = promisify(execFile);
        for (const step of compileSteps) {
          const program = step.program;
          const args = step.args || [];
          const cwd = step.current_dir
            ? path.resolve(workspace.targetDirectory, step.current_dir)
            : workspace.targetDirectory;
          try {
            await execFileAsync(program, args, { cwd });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Compile step failed: ${program} ${args.join(' ')}\n${msg}`);
          }
        }
      }

      // Resolve binary path from first test_step's program
      const testSteps = pahcerConfig.test?.test_steps || [];
      if (testSteps.length === 0) {
        throw new Error('No test_steps defined in pahcer_config.toml');
      }
      const binaryPath = path.resolve(workspace.targetDirectory, testSteps[0].program);
      this.emitLog(executionId, 'info', `[Lambda] seeds: ${seeds.length} (${startSeed}..${endSeed - 1}), parallel: ${parallel}, function: ${lambdaConfig.function_name}`);

      // Load best scores and objective for relative score calculation
      const bestScores = await this.configService.getBestScores(workspace);
      const objective = await this.configService.getObjective(workspace);

      const log = (level: 'info' | 'error', message: string) => this.emitLog(executionId, level, message);
      const state = this.resultProcessor.createProgressState(seeds.length);

      this.resultProcessor.printHeader(log);

      // Execute on Lambda
      const allResults: SeedResult[] = await this.lambdaService.execute(
        pahcerConfig,
        workspace,
        executionId,
        binaryPath,
        seeds,
        (chunkResults) => {
          this.resultProcessor.printSeedResults(chunkResults, state, bestScores, objective, log);
          this.emit('execution:progress', {
            executionId,
            acceptedCount: state.completedCount,
            totalCount: seeds.length,
          });
        },
        abortController.signal,
      );

      // Post-processing
      await this.resultProcessor.saveSummary(executionId, allResults, workspace, {
        startTime,
        comment: request.comment || '',
        state,
      });
      if (!request.freezeBestScores) {
        await this.resultProcessor.updateBestScores(allResults, workspace, objective);
      }

      // Download case outputs in background (not blocking score display)
      this.lambdaService.downloadCaseOutputs(pahcerConfig, workspace, executionId, seeds).catch(
        (err) => console.error(`Failed to download case outputs: ${err}`),
      );

      await this.cleanupTempConfig(executionId);

      this.resultProcessor.printSummary(allResults, state, log);

      await this.finalizeExecution(executionId, 'COMPLETED', workspace);
    } catch (error) {
      await this.cleanupTempConfig(executionId);
      if (abortController.signal.aborted) {
        this.emitLog(executionId, 'info', 'Lambda execution cancelled');
        await this.finalizeExecution(executionId, 'CANCELLED', workspace);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.emitLog(executionId, 'error', `Lambda execution error: ${errorMessage}`);
        await this.finalizeExecution(executionId, 'FAILED', workspace);
      }
    } finally {
      this.lambdaAbortControllers.delete(executionId);
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
    try {
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
    } finally {
      // 必ず実行中フラグをクリア
      this.runningExecutions.delete(workspace.id);
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
