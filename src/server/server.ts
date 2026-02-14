import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { createServer as createViteServer } from 'vite';
import { DIContainer } from '../infrastructure/DIContainer';
import { PathHelper } from '../infrastructure/PathHelper';
import {
  TestExecutionRequest,
  TestExecutionRequestSchema,
  TestExecutionUpdateRequestSchema,
} from '../schemas/execution';
import { Workspace, WorkspaceSchema, AppSettingsSchema, AppSettings } from '../schemas/workspace';
import {
  AnalysisRequestSchema,
  UpdateAnalysisRequestSchema,
  AnalysisSettingsSchema,
} from '../schemas/analysis';
import { AssetDownloadService } from '../services/AssetDownloadService';
import { validateRequest } from '../schemas/validators';
import { z } from 'zod';
import type { WorkspaceService } from '../services/WorkspaceService';
import type { ExecutionService } from '../services/ExecutionService';
import type { AnalysisService } from '../services/AnalysisService';

// Extend Express Request to include workspace
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspace?: Workspace;
    }
  }
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '127.0.0.1';
const isDev = process.env.NODE_ENV !== 'production';

let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;

// Initialize DI Container
// Note: In a real server environment, we might need a different way to determine userData path
// For now, we'll use a local directory for settings
const userDataDir = path.join(process.cwd(), 'data', 'settings');
fsPromises.mkdir(userDataDir, { recursive: true }).catch(console.error);

const settingsPath = PathHelper.getAppSettingsPath(userDataDir);
const container = DIContainer.getInstance();
container.initialize(settingsPath);

const executionService = container.getExecutionService();
const analysisService = container.getAnalysisService();
const workspaceService = container.getWorkspaceService();

/**
 * Create Express Application
 */
export function createApp(options?: {
  workspaceService?: WorkspaceService;
  executionService?: ExecutionService;
  analysisService?: AnalysisService;
}): express.Application {
  const app = express();
  app.use(express.json());

  // サービスの取得（オプションで上書き可能）
  const ws = options?.workspaceService || workspaceService;
  const es = options?.executionService || executionService;
  const as = options?.analysisService || analysisService;

  setupRoutes(app, ws, es, as);
  return app;
}

/**
 * ルートを設定する
 */
function setupRoutes(
  app: express.Application,
  workspaceService: WorkspaceService,
  executionService: ExecutionService,
  analysisService: AnalysisService,
): void {
  // --- API Routes ---

  // Workspaces/:workspaceId/* - RESTful routes (require workspace validation)
  // Middleware to validate workspace exists and set it for the request scope
  const validateWorkspace = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const { workspaceId } = req.params;
    const workspace = workspaceService.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    // Attach workspace to request for use in route handlers
    req.workspace = workspace;

    next();
  };

  // Executions
  app.post('/api/workspaces/:workspaceId/executions', validateWorkspace, async (req, res) => {
    try {
      const request = validateRequest(TestExecutionRequestSchema, req.body) as TestExecutionRequest;
      const workspace = req.workspace!;
      const id = await executionService.startExecution(request, workspace);
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/workspaces/:workspaceId/executions', validateWorkspace, async (req, res) => {
    try {
      const workspace = req.workspace!;
      const executions = await executionService.getAllExecutions(workspace);
      res.json(executions);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get(
    '/api/workspaces/:workspaceId/executions/:executionId',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const status = await executionService.getExecutionStatus(req.params.executionId, workspace);
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    },
  );

  app.put(
    '/api/workspaces/:workspaceId/executions/:executionId',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const { executionId } = req.params;
        const updateData = validateRequest(TestExecutionUpdateRequestSchema, req.body);

        const executionRepository = container.getExecutionRepository();
        const updated = await executionRepository.update(executionId, updateData, workspace);

        res.json(updated);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: errorMessage });
      }
    },
  );

  app.delete(
    '/api/workspaces/:workspaceId/executions/:executionId',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        await executionService.deleteExecution(req.params.executionId, workspace);
        res.status(204).send();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: errorMessage });
      }
    },
  );

  app.post(
    '/api/workspaces/:workspaceId/executions/:executionId/stop',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        await executionService.stopExecution(req.params.executionId, workspace);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    },
  );

  app.get(
    '/api/workspaces/:workspaceId/executions/:executionId/cases',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const cases = await executionService.getTestCases(req.params.executionId, workspace);
        res.json(cases);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    },
  );

  app.get(
    '/api/workspaces/:workspaceId/executions/:executionId/cases/:seed',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const result = await executionService.getTestCaseResult(
          req.params.executionId,
          parseInt(req.params.seed),
          workspace,
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    },
  );

  // Workspaces API
  app.get('/api/workspaces', (req, res) => {
    try {
      const workspaces = workspaceService.listWorkspaces();
      res.json(workspaces);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/workspaces', (req, res) => {
    try {
      const { targetDirectory, useWsl } = validateRequest(
        WorkspaceSchema.pick({ targetDirectory: true, useWsl: true }),
        req.body,
      );

      // チルダを展開
      const expandedDirectory = PathHelper.expandTilde(targetDirectory);

      // サーバー側でIDを生成
      const id = PathHelper.generateWorkspaceId(expandedDirectory);

      // 既存のworkspaceをチェック
      let workspace = workspaceService.getWorkspace(id);
      const isNew = !workspace;

      // 作成または更新
      workspace = {
        id,
        targetDirectory: expandedDirectory,
        useWsl: useWsl || false,
      };
      workspaceService.saveWorkspace(workspace);

      // 新規作成なら201、更新なら200
      res.status(isNew ? 201 : 200).json(workspace);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/workspaces/:workspaceId', (req, res) => {
    try {
      const { workspaceId } = req.params;
      const workspace = workspaceService.getWorkspace(workspaceId);

      if (!workspace) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      res.json(workspace);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete('/api/workspaces/:workspaceId', (req, res) => {
    try {
      const { workspaceId } = req.params;
      const deleted = workspaceService.deleteWorkspace(workspaceId);

      if (!deleted) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/settings', async (req, res) => {
    try {
      const settings = await workspaceService.getAppSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const validatedSettings = validateRequest(AppSettingsSchema.partial(), req.body);
      const settings = await workspaceService.updateAppSettings(validatedSettings as AppSettings);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Analysis
  app.post('/api/workspaces/:workspaceId/analysis/analyze', validateWorkspace, async (req, res) => {
    try {
      const workspace = req.workspace!;
      const request = validateRequest(AnalysisRequestSchema, req.body);
      const result = await analysisService.analyze(workspace, request);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post(
    '/api/workspaces/:workspaceId/analysis/updateCache',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const request = validateRequest(UpdateAnalysisRequestSchema, req.body);
        const result = await analysisService.updateFeatureCache(workspace, request.featureFormat);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    },
  );

  app.get('/api/workspaces/:workspaceId/analysis/settings', validateWorkspace, async (req, res) => {
    try {
      const workspace = req.workspace!;
      const settings = analysisService.getSettings(workspace);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post(
    '/api/workspaces/:workspaceId/analysis/settings',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const request = validateRequest(
          AnalysisSettingsSchema.pick({ featureFormat: true }),
          req.body,
        );
        const result = analysisService.saveSettings(workspace, request.featureFormat);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    },
  );

  // Assets (Visualizer)
  app.delete(
    '/api/workspaces/:workspaceId/asset/visualizer',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);
        await fsPromises.rm(dir, { recursive: true, force: true });
        await fsPromises.mkdir(dir, { recursive: true });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    },
  );

  app.get(
    '/api/workspaces/:workspaceId/asset/visualizer/entry',
    validateWorkspace,
    async (req, res) => {
      try {
        const workspace = req.workspace!;
        const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);

        // Check if directory exists
        try {
          await fsPromises.access(dir);
        } catch {
          return res.json({ exists: false, path: null });
        }

        const files = await fsPromises.readdir(dir);
        const htmls = files.filter((f) => f.toLowerCase().endsWith('.html'));
        if (htmls.length === 1) {
          // Return path with workspaceId in the path
          return res.json({
            exists: true,
            path: `/visualizer/${workspace.id}/${htmls[0]}`,
          });
        }
        res.json({ exists: false, path: null });
      } catch (error) {
        res.json({ exists: false, path: null });
      }
    },
  );

  app.post(
    '/api/workspaces/:workspaceId/asset/visualizer/download',
    validateWorkspace,
    async (req, res) => {
      try {
        const { url } = validateRequest(z.object({ url: z.string().url() }), req.body);
        const workspace = req.workspace!;
        const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);
        const svc = new AssetDownloadService(dir);
        const urls = await svc.download(url);
        res.json({ success: true, urls });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    },
  );

  // SSE Endpoint for Logs
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Forward events from ExecutionService
    const statusHandler = (data: unknown) => sendEvent('execution:status', data);
    const progressHandler = (data: unknown) => sendEvent('execution:progress', data);
    const logHandler = (data: unknown) => sendEvent('execution:log', data);
    const completedHandler = (data: unknown) => sendEvent('execution:completed', data);

    executionService.on('execution:status', statusHandler);
    executionService.on('execution:progress', progressHandler);
    executionService.on('execution:log', logHandler);
    executionService.on('execution:completed', completedHandler);

    // Cleanup on close
    req.on('close', () => {
      executionService.off('execution:status', statusHandler);
      executionService.off('execution:progress', progressHandler);
      executionService.off('execution:log', logHandler);
      executionService.off('execution:completed', completedHandler);
    });
  });

  // Serve Visualizer Static Files
  app.use('/visualizer/:workspaceId', async (req, res, next) => {
    const { workspaceId } = req.params;

    const workspace = workspaceService.getWorkspace(workspaceId);
    if (workspace) {
      const visualizerDir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);

      // Intercept HTML requests to inject bridge script
      if (req.path.endsWith('.html') || req.path === '/') {
        try {
          // Determine file path (handle root path)
          let relativePath = req.path;
          if (relativePath === '/') {
            const files = await fsPromises.readdir(visualizerDir);
            const html = files.find((f) => f.toLowerCase().endsWith('.html'));
            if (html) relativePath = '/' + html;
          }

          const filePath = path.join(visualizerDir, relativePath);
          await fsPromises.access(filePath);
          let content = await fsPromises.readFile(filePath, 'utf-8');

          // Inject bridge script before </body>
          const bridgeScript = `
          <script>
            window.addEventListener('message', (event) => {
              const data = event.data;
              if (data && data.type === 'set_input') {
                const el = document.getElementById(data.id);
                if (el) {
                  el.value = data.value;
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
            });
          </script>
        `;

          if (content.includes('</body>')) {
            content = content.replace('</body>', `${bridgeScript}</body>`);
          } else {
            content += bridgeScript;
          }

          res.setHeader('Content-Type', 'text/html');
          res.send(content);
          return;
        } catch (err) {
          // Fallthrough to static handler if file not found or error
        }
      }

      express.static(visualizerDir)(req, res, next);
    } else {
      next();
    }
  });
}

// Initialize Vite in development mode
async function setupVite(app: express.Application) {
  if (isDev) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve Frontend Static Files (production)
    app.use(express.static(path.resolve(__dirname, '../../dist/renderer')));
  }

  // SPA Fallback Handler
  // Serves index.html for all client-side routes (e.g., /workspaces/123)
  // This allows React Router to handle routing in the browser
  // IMPORTANT: This middleware must be placed last (after API and Visualizer routes)
  app.use(async (_req, res, next) => {
    // Skip and pass to next middleware if:
    // - Non-GET requests (POST, DELETE, etc.)
    // - API routes starting with /api
    // - Visualizer routes starting with /visualizer
    if (
      _req.method !== 'GET' ||
      _req.path.startsWith('/api') ||
      _req.path.startsWith('/visualizer')
    ) {
      return next();
    }

    if (isDev) {
      const htmlFile = path.resolve(__dirname, '../../src/renderer/index.html');
      let html = fs.readFileSync(htmlFile, 'utf-8');
      html = await vite!.transformIndexHtml(_req.url, html);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } else {
      res.sendFile(path.resolve(__dirname, '../../dist/renderer/index.html'));
    }
  });
}

// Start Server
async function start() {
  const app = createApp();

  await setupVite(app);
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

// 本番環境またはCLIから起動された場合のみサーバーを起動
if (require.main === module) {
  start().catch(console.error);
}
