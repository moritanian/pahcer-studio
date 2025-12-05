import { TestExecution, TestExecutionRequest, Workspace, TestCase } from '../../schemas/execution';
import {
  AnalysisRequest,
  AnalysisResponse,
  UpdateAnalysisRequest,
  AnalysisSettings,
} from '../../schemas/analysis';
import { AppSettings } from '../../services/WorkspaceService';

const API_BASE = '/api';

export const apiClient = {
  execution: {
    start: async (request: TestExecutionRequest): Promise<{ id: string }> => {
      const res = await fetch(`${API_BASE}/execution/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    stop: async (executionId: string): Promise<{ success: boolean }> => {
      const res = await fetch(`${API_BASE}/execution/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    getStatus: async (executionId: string): Promise<TestExecution | null> => {
      const res = await fetch(`${API_BASE}/execution/status/${executionId}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    getAll: async (): Promise<TestExecution[]> => {
      const res = await fetch(`${API_BASE}/execution/all`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    getTestCases: async (executionId: string): Promise<TestCase[]> => {
      const res = await fetch(`${API_BASE}/execution/${executionId}/cases`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    getTestCaseResult: async (executionId: string, seed: number): Promise<string | null> => {
      const res = await fetch(`${API_BASE}/execution/${executionId}/case/${seed}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    delete: async (executionId: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/execution/${executionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
    },
  },
  workspace: {
    set: async (workspace: Workspace): Promise<{ success: boolean }> => {
      const res = await fetch(`${API_BASE}/workspace/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspace),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  },
  settings: {
    get: async (): Promise<AppSettings> => {
      const res = await fetch(`${API_BASE}/settings`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    update: async (settings: Partial<AppSettings>): Promise<AppSettings> => {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  },
  analysis: {
    analyze: async (request: AnalysisRequest): Promise<AnalysisResponse> => {
      const res = await fetch(`${API_BASE}/analysis/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    updateCache: async (
      request: UpdateAnalysisRequest,
    ): Promise<{
      successful: boolean;
      totalTestCases?: number;
      extractedFeatures?: boolean;
      message?: string;
    }> => {
      const res = await fetch(`${API_BASE}/analysis/updateCache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    getSettings: async (): Promise<AnalysisSettings> => {
      const res = await fetch(`${API_BASE}/analysis/settings`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    saveSettings: async (featureFormat: string): Promise<{ success: boolean }> => {
      const res = await fetch(`${API_BASE}/analysis/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureFormat }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  },
  asset: {
    deleteVisualizer: async (): Promise<{ success: boolean; error?: string }> => {
      const res = await fetch(`${API_BASE}/asset/visualizer`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    getVisualizerEntry: async (): Promise<{ exists: boolean; path: string | null }> => {
      const res = await fetch(`${API_BASE}/asset/visualizer/entry`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data;
    },
    downloadVisualizer: async (
      url: string,
    ): Promise<{ success: boolean; urls?: string[]; error?: string }> => {
      const res = await fetch(`${API_BASE}/asset/visualizer/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error(await res.text());
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
