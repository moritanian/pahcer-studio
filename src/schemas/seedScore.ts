import { z } from 'zod';

/**
 * seed 別ベストスコア機能のスキーマ定義。
 * すべて生スコア (absolute) ベースで扱う。
 */

// objective (Max / Min)
export const ObjectiveSchema = z.enum(['Max', 'Min']);

// 案3: ある seed における 1 execution 分のエントリ
export const SeedScoreEntrySchema = z.object({
  executionId: z.string(),
  comment: z.string().nullable(),
  startTime: z.string().optional(),
  status: z.string().optional(),
  score: z.number().nullable(),
  executionTime: z.number().nullable(), // milliseconds
  isError: z.boolean(),
  rank: z.number().nullable(), // 有効スコアのみ 1-based。無効(null/error)は null
  isBest: z.boolean(),
});

// 案3: seed 指定 → 全 execution ランキング
export const SeedRankingResponseSchema = z.object({
  seed: z.number(),
  objective: ObjectiveSchema,
  bestExecutionId: z.string().nullable(),
  entries: z.array(SeedScoreEntrySchema),
});

// 案2: seed ごとのベスト 1 行
export const BestPerSeedRowSchema = z.object({
  seed: z.number(),
  bestExecutionId: z.string().nullable(),
  bestScore: z.number().nullable(),
  executionTime: z.number().nullable(), // milliseconds
  comment: z.string().nullable(),
  executionCount: z.number(), // この seed の有効スコアを持つ execution 数
});

// 案2: 全 seed ベスト一覧
export const BestPerSeedResponseSchema = z.object({
  objective: ObjectiveSchema,
  averageBestScore: z.number().nullable(),
  rows: z.array(BestPerSeedRowSchema),
});

export type Objective = z.infer<typeof ObjectiveSchema>;
export type SeedScoreEntry = z.infer<typeof SeedScoreEntrySchema>;
export type SeedRankingResponse = z.infer<typeof SeedRankingResponseSchema>;
export type BestPerSeedRow = z.infer<typeof BestPerSeedRowSchema>;
export type BestPerSeedResponse = z.infer<typeof BestPerSeedResponseSchema>;
