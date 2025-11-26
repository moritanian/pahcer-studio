import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import {
  type AnalysisRequest,
  type AnalysisResponse,
  type UpdateAnalysisResponse,
  type InputFeature,
  type ScoreData,
} from '../schemas/analysis';
import { ConfigService } from './ConfigService';
import { PathHelper } from '../infrastructure/PathHelper';

import type { ExecutionDataMinimal, ExecutionSeedResult } from '../types/summary';
import type { IExecutionRepository } from '../repositories/IExecutionRepository';
import type { IWorkspaceRepository } from '../repositories/IWorkspaceRepository';
import type { WorkspaceService } from './WorkspaceService';

/**
 * AnalysisService
 * ----------------
 * ・ tools/in  から入力ファイルを読み取り特徴量を抽出（キャッシュ可）
 * ・ data/results/{id}/summary.json を読み取りスコア系列を生成
 * ・ best_scores.json / pahcer_config.toml を参照して相対スコアを算出
 * ・ 設定の読み書きやキャッシュ更新も担当
 *
 * フロントエンド (renderer) からは IPC 経由で呼び出され、
 * 大量ファイル I/O をまとめて処理するバックエンドレイヤです。
 */
export class AnalysisService {
  private executionRepository: IExecutionRepository;
  private workspaceRepository: IWorkspaceRepository;
  private workspaceService: WorkspaceService;
  private inputFeaturesCache: Map<string, InputFeature> = new Map();
  private bestScoresCache: Map<string, number> = new Map();

  constructor(
    executionRepository: IExecutionRepository,
    workspaceRepository: IWorkspaceRepository,
    workspaceService: WorkspaceService,
  ) {
    this.executionRepository = executionRepository;
    this.workspaceRepository = workspaceRepository;
    this.workspaceService = workspaceService;

    // 初期化時はキャッシュを読み込まない（ワークスペースが確定してから読み込む）
  }

  /**
   * 現在のワークスペースのルートディレクトリを取得
   */
  private getWorkspaceDir(): string {
    const workspace = this.workspaceService.getWorkspace();
    if (!workspace) {
      throw new Error('Workspace not set. Please select a workspace first.');
    }
    return workspace.targetDirectory;
  }

  private getInputDir(): string {
    return PathHelper.getInputDirectory(this.getWorkspaceDir());
  }

  private getOutputDir(): string {
    return PathHelper.getResultsDirectory(this.getWorkspaceDir());
  }

  private getDataDir(): string {
    return PathHelper.getAnalysisDataDirectory(this.getWorkspaceDir());
  }

  private getFeatureCachePath(): string {
    return path.join(this.getDataDir(), 'input_features.json');
  }

  private getSettingsPath(): string {
    return path.join(this.getDataDir(), 'analysis_settings.json');
  }

  private getBestScoresPath(): string {
    return PathHelper.getBestScoresPath(this.getWorkspaceDir());
  }

  /**
   * キャッシュが読み込まれているか確認し、未読み込みなら読み込む
   */
  private ensureCacheLoaded(): void {
    if (this.inputFeaturesCache.size === 0 && this.bestScoresCache.size === 0) {
      this.reloadCache();
    }
  }

  /**
   * キャッシュを読み込む
   *   - 入力特徴量キャッシュ (input_features.json)
   *   - 最高得点キャッシュ   (best_scores.json)
   */
  private reloadCache(): void {
    // キャッシュをクリア
    this.inputFeaturesCache.clear();
    this.bestScoresCache.clear();

    const dataDir = this.getDataDir();
    // 必要なディレクトリの作成
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (e) {
        console.error('データディレクトリの作成に失敗しました:', e);
      }
    }

    // 入力特徴量キャッシュの読み込み
    const featureCachePath = this.getFeatureCachePath();
    if (fs.existsSync(featureCachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(featureCachePath, 'utf8'));
        for (const [fileKey, featureData] of Object.entries(data)) {
          this.inputFeaturesCache.set(fileKey, featureData as InputFeature);
        }
      } catch (error) {
        console.error('入力特徴量キャッシュの読み込みに失敗しました:', error);
      }
    }

    // 最高得点キャッシュの読み込み
    const bestScoresPath = this.getBestScoresPath();
    if (fs.existsSync(bestScoresPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(bestScoresPath, 'utf8'));
        for (const [key, score] of Object.entries(data)) {
          this.bestScoresCache.set(key, score as number);
        }
      } catch (error) {
        console.error('最高得点キャッシュの読み込みに失敗しました:', error);
      }
    }
  }

  /**
   * 現在の分析設定を取得 (featureFormat のみ)
   *   優先順位: 設定ファイル > 入力キャッシュ推測 > デフォルト
   */
  getSettings(): { featureFormat: string } {
    this.ensureCacheLoaded();

    // 既定値（後でキャッシュから置換する可能性あり）
    let featureFormat = '';
    const settingsPath = this.getSettingsPath();

    // 設定ファイルがあれば読み込む
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        // 過去バージョンでネストして保存された場合の補正
        if (
          settings.featureFormat &&
          typeof settings.featureFormat === 'object' &&
          settings.featureFormat.featureFormat
        ) {
          featureFormat = settings.featureFormat.featureFormat;
        } else if (typeof settings.featureFormat === 'string') {
          featureFormat = settings.featureFormat;
        }
      } catch (error) {
        console.error('設定ファイルの読み込みに失敗しました:', error);
      }
    }

    // 設定ファイルになければ入力特徴量キャッシュから推測
    if (!featureFormat && this.inputFeaturesCache.size > 0) {
      const sample = this.inputFeaturesCache.values().next().value as InputFeature;
      if (sample) {
        featureFormat = Object.keys(sample.features).join(' ');
      }
    }

    // それでも空ならデフォルトを返す
    if (!featureFormat) {
      featureFormat = 'N M K';
    }

    return { featureFormat };
  }

  /**
   * featureFormat を settings.json に保存
   * エラー時は直前の設定を返して UI 側で扱いやすくする
   */
  saveSettings(featureFormat: string): { featureFormat: string } {
    this.ensureCacheLoaded();
    const settings = { featureFormat };
    const settingsPath = this.getSettingsPath();

    try {
      // ディレクトリが存在することを確認
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      return settings;
    } catch (error) {
      console.error('設定ファイルの保存に失敗しました:', error);
      return this.getSettings();
    }
  }

  /** 入力特徴量キャッシュを disk へ書き戻す */
  private saveFeatureCache(): void {
    try {
      const featureData = Object.fromEntries(this.inputFeaturesCache);
      const featureCachePath = this.getFeatureCachePath();

      // ディレクトリが存在することを確認
      const dir = path.dirname(featureCachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(featureCachePath, JSON.stringify(featureData, null, 2));
    } catch (error) {
      console.error('入力特徴量キャッシュの保存に失敗しました:', error);
    }
  }

  /**
   * 単一入力ファイル(.txt)から InputFeature を抽出
   * @param inputFile 実ファイルパス
   * @param featureFormat "N M K" のように空白区切りで特徴量名を指定
   * @returns 抽出失敗時は null
   */
  private extractInputFeature(inputFile: string, featureFormat: string): InputFeature | null {
    try {
      const fileName = path.basename(inputFile);

      // シード値の抽出（ファイル名から抽出）
      const seedMatch = fileName.match(/(\d+)\.txt$/);
      const seed = seedMatch ? parseInt(seedMatch[1]) : 0;

      // 特徴量名のリスト
      const featureNames = featureFormat.split(/\s+/);

      // ファイルの1行目を読み取り、特徴量を抽出
      const firstLine = fs.readFileSync(inputFile, 'utf8').split('\n')[0].trim();

      // 空白で分割し、数値に変換
      const values = firstLine.split(/\s+/);

      // 特徴量データの作成
      const features: Record<string, number> = {};
      for (let i = 0; i < featureNames.length; i++) {
        if (i < values.length) {
          try {
            features[featureNames[i]] = parseFloat(values[i]);
          } catch {
            features[featureNames[i]] = 0.0;
          }
        }
      }

      return {
        seed,
        file: fileName,
        features,
      };
    } catch (error) {
      console.error(`入力特徴量の抽出に失敗しました: ${inputFile}`, error);
      return null;
    }
  }

  /**
   * executionId から summary.json と execution_info.json を読み取り
   * seed→score の辞書形式へ整形
   */
  private async getExecutionData(executionId: string): Promise<ExecutionDataMinimal> {
    try {
      const outputDir = this.getOutputDir();

      // 実行情報のJSONを読み取り
      const infoPath = path.join(outputDir, executionId, 'execution_info.json');
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));

      // 実行サマリーを読み取り
      const summaryPath = path.join(outputDir, executionId, 'summary.json');
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

      // コメントを取得
      const comment = info.comment || executionId.substring(0, 8);

      // シードをキーとするスコア辞書を作成
      const seeds: Record<number, ExecutionSeedResult> = {};
      for (const caseData of summary.cases || []) {
        const seed = caseData.seed || 0;
        const score = parseFloat(caseData.score || '0');
        const executionTime = parseFloat(caseData.execution_time || '0');
        const errorMessage = caseData.error_message || '';

        // ステータスを決定
        const status = errorMessage && errorMessage.trim() ? 'error' : 'success';

        seeds[seed] = {
          score,
          status,
          execution_time: executionTime,
          error_message: errorMessage,
        };
      }

      return {
        executionId,
        comment,
        seeds,
      };
    } catch (error) {
      console.error(`テスト実行データの取得に失敗しました: ${executionId}`, error);
      return {
        executionId,
        comment: executionId.substring(0, 8),
        seeds: {} as Record<number, ExecutionSeedResult>,
      };
    }
  }

  /**
   * 入力特徴量キャッシュを再生成 (tools/in/*.txt をフルスキャン)
   */
  async updateFeatureCache(featureFormat: string): Promise<UpdateAnalysisResponse> {
    this.ensureCacheLoaded();
    try {
      // 入力ディレクトリのテストケースファイルを検索（クロスプラットフォーム対応）
      const inputDir = this.getInputDir();
      console.log('Searching for input files in:', inputDir);
      const inputFiles = glob.sync('*.txt', { cwd: inputDir, absolute: true });

      // 特徴量を抽出して保存
      let featureCount = 0;
      for (const inputFile of inputFiles) {
        const fileName = path.basename(inputFile);
        const feature = this.extractInputFeature(inputFile, featureFormat);

        if (feature) {
          this.inputFeaturesCache.set(fileName, feature);
          featureCount++;
        }
      }

      // 入力特徴量キャッシュの保存のみ実施
      this.saveFeatureCache();

      const featureKeys = new Set<string>();
      if (this.inputFeaturesCache.size > 0) {
        const sampleFeature = this.inputFeaturesCache.values().next().value;
        if (sampleFeature) {
          Object.keys(sampleFeature.features).forEach((key) => featureKeys.add(key));
        }
      }

      return {
        successful: true,
        message: `特徴量キャッシュを更新しました`,
        totalTestCases: featureCount,
        totalExecutions: undefined,
        extractedFeatures: Array.from(featureKeys),
      };
    } catch (error) {
      console.error('キャッシュの更新に失敗しました:', error);
      return {
        successful: false,
        message: `キャッシュの更新に失敗しました: ${error}`,
      };
    }
  }

  /**
   * 分析メインエントリ
   *   1) 必要であれば特徴量キャッシュを生成
   *   2) BestScores を取得して相対スコアを計算
   *   3) AnalysisResponse を組み立てて返却
   */
  async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    this.ensureCacheLoaded();
    try {
      // 特徴量キャッシュを更新（キャッシュがない場合のみ）
      if (this.inputFeaturesCache.size === 0) {
        await this.updateFeatureCache(request.featureFormat);
      }

      // ★ 相対スコア計算用にベストスコアと目的関数を取得
      const configService = new ConfigService(this.workspaceRepository);
      const [bestScores, objective] = await Promise.all([
        configService.getBestScores(),
        configService.getObjective(),
      ]);

      // 入力特徴量リストの作成
      const inputFeatures = Array.from(this.inputFeaturesCache.values());

      // 特徴量キーのリスト
      let featureKeys: string[] = [];
      if (inputFeatures.length > 0) {
        featureKeys = Object.keys(inputFeatures[0].features);
      }

      // 各実行のスコアを取得
      const scoreDataList: ScoreData[] = [];

      for (const executionId of request.executionIds) {
        const executionData = await this.getExecutionData(executionId);

        if (Object.keys(executionData.seeds).length === 0) {
          continue;
        }

        // スコアデータを生成
        const scores: Record<string, number> = {};
        const relativeScores: Record<string, number> = {};

        // シードごとにスコアを設定
        for (const [seed, caseData] of Object.entries(executionData.seeds) as Array<
          [string, ExecutionSeedResult]
        >) {
          // エラーの場合は-1、成功の場合はスコアを設定
          const score = caseData.status === 'error' ? -1.0 : caseData.score;
          scores[seed.toString()] = score;

          // ★ 相対スコアを計算
          const best = bestScores[Number(seed)];
          if (best !== undefined && score >= 0) {
            relativeScores[seed.toString()] = configService.calculateRelativeScore(
              score,
              best,
              objective,
            );
          }
        }

        const scoreData: ScoreData = {
          id: executionId,
          scores,
          relativeScores,
        };

        scoreDataList.push(scoreData);
      }

      return {
        inputFeatures,
        scoreData: scoreDataList,
        featureKeys,
      };
    } catch (error) {
      console.error('分析の実行に失敗しました:', error);
      throw error;
    }
  }
}
