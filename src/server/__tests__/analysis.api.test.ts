import request from 'supertest';
import express from 'express';
import { createApp } from '../server';
import { WorkspaceRepository } from '../../repositories/WorkspaceRepository';
import { WorkspaceService } from '../../services/WorkspaceService';
import type { ExecutionService } from '../../services/ExecutionService';
import type { AnalysisService } from '../../services/AnalysisService';
import type { AnalysisRequest, AnalysisResponse } from '../../schemas/analysis';
import * as path from 'path';

// Helper function to create workspace using POST
async function createWorkspace(app: express.Application, targetDirectory: string) {
  const response = await request(app).post('/api/workspaces').send({ targetDirectory });
  return response.body;
}

describe('Analysis API (RESTful)', () => {
  let app: express.Application;
  let workspaceService: WorkspaceService;
  let mockAnalysisService: jest.Mocked<AnalysisService>;

  beforeEach(async () => {
    // Create workspace service
    const workspaceRepository = new WorkspaceRepository(undefined, false);
    const settingsPath = path.join('/tmp', 'test-settings.json');
    workspaceService = new WorkspaceService(settingsPath, workspaceRepository);

    // Create mock analysis service
    mockAnalysisService = {
      analyze: jest.fn(),
      updateFeatureCache: jest.fn(),
      getSettings: jest.fn(),
      saveSettings: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const executionService = {} as ExecutionService;

    app = createApp({
      workspaceService,
      executionService,
      analysisService: mockAnalysisService,
    });
  });

  describe('POST /api/workspaces/:workspaceId/analysis/analyze', () => {
    it('should analyze for valid workspace', async () => {
      // Create workspace first
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockRequest: AnalysisRequest = {
        executionIds: ['exec-1', 'exec-2'],
        featureFormat: 'test format',
      };

      const mockResponse: AnalysisResponse = {
        inputFeatures: [],
        scoreData: [],
        featureKeys: [],
      };

      mockAnalysisService.analyze.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/analysis/analyze`)
        .send(mockRequest)
        .expect(200);

      expect(response.body).toEqual(mockResponse);
      expect(mockAnalysisService.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workspaceId,
          targetDirectory: '/home/user/ahc041',
          useWsl: false,
        }),
        mockRequest,
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).post('/api/workspaces/non-existent/analysis/analyze').send({}).expect(404);
    });
  });

  describe('POST /api/workspaces/:workspaceId/analysis/updateCache', () => {
    it('should update cache for valid workspace', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockResult = {
        successful: true,
        message: 'Cache updated successfully',
        totalTestCases: 100,
        extractedFeatures: ['feature1', 'feature2'],
      };

      mockAnalysisService.updateFeatureCache.mockResolvedValue(mockResult);

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/analysis/updateCache`)
        .send({ featureFormat: 'test format' })
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockAnalysisService.updateFeatureCache).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workspaceId,
          targetDirectory: '/home/user/ahc041',
          useWsl: false,
        }),
        'test format',
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app)
        .post('/api/workspaces/non-existent/analysis/updateCache')
        .send({})
        .expect(404);
    });
  });

  describe('GET /api/workspaces/:workspaceId/analysis/settings', () => {
    it('should get settings for valid workspace', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockSettings = {
        featureFormat: 'test format',
      };

      mockAnalysisService.getSettings.mockReturnValue(mockSettings);

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/analysis/settings`)
        .expect(200);

      expect(response.body).toEqual(mockSettings);
      expect(mockAnalysisService.getSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workspaceId,
          targetDirectory: '/home/user/ahc041',
          useWsl: false,
        }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).get('/api/workspaces/non-existent/analysis/settings').expect(404);
    });
  });

  describe('POST /api/workspaces/:workspaceId/analysis/settings', () => {
    it('should save settings for valid workspace', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockResult = { featureFormat: 'new format' };

      mockAnalysisService.saveSettings.mockReturnValue(mockResult);

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/analysis/settings`)
        .send({ featureFormat: 'new format' })
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockAnalysisService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workspaceId,
          targetDirectory: '/home/user/ahc041',
          useWsl: false,
        }),
        'new format',
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app)
        .post('/api/workspaces/non-existent/analysis/settings')
        .send({})
        .expect(404);
    });
  });
});
