import request from 'supertest';
import express from 'express';
import { createApp } from '../server';
import { WorkspaceRepository } from '../../repositories/WorkspaceRepository';
import { WorkspaceService } from '../../services/WorkspaceService';
import type { ExecutionService } from '../../services/ExecutionService';
import type { AnalysisService } from '../../services/AnalysisService';
import type { TestExecution, TestCase } from '../../schemas/execution';
import * as path from 'path';

// Helper function to create workspace using POST
async function createWorkspace(app: express.Application, targetDirectory: string) {
  const response = await request(app).post('/api/workspaces').send({ targetDirectory });
  return response.body;
}

describe('Execution API (RESTful)', () => {
  let app: express.Application;
  let workspaceService: WorkspaceService;
  let mockExecutionService: jest.Mocked<ExecutionService>;

  beforeEach(async () => {
    // Create workspace service
    const workspaceRepository = new WorkspaceRepository(undefined, false);
    const settingsPath = path.join('/tmp', 'test-settings.json');
    workspaceService = new WorkspaceService(settingsPath, workspaceRepository);

    // Create mock execution service
    mockExecutionService = {
      startExecution: jest.fn(),
      stopExecution: jest.fn(),
      getExecutionStatus: jest.fn(),
      getAllExecutions: jest.fn(),
      getTestCases: jest.fn(),
      getTestCaseResult: jest.fn(),
      deleteExecution: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const analysisService = {} as AnalysisService;

    app = createApp({
      workspaceService,
      executionService: mockExecutionService,
      analysisService,
    });
  });

  describe('POST /api/workspaces/:workspaceId/executions', () => {
    it('should start execution for valid workspace', async () => {
      // Create workspace first
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      mockExecutionService.startExecution.mockResolvedValue('exec-123');

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/executions`)
        .send({
          comment: 'Test run',
          shuffle: false,
          freezeBestScores: false,
        })
        .expect(201);

      expect(response.body).toEqual({ id: 'exec-123' });
      expect(mockExecutionService.startExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          comment: 'Test run',
          shuffle: false,
          freezeBestScores: false,
        }),
        expect.objectContaining({
          id: workspaceId,
          targetDirectory: '/home/user/ahc041',
        }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).post('/api/workspaces/non-existent/executions').send({}).expect(404);
    });
  });

  describe('GET /api/workspaces/:workspaceId/executions', () => {
    it('should return all executions for workspace', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockExecutions: TestExecution[] = [
        {
          id: 'exec-1',
          status: 'COMPLETED',
          comment: 'Test 1',
        },
        {
          id: 'exec-2',
          status: 'RUNNING',
          comment: 'Test 2',
        },
      ];

      mockExecutionService.getAllExecutions.mockResolvedValue(mockExecutions);

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/executions`)
        .expect(200);

      expect(response.body).toEqual(mockExecutions);
      expect(mockExecutionService.getAllExecutions).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workspaceId,
        }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).get('/api/workspaces/non-existent/executions').expect(404);
    });
  });

  describe('GET /api/workspaces/:workspaceId/executions/:executionId', () => {
    it('should return execution status', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockStatus: TestExecution = {
        id: 'exec-123',
        status: 'RUNNING',
        comment: 'Test execution',
      };

      mockExecutionService.getExecutionStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/executions/exec-123`)
        .expect(200);

      expect(response.body).toEqual(mockStatus);
      expect(mockExecutionService.getExecutionStatus).toHaveBeenCalledWith(
        'exec-123',
        expect.objectContaining({ id: workspaceId }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).get('/api/workspaces/non-existent/executions/exec-123').expect(404);
    });
  });

  describe('DELETE /api/workspaces/:workspaceId/executions/:executionId', () => {
    it('should delete execution', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      mockExecutionService.deleteExecution.mockResolvedValue(undefined);

      await request(app).delete(`/api/workspaces/${workspaceId}/executions/exec-123`).expect(204);

      expect(mockExecutionService.deleteExecution).toHaveBeenCalledWith(
        'exec-123',
        expect.objectContaining({ id: workspaceId }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).delete('/api/workspaces/non-existent/executions/exec-123').expect(404);
    });
  });

  describe('POST /api/workspaces/:workspaceId/executions/:executionId/stop', () => {
    it('should stop execution', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      mockExecutionService.stopExecution.mockResolvedValue(undefined);

      await request(app)
        .post(`/api/workspaces/${workspaceId}/executions/exec-123/stop`)
        .expect(200);

      expect(mockExecutionService.stopExecution).toHaveBeenCalledWith(
        'exec-123',
        expect.objectContaining({ id: workspaceId }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).post('/api/workspaces/non-existent/executions/exec-123/stop').expect(404);
    });
  });

  describe('GET /api/workspaces/:workspaceId/executions/:executionId/cases', () => {
    it('should return test cases', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockCases: TestCase[] = [
        { seed: 0, score: 100, relativeScore: 0.5, status: 'completed', executionTime: 100 },
        { seed: 1, score: 200, relativeScore: 0.6, status: 'completed', executionTime: 120 },
      ];

      mockExecutionService.getTestCases.mockResolvedValue(mockCases);

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/executions/exec-123/cases`)
        .expect(200);

      expect(response.body).toEqual(mockCases);
      expect(mockExecutionService.getTestCases).toHaveBeenCalledWith(
        'exec-123',
        expect.objectContaining({ id: workspaceId }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app).get('/api/workspaces/non-existent/executions/exec-123/cases').expect(404);
    });
  });

  describe('GET /api/workspaces/:workspaceId/executions/:executionId/cases/:seed', () => {
    it('should return test case result', async () => {
      const workspace = await createWorkspace(app, '/home/user/ahc041');
      const workspaceId = workspace.id;

      const mockResult = 'test output';

      mockExecutionService.getTestCaseResult.mockResolvedValue(mockResult);

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/executions/exec-123/cases/0`)
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockExecutionService.getTestCaseResult).toHaveBeenCalledWith(
        'exec-123',
        0,
        expect.objectContaining({ id: workspaceId }),
      );
    });

    it('should return 404 for non-existent workspace', async () => {
      await request(app)
        .get('/api/workspaces/non-existent/executions/exec-123/cases/0')
        .expect(404);
    });
  });
});
