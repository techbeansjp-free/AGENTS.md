---
document_id: "33b728dd-3ef2-4cce-816a-16cfaeda0db6"
issue_id: "5081f55e-a70e-4037-91e8-f0524b0686e0"
---

# レビュー書: bin 生成物の gitignore 化と publish 時ビルド

**プロジェクト名**: bin 生成物の gitignore 化と publish 時ビルド
**作成日**: 2026 年 06 月 15 日
**最終更新**: 2026 年 06 月 15 日

> **重要**: 本 04 は **independent verification worker** が tmp 隔離で独立実測した結果である。実装サブの自己申告数値は一切引用していない。すべて本ワーカーが `mktemp -d` 隔離で再実行して得た値である。
>
> **用語**: [.agents/CONCEPTS.md §用語規約](../../../../.agents/CONCEPTS.md#用語規約) を参照。
> **レビュー深度**: full（CI/配布構成変更・全経路整合の影響が広いため）。[`.agents/REVIEW_RULE.md`](../../../../.agents/REVIEW_RULE.md) 準拠。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証 / デプロイ前最終チェック。生成物 `bin/agents-md.js` の git 非追跡化（`.gitignore` ＋ `git rm --cached`）と各経路の「使用前 build」転換が、SC1〜SC6 を**コミット後（`git archive HEAD` に bin が無い状態）**で満たすことを独立実測で検証する。

### 1.2 レビュー対象（必須）

- **実装範囲**: `.gitignore`（bin 追加）/ `bin/agents-md.js`（`git rm --cached`）/ `.github/workflows/self-enforce.yml`（step #2.5 diff-zero 除去）/ `.github/workflows/release.yml`（diff-zero 除去・build 維持）/ `test/e2e-install-uninstall.sh`（bin 不在ガード＋シナリオ7 build 前置）/ `test/run-all.sh`（E2E build 前置）/ `docs/maintainer/RELEASE.md`（§1.5/§5 改稿）。
- **レビュー期間**: 2026-06-15 ～ 2026-06-15
- **レビュー担当者**: independent verification worker（verify-and-close）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T1 bin 非追跡化 | `.gitignore` に `/bin/agents-md.js` 追加・`git rm --cached` | 2026-06-15 | impl サブ | 完了 |
| T2 self-enforce 再設計 | step #2.5 を「typecheck & build」へ改名・diff-zero 除去 | 2026-06-15 | impl サブ | 完了 |
| T3 release.yml diff-zero 除去 | build 維持・「Build CLI bin (replaces prepack)」へ改名 | 2026-06-15 | impl サブ | 完了 |
| T4 e2e 堅牢化 | bin 不在ガード（build 試行）＋シナリオ7 で `$src` build 前置 | 2026-06-15 | impl サブ | 完了 |
| T5 run-all 前置 | E2E 呼出前に REPO_ROOT で bin 生成（冪等・最小） | 2026-06-15 | impl サブ | 完了 |
| T6 RELEASE.md 改稿 | §1.5/§5 を「bin 非追跡・publish 直前 build」へ改稿 | 2026-06-15 | impl サブ | 完了 |

### 2.2 実装内容の詳細

#### T1: bin 非追跡化（`.gitignore` ＋ `git rm --cached`）

- **変更ファイル**: `.gitignore`（`/bin/agents-md.js` ＋意図コメント追加）、`bin/agents-md.js`（index から削除＝`D ` ステージ済）。
- **確認**: 実リポで `git ls-files bin/` 空・`git check-ignore bin/agents-md.js` がマッチ（rc=0）・`git ls-files src/agents-md.ts` 非空。ディスク上の bin 実体は保持（`-rwxr-xr-x`・shebang `#!/usr/bin/env node`）。02 §2.1 の境界どおり。

#### T2: self-enforce.yml step #2.5 再設計

- **変更内容**: step 名「CLI typecheck & build diff-zero (tsc)」→「CLI typecheck & build (tsc)」。`git diff --exit-code -- bin/agents-md.js` ブロックを除去。`npm ci`／`npm run typecheck`／`npm run build` は存続。コメントを新方式へ更新。
- **確認**: `grep -c 'git diff --exit-code -- bin/agents-md.js'` = 0。typecheck/build 残存（L93-95）。後続 step（#3/#4/#6）より前に build が走る順序を維持（下記 §9.2）。

#### T3: release.yml diff-zero 除去（build 維持）

- **変更内容**: 「Build CLI bin & verify diff-zero (replaces prepack)」→「Build CLI bin (replaces prepack)」。`git diff --exit-code bin/agents-md.js` ブロック除去。`npm ci && npm run build` 維持。marketplace job は不変。
- **確認**: `grep -c 'git diff --exit-code bin/agents-md.js'` = 0。build 残存（L75-76）。build→pack→gate→publish 順を維持。

#### T4: e2e-install-uninstall.sh 堅牢化

- **変更内容**: (a) 実行直前ガードを `[[ -f "$CLI" ]] || exit 2` から「不在時に node_modules があれば REPO_ROOT で `npm run build` 試行 → なお不在なら分かりやすいエラーで exit 2」へ強化。(b) シナリオ7（`test_no_dist_leak`）で `verify-npm-pack.sh` 呼出前に `$src` クリーンツリーで `npm ci && npm run build`（tmp 隔離内）を前置、build 失敗時は SKIP。
- **確認**: `bash -n` OK。REPO_ROOT は `git rev-parse --show-toplevel`（L26）で解決＝配置非依存。tmp post-commit シミュレーションで全 88 アサーション PASS（下記 V0）。

#### T5: run-all.sh の E2E build 前置

- **変更内容**: メインループで `name == e2e-install-uninstall` のとき、REPO_ROOT/bin が無く npm・node_modules があれば `npm run build` を前置（冪等・最小）。既存 TESTS 配列・集計・終了コード契約は不変。
- **確認**: `bash -n` OK。tmp で `合計=6 PASS=6 FAIL=0 SKIP=0`（下記 V0）。

#### T6: RELEASE.md §1.5/§5 改稿

- **変更内容**: §1.5 を「`bin/agents-md.js` は非追跡（`.gitignore`）の生成物・publish 直前 `npm ci && npm run build` で作業ツリーに生成して配布」へ改稿。`git diff --exit-code` 手順例を削除。§5 #4 の publish ジョブ説明を新方式へ更新。
- **確認**: 旧前提（`git diff --exit-code` 手順）残存 0 件。残る「差分ゼロ」「追跡 bin」言及は全て**廃止を述べる否定文脈**であり stale でない（下記 V6）。

---

## 3. テスト結果の確認（独立実測）

> **実測環境**: `mktemp -d` に現在の working tree（追跡＋未追跡実体・`.gitignore` 改変込み・`.workflow/templates/` 含む）を `.git` 除外でコピーし、`git init && git add -A && git commit`（改変済 `.gitignore` により bin は HEAD に**入らない**＝本番コミット後と同状態）。node v20.19.5 / npm 10.8.2。

### 3.1 単体/結合/E2E テスト実行結果（必須・数値）

- **実行日**: 2026-06-15
- **E2E（test/e2e-install-uninstall.sh）**: PASS=88 / FAIL=0（exit 0）
- **run-all.sh（npm test 相当）**: 合計=6 / PASS=6 / FAIL=0 / SKIP=0（exit 0）
- **verify-npm-pack.sh（build 済 working tree）**: exit 0（配布ファイル 164・必須物あり・リーク無し）

### 3.2 V0（最重要・post-commit シミュレーション）

| ステップ | コマンド | 結果 |
| -------- | -------- | ---- |
| tmp commit | `git init && git add -A && git commit` | OK。`git ls-files bin/` 空・`git archive HEAD｜tar -t｜grep '^bin/'` **無し**・`.workflow/templates/` 41 件 HEAD に有り |
| build | `npm ci && npm run build` | exit 0。`bin/agents-md.js`（`-rwxr-xr-x`・shebang）生成 |
| E2E | `bash test/e2e-install-uninstall.sh` | **PASS=88 FAIL=0**（シナリオ7「配布物: verify-npm-pack.sh が合格」PASS・「install: .workflow/templates が配備される」PASS） |
| runner | `bash test/run-all.sh` | **合計=6 PASS=6 FAIL=0 SKIP=0** |
| pack 検査 | `bash .agents/scripts/verify-npm-pack.sh`（build 済 working tree） | exit 0（合格） |

**V0 判定: PASS。** post-commit（`git archive HEAD` に bin 無し）状態で install/CLI 起動・シナリオ7・全 runner が green。

> **検証手記（再現性のための注意）**: 初回の tmp コピーで rsync が `--exclude='.workflow/'` を指定したため、**追跡対象である `.workflow/templates/`（41 件・`files` allowlist 内）が HEAD から欠落**し、E2E で 2 件（templates 配備・verify-npm-pack required）が FAIL した。これは**検証セットアップ側の誤り**であり実装の欠陥ではない。`.workflow/templates/` を含めて再構築したところ全 PASS。実リポでは `.workflow/templates/` は正しく追跡されている（`git ls-files .workflow/templates/` = 41 件）ため、本番コミットでは欠落しない。

---

## 4. コードレビュー

### 4.1 受け入れ基準の確認（SC1-6 × V0-V7 実測）

| 検証 | 対応 SC | 実測コマンド | 結果 |
| ---- | ------- | ------------ | ---- |
| **V1** | SC1 | （実リポ）`git ls-files bin/` / `git check-ignore bin/agents-md.js` / `git ls-files src/agents-md.ts` | bin 空・check-ignore マッチ(rc=0)・src 非空 → **PASS** |
| **V2** | SC2 | （tmp build 済）`npm pack --dry-run --json --ignore-scripts` を node で解析 | bin 含む=true・src=false・tsconfig=false・*.map=false・lock=false。shebang `#!/usr/bin/env node`・`-rwxr-xr-x` 保持 → **PASS** |
| **V3** | SC3 | （tmp の `git archive HEAD` クリーンツリー・node_modules 無し・bin 無し）`npm pack --dry-run --ignore-scripts` | exit 0・stderr に exit127/tsc-not-found **無し**。`verify-npm-pack.sh` は required:bin MISSING で exit 1（**クラッシュではない graceful fail**＝build→verify 順序制約の実証） → **PASS** |
| **V0** | SC4/SC5 | （tmp build 済）`bash test/e2e-install-uninstall.sh` / `bash test/run-all.sh` | E2E PASS=88 FAIL=0 / runner 6/6 PASS → **PASS** |
| **V4** | step#3 整合 | （tmp commit 済・build 済）`git status --porcelain --untracked-files=no` | **空**（bin 生成で porcelain に現れず＝self-enforce #3 が赤くならない） → **PASS** |
| **V5** | SC5/整合 | （実リポ）`grep -c 'git diff --exit-code'` 両 YAML / `python3 yaml.safe_load` / `bash -n` | self-enforce=0・release=0・typecheck&build/build 残存・両 YAML valid・両 sh `bash -n` OK・step 順序整合（§9.2） → **PASS** |
| **V6** | SC5/docs | （実リポ）RELEASE.md grep | `git diff --exit-code` 0 件。残存「差分ゼロ/追跡 bin」は全て**廃止を述べる否定文脈**（stale でない）。新方式「非追跡・使用前 build・publish 直前」明記 → **PASS** |
| **V7** | スコープ | （実リポ）`git status --short` / out-of-scope diff | 変更は 7 in-scope のみ。`package.json`/`tsconfig.json`/`verify-npm-pack.sh`/`COVERAGE_EXCEPTIONS.md` **UNCHANGED**。並行 issue `20260615_055806_…` は `??`（未着手）・`workflow.db` は `??`（gitignore） → **PASS** |

### 4.2 コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 各変更に「正本: …02_設計.md §…」由来コメントを付与 | OK | gitignore・両 YAML・e2e・run-all 全てに意図コメント |
| 保守性 | 検証本体（verify-npm-pack・e2e）は不変、build 前置のみ各 runner/step に分離（単一責務） | OK | 02 §2.3 の責務分離どおり |
| パフォーマンス | run-all/e2e の build は「bin 不在かつ node_modules 有り」時のみ＝冪等・最小 | OK | CI は元々 #2.5 で `npm ci && build` 済＝純増ほぼ無し |
| セキュリティ | tarball に `workflow.db`・`.agents-project/`・`docs/maintainer/`・`test/` 漏れ無し | OK | verify-npm-pack で禁止パターン PASS（164 件中リーク無し） |

### 4.3 指摘事項

#### 指摘 1: tmp post-commit シミュレーションの初回 rsync 除外ミス（検証側・実装無関係）

- **重要度**: 低（情報）
- **指摘内容**: 検証者が初回 tmp 構築で `.workflow/templates/`（追跡物）を誤除外し E2E 2 件が FAIL したが、再構築で解消。**実装には欠陥なし**。
- **対応状況**: 完了（templates を含めて再実測し全 PASS）。
- **対応方法**: 以後の post-commit シミュレーションでは `.workflow/templates/`・`.workflow/.gitignore` を残し、`workflow.db*` のみ除外する。

#### 指摘 2: bin 不在ガードは node_modules 必須（設計どおり・残課題なし）

- **重要度**: 低
- **指摘内容**: E2E/run-all の bin 自己回復 build は node_modules 前提。node_modules も bin も無い完全クリーン単体実行では exit 2（明示エラー）。これは 02 §3.2.2 / 設計の D 契約どおりの意図的挙動。CI（self-enforce step「typecheck & build」で `npm ci`）・release（`npm ci`）・run-all（node_modules 前提）の各前置で満たされる。
- **対応状況**: 完了（設計意図と一致）。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み | verify worker | 2026-06-15 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | verify worker | 2026-06-15 |
| [`02_設計.md`](./02_設計.md) | 更新済み | verify worker | 2026-06-15 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | verify worker | 2026-06-15 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（02 §9.4 変更ファイル一覧 10 件のうち #1〜#7 を実装・#8 COVERAGE_EXCEPTIONS/#9 package.json,tsconfig/#10 verify-npm-pack は宣言どおり**変更なし**を実リポで確認）。
- **要件と実装の整合性**: 整合している（01 BDD シナリオ1-1〜4-1 が V1〜V7 で 1:1 被覆）。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本 issue は CI/ビルド配布構成の内部変更であり、システム仕様書（`docs/` の機能仕様）に影響しない。配布手順正本 `docs/maintainer/RELEASE.md` は本 issue のスコープ内で改稿済み。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: 準拠。UNIX 哲学（bin は src の単純派生物・追跡正本は src 1 系統）、単一責務（検証本体は既存スクリプト・build 前置は runner/CI step に分離）を満たす（02 §1.2）。
- **ディレクトリ構成**: `.gitignore` で「正本（追跡 src）/ 生成物（非追跡 bin）」境界を機械確定。`.adapters/`・`.claude/`・`.coverage/` と同系列に bin を組み込む方針どおり。
- **命名規則**: step 名・コメントが新方式を正しく表現（「Build CLI bin (replaces prepack)」「CLI typecheck & build」）。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。`verify-npm-pack.sh`（pack 検査・不変）／`e2e`（install/uninstall E2E）／build 前置（runner・CI step）の責務分離を維持。
- **依存関係**: 生成は常に src → bin の一方向（循環なし）。**step 順序を実読確認**:
  - self-enforce: `CLI typecheck & build`(L90, bin 生成) → `Generated-output diff-zero`(L99, #3) → `npm pack leak check`(L121, #4) → `Install/uninstall & E2E`(L142, #6)。**build が全 bin 依存 step より前**。
  - release npm-publish: `Build CLI bin`(L72) → `Verify npm pack`(L80) → `NPM_TOKEN gate`(L87) → `npm publish`(L102)。**build → pack → publish 順を維持**。marketplace job(L118+) は bin 非依存・不変。
- **指摘・推奨**: なし（境界・順序とも設計どおり）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| SC1（bin 非追跡・ignore） | observed_runtime | 実リポ `git ls-files`/`git check-ignore` の実測（V1） |
| SC2/SC3（pack 健全性・exit127 回避） | test_output | tmp の `npm pack --dry-run --json` 解析・clean clone pack exit 0（V2/V3） |
| SC4/SC5（E2E・runner green） | test_output | tmp post-commit で E2E 88/88・runner 6/6（V0） |
| step#3 が bin 生成で赤くならない | observed_runtime | tmp `git status --porcelain --untracked-files=no` 空（V4） |
| CI/release/docs 整合・スコープ | existing_code | 実リポ grep・YAML/bash 構文検証・out-of-scope diff（V5/V6/V7） |

**inference_only のみに依存する重要判断は無い**（全 SC を実測根拠で確認）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（設計の A〜D 決定・§9.4 変更一覧に厳密準拠。スコープ逸脱なし）。
- **テスト品質**: 良好（post-commit シミュレーションで全経路 green を独立実測。SC1-6 を V0-V7 で被覆）。
- **ドキュメント品質**: 良好（RELEASE.md が新方式へ整合・旧前提残存なし）。
- **総合評価**: **PASS**。

### 12.2 承認状況

- **レビュー承認者**: independent verification worker
- **承認日**: 2026-06-15
- **承認コメント**: SC1〜SC6 をすべて tmp 隔離の独立実測で確認。コミット後（`git archive HEAD` に bin 無し）状態で install/CLI 起動・E2E・runner・pack・clean-clone pack のすべてが green。CI/release/docs の整合と、out-of-scope ファイル（package.json/tsconfig.json/verify-npm-pack.sh/COVERAGE_EXCEPTIONS.md）の不変、並行 issue・workflow.db 未着手を確認。**orchestrator はコミット可**。

> **コミット対象（orchestrator 用）**:
> - 変更（M）: `.github/workflows/release.yml`・`.github/workflows/self-enforce.yml`・`.gitignore`・`docs/maintainer/RELEASE.md`・`test/e2e-install-uninstall.sh`・`test/run-all.sh`
> - 削除（D／`git rm --cached` 済）: `bin/agents-md.js`（index から削除。ディスク実体は生成物として残置）
> - 新規（??）: 本 issue ディレクトリ `docs/maintainer/workflow/20260615_114305_bin生成物のgitignore化とpublish時ビルド/`（00〜04）
> - **コミットしない**: `workflow.db`（gitignore 対象）、並行 issue `docs/maintainer/workflow/20260615_055806_コア取り込み漏れ補完/`（別 issue・未着手）

### 12.3 書記証跡（workflow_log document_id 一覧）

本 04 完了時、本 issue の 00〜04 全 document_id を workflow_log に記録した（#20 構造対策として command 別に複数回 INSERT）。

| 文書 | command | document_id |
| ---- | ------- | ----------- |
| 00_要求定義.md | requirement-discovery | `dfef6583-4f56-4e19-a47b-f076d528c680` |
| 01_要件定義.md | requirement-discovery | `01f9c443-d940-4c39-97af-52d4836615df` |
| 02_設計.md | design-feature | `b3d4e9a1-6c52-4f8a-9e1d-2a7c0f4b8d36` |
| 03_実装計画.md | implement-feature | `29beba74-b82b-4440-885d-8dcd3dedef86` |
| 04_review.md | verify-and-close | `33b728dd-3ef2-4cce-816a-16cfaeda0db6` |

**DB 確認（SELECT 実測・記録後）**: `.workflow/workflow.db` の workflow_log に 00-04 の 5 document_id がすべて存在することを `SELECT count(DISTINCT document_id) ... = 5` で確認済み。各 entry_id:

| 文書 | command | document_id | entry_id |
| ---- | ------- | ----------- | -------- |
| 00 | requirement-discovery | `dfef6583-4f56-4e19-a47b-f076d528c680` | `0c98fa82-451e-4e93-84fd-8d03fb488ec5` |
| 01 | requirement-discovery | `01f9c443-d940-4c39-97af-52d4836615df` | `79fa2da0-cb3c-4876-a2f7-550ccb66179b` |
| 02 | design-feature | `b3d4e9a1-6c52-4f8a-9e1d-2a7c0f4b8d36` | `3ae1b215-8d69-4db4-8016-0f06338acb7c` |
| 03 | implement-feature | `29beba74-b82b-4440-885d-8dcd3dedef86` | `f2383837-d2be-4c64-b0b2-c6d4c1775d0d` |
| 04 | verify-and-close | `33b728dd-3ef2-4cce-816a-16cfaeda0db6` | `c3b2a282-5be0-4d1d-a434-635063a45add` |

> 注: 00・02 は前フェーズで既記録、01・03・04 は本検証フェーズで補完記録（#20 構造対策＝command 別に複数回 INSERT し全 5 件を確実に紐付け）。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義（SC1-6・A〜D 申し送り）
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義（BDD シナリオ）
- [`02_設計.md`](./02_設計.md) - 設計（A〜D の決定・§9.4 変更一覧）
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画（T1〜T6）
- [.agents/REVIEW_RULE.md](../../../../.agents/REVIEW_RULE.md)、[.agents-project/自己拡張ワークフロー.md](../../../../.agents-project/自己拡張ワークフロー.md)（tmp 隔離・名前空間）

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本レビューは **PASS**。orchestrator が §12.2 のパス一覧で 1 論理コミット（feature ブランチ）し、close 移動を行う（push はユーザー明示時のみ）。
