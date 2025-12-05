import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { createServer as createViteServer } from 'vite';
import { DIContainer } from '../infrastructure/DIContainer';
import { PathHelper } from '../infrastructure/PathHelper';
import { TestExecutionRequest, Workspace } from '../schemas/execution';
import { AnalysisRequest } from '../schemas/analysis';
import { AssetDownloadService } from '../services/AssetDownloadService';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '127.0.0.1';
const isDev = process.env.NODE_ENV !== 'production';

// Middleware
app.use(express.json());

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

// --- API Routes ---

// Execution
app.post('/api/execution/start', async (req, res) => {
  try {
    const request = req.body as TestExecutionRequest;
    const id = await executionService.startExecution(request);
    res.json({ id });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/execution/stop', async (req, res) => {
  try {
    const { executionId } = req.body;
    await executionService.stopExecution(executionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/execution/status/:id', async (req, res) => {
  try {
    const status = await executionService.getExecutionStatus(req.params.id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/execution/all', async (req, res) => {
  try {
    const executions = await executionService.getAllExecutions();
    res.json(executions);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/execution/:id/cases', async (req, res) => {
  try {
    const cases = await executionService.getTestCases(req.params.id);
    res.json(cases);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/execution/:id/case/:seed', async (req, res) => {
  try {
    const result = await executionService.getTestCaseResult(
      req.params.id,
      parseInt(req.params.seed),
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/execution/:id', async (req, res) => {
  try {
    await executionService.deleteExecution(req.params.id);
    res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
});

// Workspace
app.post('/api/workspace/set', async (req, res) => {
  try {
    const workspace = req.body as Workspace;
    workspaceService.setWorkspace(workspace);
    res.json({ success: true });
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
    const settings = await workspaceService.updateAppSettings(req.body);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Analysis
app.post('/api/analysis/analyze', async (req, res) => {
  try {
    const result = await analysisService.analyze(req.body as AnalysisRequest);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/analysis/updateCache', async (req, res) => {
  try {
    const result = await analysisService.updateFeatureCache(req.body.featureFormat);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/analysis/settings', async (req, res) => {
  try {
    const settings = await analysisService.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/analysis/settings', async (req, res) => {
  try {
    const result = await analysisService.saveSettings(req.body.featureFormat);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Assets (Visualizer)
app.delete('/api/asset/visualizer', async (req, res) => {
  try {
    const workspace = workspaceService.getWorkspace();
    if (!workspace) {
      return res.status(400).json({ success: false, error: 'Workspace not selected' });
    }
    const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);
    await fsPromises.rm(dir, { recursive: true, force: true });
    await fsPromises.mkdir(dir, { recursive: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/asset/visualizer/entry', async (req, res) => {
  try {
    const workspace = workspaceService.getWorkspace();
    if (!workspace) {
      return res.json({ exists: false, path: null });
    }
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
      // Return relative path for static serving
      // The client will construct the full URL
      return res.json({ exists: true, path: `/visualizer/${htmls[0]}` });
    }
    res.json({ exists: false, path: null });
  } catch (error) {
    res.json({ exists: false, path: null });
  }
});

app.post('/api/asset/visualizer/download', async (req, res) => {
  try {
    const { url } = req.body;
    const workspace = workspaceService.getWorkspace();
    if (!workspace) {
      return res.status(400).json({ success: false, error: 'Workspace not selected' });
    }
    const dir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);
    const svc = new AssetDownloadService(dir);
    const urls = await svc.download(url);
    res.json({ success: true, urls });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

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
// We need to dynamically serve the visualizer directory based on the current workspace
app.use('/visualizer', async (req, res, next) => {
  const workspace = workspaceService.getWorkspace();
  if (workspace) {
    const visualizerDir = PathHelper.getVisualizerDirectory(workspace.targetDirectory);

    // Intercept HTML requests to inject bridge script
    if (req.path.endsWith('.html') || req.path === '/') {
      try {
        // Determine file path (handle root path)
        // Note: req.path is relative to the mount point '/visualizer'
        let relativePath = req.path;
        if (relativePath === '/') {
          // Find index.html or similar
          const files = await fsPromises.readdir(visualizerDir);
          const html = files.find((f) => f.toLowerCase().endsWith('.html'));
          if (html) relativePath = '/' + html;
        }

        const filePath = path.join(visualizerDir, relativePath);

        // Check if file exists
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
        // console.error('Error injecting script:', err);
      }
    }

    express.static(visualizerDir)(req, res, next);
  } else {
    next();
  }
});

// Initialize Vite in development mode
async function setupVite() {
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

  // Handle SPA Routing (Fallback to index.html)
  // Note: This must be after all API routes and Vite middleware
  app.use(async (_req, res, next) => {
    // Skip non-GET requests and API routes
    if (_req.method !== 'GET' || _req.path.startsWith('/api')) {
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
  await setupVite();
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

start().catch(console.error);
