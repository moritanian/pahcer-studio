import {
  TestExecution,
  TestExecutionRequest,
  TestCase,
  TestExecutionUpdateRequest,
} from '../../schemas/execution';
import { Workspace, AppSettings } from '../../schemas/workspace';
import {
  AnalysisRequest,
  AnalysisResponse,
  UpdateAnalysisRequest,
  AnalysisSettings,
} from '../../schemas/analysis';
import { SeedRankingResponse, BestPerSeedResponse } from '../../schemas/seedScore';

const API_BASE = '/api';

/**
 * 非 ok なレスポンスから表示用の Error を生成する。
 * サーバは `{ error: string }` を返すので、その文字列を取り出して
 * `String(error)` 由来の "Error: " プレフィックスを除去する。
 * JSON でない場合は本文をそのまま使う。
 */
async function toResponseError(res: Response): Promise<Error> {
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === 'string') {
      return new Error(parsed.error.replace(/^Error:\s*/, ''));
    }
  } catch {
    // not JSON; fall through to raw body
  }
  return new Error(body);
}

export const apiClient = {
  execution: {
    start: async (workspaceId: string, request: TestExecutionRequest): Promise<{ id: string }> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    stop: async (workspaceId: string, executionId: string): Promise<{ success: boolean }> => {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/executions/${executionId}/stop`,
        {
          method: 'POST',
        },
      );
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    getStatus: async (workspaceId: string, executionId: string): Promise<TestExecution | null> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/executions/${executionId}`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    getAll: async (workspaceId: string): Promise<TestExecution[]> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/executions`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    getTestCases: async (workspaceId: string, executionId: string): Promise<TestCase[]> => {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/executions/${executionId}/cases`,
      );
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    getTestCaseResult: async (
      workspaceId: string,
      executionId: string,
      seed: number,
    ): Promise<string | null> => {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/executions/${executionId}/cases/${seed}`,
      );
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    delete: async (workspaceId: string, executionId: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/executions/${executionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw await toResponseError(res);
    },
    update: async (
      workspaceId: string,
      executionId: string,
      request: TestExecutionUpdateRequest,
    ): Promise<TestExecution> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/executions/${executionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
  },
  workspace: {
    list: async (): Promise<Workspace[]> => {
      const res = await fetch(`${API_BASE}/workspaces`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    create: async (targetDirectory: string, useWsl?: boolean): Promise<Workspace> => {
      const res = await fetch(`${API_BASE}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDirectory, useWsl }),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    get: async (workspaceId: string): Promise<Workspace> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    delete: async (workspaceId: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw await toResponseError(res);
    },
  },
  settings: {
    get: async (): Promise<AppSettings> => {
      const res = await fetch(`${API_BASE}/settings`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    update: async (settings: Partial<AppSettings>): Promise<AppSettings> => {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
  },
  analysis: {
    analyze: async (workspaceId: string, request: AnalysisRequest): Promise<AnalysisResponse> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/analysis/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    updateCache: async (
      workspaceId: string,
      request: UpdateAnalysisRequest,
    ): Promise<{
      successful: boolean;
      totalTestCases?: number;
      extractedFeatures?: boolean;
      message?: string;
    }> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/analysis/updateCache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    getSettings: async (workspaceId: string): Promise<AnalysisSettings> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/analysis/settings`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    saveSettings: async (
      workspaceId: string,
      featureFormat: string,
    ): Promise<{ success: boolean }> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/analysis/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureFormat }),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
  },
  seed: {
    getRanking: async (workspaceId: string, seed: number): Promise<SeedRankingResponse> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/seeds/${seed}/ranking`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    getBestPerSeed: async (workspaceId: string): Promise<BestPerSeedResponse> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/seeds/best`);
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
  },
  asset: {
    deleteVisualizer: async (
      workspaceId: string,
    ): Promise<{ success: boolean; error?: string }> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/asset/visualizer`, {
        method: 'DELETE',
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
    getVisualizerEntry: async (
      workspaceId: string,
    ): Promise<{ exists: boolean; path: string | null }> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/asset/visualizer/entry`);
      if (!res.ok) throw await toResponseError(res);
      const data = await res.json();
      return data;
    },
    downloadVisualizer: async (
      workspaceId: string,
      url: string,
    ): Promise<{ success: boolean; urls?: string[]; error?: string }> => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/asset/visualizer/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw await toResponseError(res);
      return res.json();
    },
  },
  dialog: {
    // Dialogs are tricky in Web App. For now, we might need to rely on manual input or a different approach.
    // Since we can't open a native system dialog from the browser to get a path on the server.
    openDirectory: async (): Promise<string | null> => {
      // TODO: Implement a way to select directory on server, or ask user to input path manually
      // For MVP, we might just return null or prompt user
      const path = prompt(
        'Please enter the absolute path to the workspace directory on the server:',
      );
      return path;
    },
  },
};
