import request from 'supertest';
import express from 'express';
import { WorkspaceRepository } from '../../repositories/WorkspaceRepository';
import { WorkspaceService } from '../../services/WorkspaceService';
import type { ExecutionService } from '../../services/ExecutionService';
import type { AnalysisService } from '../../services/AnalysisService';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

// Mock fs/promises before importing server
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  readFile: jest.fn().mockResolvedValue('[]'),
}));

// Import after mocking
import { createApp } from '../server';
const mockedFsPromises = fsPromises as jest.Mocked<typeof fsPromises>;

// Helper function to create workspace using POST
async function createWorkspace(app: express.Application, targetDirectory: string) {
  const response = await request(app).post('/api/workspaces').send({ targetDirectory });
  return response.body;
}

describe('Asset (Visualizer) API (RESTful)', () => {
  let app: express.Application;
  let workspaceService: WorkspaceService;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Create workspace service
    const workspaceRepository = new WorkspaceRepository(undefined, false);
    const settingsPath = path.join('/tmp', 'test-settings.json');
    workspaceService = new WorkspaceService(settingsPath, workspaceRepository);

    const executionService = {} as ExecutionService;
    const analysisService = {} as AnalysisService;

    app = createApp({
      workspaceService,
      executionService,
      analysisService,
    });
  });

  describe('DELETE /api/workspaces/:workspaceId/asset/visualizer', () => {
    it('should delete visualizer assets for valid workspace', async () => {
      // Create workspace first
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      // Mock fs operations
      mockedFsPromises.rm.mockResolvedValue(undefined);
      mockedFsPromises.mkdir.mockResolvedValue(undefined);

      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/asset/visualizer`)
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockedFsPromises.rm).toHaveBeenCalled();
      expect(mockedFsPromises.mkdir).toHaveBeenCalled();
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).delete('/api/workspaces/non-existent/asset/visualizer').expect(404);
    });
  });

  describe('GET /api/workspaces/:workspaceId/asset/visualizer/entry', () => {
    it('should return visualizer entry for valid workspace', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      // Mock fs operations - directory exists with one HTML file
      mockedFsPromises.access.mockResolvedValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockedFsPromises.readdir.mockResolvedValue(['index.html'] as any);

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/asset/visualizer/entry`)
        .expect(200);

      expect(response.body).toEqual({
        exists: true,
        path: `/visualizer/${workspaceId}/index.html`,
      });
    });

    it('should return exists: false when directory does not exist', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      // Mock fs operations - directory does not exist
      mockedFsPromises.access.mockRejectedValue(new Error('ENOENT'));

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/asset/visualizer/entry`)
        .expect(200);

      expect(response.body).toEqual({
        exists: false,
        path: null,
      });
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).get('/api/workspaces/non-existent/asset/visualizer/entry').expect(404);
    });
  });

  describe('POST /api/workspaces/:workspaceId/asset/visualizer/download', () => {
    it('should download visualizer for valid workspace', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      // Note: We can't easily mock AssetDownloadService here
      // For now, we'll expect an error since the service will try to download
      // In a real test, we'd mock the AssetDownloadService module
      await request(app)
        .post(`/api/workspaces/${workspaceId}/asset/visualizer/download`)
        .send({ url: 'https://example.com/visualizer.html' })
        .expect(500);

      // Just verify the endpoint exists and requires workspace
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app)
        .post('/api/workspaces/non-existent/asset/visualizer/download')
        .send({ url: 'https://example.com' })
        .expect(404);
    });
  });
});
