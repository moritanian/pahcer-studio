import { z } from 'zod';

/**
 * Workspace configuration
 */
export const WorkspaceSchema = z.object({
  id: z.string(),
  targetDirectory: z.string(),
  useWsl: z.boolean().default(false).optional(),
});

/**
 * Workspace history
 */
export const WorkspaceHistorySchema = z.object({
  path: z.string(),
  useWsl: z.boolean(),
  lastOpened: z.number(), // timestamp
});

/**
 * Application settings
 */
export const AppSettingsSchema = z.object({
  projects: z.array(WorkspaceHistorySchema),
});

// Type exports
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceHistory = z.infer<typeof WorkspaceHistorySchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
