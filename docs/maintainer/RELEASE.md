# RELEASE / 公開手順（メンテナ向け・正本）

本ドキュメントは marketplace（Claude プラグイン）／apm（Agent Package Manager）配布の**リリース手順の詳細正本**である。README §リリース手順は入口リンクと要約のみを持ち、詳細はここに一本化する（重複させない）。

> **重要（リリース発火はユーザー承認前提）**
>
> - リリースは [`.github/workflows/release.yml`](../../.github/workflows/release.yml) の `workflow_dispatch` を手動起動し、リポジトリ変数 `RELEASE_ENABLED=true` を設定したときのみ実行される。この**リリース発火（`workflow_dispatch` 起動・`RELEASE_ENABLED` 設定・main への書き戻し push）は、必ずユーザーの明示承認を得てから行う。** 承認なしにリリースを起動しない。
> - **検証フェーズ（version 同期の `--check`・生成物のローカル build 確認）は read-only であり、リポジトリ・リリースブランチを書き換えない。**

---

## 0. 前提

| 前提 | 内容 |
| ---- | ---- |
| node | `>=20`（[`package.json`](../../package.json) の `engines.node`）。version 同期・アダプタ生成に使用する。 |
| npm | version 採番（`npm version`）・ローカル build 確認に使用する。検証時の実測例: npm 10.x。 |
| 認可 | リリースはリポジトリ変数 `RELEASE_ENABLED` の設定権限と `workflow_dispatch` の起動権限を持つメンテナが行う。 |

前提確認:

```bash
node -v  # >=20
npm -v
```

不足時は検証・リリースを成立させられない。スキップせず前提不足として明示的に止めること。

---

## 1. version 同期（package.json ⇔ plugin.json ⇔ apm.yml）

version の正本は `package.json` 1 か所。Claude プラグイン正本 [`.agent-skill-chain/source/platforms/claude/plugin.json`](../../.agent-skill-chain/source/platforms/claude/plugin.json)、および apm（Agent Package Manager）正本 [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml) の両方を一致させる。ロジックの正本は [`.agent-skill-chain/source/scripts/sync-version.sh`](../../.agent-skill-chain/source/scripts/sync-version.sh)。

```bash
bash .agent-skill-chain/source/scripts/sync-version.sh --check   # 一致を検証（CI ゲートと同じ。不一致なら exit 1）
bash .agent-skill-chain/source/scripts/sync-version.sh --write   # package.json の version を plugin.json/apm.yml へ注入して揃える
```

**期待結果**: `--check` が `[sync-version] OK: version 一致（X.Y.Z）` を出し exit 0。

> CI（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)）の `version-bump` ジョブは bump 後に `package.json`・`plugin.json`・`apm.yml` の三者一致を検証する。日時タグ `vYYYYMMDD.HHMMSS`／`apm-vX.Y.Z` タグはリリースの目印であり semver と独立。

---

## 2. リリース実行手順

リリースは CI（[`release.yml`](../../.github/workflows/release.yml)）が担う。ローカルからブランチ／タグの push は行わない。

1. **version 同期の確認**: §1 の `--check` が exit 0 であることを確認する。
2. **リリース起動（ユーザー承認後）**: [`release.yml`](../../.github/workflows/release.yml) の `workflow_dispatch` を手動起動し、リポジトリ変数 `RELEASE_ENABLED=true` を設定する。両方を満たしたときのみ 3 ジョブが実行される（未設定／その他の値では全ジョブが skip される）。

CI は次の 3 ジョブを直列（`version-bump` → `release-marketplace` → `apm-release`）に実行する。

- **`version-bump`**: 最新 main を取得し `package.json` の semver patch を +1、`sync-version.sh` で `plugin.json`・`apm.yml` へ従属同期して 4 ファイル（`package.json`・`package-lock.json`・`plugin.json`・`apm.yml`）を main へ `[skip ci]` commit/push する。続けて JST 日時タグ `vYYYYMMDD.HHMMSS` を付与（同一秒で衝突する場合は最大 3 段リトライ、尽きたら fail）し、同タグの GitHub Release（自動生成ノート）を作成する（既存タグ・既存 Release は冪等に skip）。後続へ `outputs.version` を供給する。
- **`release-marketplace`**: 正本 `.agent-skill-chain/source/` から `build-adapters.sh claude cursor` で生成物を build し、決定性（再生成 diff ゼロ）を検証して `release/marketplace` ブランチへ commit/push する。commit メッセージの version は `version-bump` の `outputs.version` を参照する。
- **`apm-release`**: `needs: release-marketplace` で後段に直列化。正本から `build-adapters.sh apm` で `apm.yml`・`.apm/skills/**` を build し、決定性を検証して `release/apm` ブランチへ commit/push したうえで、同一コミットへ `apm-vX.Y.Z`（`X.Y.Z` は `package.json` の version）タグを付与する。

> main への書き戻し push・リリースブランチ push・タグ付与・GitHub Release 作成は GitHub Actions 既定 `GITHUB_TOKEN`（`permissions: contents: write`）のみを使用する（PAT／deploy key を使わない）。既定 `GITHUB_TOKEN` による push は workflow を再トリガしない（無限ループ防止）。

---

## 3. 確定既定（配布経路別）

| 配布経路 | リリースブランチ | タグ | version 正本 |
|---|---|---|---|
| Claude marketplace（`release-marketplace`） | `release/marketplace` | （タグ付与なし。ブランチ HEAD が最新） | `package.json`（`plugin.json`／`apm.yml` は従属。`sync-version.sh` で同期） |
| apm（`apm-release`。`microsoft/apm` パッケージ形式配布） | `release/apm` | `apm-vX.Y.Z`（semver・`package.json` の version と一致） | 同上 |

リリースイベントの目印として、`version-bump` が bump 後の HEAD へ日時タグ `vYYYYMMDD.HHMMSS`（semver ではない）を付与し、同タグの GitHub Release（自動生成ノート）を作成する。

---

## 4. 参照

- [`.agent-skill-chain/source/scripts/sync-version.sh`](../../.agent-skill-chain/source/scripts/sync-version.sh) — version 同期（正本）
- [`.github/workflows/release.yml`](../../.github/workflows/release.yml) — `workflow_dispatch` 起点の version bump／marketplace／apm リリース CI
- [`README.md`](../../README.md) §リリース手順（メンテナ向け） — 入口リンク・要約
- [`package.json`](../../package.json)（`files`・`bin`・`publishConfig.access=public`）、[`LICENSE`](../../LICENSE)（MIT）
- [`docs/maintainer/adapters.md`](./adapters.md) — Claude/Cursor アダプタ生成方式（marketplace 生成物の解説）
- [`docs/maintainer/apm-package.md`](./apm-package.md) — apm パッケージ生成方式（`.apm/` 生成物の解説）
- [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml) — apm 手書き正本
