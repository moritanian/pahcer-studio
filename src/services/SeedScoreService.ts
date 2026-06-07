import * as fs from 'fs/promises';
import * as path from 'path';
import { PathHelper } from '../infrastructure/PathHelper';
import { ConfigService } from './ConfigService';
import type { Workspace } from '../schemas/workspace';
import type { SummaryJson } from '../types/summary';
import type {
  Objective,
  SeedRankingResponse,
  SeedScoreEntry,
  BestPerSeedResponse,
  BestPerSeedRow,
} from '../schemas/seedScore';

/** execution 1 件のメタ情報（execution_info.json 由来） */
interface ExecutionMeta {
  comment: string | null;
  startTime?: string;
  status?: string;
}

/** ある execution における 1 seed 分の生データ */
interface SeedCell {
  executionId: string;
  score: number | null;
  executionTime: number | null; // milliseconds
  isError: boolean;
}

/** 全 execution を横断した索引 */
interface SeedIndex {
  /** executionId -> メタ情報 */
  meta: Map<string, ExecutionMeta>;
  /** seed -> その seed のセル一覧 */
  bySeed: Map<number, SeedCell[]>;
}

interface CachedIndex {
  fingerprint: string;
  index: SeedIndex;
}

/**
 * seed ごとに「どの execution が最良スコアか」を集計するサービス。
 *
 * - 全 execution の summary.json を一度だけ読み込んで索引を構築する。
 * - 構築結果は workspace 単位でメモリにキャッシュし、
 *   summary.json の mtime から計算したフィンガープリントで自動的に無効化する。
 * - スコアは生スコア (absolute) を objective (Max/Min) に従って比較する。
 */
export class SeedScoreService {
  private configService: ConfigService;
  private cache: Map<string, CachedIndex> = new Map();

  constructor(configService?: ConfigService) {
    this.configService = configService ?? new ConfigService();
  }

  /**
   * 案3: seed 指定 → 全 execution を生スコアの良い順にランキングして返す。
   */
  async getSeedRanking(seed: number, workspace: Workspace): Promise<SeedRankingResponse> {
    const [index, objective] = await Promise.all([
      this.getIndex(workspace),
      this.configService.getObjective(workspace),
    ]);

    const cells = index.bySeed.get(seed) ?? [];

    // 有効スコア(非エラー かつ score!=null)を objective に従ってソート
    const sorted = [...cells].sort((a, b) => this.compareCells(a, b, objective));

    let rankCounter = 0;
    const entries: SeedScoreEntry[] = sorted.map((cell) => {
      const meta = index.meta.get(cell.executionId);
      const valid = !cell.isError && cell.score != null;
      const rank = valid ? ++rankCounter : null;
      return {
        executionId: cell.executionId,
        comment: meta?.comment ?? null,
        startTime: meta?.startTime,
        status: meta?.status,
        score: cell.score,
        executionTime: cell.executionTime,
        isError: cell.isError,
        rank,
        isBest: false,
      };
    });

    // 最良(rank===1)に isBest を立てる
    const best = entries.find((e) => e.rank === 1) ?? null;
    if (best) best.isBest = true;

    return {
      seed,
      objective,
      bestExecutionId: best?.executionId ?? null,
      entries,
    };
  }

  /**
   * 案2: seed ごとのベスト execution を一覧で返す（seed 昇順）。
   */
  async getBestPerSeed(workspace: Workspace): Promise<BestPerSeedResponse> {
    const [index, objective] = await Promise.all([
      this.getIndex(workspace),
      this.configService.getObjective(workspace),
    ]);

    const rows: BestPerSeedRow[] = [];
    const seeds = [...index.bySeed.keys()].sort((a, b) => a - b);

    for (const seed of seeds) {
      const cells = index.bySeed.get(seed) ?? [];
      const validCells = cells.filter((c) => !c.isError && c.score != null);

      let bestCell: SeedCell | null = null;
      for (const cell of validCells) {
        if (bestCell === null || this.compareCells(cell, bestCell, objective) < 0) {
          bestCell = cell;
        }
      }

      rows.push({
        seed,
        bestExecutionId: bestCell?.executionId ?? null,
        bestScore: bestCell?.score ?? null,
        executionTime: bestCell?.executionTime ?? null,
        comment: bestCell ? (index.meta.get(bestCell.executionId)?.comment ?? null) : null,
        executionCount: validCells.length,
      });
    }

    const bestScores = rows
      .map((row) => row.bestScore)
      .filter((score): score is number => score != null);
    const averageBestScore =
      bestScores.length > 0
        ? bestScores.reduce((sum, score) => sum + score, 0) / bestScores.length
        : null;

    return { objective, averageBestScore, rows };
  }

  /**
   * 「良い順」の比較関数。
   * 戻り値が負なら a の方が良い。
   * 有効スコアは無効スコア(null/error)より常に良いものとして扱う。
   */
  private compareCells(a: SeedCell, b: SeedCell, objective: Objective): number {
    const aValid = !a.isError && a.score != null;
    const bValid = !b.isError && b.score != null;
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1;
    if (!bValid) return -1;
    // ここで両者 score は number
    const diff = (a.score as number) - (b.score as number);
    const scoreComparison = objective === 'Max' ? -diff : diff;
    if (scoreComparison !== 0) return scoreComparison;

    return b.executionId.localeCompare(a.executionId);
  }

  /**
   * 索引を取得する。フィンガープリントが一致すればキャッシュを再利用する。
   */
  private async getIndex(workspace: Workspace): Promise<SeedIndex> {
    const resultsDir = PathHelper.getResultsDirectory(workspace.targetDirectory);
    const executionIds = await this.listExecutionIds(resultsDir);
    const fingerprint = await this.computeFingerprint(resultsDir, executionIds);

    const cached = this.cache.get(workspace.id);
    if (cached && cached.fingerprint === fingerprint) {
      return cached.index;
    }

    const index = await this.buildIndex(resultsDir, executionIds);
    this.cache.set(workspace.id, { fingerprint, index });
    return index;
  }

  /** results ディレクトリ直下の execution ID 一覧を取得する */
  private async listExecutionIds(resultsDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(resultsDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * summary.json の mtime からフィンガープリントを計算する。
   * 索引本体の読み込み(=全 cases のパース)より遥かに軽い stat のみで変更検知する。
   */
  private async computeFingerprint(resultsDir: string, executionIds: string[]): Promise<string> {
    const parts = await Promise.all(
      [...executionIds].sort().map(async (id) => {
        const summaryPath = path.join(resultsDir, id, 'summary.json');
        try {
          const stat = await fs.stat(summaryPath);
          return `${id}:${stat.mtimeMs}:${stat.size}`;
        } catch {
          // summary.json 未生成（実行中など）はフィンガープリントから除外
          return null;
        }
      }),
    );
    return parts.filter(Boolean).join('|');
  }

  /** 全 execution の summary.json / execution_info.json を読み込んで索引を構築する */
  private async buildIndex(resultsDir: string, executionIds: string[]): Promise<SeedIndex> {
    const meta = new Map<string, ExecutionMeta>();
    const bySeed = new Map<number, SeedCell[]>();

    await Promise.all(
      executionIds.map(async (id) => {
        const summary = await this.readJson<SummaryJson>(path.join(resultsDir, id, 'summary.json'));
        if (!summary?.cases || !Array.isArray(summary.cases)) {
          return;
        }

        const info = await this.readJson<{
          comment?: string | null;
          startTime?: string;
          status?: string;
        }>(path.join(resultsDir, id, 'execution_info.json'));

        meta.set(id, {
          comment: info?.comment ?? summary.comment ?? null,
          startTime: info?.startTime,
          status: info?.status,
        });

        for (const c of summary.cases) {
          const isError = !!(c.error_message && String(c.error_message).trim());
          const cell: SeedCell = {
            executionId: id,
            score: c.score ?? null,
            executionTime: c.execution_time != null ? Number(c.execution_time) * 1000 : null,
            isError,
          };
          const list = bySeed.get(c.seed);
          if (list) {
            list.push(cell);
          } else {
            bySeed.set(c.seed, [cell]);
          }
        }
      }),
    );

    return { meta, bySeed };
  }

  /** JSON を読み込む。存在しなければ null */
  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }
}
