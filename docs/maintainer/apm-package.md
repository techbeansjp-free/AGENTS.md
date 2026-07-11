# apm-package.md — apm（Agent Package Manager）向けパッケージ（生成物）

本パッケージの**正本は常にリポジトリルートの `.agent-skill-chain/source/`**（および `AGENTS.md`）。リポジトリルート直下の `apm.yml` と `.apm/` は、その正本から [`microsoft/apm`](https://github.com/microsoft/apm)（Agent Package Manager, MIT license）向けに生成した配布物であり、**100% 生成物であり手で編集しない**（次回ビルドで上書きされる）。

手書きの土台は `.apm/` の外（正本側）に置く: apm メタデータの手書き正本は [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml)、本ドキュメント（保守者向け解説）が `docs/maintainer/adapters.md` と対になる apm 版の解説を担う。

`apm.yml`・`.apm/` は `.gitignore` 対象であり、`main` には一切コミットしない（`.adapters/` と同じ「案A」方針。§4 参照）。

## なぜ apm 経由の配布か

- 本パッケージは npm 公開を取りやめ（`docs/maintainer/RELEASE.md` §5 参照）、`apm install` を一次配布導線とする（README.md §導入）。
- `.agent-skill-chain/source/` は**ツール非依存の共通仕様**であり、apm はスキル等のプリミティブを複数ハーネス（Claude/Cursor/Gemini/Copilot/Codex 等）へ横断的に配布できる仕組みを提供する。
- 既存の `.adapters/`（Claude/Cursor 向け生成物・`release/marketplace` ブランチ）とは独立したチャネルとして共存する（互いに変更しない。02_設計 §2.1.2）。

## v1 スコープ（skills のみ）

**v1 では skills プリミティブのみを apm ネイティブに配備する。** agents（`.apm/agents/*.agent.md`）・commands/prompts（`.apm/prompts/*.prompt.md`）・instructions（`.apm/instructions/*.instructions.md`）・hooks（`.apm/hooks/*.json`）への個別分解は、意味論的な差異（消費モデルの違い・コンパイル方式の違い等）を理由に本 v1 の対象外とし、後続 issue へ申し送る。詳細な根拠は [npm 公開中止・APM 転換 issue の 02_設計.md §2.6.5・§9.2](../maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/20260711_024021_npm公開中止_APM転換/02_設計.md#265-v1-スコープをスキルのみに限定する理由agentspromptscommandsinstructionshooks-を対象外とする根拠) を参照。

「`.agents/` 一式が展開できる」という受け入れ基準を満たすため、正本一式（`.agent-skill-chain/source/`）を 1 つの skill バンドル `agent-skill-chain-full` として同梱している（§2 参照）。

## 生成物の構成

`bash .agent-skill-chain/source/scripts/build-adapters.sh apm` が以下を生成する。

| 生成物 | 由来 |
|--------|------|
| `apm.yml`（repo root） | 手書き正本 [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml) をコピー |
| `.apm/skills/{domain}__{capability}/SKILL.md` | `.agent-skill-chain/source/skills/{domain}/{capability}/`（命名規約は [DESIGN_SYNC_SKILLS_NAMING.md](../../.agent-skill-chain/source/platforms/DESIGN_SYNC_SKILLS_NAMING.md) と同一。既存共有関数 `deploy_skills_impl` を claude/cursor アダプタと共用） |
| `.apm/skills/agent-skill-chain-full/SKILL.md` | 新規生成（frontmatter: `name: agent-skill-chain-full`）。正本一式バンドルの説明文 |
| `.apm/skills/agent-skill-chain-full/reference/.agent-skill-chain/source/` | `.agent-skill-chain/source/` 全体を同梱（既存 `bundle_agents_src` を無改変で呼び出す。保守/導入専用スクリプト `setup.sh`・`build-plugin-claude.sh`・`build-adapters.sh`・`sync-version.sh`・`verify-npm-pack.sh`・`lib/` は既存規則どおり除外） |

`.apm/skills/{domain}__{capability}/SKILL.md` の frontmatter `name`（例: `define-boundaries`）とディレクトリ名は一致しないが、apm 公式仕様によりディレクトリ名が優先されるため許容済みの既知事項である（既存 `.adapters/claude` と同じ扱い）。

**実機確認事項（`apm install` 時の暗黙正規化）**: 本パッケージ側で生成する `.apm/skills/` のディレクトリ名は `{domain}__{capability}`（例: `architecture__define-boundaries`）だが、apm CLI（v0.24.1 で実機確認）は `apm install` 実行時にこれを `-`（ハイフン）区切りへ暗黙に正規化する。そのため消費者プロジェクトの `.agents/skills/` 配下には `architecture-define-boundaries` のように展開される（`SKILL.md` の frontmatter `name` はディレクトリ名にかかわらず正本のまま無改変）。

## ビルドコマンド

```bash
bash .agent-skill-chain/source/scripts/build-adapters.sh apm            # apm のみ
bash .agent-skill-chain/source/scripts/build-adapters.sh claude cursor apm  # 複合実行も可能
```

`build-adapters.sh` の `SUPPORTED_TOOLS` に `apm` が登録済みであり、既存の `claude`/`cursor` アダプタと同じディスパッチャから起動する。実行の都度、リポジトリルートの既存 `apm.yml`・`.apm/` を削除してからクリーンに再生成する（決定性の担保）。

## version 同期

`apm.yml` の `version` フィールドは `package.json`（正本）から [`sync-version.sh`](../../.agent-skill-chain/source/scripts/sync-version.sh) が同期する（手動編集しない）。詳細は [`docs/maintainer/RELEASE.md`](./RELEASE.md) §1 を参照。

```bash
bash .agent-skill-chain/source/scripts/sync-version.sh --check   # package.json/plugin.json/apm.yml の一致を検証
bash .agent-skill-chain/source/scripts/sync-version.sh --write   # package.json の version を plugin.json/apm.yml へ注入
```

## ローカル検証手順（tmp 隔離）

本番ファイルを汚さないため、必ず `mktemp -d` で隔離した環境で検証する（[自己拡張ワークフロー.md §テストの tmp 隔離](../../.agent-skill-chain/project/自己拡張ワークフロー.md#テストの-tmp-隔離必須)）。

```bash
# 環境A: 本パッケージの worktree コピー
A=$(mktemp -d); git archive HEAD | tar -x -C "$A"
( cd "$A" && bash .agent-skill-chain/source/scripts/build-adapters.sh apm )

# 環境B: 空の消費者プロジェクト（apm CLI 導入済みが前提）
B=$(mktemp -d)
( cd "$B" && apm install "$A" --target agent-skills )

# 確認
test -d "$B/.agents/skills/agent-skill-chain-full/reference/.agent-skill-chain/source" && echo "full bundle OK"
test -f "$B/.agents/skills/architecture-define-boundaries/SKILL.md" && echo "individual skill OK"  # apm が __ を - へ正規化する
test -f "$B/apm.lock.yaml" && echo "lockfile OK"

rm -rf "$A" "$B"
```

空ディレクトリはハーネスマーカー（`.claude/`・`.github/` 等）を持たないため、`apm install` の auto-detect が exit 2 で失敗する。**`--target` の明示が必須**である。

## `release/apm` ブランチへの発行フロー

`main` には生成物を一切コミットしない（既存 `.adapters/` と同じ「案A」方針）。リリース時にのみ CI（[`.github/workflows/release.yml`](../../.github/workflows/release.yml) の `apm-release` ジョブ）が以下を行う。

1. `bash .agent-skill-chain/source/scripts/build-adapters.sh apm` を実行して `apm.yml`・`.apm/` を生成する。
2. 再度ビルドし、ファイルハッシュの diff がゼロであること（決定性）を検証する。
3. `apm.yml`・`.apm/` を **`release/apm`** ブランチへ commit/push する。
4. 同一コミットに **`apm-vX.Y.Z`**（`X.Y.Z` は `package.json` の version）タグを付与する。

`apm-release` ジョブは既存 `release-npm`/`release-marketplace` ジョブと**完全に同一の dormant ゲート**（`github.actor != 'github-actions[bot]' && vars.RELEASE_ENABLED == 'true'`。かつ `workflow_dispatch` のみがトリガ）配下にあり、現状は自動発火しない。再開手順は [`docs/maintainer/RELEASE.md`](./RELEASE.md) §5 を参照。

消費者向けの install コマンド（README.md §導入）:

```bash
apm install techbeansjp-free/AGENTS.md#release/apm            # 最新版（ブランチ ref）
apm install techbeansjp-free/AGENTS.md#apm-v0.1.0             # 特定版（タグ ref・ピン留め）
```

## 参照

- [`.agent-skill-chain/source/scripts/build-adapters.sh`](../../.agent-skill-chain/source/scripts/build-adapters.sh)（`adapter_apm()`）
- [`.agent-skill-chain/source/scripts/sync-version.sh`](../../.agent-skill-chain/source/scripts/sync-version.sh)
- [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml) — 手書き正本
- [`docs/maintainer/RELEASE.md`](./RELEASE.md) — リリース手順（version 同期・dormant ゲート・再開手順）
- [`docs/maintainer/adapters.md`](./adapters.md) — Claude/Cursor アダプタ生成方式（対の解説ドキュメント）
- [npm 公開中止・APM 転換 issue（02_設計.md・03_実装計画.md）](../maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/20260711_024021_npm公開中止_APM転換/) — 一次情報調査・設計判断の詳細
