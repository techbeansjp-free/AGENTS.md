# .adapters/ — プラットフォーム別アダプタ（生成物）

本パッケージの**正本は常にリポジトリルートの `.agents/`**（および `AGENTS.md`）。`.adapters/` 配下は、その正本から**各ツール向けに生成した配備物**であり、**手で編集しない**（次回ビルドで上書きされる）。汎用仕様を 1 か所に保ち、ツール固有の形（Claude プラグイン等）はここに派生させる、という方針。

`.adapters/` は **100% 生成物**であり、手書きの土台は `.adapters/` の外（正本側）に置く。Claude プラグインの `plugin.json` の手書き正本は [.agents/platforms/claude/plugin.json](../../.agents/platforms/claude/plugin.json)、本ドキュメント（保守者向け解説）が従来の `.adapters/README.md` を引き継ぐ。

`.agents`・`.workflow`・`.claude-plugin` と同様、機械/エージェント向けインフラなので dot 接頭辞（`.adapters`）とする。`.agents/` を丸ごとコピーする [setup.sh](../../.agents/scripts/setup.sh) の配布対象にも含まれない（採用先プロジェクトを汚さない）。

## なぜアダプタ方式か

- AGENTS.md / `.agents/` は**ツール非依存の共通仕様**。Claude Code・Cursor・Gemini 等はそれぞれ配置パス・配布形式が異なる（参照: [.agents/platforms/SKILLS.md](../../.agents/platforms/SKILLS.md)）。
- Claude Code のプラグイン仕様は **プラグインルート直下**に `.claude-plugin/plugin.json` ・ `skills/` ・ `commands/` ・ `agents/` ・ `hooks/` を要求し、これらの位置は変更不可。Claude 固有の構造で正本を侵食しないよう、`.adapters/claude/` に隔離する。
- リポジトリ自身を**自己ホスト型マーケットプレイス**にできる（[../../.claude-plugin/marketplace.json](../../.claude-plugin/marketplace.json) が `./.adapters/claude` を指す）。

## claude/ — Claude Code プラグイン

`.agents/scripts/build-plugin-claude.sh` が `.agents/` から以下を生成する。

| 生成物 | 由来 |
|--------|------|
| `.adapters/claude/.claude-plugin/plugin.json` | 手書き正本 [.agents/platforms/claude/plugin.json](../../.agents/platforms/claude/plugin.json) をコピー |
| `.adapters/claude/.agents/` | `.agents/` 全体を同梱（プラグインを自己完結させる。保守/導入専用スクリプト `setup.sh`・`build-plugin-claude.sh` は除外） |
| `.adapters/claude/skills/{domain}__{capability}/SKILL.md` | `.agents/skills/{domain}/{capability}/`（命名規約は [DESIGN_SYNC_SKILLS_NAMING.md](../../.agents/platforms/DESIGN_SYNC_SKILLS_NAMING.md)） |
| `.adapters/claude/commands/*.md` | `.agents/commands/*.md` |
| `.adapters/claude/agents/*.md` | `.agents/agents/*.md`（README.md を除く） |
| `.adapters/claude/hooks/hooks.json` | `.agents/enforcement/claude/{Pre,Post}ToolUse.sh` を `${CLAUDE_PLUGIN_ROOT}/.agents` 基準で呼ぶ |

`.adapters/claude/` 配下はすべてビルドで再生成する（手書きファイルは置かない）。手書きの土台は正本側、すなわち [.agents/platforms/claude/plugin.json](../../.agents/platforms/claude/plugin.json) と本ドキュメントに集約する。

### ビルド

```bash
bash .agents/scripts/build-adapters.sh claude        # Claude のみ
bash .agents/scripts/build-adapters.sh claude cursor # claude + cursor
# 互換ラッパ: bash .agents/scripts/build-plugin-claude.sh（= build-adapters.sh claude）
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

1. 保守者が `package.json` / `plugin.json` の version を揃える（`bash .agents/scripts/sync-version.sh --write`）。
2. version と一致するタグ（例 `v0.1.0`）を push する。
3. `release.yml` がタグ push を検知し、次を実行する:
   - **version 同期検証**: タグ `vX.Y.Z` ＝ `package.json.version` ＝ `plugin.json.version`（不一致なら fail）。
   - **生成**: `build-adapters.sh claude cursor` で正本 `.agents/` から `.adapters/` を生成。
   - **再生成 diff ゼロ**: もう一度生成しても同一（決定性）であることを検証。
   - **公開**: 生成物 `.adapters/claude`（＋cursor）と `marketplace.json` を専用ブランチ **`release/marketplace`** へ commit/push。

**marketplace.json の `source` 解決**

`.claude-plugin/marketplace.json` の `source: "./.adapters/claude"` は、リリースブランチ `release/marketplace` 上で
解決される（このブランチには `.adapters/claude` が追跡コミットされている）。`main` には生成物が無いため、
marketplace 登録時は当該リリースブランチ/タグ時点のツリーを指す運用とする。

**暫定既定（03_実装計画 §0／§9 未決#2 で確定）**

| 項目 | 暫定既定 |
|------|----------|
| トリガ | タグ push `v*`（例 `v0.1.0`） |
| リリースブランチ | `release/marketplace` |
| version 正本 | `package.json`（`plugin.json` は従属。`sync-version.sh` で同期） |

> npm publish は scope/レジストリ未確定（03 §9 未決#1）のため release.yml には含めない。
> 配線する場合も `NPM_TOKEN` secret 必須＋手動承認ゲートで、未確定時は発火しない形にすること。

## cursor/ ・ gemini/（将来）

同様に `.agents/` から各ツールの形式へ生成する。Cursor は `.agents/enforcement/cursor/`、配備パスは [platforms/SKILLS.md](../../.agents/platforms/SKILLS.md) を参照。
