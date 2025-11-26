import type {
  TestExecutionRequest,
  TestExecution,
  TestCase,
  ExecutionLogEvent,
  ExecutionStatusEvent,
  ExecutionProgressEvent,
  Workspace,
} from '../schemas/execution';
import type {
  AnalysisRequest,
  AnalysisResponse,
  UpdateAnalysisRequest,
  UpdateAnalysisResponse,
  AnalysisSettings,
} from '../schemas/analysis';
import type { DownloadVisualizerResponse, VisualizerEntryResponse } from '../schemas/asset';
import type { SimpleSuccessResponse, IdResponse } from '../schemas/execution';
import type { AppSettings } from '../services/ConfigService';

// ElectronAPI に共通で使用するインターフェース
export interface ElectronAPI {
  execution: {
    start: (request: TestExecutionRequest) => Promise<IdResponse>;
    stop: (executionId: string) => Promise<SimpleSuccessResponse>;
    getStatus: (executionId: string) => Promise<TestExecution>;
    getAll: () => Promise<TestExecution[]>;
    getTestCases: (executionId: string) => Promise<TestCase[]>;
    getTestCaseResult: (executionId: string, seed: number) => Promise<string | null>;
    deleteExecution: (executionId: string) => Promise<SimpleSuccessResponse>;
    onLog: (callback: (data: ExecutionLogEvent) => void) => void;
    offLog: (callback: (data: ExecutionLogEvent) => void) => void;
    onStatus: (callback: (data: ExecutionStatusEvent) => void) => void;
    offStatus: (callback: (data: ExecutionStatusEvent) => void) => void;
    onProgress: (callback: (data: ExecutionProgressEvent) => void) => void;
    offProgress: (callback: (data: ExecutionProgressEvent) => void) => void;
  };
  analysis: {
    analyze: (request: AnalysisRequest) => Promise<AnalysisResponse>;
    updateCache: (request: UpdateAnalysisRequest) => Promise<UpdateAnalysisResponse>;
    getSettings: () => Promise<AnalysisSettings>;
    saveSettings: (featureFormat: string) => Promise<SimpleSuccessResponse>;
  };
  asset: {
    deleteVisualizer: () => Promise<SimpleSuccessResponse>;
    downloadVisualizer: (url: string) => Promise<DownloadVisualizerResponse>;
    getVisualizerEntry: () => Promise<VisualizerEntryResponse>;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
  };
  workspace: {
    set: (workspace: Workspace) => Promise<{ success: boolean }>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  };
  getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
