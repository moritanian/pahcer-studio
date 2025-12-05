import { z } from 'zod';
import { BaseErrorSchema } from './base';

// 汎用バリデーション関数
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(
        (err: z.ZodIssue) => `${err.path.join('.')}: ${err.message}`,
      );
      throw new Error(`バリデーションエラー: ${messages.join(', ')}`);
    }
    throw error;
  }
}

// レスポンス用バリデーション
export function validateResponse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    console.error('レスポンスバリデーションエラー:', error);
    throw new Error('内部エラー: レスポンス形式が正しくありません');
  }
}

// エラーハンドリング用
export function createIPCError(message: string, code?: string) {
  return BaseErrorSchema.parse({
    message,
    code,
    timestamp: new Date(),
  });
}
