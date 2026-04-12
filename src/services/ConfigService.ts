import * as fs from 'fs/promises';
import * as path from 'path';
import { parse, stringify } from 'smol-toml';
import { PathHelper } from '../infrastructure/PathHelper';
import type { Workspace } from '../schemas/workspace';

export interface AwsLambdaConfig {
  default?: boolean;
  parallel?: number;
  profile?: string;
  region: string;
  role_arn?: string;
  function_name: string;
  tools_bucket: string;
}

export interface TestStep {
  program: string;
  args?: string[];
  stdin?: string;
  stdout?: string;
  stderr?: string;
  current_dir?: string;
  measure_time?: boolean;
}

export interface PahcerConfig {
  general?: {
    version?: string;
  };
  problem?: {
    problem_name?: string;
    objective?: 'Max' | 'Min';
    score_regex?: string;
  };
  test?: {
    start_seed?: number;
    end_seed?: number;
    threads?: number;
    out_dir?: string;
    compile_steps?: TestStep[];
    test_steps?: TestStep[];
  };
  aws_lambda?: AwsLambdaConfig;
}

/**
 * pahcer_config.tomlの操作を行うサービス
 */
export class ConfigService {
  constructor() {}

  /**
   * pahcer_config.toml のパスを取得
   */
  private getConfigPath(workspace: Workspace): string {
    return PathHelper.getConfigPath(workspace.targetDirectory);
  }

  /**
   * best_scores.json のパスを取得
   */
  private getBestScoresPath(workspace: Workspace): string {
    return PathHelper.getBestScoresPath(workspace.targetDirectory);
  }

  /**
   * pahcer_config.tomlの設定を取得
   */
  async getConfig(workspace: Workspace): Promise<PahcerConfig> {
    try {
      const configPath = this.getConfigPath(workspace);
      const content = await fs.readFile(configPath, 'utf-8');
      return parse(content) as PahcerConfig;
    } catch (error) {
      console.error(`Error loading config: ${error}`);
      return {};
    }
  }

  /**
   * pahcer_config.tomlの設定を更新
   */
  async updateConfig(config: PahcerConfig, workspace: Workspace): Promise<PahcerConfig> {
    try {
      // 現在の設定を読み込む
      const currentConfig = await this.getConfig(workspace);

      // 設定をマージ
      const updatedConfig = this.mergeConfig(currentConfig, config);

      // smol-tomlのstringifyを使用してTOML文字列を生成
      const tomlContent = stringify(updatedConfig);
      const configPath = this.getConfigPath(workspace);
      await fs.writeFile(configPath, tomlContent, 'utf-8');

      return await this.getConfig(workspace);
    } catch (error) {
      console.error(`Error updating config: ${error}`);
      return config;
    }
  }

  /**
   * テスト実行用の一時設定ファイルを削除する
   */
  async cleanupTempConfig(tempConfigPath: string): Promise<boolean> {
    try {
      await fs.unlink(tempConfigPath);
      return true;
    } catch (error) {
      console.error(`Error cleaning up temp config: ${error}`);
      return false;
    }
  }

  /**
   * テスト実行用の一時設定ファイルを作成する。
   * 元の設定ファイルには一切触れず、seed範囲を変更した一時ファイルを生成する。
   * @returns 一時ファイルのパスと out_dir。失敗時はnull。
   */
  async createTempConfigForTest(
    testCaseCount: number | null,
    startSeed: number | null,
    workspace: Workspace,
    settingFilePath?: string | null,
  ): Promise<{ tempPath: string; outDir: string | null } | null> {
    try {
      const sourcePath = settingFilePath || this.getConfigPath(workspace);

      // 現在の設定を読み込む
      const content = await fs.readFile(sourcePath, 'utf-8');
      const currentConfig = parse(content) as PahcerConfig;

      // 指定がなければ元の設定をそのまま使う
      const effectiveStartSeed = startSeed ?? currentConfig.test?.start_seed ?? 0;
      const effectiveEndSeed =
        testCaseCount != null
          ? effectiveStartSeed + testCaseCount
          : (currentConfig.test?.end_seed ?? effectiveStartSeed + 100);

      // テスト設定を更新
      const updatedConfig = {
        ...currentConfig,
        test: {
          ...currentConfig.test,
          start_seed: effectiveStartSeed,
          end_seed: effectiveEndSeed,
        },
      };

      // 一時ファイルに書き出す
      const dir = path.dirname(sourcePath);
      const tempPath = path.join(dir, '.pahcer_studio_tmp.toml');
      const tomlContent = stringify(updatedConfig);
      await fs.writeFile(tempPath, tomlContent, 'utf-8');

      return { tempPath, outDir: currentConfig.test?.out_dir ?? null };
    } catch (error) {
      console.error(`Error creating temp config for test: ${error}`);
      return null;
    }
  }

  /**
   * 設定をマージ
   */
  private mergeConfig(current: PahcerConfig, update: PahcerConfig): PahcerConfig {
    return {
      general: { ...current.general, ...update.general },
      problem: { ...current.problem, ...update.problem },
      test: { ...current.test, ...update.test },
    };
  }

  /**
   * 問題の目的関数（Max/Min）を取得
   */
  async getObjective(workspace: Workspace): Promise<'Max' | 'Min'> {
    try {
      const config = await this.getConfig(workspace);
      return config.problem?.objective || 'Max'; // デフォルトはMax
    } catch (error) {
      console.error(`Error getting objective: ${error}`);
      return 'Max';
    }
  }

  /**
   * best_scores.jsonからベストスコアを取得
   */
  async getBestScores(workspace: Workspace): Promise<Record<number, number>> {
    try {
      const bestScoresPath = this.getBestScoresPath(workspace);
      const content = await fs.readFile(bestScoresPath, 'utf-8');
      const bestScores = JSON.parse(content);

      // JSONのキーは文字列なので、数値に変換
      const result: Record<number, number> = {};
      for (const [seedStr, score] of Object.entries(bestScores)) {
        const seed = parseInt(seedStr, 10);
        if (!isNaN(seed) && typeof score === 'number') {
          result[seed] = score;
        }
      }

      return result;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return {};
      }
      console.error(`Error loading best scores: ${error}`);
      return {};
    }
  }

  /**
   * 相対スコアを計算
   * @param score 現在のスコア
   * @param bestScore ベストスコア
   * @param objective 目的関数（Max/Min）
   * @returns 相対スコア（0.0-1.0）
   */
  calculateRelativeScore(score: number, bestScore: number, objective: 'Max' | 'Min'): number {
    if (score <= 0 || bestScore <= 0) {
      return 0;
    }

    if (objective === 'Min') {
      // Minの場合: ベストスコア / 自分のスコア
      return bestScore / score;
    } else {
      // Maxの場合: 自分のスコア / ベストスコア
      return score / bestScore;
    }
  }
}
