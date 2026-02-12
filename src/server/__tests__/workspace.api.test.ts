import request from 'supertest';
import express from 'express';
import { createApp } from '../server';
import { WorkspaceRepository } from '../../repositories/WorkspaceRepository';
import { WorkspaceService } from '../../services/WorkspaceService';
import type { ExecutionService } from '../../services/ExecutionService';
import type { AnalysisService } from '../../services/AnalysisService';
import * as path from 'path';

describe('Workspace API', () => {
  let app: express.Application;
  let workspaceRepository: WorkspaceRepository;
  let workspaceService: WorkspaceService;

  beforeEach(async () => {
    // Create repository without persistence for isolated testing
    workspaceRepository = new WorkspaceRepository(undefined, false);

    // Create workspace service with test repository
    const settingsPath = path.join('/tmp', 'test-settings.json');
    workspaceService = new WorkspaceService(settingsPath, workspaceRepository);

    // Create minimal mock services for execution and analysis
    // We don't need real implementations for workspace API tests
    const executionService = {} as ExecutionService;
    const analysisService = {} as AnalysisService;

    // Create app with test services
    app = createApp({
      workspaceService,
      executionService,
      analysisService,
    });
  });

  describe('POST /api/workspaces', () => {
    it('should create a new workspace', async () => {
      const targetDirectory = '/home/user/atcoder/ahc041';

      const response = await request(app)
        .post('/api/workspaces')
        .send({
          targetDirectory,
          useWsl: false,
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.targetDirectory).toBe(targetDirectory);
      expect(response.body.useWsl).toBe(false);
    });

    it('should return same workspace when called twice (idempotent)', async () => {
      const targetDirectory = '/home/user/atcoder/ahc042';

      const response1 = await request(app)
        .post('/api/workspaces')
        .send({ targetDirectory })
        .expect(201);

      // 2回目は既存のworkspaceが返る（200 OK）
      const response2 = await request(app)
        .post('/api/workspaces')
        .send({ targetDirectory })
        .expect(200);

      expect(response1.body.id).toBe(response2.body.id);
    });

    it('should generate different IDs for different targetDirectories', async () => {
      const dir1 = '/home/user/ahc041';
      const dir2 = '/home/another/ahc041';

      const response1 = await request(app)
        .post('/api/workspaces')
        .send({ targetDirectory: dir1 })
        .expect(201);

      const response2 = await request(app)
        .post('/api/workspaces')
        .send({ targetDirectory: dir2 })
        .expect(201);

      expect(response1.body.id).not.toBe(response2.body.id);
    });

    it('should use default values for optional fields', async () => {
      const targetDirectory = '/home/user/project';

      const response = await request(app)
        .post('/api/workspaces')
        .send({ targetDirectory })
        .expect(201);

      expect(response.body.useWsl).toBe(false);
    });
  });

  describe('GET /api/workspaces', () => {
    it('should return empty array when no workspaces exist', async () => {
      const response = await request(app).get('/api/workspaces').expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return all registered workspaces', async () => {
      // Create two workspaces
      const dir1 = '/home/user/ahc041';
      const dir2 = '/home/user/ahc042';

      await request(app).post('/api/workspaces').send({ targetDirectory: dir1 });
      await request(app).post('/api/workspaces').send({ targetDirectory: dir2 });

      const response = await request(app).get('/api/workspaces').expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[1]).toHaveProperty('id');
    });
  });

  describe('GET /api/workspaces/:workspaceId', () => {
    it('should return workspace info for valid ID', async () => {
      const targetDir = '/home/user/ahc041';

      const createResponse = await request(app)
        .post('/api/workspaces')
        .send({ targetDirectory: targetDir });
      const workspaceId = createResponse.body.id;

      const response = await request(app).get(`/api/workspaces/${workspaceId}`).expect(200);

      expect(response.body.id).toBe(workspaceId);
      expect(response.body.targetDirectory).toBe(targetDir);
    });

    it('should return 404 for non-existent workspace', async () => {
      const response = await request(app).get('/api/workspaces/non-existent-id').expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/workspaces/:workspaceId', () => {
    it('should delete workspace successfully', async () => {
      const targetDir = '/home/user/ahc041';

      const createResponse = await request(app)
        .post('/api/workspaces')
        .send({ targetDirectory: targetDir });
      const workspaceId = createResponse.body.id;

      await request(app).delete(`/api/workspaces/${workspaceId}`).expect(204);

      // Verify it's deleted
      await request(app).get(`/api/workspaces/${workspaceId}`).expect(404);
    });

    it('should return 404 when deleting non-existent workspace', async () => {
      await request(app).delete('/api/workspaces/non-existent-id').expect(404);
    });
  });
});
