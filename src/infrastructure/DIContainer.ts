import type { IExecutionRepository } from '../repositories/IExecutionRepository';
import { ExecutionRepository } from '../repositories/ExecutionRepository';
import type { IWorkspaceRepository } from '../repositories/IWorkspaceRepository';
import { WorkspaceRepository } from '../repositories/WorkspaceRepository';
import { ProcessManager } from './ProcessManager';
import { WorkspaceService } from '../services/WorkspaceService';
import { ConfigService } from '../services/ConfigService';
import { AnalysisService } from '../services/AnalysisService';
import { ExecutionService } from '../services/ExecutionService';
import { ScoreAnalysisService } from '../services/ScoreAnalysisService';
import { LambdaService } from '../services/LambdaService';
import { ResultProcessor } from '../services/ResultProcessor';

/**
 * 依存性注入コンテナ
 */
export class DIContainer {
  private static instance: DIContainer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dependencies: Map<string, any> = new Map();

  // Service singletons
  private workspaceService?: WorkspaceService;
  private configService?: ConfigService;
  private analysisService?: AnalysisService;
  private executionService?: ExecutionService;
  private scoreAnalysisService?: ScoreAnalysisService;
  private lambdaService?: LambdaService;
  private resultProcessor?: ResultProcessor;

  private constructor() {
    this.setupDependencies();
  }

  public static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  private setupDependencies(): void {
    // ProcessManagerの設定
    const processManager = new ProcessManager();
    this.dependencies.set('ProcessManager', processManager);

    // WorkspaceRepositoryの設定
    const workspaceRepository = new WorkspaceRepository();
    this.dependencies.set('IWorkspaceRepository', workspaceRepository);

    // ExecutionRepositoryの設定
    const executionRepository = new ExecutionRepository();
    this.dependencies.set('IExecutionRepository', executionRepository);
  }

  /**
   * サービスを初期化する（main.tsから呼ばれる）
   */
  public initialize(settingsPath: string): void {
    const executionRepository = this.getExecutionRepository();
    const workspaceRepository = this.getWorkspaceRepository();
    const processManager = this.getProcessManager();

    // WorkspaceServiceを初期化
    this.workspaceService = new WorkspaceService(settingsPath, workspaceRepository);

    // ConfigServiceを初期化
    this.configService = new ConfigService();

    // ScoreAnalysisServiceを初期化
    this.scoreAnalysisService = new ScoreAnalysisService();

    // LambdaServiceを初期化
    this.lambdaService = new LambdaService();

    // ResultProcessorを初期化
    this.resultProcessor = new ResultProcessor(this.configService);

    // ExecutionServiceを初期化
    this.executionService = new ExecutionService(
      executionRepository,
      workspaceRepository,
      processManager,
      this.configService,
      this.scoreAnalysisService,
      this.lambdaService,
      this.resultProcessor,
    );

    // AnalysisServiceを初期化
    this.analysisService = new AnalysisService(executionRepository, workspaceRepository);
  }

  public get<T>(key: string): T {
    const dependency = this.dependencies.get(key);
    if (!dependency) {
      throw new Error(`Dependency ${key} not found`);
    }
    return dependency;
  }

  public register<T>(key: string, instance: T): void {
    this.dependencies.set(key, instance);
  }

  // 便利メソッド
  public getExecutionRepository(): IExecutionRepository {
    return this.get<IExecutionRepository>('IExecutionRepository');
  }

  public getProcessManager(): ProcessManager {
    return this.get<ProcessManager>('ProcessManager');
  }

  public getWorkspaceRepository(): IWorkspaceRepository {
    return this.get<IWorkspaceRepository>('IWorkspaceRepository');
  }

  public getWorkspaceService(): WorkspaceService {
    if (!this.workspaceService) {
      throw new Error('DIContainer not initialized. Call initialize() first.');
    }
    return this.workspaceService;
  }

  public getConfigService(): ConfigService {
    if (!this.configService) {
      throw new Error('DIContainer not initialized. Call initialize() first.');
    }
    return this.configService;
  }

  public getAnalysisService(): AnalysisService {
    if (!this.analysisService) {
      throw new Error('DIContainer not initialized. Call initialize() first.');
    }
    return this.analysisService;
  }

  public getExecutionService(): ExecutionService {
    if (!this.executionService) {
      throw new Error('DIContainer not initialized. Call initialize() first.');
    }
    return this.executionService;
  }

  public getScoreAnalysisService(): ScoreAnalysisService {
    if (!this.scoreAnalysisService) {
      throw new Error('DIContainer not initialized. Call initialize() first.');
    }
    return this.scoreAnalysisService;
  }

  public getLambdaService(): LambdaService {
    if (!this.lambdaService) {
      throw new Error('DIContainer not initialized. Call initialize() first.');
    }
    return this.lambdaService;
  }

  // テスト用のモック注入
  public registerMock<T>(key: string, mockInstance: T): void {
    this.dependencies.set(key, mockInstance);
  }

  // コンテナのリセット（テスト用）
  public reset(): void {
    this.dependencies.clear();
    this.workspaceService = undefined;
    this.configService = undefined;
    this.analysisService = undefined;
    this.executionService = undefined;
    this.scoreAnalysisService = undefined;
    this.lambdaService = undefined;
    this.resultProcessor = undefined;
    this.setupDependencies();
  }
}
