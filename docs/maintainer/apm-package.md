# apm-package.md — apm（Agent Package Manager）向けパッケージ（生成物）

本パッケージの**正本は常にリポジトリルートの `.agent-skill-chain/source/`**（および `AGENTS.md`）。リポジトリルート直下の `apm.yml` と `.apm/` は、その正本から [`microsoft/apm`](https://github.com/microsoft/apm)（Agent Package Manager, MIT license）向けに生成した配布物であり、**100% 生成物であり手で編集しない**（次回ビルドで上書きされる）。

手書きの土台は `.apm/` の外（正本側）に置く: apm メタデータの手書き正本は [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml)、本ドキュメント（保守者向け解説）が `docs/maintainer/adapters.md` と対になる apm 版の解説を担う。

`apm.yml`・`.apm/` は `.gitignore` 対象であり、`main` には一切コミットしない（`.adapters/` と同じ「案A」方針。§4 参照）。

## なぜ apm 経由の配布か

- 本パッケージは `apm install` を補助的な横断配布導線とする（README.md §導入。個別スキル＋契約本体＋enforcement＋管理 CLI を配れる**完全導線は npx**）。
- `.agent-skill-chain/source/` は**ツール非依存の共通仕様**であり、apm は正本一式を参照コンテキスト（バンドル）として複数ハーネス（Claude/Cursor/Gemini/Copilot/Codex 等）へ横断的に配布できる。
- 既存の `.adapters/`（Claude/Cursor 向け生成物・`release/marketplace` ブランチ）とは独立したチャネルとして共存する（互いに変更しない。02_設計 §2.1.2）。

## apm 配布スコープ（agent-skill-chain-full バンドルのみ）

**apm 経由では `agent-skill-chain-full` バンドル（正本一式の参照コンテキスト）のみを配布する。** 個別スキル（`{domain}__{capability}`）は apm では配備しない。個別スキルの `.claude/skills/`・`.cursor/skills/` への配備は **npx 導線**（`setup.sh`／`lib/deploy-skills.sh`）が唯一の主体である。

> **背景（二重コピー解消・修正方針 D1）**: apm（Claude ターゲット）と npx が同一の `.claude/skills/` へ**異なる命名規則**（apm＝ハイフン正規化、npx＝ダブルアンダースコア）で同じ個別スキルを配備すると、Claude Code が同一スキルを 2 件として認識する二重コピーが発生していた。apm が個別スキルを配らずバンドル 1 件のみを配ることで、同一ディレクトリに個別スキルを置く主体が npx のみになり、併用しても別名重複が構造的に生じない。詳細は [apm-npx スキル二重コピー解消 issue の 02_設計.md（ADR-1）](./workflow/20260713_033406_apm-npx-skill重複解消/02_設計.md) を参照。

agents（`.apm/agents/*.agent.md`）・commands/prompts・instructions・hooks への個別分解も引き続き対象外である（後続 issue へ申し送り。根拠は [npm 公開中止・APM 転換 issue の 02_設計.md §2.6.5・§9.2](../maintainer/workflow/close/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/20260711_024021_npm公開中止_APM転換/02_設計.md#265-v1-スコープをスキルのみに限定する理由agentspromptscommandsinstructionshooks-を対象外とする根拠)）。

## 生成物の構成

`bash .agent-skill-chain/source/scripts/build-adapters.sh apm` が以下を生成する。

| 生成物 | 由来 |
|--------|------|
| `apm.yml`（repo root） | 手書き正本 [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml) をコピー |
| `.apm/skills/agent-skill-chain-full/SKILL.md` | 新規生成（frontmatter: `name: agent-skill-chain-full`）。正本一式バンドルの説明文 |
| `.apm/skills/agent-skill-chain-full/reference/.agent-skill-chain/source/` | `.agent-skill-chain/source/` 全体を同梱（既存 `bundle_agents_src` を無改変で呼び出す。保守/導入専用スクリプト `setup.sh`・`build-plugin-claude.sh`・`build-adapters.sh`・`sync-version.sh`・`verify-npm-pack.sh`・`lib/` は既存規則どおり除外） |

`.apm/skills/` 直下には `agent-skill-chain-full` の 1 ディレクトリのみが生成される（個別スキル `{domain}__{capability}/` は生成しない）。共有関数 `deploy_skills_impl`／`list_owned_skill_names` は npx 導線が引き続き使用するため削除していない。

**apm install 時の展開（外部仕様）**: apm CLI は Claude ターゲットでは `.claude/skills/`、その他の横断ハーネスでは `.agents/skills/` へ配備する（external_spec: apm 公式）。本パッケージが配るのは `agent-skill-chain-full` の 1 スキルのみのため、apm 経由では消費者プロジェクトに `agent-skill-chain-full/`（バンドル）が 1 件展開される。過去に apm CLI が個別スキル名の `__`→`-` 正規化を行っていた事象（v0.24.1 実機確認）は、本パッケージが個別スキルを配らなくなったため apm 経由では発生しない（`SKILL.md` の frontmatter `name` は無改変）。

## 既存の二重コピーの掃除（併用済みプロジェクトの是正）

本修正の適用前に `apm install`（Claude ターゲット）と `npx init` を併用していたプロジェクトでは、旧 apm が置いた**ハイフン名の個別スキル**（例: `.claude/skills/architecture-define-boundaries/`）が残存しうる。これらは以下の手順で掃除する（npx 由来のダブルアンダースコア名スキル・ユーザー自作スキルは残す）。

- apm を新版へ更新し `apm uninstall`（または当該パッケージの再同期）で apm 管理エントリを除去する、もしくは
- `.claude/skills/` 配下の**ハイフン区切りの個別スキルディレクトリ**（`{domain}-{capability}` 形式・apm 由来）を手動で削除する。`{domain}__{capability}`（ダブルアンダースコア＝npx 由来）と `agent-skill-chain-full` は削除しない。

その後 `npx github:techbeansjp-free/AGENTS.md upgrade` を実行すると、npx 所有分（ダブルアンダースコア名）が最新化され、`.claude/skills/` に同一スキルの別名コピーが 0 件になる。

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
# 個別スキルは apm では配らない（D1）。バンドル以外の個別スキルディレクトリが 0 件であることを確認する。
[ "$(find "$B/.agents/skills" -mindepth 1 -maxdepth 1 -type d ! -name agent-skill-chain-full | wc -l)" -eq 0 ] && echo "no individual skills OK"
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

`apm-release` ジョブは `release-marketplace` ジョブと同一の実行ゲート（`github.actor != 'github-actions[bot]' && vars.RELEASE_ENABLED == 'true'`。トリガは `workflow_dispatch` のみ）配下にある。リリース手順は [`docs/maintainer/RELEASE.md`](./RELEASE.md) を参照。

消費者向けの install コマンド（README.md §導入）:

```bash
apm install techbeansjp-free/AGENTS.md#release/apm            # 最新版（ブランチ ref）
apm install techbeansjp-free/AGENTS.md#apm-v0.1.0             # 特定版（タグ ref・ピン留め）
```

## 参照

- [`.agent-skill-chain/source/scripts/build-adapters.sh`](../../.agent-skill-chain/source/scripts/build-adapters.sh)（`adapter_apm()`）
- [`.agent-skill-chain/source/scripts/sync-version.sh`](../../.agent-skill-chain/source/scripts/sync-version.sh)
- [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml) — 手書き正本
- [`docs/maintainer/RELEASE.md`](./RELEASE.md) — リリース手順（version 同期・リリース実行手順）
- [`docs/maintainer/adapters.md`](./adapters.md) — Claude/Cursor アダプタ生成方式（対の解説ドキュメント）
- [npm 公開中止・APM 転換 issue（02_設計.md・03_実装計画.md）](../maintainer/workflow/close/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/20260711_024021_npm公開中止_APM転換/) — 一次情報調査・設計判断の詳細
