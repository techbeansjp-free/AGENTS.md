# .adapters/ — プラットフォーム別アダプタ（生成物）

本パッケージの**正本は常にリポジトリルートの `.agent-skill-chain/source/`**（および `AGENTS.md`）。`.adapters/` 配下は、その正本から**各ツール向けに生成した配備物**であり、**手で編集しない**（次回ビルドで上書きされる）。汎用仕様を 1 か所に保ち、ツール固有の形（Claude プラグイン等）はここに派生させる、という方針。

`.adapters/` は **100% 生成物**であり、手書きの土台は `.adapters/` の外（正本側）に置く。Claude プラグインの `plugin.json` の手書き正本は [.agent-skill-chain/source/platforms/claude/plugin.json](../../.agent-skill-chain/source/platforms/claude/plugin.json)、本ドキュメント（保守者向け解説）が従来の `.adapters/README.md` を引き継ぐ。

`.agents`・`.workflow`・`.claude-plugin` と同様、機械/エージェント向けインフラなので dot 接頭辞（`.adapters`）とする。`.agent-skill-chain/source/` を丸ごとコピーする [setup.sh](../../.agent-skill-chain/source/scripts/setup.sh) の配布対象にも含まれない（採用先プロジェクトを汚さない）。

## なぜアダプタ方式か

- AGENTS.md / `.agent-skill-chain/source/` は**ツール非依存の共通仕様**。Claude Code・Cursor・Gemini 等はそれぞれ配置パス・配布形式が異なる（参照: [.agent-skill-chain/source/platforms/SKILLS.md](../../.agent-skill-chain/source/platforms/SKILLS.md)）。
- Claude Code のプラグイン仕様は **プラグインルート直下**に `.claude-plugin/plugin.json` ・ `skills/` ・ `commands/` ・ `agents/` ・ `hooks/` を要求し、これらの位置は変更不可。Claude 固有の構造で正本を侵食しないよう、`.adapters/claude/` に隔離する。
- リポジトリ自身を**自己ホスト型マーケットプレイス**にできる（[../../.claude-plugin/marketplace.json](../../.claude-plugin/marketplace.json) が `./.adapters/claude` を指す）。

## claude/ — Claude Code プラグイン

`.agent-skill-chain/source/scripts/build-plugin-claude.sh` が `.agent-skill-chain/source/` から以下を生成する。

| 生成物 | 由来 |
|--------|------|
| `.adapters/claude/.claude-plugin/plugin.json` | 手書き正本 [.agent-skill-chain/source/platforms/claude/plugin.json](../../.agent-skill-chain/source/platforms/claude/plugin.json) をコピー |
| `.adapters/claude/.agent-skill-chain/source/` | `.agent-skill-chain/source/` 全体を同梱（プラグインを自己完結させる。保守/導入専用スクリプト `setup.sh`・`build-plugin-claude.sh` は除外） |
| `.adapters/claude/skills/{domain}__{capability}/SKILL.md` | `.agent-skill-chain/source/skills/{domain}/{capability}/`（命名規約は [DESIGN_SYNC_SKILLS_NAMING.md](../../.agent-skill-chain/source/platforms/DESIGN_SYNC_SKILLS_NAMING.md)） |
| `.adapters/claude/commands/*.md` | `.agent-skill-chain/source/commands/*.md` |
| `.adapters/claude/agents/*.md` | `.agent-skill-chain/source/agents/*.md`（README.md を除く） |
| `.adapters/claude/hooks/hooks.json` | `.agent-skill-chain/source/enforcement/claude/{Pre,Post}ToolUse.sh` を `${CLAUDE_PLUGIN_ROOT}/.agents` 基準で呼ぶ |

`.adapters/claude/` 配下はすべてビルドで再生成する（手書きファイルは置かない）。手書きの土台は正本側、すなわち [.agent-skill-chain/source/platforms/claude/plugin.json](../../.agent-skill-chain/source/platforms/claude/plugin.json) と本ドキュメントに集約する。

### ビルド

```bash
bash .agent-skill-chain/source/scripts/build-adapters.sh claude        # Claude のみ
bash .agent-skill-chain/source/scripts/build-adapters.sh claude cursor # claude + cursor
# 互換ラッパ: bash .agent-skill-chain/source/scripts/build-plugin-claude.sh（= build-adapters.sh claude）
```

### ローカルでの試用

```bash
claude --plugin-dir .adapters/claude
# セッション内で変更を反映: /reload-plugins
```

### 配布（マーケットプレイス）— リリースフロー（案A）

```bash
# 利用側
/plugin marketplace add techbeansjp-free/AGENTS.md
/plugin install agents-package@agents-md
```

marketplace 配布ではプラグイン生成物 `.adapters/claude/` がインストール時に取得される。本リポは
**正本リポ（`main`）に生成物 `.adapters/` を一切コミットしない**方針（`/.adapters/` は常に gitignore）を採るため、
生成物は **リリース時に CI が専用ブランチへ commit する**（案A）。手動でローカルから push しない。

**フロー（[.github/workflows/release.yml](../../.github/workflows/release.yml)）**

1. 保守者が `package.json` / `plugin.json` の version を揃える（`bash .agent-skill-chain/source/scripts/sync-version.sh --write`）。
2. version と一致するタグ（例 `v0.1.0`）を push する。
3. `release.yml` がタグ push を検知し、2 系統を実行する:
   - **(A) npm publish ジョブ（`npm-publish`）**:
     - **version 同期検証**: タグ `vX.Y.Z` ＝ `package.json.version` ＝ `plugin.json.version`（不一致なら fail）。
     - **配布物リーク検査**: `verify-npm-pack.sh`（tarball にリポ固有物が漏れず必須物がある）。
     - **NPM_TOKEN ゲート**: secret `NPM_TOKEN` が未設定なら publish を skip（未設定では発火しない）。
     - **publish**: `npm publish --access public`（scoped public、`publishConfig.access=public`）。認証は `NODE_AUTH_TOKEN=${{ secrets.NPM_TOKEN }}`。
   - **(B) marketplace ジョブ（`release`）**:
     - **version 同期検証**: 上と同じ一致検証。
     - **生成**: `build-adapters.sh claude cursor` で正本 `.agent-skill-chain/source/` から `.adapters/` を生成。
     - **再生成 diff ゼロ**: もう一度生成しても同一（決定性）であることを検証。
     - **公開**: 生成物 `.adapters/claude`（＋cursor）と `marketplace.json` を専用ブランチ **`release/marketplace`** へ commit/push。

**marketplace.json の `source` 解決**

`.claude-plugin/marketplace.json` の `source: "./.adapters/claude"` は、リリースブランチ `release/marketplace` 上で
解決される（このブランチには `.adapters/claude` が追跡コミットされている）。`main` には生成物が無いため、
marketplace 登録時は当該リリースブランチ/タグ時点のツリーを指す運用とする。

**確定既定（03_実装計画 §0／§9 #1・#2・#6 で確定）**

| 項目 | 既定 |
|------|------|
| トリガ | タグ push `v*`（例 `v0.1.0`） |
| npm パッケージ | `agent-skill-chain`（unscoped public / npmjs.com、`publishConfig.access=public`。CLI コマンド名は `agents-md`） |
| リリースブランチ | `release/marketplace` |
| version 正本 | `package.json`（`plugin.json` は従属。`sync-version.sh` で同期） |
| LICENSE | MIT（`Copyright (c) 2026 TechBeans Inc.`） |

> npm publish は `release.yml` の `npm-publish` ジョブで配線済み。`NPM_TOKEN` secret によるゲートで保護し、
> 未設定なら publish step を skip する（ユーザーが `NPM_TOKEN` を設定し `v*` タグを push したときのみ発火）。

## cursor/ ・ gemini/（将来）

同様に `.agent-skill-chain/source/` から各ツールの形式へ生成する。Cursor は `.agent-skill-chain/source/enforcement/cursor/`、配備パスは [platforms/SKILLS.md](../../.agent-skill-chain/source/platforms/SKILLS.md) を参照。

## apm 経由の配布について

`microsoft/apm`（Agent Package Manager）向けの生成物（`apm.yml`・`.apm/`）は本ドキュメントの対象外。生成方式・配置理由・ビルド/配布手順は [apm-package.md](./apm-package.md) を参照。
