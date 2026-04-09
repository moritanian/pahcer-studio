# pahcer-studio

**[pahcer](https://github.com/terry-u16/pahcer) ベースの AtCoder Heuristic Contest (AHC) テスト実行管理ツール**

![pahcer-studio](img/fig1.png)

terry_u16 さんが開発したテスト実行ツール **pahcer** を活用し、テスト実行・結果管理・分析機能を統合した Web アプリケーションです。

## 🎯 開発の背景

AHCをやっている中で、以下のような問題を感じていました：

- **テスト実行の管理が煩雑** - pahcer では基本的に最新の結果しか持たない
- **改善効果の把握が困難** - どのコード変更が実際にスコア向上につながったか分からない
- **ビジュアライザでの確認が手間** - pahcerの実行結果をビジュアライザに貼り付けるのに手間がかかる
- **テストケース分析の手間** - 個別ケースでの強み・弱みが見えづらい

これらの課題を解決し、より効率的にアルゴリズム改善を行うために pahcer-studio を開発しました。

## ✨ 主要機能

### 🚀 テスト実行管理

- **GUI実行**: GUI から pahcer テストを開始
- **実行監視**: 実行状況とログをリアルタイムで表示
- **パラメータ設定**: テストケース数、シード値、シャッフルオプションの設定

### 🗂️ 履歴管理・比較

- **実行履歴一覧**: 過去の実行結果を時系列で表示
- **コメント機能**: 各実行にメモを記録
- **ビジュアライザ連携**: テストケース結果をビジュアライザで表示

### 📊 実行結果の分析・可視化

- **スコア推移グラフ**: 実行間でのスコア変化をグラフ表示
- **相対スコア評価**: ベストスコアとの比較による改善度計算
- **テストケース別分析**: 入力特徴量とスコアの相関関係の表示

---

> **注意**: このアプリケーションは [pahcer](https://github.com/terry-u16/pahcer) がインストールされていることを前提としています

# 使用方法

## 📋 前提条件

- **pahcer** がインストール済みであること（[インストール手順](https://github.com/terry-u16/pahcer)）
- **Node.js** (v16以上推奨)
- **yarn**

## 📁 セットアップ

### 1. リポジトリのクローン

任意のディレクトリにpahcer-studioをクローンします：

```bash
git clone https://github.com/moritanian/pahcer-studio.git
cd pahcer-studio
yarn install
```

### 2. ビルドとグローバルインストール

```bash
yarn build
npm install -g .
```

これでシステム全体から`phst`コマンドが使用できるようになります。

## 🚀 使用方法

### 基本的な使い方

pahcer-studioは、AHCプロジェクト（`pahcer_config.toml`があるディレクトリ）をワークスペースとして使用します。

#### 1. サーバーの起動

```bash
# AHCプロジェクトのディレクトリで実行
cd /path/to/your-ahc-project
phst launch
```

ブラウザが自動的に開き、`http://127.0.0.1:3000`でWebアプリケーションが表示されます。

#### 2. ワークスペースの選択

初回起動時、ワークスペース選択ダイアログが表示されます。以下のいずれかの形式でプロジェクトのパスを入力してください：

**Linux/macOS の場合:**
- **絶対パス**: `/home/user/project/ahc041`
- **チルダ記法**: `~/project/ahc041`（ホームディレクトリから始まる場合）

**Windows の場合:**
- **Windowsパス**: `C:\Projects\ahc041`
- **WSLパス**: `\\wsl.localhost\Ubuntu\home\user\project`
  - Windows上でpahcer-studioを実行し、AHCプロジェクトがWSL内にある場合に使用
  - WSLパスを指定する場合は「WSLで開く」チェックボックスをオンにしてください

一度選択したワークスペースは履歴に保存され、次回から簡単に選択できます。

#### 3. テストの実行

**Webブラウザから:**

- テスト実行タブで、テストケース数・シード値などのパラメータを設定して実行

**コマンドラインから:**

```bash
# AHCプロジェクトのディレクトリで実行
cd /path/to/your-ahc-project
phst run

# テスト実行のオプション例
phst run -n 50                    # 50ケースだけ実行
phst run -n 50 -s 100             # シード100から50ケース実行
phst run --shuffle                # テストケースの順序をシャッフル
phst run -c "fix: improve algo"   # コメント付きで実行
phst run --freeze                 # ベストスコアを固定
```

**注意**: 実行中は**Ctrl+C**で中断できます。バックグラウンドのpahcerプロセスも自動的に停止します。

### CLIコマンド一覧

```bash
phst launch              # サーバー起動 + ブラウザを開く
phst launch --no-browser # サーバー起動のみ（ブラウザを開かない）
phst run                 # テスト実行（現在のディレクトリをワークスペースとして使用）
phst run --lambda        # AWS Lambda で実行
phst run --local         # ローカルで実行
phst terminate           # サーバー終了
phst results list        # 実行履歴一覧
phst results get <id>    # 実行結果の詳細表示
phst aws deploy-tools    # ツールを S3 にアップロード
phst aws status          # Lambda 設定の確認
phst --help              # ヘルプを表示
```

**`phst run` コマンドのオプション:**

| オプション               | 説明                           | デフォルト |
| ------------------------ | ------------------------------ | ---------- |
| `-n, --count <number>`   | 実行するテストケース数         | 100        |
| `-s, --seed <number>`    | 開始シード値                   | 0          |
| `-c, --comment <string>` | 実行に付けるコメント           | なし       |
| `--shuffle`              | テストケースの順序をシャッフル | false      |
| `--freeze`               | ベストスコアを固定             | false      |
| `--lambda`               | AWS Lambda で実行              | -          |
| `--local`                | ローカルで実行                 | -          |

## ☁️ AWS Lambda 実行（実験的）

大量の seed を高速に並列実行するために、AWS Lambda をバックエンドとして使用できます。

### 前提条件

- AWS アカウント
- AWS CLI が設定済み（`aws configure`）
- AWS CDK がインストール済み（`npm install -g aws-cdk`）

### 1. インフラのデプロイ

`lambda_test/cdk` ディレクトリにサンプル CDK スタックがあります：

```bash
cd lambda_test/cdk
npm install
npx cdk deploy
```

以下のリソースが作成されます：
- **S3 バケット**: ツールバイナリ・実行結果の保存
- **Lambda 関数**: テスト実行（メモリ 3008MB / タイムアウト 15分）

デプロイ完了時に表示される出力値（`FunctionName`, `ToolsBucketName`）を控えてください。

### 2. pahcer_config.toml に設定を追加

AHC プロジェクトの `pahcer_config.toml` に `[aws_lambda]` セクションを追加します：

```toml
[aws_lambda]
region = "ap-northeast-1"
function_name = "ahc-tester"          # CDK出力: FunctionName
tools_bucket = "ahc-tester-tools-XXX" # CDK出力: ToolsBucketName
parallel = 10                          # 同時Lambda起動数
# profile = "admin"                    # デフォルト以外のAWSプロファイルを使う場合
```

### 3. ツールのビルドとデプロイ

AHC プロジェクトのツール（gen, tester, vis 等）をビルドして S3 にアップロードします：

```bash
cd /path/to/your-ahc-project/tools
cargo build --release

phst aws deploy-tools
```

### 4. Lambda で実行

```bash
# Lambda で実行
phst run --lambda

# ローカルで実行（従来通り）
phst run --local

# pahcer_config.toml の設定に従う（default 未設定ならローカル）
phst run
```

### Lambda 関連コマンド

```bash
phst aws deploy-tools [directory]  # ツールを S3 にアップロード
phst aws status [directory]        # Lambda 設定の確認
phst run --lambda                  # Lambda で実行
phst run --local                   # ローカルで実行
```

### 注意事項

- Lambda の CPU（Xeon）はローカル PC より遅い場合があります（目安: Ryzen 5 の約 50%）
- バイナリは動的リンク（glibc）で動作します。musl static build はスコアが劣化する場合があります
- バイナリサイズは 4.5MB 以下である必要があります（release build + strip 推奨）
- AWS の利用料金が発生します（目安: 3000 seed × 2s/seed で約 9〜45 円）

---

### 開発者向け（開発環境）

pahcer-studioの開発に貢献する場合は、以下の手順で開発環境をセットアップします：

#### 開発サーバーの起動

```bash
cd pahcer-studio
yarn install
yarn dev
```

開発サーバーが起動し、`http://127.0.0.1:3000`でアクセスできます。
ホットリロード機能により、コードの変更が自動的に反映されます。

#### ビルド

本番環境用のビルドを作成する場合：

```bash
yarn build
```

ビルドされたファイルは`dist/`ディレクトリに出力されます。

#### プロジェクト構成

```
pahcer-studio/
├── src/
│   ├── cli/              # CLIツール (phst コマンド)
│   ├── server/           # Express サーバー
│   ├── renderer/         # React フロントエンド
│   ├── services/         # ビジネスロジック
│   ├── repositories/     # データアクセス層
│   ├── infrastructure/   # インフラ層（パス処理、プロセス管理等）
│   └── schemas/          # 型定義
├── dist/                 # ビルド出力先
└── package.json
```

# 機能一覧

pahcer-studioは3つの画面からなり、

- テスト実行
- 過去のテスト実行の管理・ビジュアライザでの確認
- 過去のテスト実行の分析

を行うことができます。

## テスト実行

![pahcer-studio](img/fig2.png)

この画面では pahcer のテスト実行を GUI から行うことができます。

**主な機能：**

- **実行パラメータ設定**: テストケース数、開始シード値を指定
  - なお、テストケースはあらかじめ別に用意しておく必要があります
  - 初期に配布される100ケース以外をテストに使いたい場合には、テストケース生成をしてください
- **オプション設定**: テストケースシャッフル、ベストスコア固定の選択
- **コメント機能**: 実行内容や変更点をメモとして記録
- **リアルタイム監視**: 実行状況とログをリアルタイムで表示

## 過去のテスト実行の管理

![pahcer-studio](img/fig1.png)

この画面では過去のテスト実行の一覧を管理し、ビジュアライザでの確認を行うことができます。

**主な機能：**

- **実行履歴一覧**: 過去の全実行を時系列で表示（実行日時、コメント、スコア情報）
- **詳細情報表示**: 平均スコア、相対スコア、実行時間などの統計情報
- **ビジュアライザ連携**: 選択したテストケースをビジュアライザで直接表示
  - 右上のSeedの値を変更すると、自動でinputとoutputが変更される
  - Scaleの値を変更してビジュアライザ部分の縮尺を調整可能
- **履歴管理**: 実行履歴の更新、削除などの管理機能

なお、初期状態ではビジュアライザのファイルがダウンロードされていません。
問題ごとのビジュアライザのURLを入力すると、必要なファイルをダウンロードしてビジュアライザを表示することができます。
ダウンロードしたファイルはpahcer-studio/public以下に保存されます。

## 過去のテスト実行の分析

![pahcer-studio](img/fig3.png)

この画面では複数の実行結果を比較・分析し、改善点を見つけることができます。

**主な機能：**

- **分析設定**: 入力特徴量フォーマットの設定とキャッシュ更新
  - テストケースごとのパラメータを分析するために、入力ファイルの1行目の変数の構成を入力("N M K"など)
  - 更新ボタンを押すとテストケースごとのパラメータをpahcer-studio/analysis_dataに保存
  - ここで指定した変数は分析で指定できるようになります
- **実行選択**: 分析対象とする実行を複数選択
- **スコア推移グラフ**: 選択した実行間でのスコア変化を可視化
  - **相対スコア評価**: ベストスコアとの比較による改善度の定量評価
  - **テストケース別分析**: 入力特徴量（N, M, K等）とスコアの相関関係を分析
  - **フィルタ機能**: seedや入力特徴量についてフィルタを設定可能

## 注意事項

このソフトウェアは個人開発によるものです。以下の点についてご理解をお願いします：

- **開発中のソフトウェアです** - バグや予期しない動作が発生する可能性があります
- **重要なデータのバックアップをお願いします** - 万が一に備えて、大切なファイルはバックアップを取っておくことをおすすめします
- **環境による動作差異について** - 全ての環境での完全な動作確認はできておりません
- **サポートについて** - 個人開発のため、サポートは限定的となります
- **免責について** - 本ソフトウェアの使用により生じたいかなる損害についても、開発者は責任を負いかねます

何かお気づきの点やご質問がございましたら、お気軽にIssueでお知らせください。
