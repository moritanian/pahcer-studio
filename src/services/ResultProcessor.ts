import * as fs from 'fs/promises';
import * as path from 'path';
import { PathHelper } from '../infrastructure/PathHelper';
import { ConfigService } from './ConfigService';
import type { Workspace } from '../schemas/workspace';

/**
 * テスト実行結果（Backend共通）
 */
export interface SeedResult {
  seed: number;
  score: number | null;
  executionTime: number;
  error?: string;
}

/**
 * ログ出力用コールバック
 */
export type LogEmitter = (level: 'info' | 'error', message: string) => void;

/**
 * pahcer CLI を使わない実行パス（Lambda, 将来の LocalBackend）の
 * 結果処理を担当するサービス。
 *
 * - pahcer互換テーブル出力
 * - summary.json 生成
 * - best_scores.json 更新
 * - relative score 計算
 */
export class ResultProcessor {
  constructor(private readonly configService: ConfigService) {}

  /**
   * テーブルヘッダーを出力
   */
  printHeader(log: LogEmitter): void {
    log('info', '| Progress  | Seed |     Case Score     |     Average Score     |   Exec.   |');
    log('info', '|           |      |  Score  | Relative |   Score    | Relative |   Time    |');
    log('info', '|-----------|------|---------|----------|------------|----------|-----------|');
  }

  /**
   * seed ごとの結果行を出力し、累計を更新して返す
   */
  printSeedResults(
    results: SeedResult[],
    state: ProgressState,
    bestScores: Record<number, number>,
    objective: 'Max' | 'Min',
    log: LogEmitter,
  ): void {
    for (const r of results) {
      state.completedCount++;
      if (r.score !== null) {
        state.acceptedCount++;
        state.totalScore += r.score;
      }

      // Calculate relative score (pahcer: best なし → 100.0)
      let rel: number | null = null;
      if (r.score !== null && r.score > 0) {
        if (bestScores[r.seed] !== undefined) {
          rel = this.configService.calculateRelativeScore(r.score, bestScores[r.seed], objective) * 100;
        } else {
          rel = 100.0;
        }
      }
      let relativeStr = '       -';
      if (rel !== null) {
        state.totalRelative += rel;
        state.relativeCount++;
        relativeStr = rel.toFixed(3).padStart(8);
      }

      const avgScore = state.acceptedCount > 0 ? state.totalScore / state.acceptedCount : 0;
      const avgRelative = state.relativeCount > 0 ? state.totalRelative / state.relativeCount : 0;
      const avgRelStr =
        state.relativeCount > 0 ? avgRelative.toFixed(3).padStart(8) : '       -';
      const scoreStr = r.score !== null ? this.formatNumber(r.score) : 'ERROR';
      const avgStr = avgScore.toFixed(2);
      const timeMs = Math.round(r.executionTime * 1000);
      const timeStr = this.formatNumber(timeMs) + ' ms';
      const progressStr = String(state.completedCount).padStart(state.progressWidth);
      const seedStr = String(r.seed).padStart(4, '0');

      log(
        'info',
        `| ${progressStr} / ${state.totalSeeds} | ${seedStr} | ${scoreStr.padStart(7)} | ${relativeStr} | ${avgStr.padStart(10)} | ${avgRelStr} | ${timeStr.padStart(9)} |`,
      );
    }
  }

  /**
   * サマリーを出力
   */
  printSummary(results: SeedResult[], state: ProgressState, log: LogEmitter): void {
    const successResults = results.filter((r) => r.score !== null);
    const finalAvg =
      successResults.length > 0
        ? successResults.reduce((sum, r) => sum + r.score!, 0) / successResults.length
        : 0;
    const finalRelAvg = state.relativeCount > 0 ? state.totalRelative / state.relativeCount : 0;
    const maxExecTime =
      results.length > 0
        ? Math.max(...results.map((r) => Math.round(r.executionTime * 1000)))
        : 0;

    log('info', `Average Score          : ${finalAvg.toFixed(2)}`);
    log('info', `Average Relative Score : ${finalRelAvg.toFixed(3)}`);
    log('info', `Accepted               : ${successResults.length} / ${results.length}`);
    log('info', `Max Execution Time     : ${this.formatNumber(maxExecTime)} ms`);
  }

  /**
   * summary.json を pahcer 互換形式で保存
   */
  async saveSummary(
    executionId: string,
    results: SeedResult[],
    workspace: Workspace,
    options?: {
      startTime?: string;
      comment?: string;
      state?: ProgressState;
    },
  ): Promise<void> {
    const targetDir = workspace.targetDirectory;
    const resultsDir = PathHelper.getResultsDirectory(targetDir);
    const executionDir = path.join(resultsDir, executionId);
    await fs.mkdir(executionDir, { recursive: true });

    const cases = results.map((r) => ({
      seed: r.seed,
      score: r.score,
      execution_time: r.executionTime,
      error_message: r.error,
    }));

    const successCases = cases.filter((c) => c.score !== null);
    const totalScore = successCases.reduce((sum, c) => sum + c.score!, 0);
    const maxExecTime = cases.length > 0 ? Math.max(...cases.map((c) => c.execution_time)) : 0;
    const totalRelativeScore = options?.state?.relativeCount
      ? options.state.totalRelative / options.state.relativeCount
      : 0;

    const summary = {
      start_time: options?.startTime || new Date().toISOString(),
      case_count: results.length,
      total_score: totalScore,
      total_relative_score: totalRelativeScore,
      max_execution_time: maxExecTime,
      comment: options?.comment || '',
      cases,
    };

    const summaryPath = PathHelper.getSummaryPath(targetDir, executionId);
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  }

  /**
   * best_scores.json を更新
   */
  async updateBestScores(
    results: SeedResult[],
    workspace: Workspace,
    objective: 'Max' | 'Min',
  ): Promise<void> {
    const bestScores = await this.configService.getBestScores(workspace);
    let updated = false;

    for (const r of results) {
      if (r.score === null) continue;
      const current = bestScores[r.seed];
      if (current === undefined) {
        bestScores[r.seed] = r.score;
        updated = true;
      } else if (objective === 'Min' && r.score < current) {
        bestScores[r.seed] = r.score;
        updated = true;
      } else if (objective === 'Max' && r.score > current) {
        bestScores[r.seed] = r.score;
        updated = true;
      }
    }

    if (updated) {
      const bestScoresPath = PathHelper.getBestScoresPath(workspace.targetDirectory);
      await fs.mkdir(path.dirname(bestScoresPath), { recursive: true });
      await fs.writeFile(bestScoresPath, JSON.stringify(bestScores, null, 2));
    }
  }

  /**
   * ProgressState の初期化
   */
  createProgressState(totalSeeds: number): ProgressState {
    return {
      completedCount: 0,
      totalScore: 0,
      totalRelative: 0,
      acceptedCount: 0,
      relativeCount: 0,
      totalSeeds,
      progressWidth: String(totalSeeds).length,
    };
  }

  private formatNumber(n: number): string {
    return n.toLocaleString('en-US');
  }
}

export interface ProgressState {
  completedCount: number;
  totalScore: number;
  totalRelative: number;
  acceptedCount: number;
  relativeCount: number;
  totalSeeds: number;
  progressWidth: number;
}
