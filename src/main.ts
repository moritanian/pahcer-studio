import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';

import { ExecutionService } from './services/ExecutionService';
import { AnalysisService } from './services/AnalysisService';

import { WorkspaceService } from './services/WorkspaceService';
import { DIContainer } from './infrastructure/DIContainer';
import type { TestExecutionRequest, Workspace } from './schemas/execution';
import type { AnalysisRequest, UpdateAnalysisRequest } from './schemas/analysis';
import * as fsPromises from 'fs/promises';
import { AssetDownloadService } from './services/AssetDownloadService';
import { PathHelper } from './infrastructure/PathHelper';

let mainWindow: BrowserWindow;
let executionService: ExecutionService;
let analysisService: AnalysisService;
let workspaceService: WorkspaceService;

function createWindow(): void {
  // メインウィンドウを作成
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'default',
    title: 'AtCoder Test Runner',
  });

  // メニューバーを完全に削除
  Menu.setApplicationMenu(null);

  // HTMLファイルを読み込み
  mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));

  // 開発者ツールを開く（開発時のみ）
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function setupExecutionService(): void {
  // DIContainerから依存関係を取得
  const container = DIContainer.getInstance();

  // SettingsPathを設定してDIContainerを初期化
  // SettingsPathを設定してDIContainerを初期化
  const settingsPath = PathHelper.getAppSettingsPath(app.getPath('userData'));
  container.initialize(settingsPath);

  // サービスを取得
  executionService = container.getExecutionService();
  analysisService = container.getAnalysisService();
  workspaceService = container.getWorkspaceService();

  // ExecutionServiceのイベントをレンダラープロセスに転送
  executionService.on('execution:status', (data) => {
    mainWindow?.webContents.send('execution:status', data);
  });

  executionService.on('execution:progress', (data) => {
    mainWindow?.webContents.send('execution:progress', data);
  });

  executionService.on('execution:log', (data) => {
    mainWindow?.webContents.send('execution:log', data);
  });

  executionService.on('execution:completed', (data) => {
    mainWindow?.webContents.send('execution:completed', data);
  });
}

ipcMain.handle('execution:start', async (event, request: TestExecutionRequest) => {
  const id = await executionService.startExecution(request);
  return { id };
});

ipcMain.handle('execution:stop', async (event, executionId: string) => {
  await executionService.stopExecution(executionId);
  return { success: true };
});

ipcMain.handle('execution:getStatus', async (event, executionId: string) => {
  return executionService.getExecutionStatus(executionId);
});

ipcMain.handle('execution:getAll', async () => {
  return executionService.getAllExecutions();
});

ipcMain.handle('execution:getTestCases', async (event, executionId: string) => {
  return executionService.getTestCases(executionId);
});

ipcMain.handle(
  'execution:getTestCaseResult',
  async (event, { executionId, seed }: { executionId: string; seed: number }) => {
    return executionService.getTestCaseResult(executionId, seed);
  },
);

ipcMain.handle('execution:delete', async (event, executionId: string) => {
  await executionService.deleteExecution(executionId);
});

ipcMain.handle('workspace:set', async (event, workspace: Workspace) => {
  workspaceService.setWorkspace(workspace);
  return { success: true };
});

// 分析関連のIPCハンドラー
ipcMain.handle('analysis:analyze', async (event, request: AnalysisRequest) => {
  return await analysisService.analyze(request);
});

ipcMain.handle('analysis:updateCache', async (event, request: UpdateAnalysisRequest) => {
  return await analysisService.updateFeatureCache(request.featureFormat);
});

ipcMain.handle('analysis:getSettings', async () => {
  return analysisService.getSettings();
});

ipcMain.handle(
  'analysis:saveSettings',
  async (event, { featureFormat }: { featureFormat: string }) => {
    return analysisService.saveSettings(featureFormat);
  },
);

ipcMain.handle('asset:deleteVisualizer', async () => {
  try {
    const workspace = workspaceService.getWorkspace();
    if (!workspace) {
      return { success: false, error: 'Workspace not selected' };
    }
    const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);
    await fsPromises.rm(dir, { recursive: true, force: true });
    await fsPromises.mkdir(dir, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// ビジュアライザフォルダ内で唯一の HTML ファイル名を返す
ipcMain.handle('asset:getVisualizerEntry', async () => {
  try {
    const workspace = workspaceService.getWorkspace();
    if (!workspace) {
      return { exists: false, path: null };
    }
    const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);
    const files = await fsPromises.readdir(dir);
    const htmls = files.filter((f) => f.toLowerCase().endsWith('.html'));
    if (htmls.length === 1) {
      const fullPath = path.join(dir, htmls[0]);
      return { exists: true, path: fullPath };
    }
    return { exists: false, path: null };
  } catch {
    return { exists: false, path: null };
  }
});

// ダウンロード: HTML + 直接参照 JS を保存（AssetDownloadService に任せる）
ipcMain.handle('asset:downloadVisualizer', async (event, { url }: { url: string }) => {
  try {
    const workspace = workspaceService.getWorkspace();
    if (!workspace) {
      return { success: false, error: 'Workspace not selected' };
    }
    const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);
    const svc = new AssetDownloadService(dir);
    const urls = await svc.download(url);
    return { success: true, urls };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ダイアログ関連のIPCハンドラー
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

// 設定関連のIPCハンドラー
ipcMain.handle('settings:get', async () => {
  return await workspaceService.getAppSettings();
});

ipcMain.handle('settings:update', async (_event, settings) => {
  return await workspaceService.updateAppSettings(settings);
});

// アプリケーションの準備ができたらウィンドウを作成
app.whenReady().then(() => {
  setupExecutionService();
  createWindow();
});

// すべてのウィンドウが閉じられたときの処理
app.on('window-all-closed', () => {
  // macOS以外では、すべてのウィンドウが閉じられたらアプリを終了
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// アプリがアクティブになったときの処理（macOS用）
app.on('activate', () => {
  // ウィンドウがない場合は新しく作成
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
