import * as fs from 'fs/promises';
import { parse, stringify } from 'smol-toml';
import { IWorkspaceRepository } from '../repositories/IWorkspaceRepository';
import { PathHelper } from '../infrastructure/PathHelper';

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
    compile_steps?: string[];
    test_steps?: string[];
  };
}

/**
 * pahcer_config.tomlの操作を行うサービス
 */
export class ConfigService {
  private readonly workspaceRepository: IWorkspaceRepository;

  constructor(workspaceRepository: IWorkspaceRepository) {
    this.workspaceRepository = workspaceRepository;
  }

  /**
   * 現在のワークスペースディレクトリを取得
   */
  private getWorkspaceDir(): string {
    const workspace = this.workspaceRepository.getWorkspace();
    if (!workspace) {
      throw new Error('Workspace not set. Please select a workspace first.');
    }
    return workspace.targetDirectory;
  }

  /**
   * pahcer_config.toml のパスを取得
   */
  private getConfigPath(): string {
    return PathHelper.getConfigPath(this.getWorkspaceDir());
  }

  /**
   * pahcer_config.toml.bak のパスを取得
   */
  private getBackupPath(): string {
    return PathHelper.getBackupPath(this.getWorkspaceDir());
  }

  /**
   * best_scores.json のパスを取得
   */
  private getBestScoresPath(): string {
    return PathHelper.getBestScoresPath(this.getWorkspaceDir());
  }

  /**
   * pahcer_config.tomlの設定を取得
   */
  async getConfig(): Promise<PahcerConfig> {
    try {
      const configPath = this.getConfigPath();
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
  async updateConfig(config: PahcerConfig): Promise<PahcerConfig> {
    try {
      // 現在の設定を読み込む
      const currentConfig = await this.getConfig();

      // 設定をマージ
      const updatedConfig = this.mergeConfig(currentConfig, config);

      // smol-tomlのstringifyを使用してTOML文字列を生成
      const tomlContent = stringify(updatedConfig);
      const configPath = this.getConfigPath();
      await fs.writeFile(configPath, tomlContent, 'utf-8');

      return await this.getConfig();
    } catch (error) {
      console.error(`Error updating config: ${error}`);
      return config;
    }
  }

  /**
   * pahcer_config.tomlをバックアップ
   */
  async backupConfig(): Promise<boolean> {
    try {
      const configPath = this.getConfigPath();
      const backupPath = this.getBackupPath();
      await fs.copyFile(configPath, backupPath);
      return true;
    } catch (error) {
      console.error(`Error backing up config: ${error}`);
      return false;
    }
  }

  /**
   * バックアップからpahcer_config.tomlを復元
   */
  async restoreConfig(): Promise<boolean> {
    try {
      const backupPath = this.getBackupPath();
      const configPath = this.getConfigPath();

      await fs.access(backupPath);
      await fs.copyFile(backupPath, configPath);
      return true;
    } catch (error) {
      console.error(`Error restoring config: ${error}`);
      return false;
    }
  }

  /**
   * テスト実行用にpahcer_config.tomlを更新
   * Python側のupdate_config_for_testと同じ機能
   */
  async updateConfigForTest(testCaseCount: number, startSeed: number): Promise<boolean> {
    try {
      // 設定をバックアップ
      await this.backupConfig();

      // 現在の設定を読み込む
      const currentConfig = await this.getConfig();

      // テスト設定を更新
      const updatedConfig = {
        ...currentConfig,
        test: {
          ...currentConfig.test,
          start_seed: startSeed,
          end_seed: startSeed + testCaseCount,
        },
      };

      // smol-tomlのstringifyを使用してTOML文字列を生成
      const tomlContent = stringify(updatedConfig);
      const configPath = this.getConfigPath();
      await fs.writeFile(configPath, tomlContent, 'utf-8');

      return true;
    } catch (error) {
      console.error(`Error updating config for test: ${error}`);
      return false;
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
  async getObjective(): Promise<'Max' | 'Min'> {
    try {
      const config = await this.getConfig();
      return config.problem?.objective || 'Max'; // デフォルトはMax
    } catch (error) {
      console.error(`Error getting objective: ${error}`);
      return 'Max';
    }
  }

  /**
   * best_scores.jsonからベストスコアを取得
   */
  async getBestScores(): Promise<Record<number, number>> {
    try {
      const bestScoresPath = this.getBestScoresPath();
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
