import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceRepository } from '../WorkspaceRepository';
import type { Workspace } from '../../schemas/workspace';

describe('WorkspaceRepository', () => {
  describe('In-memory mode (no persistence)', () => {
    let repository: WorkspaceRepository;

    beforeEach(() => {
      repository = new WorkspaceRepository(undefined, false);
    });

    it('should save and retrieve workspace by ID', () => {
      const workspace: Workspace = {
        id: 'test-workspace-12345678',
        targetDirectory: '/home/user/test',
        useWsl: false,
      };

      repository.saveWorkspace(workspace);
      const retrieved = repository.getWorkspace('test-workspace-12345678');

      expect(retrieved).toEqual(workspace);
    });

    it('should return null for non-existent workspace', () => {
      const retrieved = repository.getWorkspace('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should list all workspaces', () => {
      const workspace1: Workspace = {
        id: 'workspace1-12345678',
        targetDirectory: '/home/user/project1',
        useWsl: false,
      };

      const workspace2: Workspace = {
        id: 'workspace2-87654321',
        targetDirectory: '/home/user/project2',
        useWsl: false,
      };

      repository.saveWorkspace(workspace1);
      repository.saveWorkspace(workspace2);

      const workspaces = repository.listWorkspaces();
      expect(workspaces).toHaveLength(2);
      expect(workspaces).toContainEqual(workspace1);
      expect(workspaces).toContainEqual(workspace2);
    });

    it('should delete workspace by ID', () => {
      const workspace: Workspace = {
        id: 'test-workspace-12345678',
        targetDirectory: '/home/user/test',
        useWsl: false,
      };

      repository.saveWorkspace(workspace);
      const deleted = repository.deleteWorkspace('test-workspace-12345678');

      expect(deleted).toBe(true);
      expect(repository.getWorkspace('test-workspace-12345678')).toBeNull();
    });

    it('should return false when deleting non-existent workspace', () => {
      const deleted = repository.deleteWorkspace('non-existent');
      expect(deleted).toBe(false);
    });

    it('should update existing workspace', () => {
      const workspace: Workspace = {
        id: 'workspace1-12345678',
        targetDirectory: '/home/user/project1',
        useWsl: false,
      };

      repository.saveWorkspace(workspace);

      // Update the workspace
      const updatedWorkspace: Workspace = {
        id: 'workspace1-12345678',
        targetDirectory: '/home/user/project1-updated',
        useWsl: true,
      };

      repository.saveWorkspace(updatedWorkspace);

      const retrieved = repository.getWorkspace('workspace1-12345678');
      expect(retrieved).toEqual(updatedWorkspace);
      expect(repository.listWorkspaces()).toHaveLength(1);
    });

    it('should clear all workspaces', () => {
      const workspace: Workspace = {
        id: 'test-workspace-12345678',
        targetDirectory: '/home/user/test',
        useWsl: false,
      };

      repository.saveWorkspace(workspace);
      repository.clear();

      expect(repository.listWorkspaces()).toHaveLength(0);
    });
  });

  describe('Persistence mode', () => {
    let testDir: string;
    let repository: WorkspaceRepository;

    beforeEach(async () => {
      // Create temporary directory for test
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pahcer-test-'));
    });

    afterEach(async () => {
      // Cleanup temporary directory
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (error) {
        console.error('Failed to cleanup test directory:', error);
      }
    });

    it('should persist workspace to file', async () => {
      repository = new WorkspaceRepository(testDir, true);

      const workspace: Workspace = {
        id: 'test-workspace-12345678',
        targetDirectory: '/home/user/test',
        useWsl: false,
      };

      repository.saveWorkspace(workspace);

      // Wait for async persist operation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify file exists and contains workspace
      const filePath = path.join(testDir, 'workspaces.json');
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const workspaces = JSON.parse(fileContent);

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]).toEqual(workspace);
    });

    it('should load workspaces from file on initialization', async () => {
      // First, create a repository and save workspace
      const repository1 = new WorkspaceRepository(testDir, true);

      const workspace: Workspace = {
        id: 'test-workspace-12345678',
        targetDirectory: '/home/user/test',
        useWsl: false,
      };

      repository1.saveWorkspace(workspace);

      // Wait for persist
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create new repository instance (should load from file)
      const repository2 = new WorkspaceRepository(testDir, true);

      // Wait for load
      await new Promise((resolve) => setTimeout(resolve, 100));

      const retrieved = repository2.getWorkspace('test-workspace-12345678');
      expect(retrieved).toEqual(workspace);
    });

    it('should persist deletion to file', async () => {
      repository = new WorkspaceRepository(testDir, true);

      const workspace: Workspace = {
        id: 'test-workspace-12345678',
        targetDirectory: '/home/user/test',
        useWsl: false,
      };

      repository.saveWorkspace(workspace);
      await new Promise((resolve) => setTimeout(resolve, 100));

      repository.deleteWorkspace('test-workspace-12345678');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify file is empty array
      const filePath = path.join(testDir, 'workspaces.json');
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const workspaces = JSON.parse(fileContent);

      expect(workspaces).toHaveLength(0);
    });

    it('should handle missing storage file gracefully', async () => {
      // Create repository with non-existent directory
      const nonExistentDir = path.join(testDir, 'non-existent');
      repository = new WorkspaceRepository(nonExistentDir, true);

      // Wait for load attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should work fine (no workspaces loaded)
      expect(repository.listWorkspaces()).toHaveLength(0);

      // Should be able to save (will create directory)
      const workspace: Workspace = {
        id: 'test-workspace-12345678',
        targetDirectory: '/home/user/test',
        useWsl: false,
      };

      repository.saveWorkspace(workspace);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify directory and file were created
      const filePath = path.join(nonExistentDir, 'workspaces.json');
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should handle corrupted JSON file gracefully', async () => {
      // Suppress console.error for this test
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Create corrupted JSON file
      const filePath = path.join(testDir, 'workspaces.json');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(filePath, '{invalid json', 'utf-8');

      // Should not throw when loading
      repository = new WorkspaceRepository(testDir, true);

      // Wait for load attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have empty list (failed to load)
      expect(repository.listWorkspaces()).toHaveLength(0);

      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });
});
