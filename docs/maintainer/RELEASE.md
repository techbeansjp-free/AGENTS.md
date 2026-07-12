# RELEASE / 公開手順（メンテナ向け・正本）

本ドキュメントは marketplace（Claude プラグイン）／apm（Agent Package Manager）配布の**リリース手順の詳細正本**である。README §リリース手順は入口リンクと要約のみを持ち、詳細はここに一本化する（重複させない）。

> **重要（リリース発火は push 契機・PR レビュー承認をもって人間承認済みとみなす）**
>
> - リリースは [`.github/workflows/release.yml`](../../.github/workflows/release.yml) が main への push（配布影響パス `.agent-skill-chain/source/**`・`package.json`・`.claude-plugin/marketplace.json` のいずれかに一致する変更を含む場合）を検知して自動発火する。main は branch protection（PR 必須・レビュー承認 1 件以上・`self-enforce` 必須）で保護されており、**PR レビュー承認をもって人間承認済みとみなす**。承認された変更が main へマージされた時点で自動発火し、リリース起動のための追加操作・追加承認は不要。
> - `RELEASE_ENABLED` はリポジトリ変数で、**緊急停止スイッチ**として機能する。既定（未設定を含む）は有効（fail-open）であり、リリースを止めたいときのみ正確に文字列 `false` を設定する（`'true'`・誤字・空文字はすべて「有効」に倒れる）。
> - `workflow_dispatch` は緊急時の手動代替発火手段として残っているが、手動起動時は `paths` フィルタが適用されない（GitHub Actions の仕様）。通常運用は push 自動発火であり、手動起動は補助手段である。
> - **検証フェーズ（version 同期の `--check`・生成物のローカル build 確認）は read-only であり、リポジトリ・リリースブランチを書き換えない。**

---

## 0. 前提

| 前提 | 内容 |
| ---- | ---- |
| node | `>=20`（[`package.json`](../../package.json) の `engines.node`）。version 同期・アダプタ生成に使用する。 |
| npm | version 採番（`npm version`）・ローカル build 確認に使用する。検証時の実測例: npm 10.x。 |
| 認可 | 通常運用のリリース起動操作は不要（PR レビュー承認が人間承認を兼ねる）。緊急停止・再開の操作にはリポジトリ変数 `RELEASE_ENABLED` の設定権限を持つメンテナが必要。緊急時の `workflow_dispatch` 手動起動にはワークフロー起動権限を持つメンテナが必要。 |

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

1. **version 同期の確認（任意）**: §1 の `--check` が exit 0 であることを事前に確認しておくとよい（bump 後の CI ゲートと同じ検証を先取りできる）。
2. **自動発火**: 配布影響パス（`.agent-skill-chain/source/**`・`package.json`・`.claude-plugin/marketplace.json`）を含む変更を PR でレビュー承認（branch protection・1 件以上）を得たうえで main へマージすると、その push を検知して 3 ジョブが自動的に走る。`RELEASE_ENABLED` は既定で有効（未設定時も動作）であり、追加の起動操作は不要。
3. **緊急停止**: 不具合発覚時などリリースを即座に止めたい場合は、リポジトリ変数 `RELEASE_ENABLED` に正確に文字列 `false` を設定する。停止解除は変数を削除するか `'true'`（または `'false'` 以外の任意の値）に戻す。
4. **緊急時の手動起動**: `paths` フィルタの想定漏れ等で自動発火しない場合、[`release.yml`](../../.github/workflows/release.yml) の `workflow_dispatch` を手動起動できる（`RELEASE_ENABLED` ゲートは push と同様に適用される）。手動起動時は `paths` フィルタの対象外になるため、配布に影響しない変更のみのコミットでも実行される点に注意する。

CI は次の 3 ジョブを直列（`version-bump` → `release-marketplace` → `apm-release`）に実行する。

- **`version-bump`**: 最新 main を取得し `package.json` の semver patch を +1、`sync-version.sh` で `plugin.json`・`apm.yml` へ従属同期して 4 ファイル（`package.json`・`package-lock.json`・`plugin.json`・`apm.yml`）を main へ `[skip ci]` commit/push する。続けて JST 日時タグ `vYYYYMMDD.HHMMSS` を付与（同一秒で衝突する場合は最大 3 段リトライ、尽きたら fail）し、同タグの GitHub Release（自動生成ノート）を作成する（既存タグ・既存 Release は冪等に skip）。後続へ `outputs.version` を供給する。
- **`release-marketplace`**: 正本 `.agent-skill-chain/source/` から `build-adapters.sh claude cursor` で生成物を build し、決定性（再生成 diff ゼロ）を検証して `release/marketplace` ブランチへ commit/push する。commit メッセージの version は `version-bump` の `outputs.version` を参照する。
- **`apm-release`**: `needs: release-marketplace` で後段に直列化。正本から `build-adapters.sh apm` で `apm.yml`・`.apm/skills/**` を build し、決定性を検証して `release/apm` ブランチへ commit/push したうえで、同一コミットへ `apm-vX.Y.Z`（`X.Y.Z` は `package.json` の version）タグを付与する。

> `version-bump` の main 書き戻し push のみ admin PAT（secret `RELEASE_MAIN_PAT`）で認証し、branch protection（`enforce_admins: false`）をバイパスして通す。PAT push は `on: push` を再トリガしうるため、無限ループ防止の**主防御はコミットメッセージの `[skip ci]`**（`concurrency: group: release` は直列化のセーフティネット）。リリースブランチ push・タグ付与・GitHub Release 作成は引き続き GitHub Actions 既定 `GITHUB_TOKEN`（`permissions: contents: write`）を使用する。
>
> **障害切り分け**: `GH006`（Protected branch update failed）が再発した場合は PAT が Checkout に渡っていない、または PAT の実行主体が admin 権限を持たないことを疑う。`401`/`403` は PAT の失効・スコープ不足・対象リポジトリ不一致を示し `GH006` とは別事象。復旧は secret `RELEASE_MAIN_PAT` の再登録。

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
- [`.github/workflows/release.yml`](../../.github/workflows/release.yml) — main push（配布影響 paths 限定）起点の version bump／marketplace／apm リリース CI（`workflow_dispatch` は緊急時の手動代替）
- [`README.md`](../../README.md) §リリース手順（メンテナ向け） — 入口リンク・要約
- [`package.json`](../../package.json)（`files`・`bin`・`publishConfig.access=public`）、[`LICENSE`](../../LICENSE)（MIT）
- [`docs/maintainer/adapters.md`](./adapters.md) — Claude/Cursor アダプタ生成方式（marketplace 生成物の解説）
- [`docs/maintainer/apm-package.md`](./apm-package.md) — apm パッケージ生成方式（`.apm/` 生成物の解説）
- [`.agent-skill-chain/source/platforms/apm/apm.yml`](../../.agent-skill-chain/source/platforms/apm/apm.yml) — apm 手書き正本
