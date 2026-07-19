---
document_id: "8512dbce-0005-4357-a11e-6f3b81bc88bf"
---

# レビュー書: CLI（bin/agents-md.js）の TypeScript 化と型チェックの CI 配線

**プロジェクト名**: CLI の TypeScript 化と型チェックの CI 配線
**作成日**: 2026 年 06 月 15 日
**最終更新**: 2026 年 06 月 15 日（前回ブロッキング是正の再検証を反映）

> **重要**: このドキュメントは「生きているドキュメント」として実装と同期させる。
> **必須**: レビュー実施時は [`.agents/REVIEW_RULE.md`](../../../../../.agents/REVIEW_RULE.md) を参照。レビュー深度は **standard**（変更規模: src 移植 1 ファイル＋足場・CI 配線）。
>
> **用語**: [.agents/CONCEPTS.md §用語規約](../../../../../.agents/CONCEPTS.md#用語規約) を参照。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・品質保証・配布前最終チェック（TypeScript 化が挙動同一・型安全・配布健全であることの検証）。

### 1.2 レビュー対象（必須）

- **実装範囲**: 現 `bin/agents-md.js` を `src/agents-md.ts`（strict）へ移植し `tsc` で生成 bin を出力。`tsconfig.json`・devDependencies・`package-lock.json`・npm scripts（build/typecheck/prepack）・`.gitignore`（node_modules）・`self-enforce.yml` step #2.5・`verify-npm-pack.sh` 防御的禁止追加。
- **レビュー期間**: 2026-06-15 ～ 2026-06-15
- **レビュー担当者**: verify-and-close サブエージェント（レビュア）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス（必須） |
| -------- | -------- | ------ | ------ | ------------------ |
| T1 足場 | `tsconfig.json`（src 限定・ES2022/NodeNext/strict/rootDir src/outDir bin/noEmitOnError）・devDeps（typescript ^5・@types/node ^20）・`package-lock.json` | 2026-06-15 | 実装者 | 完了 |
| T2 移植・build | `src/agents-md.ts`（714 行・strict・`any` 不使用）へ移植、`npm run build` で生成 bin（shebang/755/ESM） | 2026-06-15 | 実装者 | 完了 |
| T3 scripts/gitignore | scripts に build/typecheck/prepack、`.gitignore` に `node_modules/`、files allowlist 据置 | 2026-06-15 | 実装者 | 完了 |
| T4 CI step | `self-enforce.yml` step #2.5（npm ci→typecheck→build→bin 差分ゼロ）追加・既存 step 不変 | 2026-06-15 | 実装者 | 完了 |
| T5 受け入れ検証 | E2E・pack・差分ゼロ・publish dry-run の総合受け入れ | 2026-06-15 | 実装者 | 完了（是正後 E2E FAIL=0 を実測） |
| T6 是正（prepack 廃止・--ignore-scripts） | `prepack` 廃止＋`verify-npm-pack.sh` に `--ignore-scripts`＋`release.yml`/`RELEASE.md` に publish 前 `npm ci && npm run build`＋02 §3.2.2 訂正 | 2026-06-15 | 実装者 | 完了 |

### 2.2 実装内容の詳細

#### T2: src/agents-md.ts への移植と strict 化

- **実装内容**: 現 bin の中身を `src/agents-md.ts`（1 行目 shebang 維持）へ移植し strict 型注釈を付与。`main(argv: string[]): number` 等。
- **変更ファイル**: `src/agents-md.ts`（新規）, `bin/agents-md.js`（生成物・追跡）, `tsconfig.json`, `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/self-enforce.yml`, `.agents/scripts/verify-npm-pack.sh`。
- **確認事項**: `any` 不使用（grep 0 件）・ESM（require 0／import.meta 1）・shebang・755 を build 後も維持（確認済み）。

---

## 3. テスト結果の確認

**テストは tmp 隔離（`mktemp -d` ＋ `git archive HEAD`）で再実行。本リポ非破壊。実 publish 禁止。** 詳細ログ: 初回 [`memo/20260615_095139_verify-and-close-検証ログ.md`](./memo/20260615_095139_verify-and-close-検証ログ.md)（要修正判定）／**是正後再検証 [`memo/20260615_100913_verify-and-close-再検証ログ.md`](./memo/20260615_100913_verify-and-close-再検証ログ.md)（E2E FAIL=0・全 PASS を実測）**。
**環境**: node v20.19.5 / npm 10.8.2。
**経緯**: 初回レビューで指摘 1（`prepack` が clean clone の pack を破壊し E2E/npm test FAIL）を**要修正（ブロッキング）**と判定。実装側で (A)`prepack` 廃止・(B)`verify-npm-pack.sh` に `--ignore-scripts`・publish 前 build の CI/手順配線・02 §3.2.2 訂正を実施。本再検証で是正を独立に確認した。

### 3.1 単体テスト（型検査）

#### テスト実行結果（必須）

- **実行日**: 2026-06-15
- **テストファイル数**: 1（`src/agents-md.ts` の `tsc --noEmit`）
- **テストケース数**: 2（typecheck PASS・型エラー注入で fail）
- **成功**: 2
- **失敗**: 0
- **スキップ**: 0

`npm run typecheck` = PASS（exit 0）。型エラー注入（`main` 内に `const __inject: number = "..."`）→ `tsc` exit 2（TS2322）→ 修正で exit 0 復帰。**SC-2 充足**。

### 3.2 統合テスト（build / 差分ゼロ / pack）

- `npm run build` → `git diff --exit-code bin/agents-md.js` = **差分ゼロ（exit 0）**。生成 bin は shebang・755・ESM 維持。**SC-1/SC-6（差分ゼロ部分）充足**。
- 生成 bin の version/help バイト一致 = PASS（新 bin と HEAD bin を同一ツリーで実行し `--version`(0.1.0)・`--help` がバイト一致）。
- `verify-npm-pack.sh`（リポ直下・node_modules あり）= PASS（exit 0、172 files、bin 同梱・src/tsconfig/lockfile リーク無し）。
- **`verify-npm-pack.sh`（クリーン clone・node_modules 無し）= PASS（exit 0、172 files）。** 前回 exit 127（`tsc not found`）だった経路が、`--ignore-scripts`（prepack 不実行）と prepack 廃止により解消。**指摘 1 是正の核心。**
- `npm publish --dry-run`（**実 publish せず**）= PASS（exit 0、total files 172、bin 同梱・src/tsconfig/lockfile/docs リーク無し・public access dry-run）。

### 3.3 E2E テスト

- **`e2e-install-uninstall.sh` = PASS（PASS=88 / FAIL=0）。** 前回 FAIL=1 だったシナリオ 7（配布物: verify-npm-pack.sh）が PASS に転じ、全 14 シナリオ pass。
- **`npm test`（run-all.sh）= PASS（合計 6 / PASS=6 / FAIL=0）。** 前回 5/6 FAIL → 全 PASS。

**SC-5（E2E FAIL=0）OK・SC-6（既存 CI 全 step 維持・差分ゼロ）OK。** 前回 NG の根因（§4.2 指摘 1）は是正済み。

---

## 4. コードレビュー

### 4.1 コード品質

- **リント結果**: 該当なし（ESLint 未導入＝スコープ外）
- **フォーマット**: 問題なし
- **型チェック**: 0 エラー / 0 警告（`tsc --noEmit` PASS）

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 単一ファイル・薄いラッパの責務を維持し型注釈が意図を明確化 | OK | |
| 保守性 | 正本を `src/agents-md.ts` 1 か所に集約・bin は生成物（追跡） | OK | |
| パフォーマンス | typecheck/build は開発・CI 時処理でランタイム性能に影響なし | OK | |
| セキュリティ | 追加依存はビルド専用 devDependency に限定・ランタイム依存不変 | OK | |
| 配布健全性 | pack に bin 同梱・src/tsconfig/lockfile リーク無し（リポ直下・クリーン clone 双方） | OK | 指摘 1 是正後、クリーン clone でも `--ignore-scripts` で exit 0・172 files（前回 exit 127 を解消） |

### 4.2 指摘事項

#### 指摘 1: `prepack` により E2E のクリーン clone で `npm pack --dry-run` が失敗する（ブロッキング）→ **是正完了**

- **重要度**: 高
- **指摘内容**: 02_設計 §3.2.2 は「`npm pack --dry-run` は `prepack` を実行しない」と前提するが、**npm 10.8.2 では `prepack` が実行される**。E2E（`e2e-install-uninstall.sh`）は `git archive HEAD | tar -x` で作る **node_modules 無し**のクリーン作業ツリーで `verify-npm-pack.sh` を呼ぶため、`npm pack --dry-run` → `prepack` → `npm run build` → `tsc: not found` で **exit 127**。E2E シナリオ 7 が FAIL し、`npm test` も FAIL。
- **証跡（初回）**: `test_output`。E2E PASS=87/FAIL=1、`npm test` 5/6、クリーン archive での verify-npm-pack exit 127（`sh: 1: tsc: not found`）。
- **対応状況**: **完了（是正済み）**。下記 (A)+(B) を実装し、本再検証で独立確認した。
- **対応方法（実施済み）**: (A) `verify-npm-pack.sh` の `npm pack --dry-run` に **`--ignore-scripts`** を付与（L48。lifecycle script の副作用を起こさない多重防御）。(B) `package.json` から **`prepack` を廃止**し、未ビルド配布防止を「追跡 bin の差分ゼロ＋CI build（`self-enforce.yml` #2.5・`release.yml` の `npm ci && npm run build`）」に委ねる。加えて `RELEASE.md` に publish 前 build 手順を明記、02_設計 §3.2.2 の誤前提を訂正。
- **再検証結果（test_output / observed_runtime）**: クリーン clone（node_modules 無し）での `verify-npm-pack.sh` = **exit 0・172 files**（前回 exit 127 を解消）。E2E **PASS=88/FAIL=0**、`npm test` **6/6 PASS**。`package.json` に `prepack` 無し（grep 0 件）。詳細: [`memo/20260615_100913_verify-and-close-再検証ログ.md`](./memo/20260615_100913_verify-and-close-再検証ログ.md)。

#### 指摘 2: 実装者の記録証跡が再現結果と不一致（中）→ 解消

- **重要度**: 中
- **指摘内容**: 初回 implement-feature の workflow_log（entry 422a929c）は「E2E 88/0 PASS・npm test 6/6 PASS」と記録したが、初回再現は E2E 87/1 FAIL・npm test 5/6 FAIL であった。
- **対応状況**: 是正後 implement-feature（entry 41e7e641）で prepack 廃止・`--ignore-scripts` を実装。本再検証で **E2E 88/0 PASS・npm test 6/6 PASS** を実測し、現状の記録と再現結果が一致。乖離は解消。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み | レビュア | 2026-06-15 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | レビュア | 2026-06-15 |
| [`02_設計.md`](./02_設計.md) | 更新済み（§3.2.2 の prepack/dry-run 誤前提を訂正済み・prepack 廃止＋`--ignore-scripts` を明記） | レビュア | 2026-06-15 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | レビュア | 2026-06-15 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合。02 §3.2.2 の誤前提（dry-run は prepack を走らせない）は訂正され、prepack 廃止・`--ignore-scripts`・publish 前 build（release.yml / RELEASE.md）が設計・実装・CI で一貫。
- **要件と実装の整合性**: SC-1〜SC-7 すべて整合・充足（下記 SC 表）。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本 issue は CLI のビルド構成整備でありシステム仕様（docs/）の振る舞いに影響しない。`docs/maintainer/workflow/` 配下の開発記録のみで完結。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: UNIX 哲学・単一責務（薄いラッパ）を維持。型化は目的を変えず静的安全網のみ追加。spec 01/06 に整合。OK。
- **ディレクトリ構成**: `src/` 直下 1 ファイル・`bin/` 生成物・`tsconfig.json` ルート。深い階層を作らず AI フレンドリー。OK。
- **命名規則**: 既存命名を踏襲。OK。

### 9.2 境界・依存の確認

- **責務の境界**: 正本ソース（`src/`）と配布物（生成 `bin/`）の境界を `files` allowlist・`.gitignore`・CI 検査で三位一体に定義。`tsconfig` は `src/` 限定で `audit-table.ts` を巻き込まない（include `src/**/*.ts`・exclude 確認）。OK。
- **依存関係**: `src → bin` 一方向生成のみ・循環なし。追加依存はビルド専用 devDependency。OK。
- **指摘・推奨**:
  - 生成 bin の Git 追跡方針（再ビルド差分ゼロで同期保証）は E2E の clean-clone 直接実行と整合し妥当。OK。
  - `prepack` は廃止された。追跡 bin 方針では「保険」に過ぎず、clean-clone 経路で破壊的副作用（tsc not found）を生むため、未ビルド配布防止は「追跡 bin の差分ゼロ＋CI build（`self-enforce.yml` #2.5・`release.yml` の `npm ci && npm run build`）」に委ね、`verify-npm-pack.sh` は `--ignore-scripts` で pack 検査の副作用を排した。これにより設計判断と E2E（clean-clone で pack を呼ぶ）が整合。指摘 1 解消。OK。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| typecheck PASS・型エラー注入で fail（SC-2） | test_output | 再検証ログ（memo）。tsc exit 0／注入で exit 2（TS2322）→復元で exit 0 |
| build 後 bin 差分ゼロ・shebang/755/ESM 維持・version/help バイト一致（SC-1） | test_output | `git diff --exit-code` exit 0・head -1・stat・grep・--version/--help バイト一致 |
| E2E FAIL=0・npm test 全 PASS（SC-5/SC-6 充足） | test_output | E2E 88/0・npm test 6/6・clean archive verify-npm-pack exit 0（172 files） |
| 指摘 1 是正（prepack 廃止＋`--ignore-scripts`）の有効性 | observed_runtime | npm 10.8.2 clean clone で pack が prepack を走らせず exit 0。package.json に prepack 無し |
| 生成 bin の Git 追跡方針の妥当性 | existing_code | E2E が `git archive HEAD` から bin 直接実行する既存設計に整合 |

---

## 受け入れ基準（SC）充足表

| SC | 内容 | 結果 | 根拠 |
| -- | ---- | ---- | ---- |
| SC-1 | src/agents-md.ts(strict)・生成 bin が shebang/権限/ESM 維持 | OK | build 後 head/stat/grep・差分ゼロ・version/help バイト一致 |
| SC-2 | `npm run typecheck` PASS・型エラー注入で fail | OK | tsc exit 0／注入で exit 2（TS2322）→復元で exit 0 |
| SC-3 | npm test/CI に typecheck・build 組込・型エラーで CI× | OK | step #2.5 配線（npm ci→typecheck→build→bin 差分ゼロ）・E2E step も green |
| SC-4 | `npm pack --dry-run` 合格・生成 bin 同梱・開発物リーク無し | OK | リポ直下＋**クリーン clone 双方で exit 0・172 files・リーク無し**（指摘 1 是正） |
| SC-5 | E2E 全シナリオ PASS（FAIL=0） | **OK** | **E2E PASS=88/FAIL=0 を実測**（前回 FAIL=1 → 是正） |
| SC-6 | CI 既存全 step green 維持・#3 差分ゼロ | **OK** | npm test 6/6 PASS・E2E 経路 green・#3 差分ゼロ（前回 NG → 是正） |
| SC-7 | audit-table.ts の型検査範囲を 01 に明記 | OK | 01 §2.3「別 issue 推奨」明記・tsconfig include は `src/**/*.ts` で巻き込まない |

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良（型化・strict・any 不使用・責務維持・配布配線の欠陥を是正）。
- **テスト品質**: 良（記録と再現結果が一致＝指摘 2 解消。E2E 88/0・npm test 6/6 を実測）。
- **ドキュメント品質**: 良（テンプレ準拠・02 §3.2.2 の誤前提を訂正・release.yml/RELEASE.md に publish 前 build を明記）。
- **総合評価**: **合格（承認）**。SC-1〜SC-7 すべて充足。前回ブロッキング（指摘 1）は (A)prepack 廃止・(B)`--ignore-scripts` で是正され、E2E FAIL=0 を独立に実測。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close レビュア
- **承認日**: 2026-06-15
- **承認コメント**: **承認**。前回「要修正（ブロッキング）」とした指摘 1（`prepack` が clean-clone の pack を破壊し E2E/npm test FAIL）は是正済み。本再検証で、`package.json` に prepack 無し・`verify-npm-pack.sh` が `--ignore-scripts`・`release.yml`/`RELEASE.md` に publish 前 `npm ci && npm run build`・02 §3.2.2 訂正を独立確認し、**E2E PASS=88/FAIL=0・npm test 6/6 PASS・typecheck PASS（型エラー注入で fail）・build 差分ゼロ・version/help バイト一致・clean clone での verify-npm-pack exit 0・publish dry-run 健全**を実測した（**実 publish せず**）。**評価根拠は test_output / observed_runtime に基づき inference_only のみの判断ではない。**

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- 初回検証ログ（要修正判定）: [`memo/20260615_095139_verify-and-close-検証ログ.md`](./memo/20260615_095139_verify-and-close-検証ログ.md)
- 是正後再検証ログ（合格判定・E2E FAIL=0 実測）: [`memo/20260615_100913_verify-and-close-再検証ログ.md`](./memo/20260615_100913_verify-and-close-再検証ログ.md)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- **承認済み**。SC-1〜SC-7 充足・指摘 1/2 解消。トップレベル issue 完了時に `docs/maintainer/workflow/close/` へ移動（`.agents-project/自己拡張ワークフロー.md` §close 移動・相対リンク補正）。実 publish はユーザー明示承認時のみ（RELEASE.md §0）。
