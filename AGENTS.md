# AGENTS.md

## Lint / Format

コード変更時は必ず lint と format を通すこと:

```bash
yarn lint:fix      # eslint --fix
yarn format:fix    # prettier --write
```

ファイル単位で書き換えた直後は `yarn eslint --fix <file>` と `yarn prettier --write <file>` を当てる（PostToolUse hook が `.claude/settings.json` で自動実行する設定もあるが、agent 自身も意識すること）。

## 動作確認

実装完了後、以下のコマンドを実行してビルドとサーバ起動を確認する:

```bash
yarn build && phst launch --no-browser -f
```
