---
document_id: "5e03c06f-eb9f-4a64-9d10-172f553c947b"
---

# レビュー書: test-audit.sh 必須ファイル欠落検知の AGENTS_ROOT 環境変数汚染是正

**プロジェクト名**: test-audit.sh 必須ファイル欠落検知の AGENTS_ROOT 環境変数汚染是正
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **レビュー深度**: standard。fresh reviewer（実装担当・過去レビュー担当いずれとも別インスタンス）による独立検証。実装担当の「PASS=39 FAIL=0」主張を鵜呑みにせず、汚染 env・クリーン env の両方で自ら再実行し、ADR-2 の WARN 分岐 3 パターンも直接 audit.sh を実行して裏取りした。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。参照ルール: [REVIEW_RULE.md](../../../../../../../.agent-skill-chain/source/REVIEW_RULE.md)。

---

## 1. レビュー概要

### 1.1 レビュー目的

実装内容の確認 / 品質保証 / クローズ前最終チェック。`test-audit.sh` の環境変数隔離（ADR-1）と `audit.sh` #1 の WARN 可視化（ADR-2）が、01 の受け入れ基準（AC-1〜AC-6）を満たし、既存 32 監査項目・既存全テストスイートに回帰を与えていないことを独立に検証する。

### 1.2 レビュー対象

- **実装範囲**:
  - `test/test-audit.sh`: ADR-1（`set -uo pipefail` 直後の環境変数一括 unset 隔離ブロック追加＋ENV-1/ENV-2 回帰シナリオ追加）。
  - `.agent-skill-chain/source/enforcement/ci/audit.sh`: ADR-2（default 置換前の `AGENTS_ROOT_EXPLICIT` 捕捉＋ #1 への `elif` WARN 分岐）。
- **レビュー期間**: 2026-07-12 ～ 2026-07-12
- **レビュー担当者**: fresh reviewer（監査ロール・opus・reasoning effort high）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| タスク1: test-audit.sh 環境変数隔離 | 冒頭で `AGENTS_ROOT WORKFLOW_DIR WORKFLOW_DIRS PR_BODY CODE_COMMENT_SRC_DIRS REVIEWDOCS_GATE_EFFECTIVE_FROM` を一括 unset | 2026-07-12 | 実装担当 | 完了 |
| タスク2: audit.sh #1 WARN 可視化 | default 置換前に明示指定フラグ捕捉、#1 の `-d` ガードに `elif`（明示指定＋不在で WARN） | 2026-07-12 | 実装担当 | 完了 |
| タスク3: 回帰シナリオ追加・両 env 実測 | ENV-1（明示不在→WARN・exit0）・ENV-2（既定不在→静か SKIP）を恒久化 | 2026-07-12 | 実装担当 | 完了 |

### 2.2 実装内容の詳細

#### タスク1: test-audit.sh の環境変数隔離（ADR-1）

- **変更ファイル**: `test/test-audit.sh`（`set -uo pipefail` 直後の 25-28 行）。
- **実装方法**: 03 §2.1.2 の許可リストどおり 6 変数を変数名列挙のみで `unset`（値参照なし＝`set -u` 下でも安全）。`AUDIT_GIT_RANGE` は per-invocation 設定のため対象外という設計判断（02 §3.1.2）どおり除外されている。変更理由コメント（本 issue の根本原因）も付与済み。
- **確認事項**: 隔離対象が許可リストに一致し、無関係変数（PATH 等）を unset していないこと（バリデーション観点）。→ 差分確認で確認済み。過不足なし。

#### タスク2: audit.sh #1 の解決失敗可視化（ADR-2）

- **変更ファイル**: `.agent-skill-chain/source/enforcement/ci/audit.sh`（default 置換直前の明示指定フラグ捕捉＋ #1 の `elif` 分岐、計 5 行追加）。
- **実装方法**:
  - `if [[ -n "${AGENTS_ROOT:-}" ]]; then AGENTS_ROOT_EXPLICIT=1; else AGENTS_ROOT_EXPLICIT=0; fi` を `AGENTS_ROOT="${AGENTS_ROOT:-.agent-skill-chain/source}"` の**直前**に配置。set-but-empty（`AGENTS_ROOT=`）は `-n` が偽となり非明示（=0）扱いに落ちる設計が実装どおり。
  - #1 の `if [[ -d "$PROJECT_ROOT/$AGENTS_ROOT" ]]; then ...; done` の後に `elif [[ "$AGENTS_ROOT_EXPLICIT" == "1" ]]; then echo "WARN: ..." >&2` を追加。終了コード（`EXIT_CODE`）には一切触れていない（後方互換）。
- **確認事項**: WARN 文言に章節番号・issue/PR 番号・仕様ファイル名を含めていないこと（#26 コメント外部参照禁止への非抵触）。→ 文言は一般的散文のみで、#26 に抵触しない。実際、run-all.sh 全体で #26 由来 FAIL は 0。

#### タスク3: 回帰シナリオ ENV-1/ENV-2

- **変更ファイル**: `test/test-audit.sh`（106-127 行、シナリオ ENV-1・ENV-2）。
- ENV-1: `AGENTS_ROOT='/nonexistent/xyz'` で `audit.sh <tmp>` 実行 → stderr に WARN 含む＋exit 0 を 2 アサーションで判定。
- ENV-2: `.agent-skill-chain/source` を持たない tmp ツリーへ `AGENTS_ROOT` 未設定実行 → #1 由来の WARN も Missing も出ないことを判定。tmp 隔離（`mktemp -d`）を用い本番ファイルを変更しない。

---

## 3. テスト結果の確認（再実行・独立検証）

**すべて本レビューで自ら再実行した実測値である（実装担当の報告値を再現確認）。**

### 3.1 test-audit.sh 単体（汚染 env / クリーン env 両方）

現シェルには実際に汚染値 `AGENTS_ROOT=${CLAUDE_PROJECT_DIR}/.agent-skill-chain/source`（`CLAUDE_PROJECT_DIR` 未設定で未展開）が事前設定されており、本 issue の再現条件そのものである（`env | grep AGENTS_ROOT` で確認）。

| 実行条件 | コマンド | 結果 | 判定 |
| -------- | -------- | ---- | ---- |
| 汚染 env（現シェル継承） | `bash test/test-audit.sh` | `== 結果: PASS=39 FAIL=0 ==`（rc=0） | OK（AC-1） |
| クリーン env | `env -u AGENTS_ROOT bash test/test-audit.sh` | `== 結果: PASS=39 FAIL=0 ==`（rc=0） | OK（AC-2） |

- **実行日**: 2026-07-12
- **テストファイル数**: 1（test-audit.sh）
- **テストケース数**: 39（両 env とも同数）
- **成功**: 39 / **失敗**: 0 / **スキップ**: 0（sqlite3・git とも本環境に存在するため #17/#31/#32/GIT_RANGE 系すべて実行）
- 汚染・クリーン両 env で PASS 件数・FAIL 件数が完全一致 → 隔離ブロックにより実行結果が呼び出し元環境から独立（決定的）になっていることを確認。

### 3.2 ADR-2 WARN 分岐の直接検証（3 パターン＋境界 2 件）

`audit.sh` を直接実行し、`make_min_tree` 相当の tmp ツリーで境界を裏取りした（本番ファイル非改変・実行後 `rm -rf`）。

| パターン | 条件 | rc | WARN 件数 | Missing 件数 | 判定 |
| -------- | ---- | -- | --------- | ------------ | ---- |
| P1 既定値＋実在 | `AGENTS_ROOT` unset・`.agent-skill-chain/source` 実在 | 0 | 0 | 0（Audit passed） | OK（AC-5・既存 T1 相当が不変） |
| P2 既定値＋不在 | `AGENTS_ROOT` unset・該当 dir 不在 | 0 | 0 | 0 | OK（AC-6・非採用消費者を静かに SKIP） |
| P3 明示＋不在 | `AGENTS_ROOT=/nonexistent/xyz` | 0 | 1 | 0 | OK（AC-4・無条件成功でなく WARN 可視化） |
| P3b set-but-empty＋不在 | `AGENTS_ROOT=`（空文字） | 0 | 0 | – | OK（非明示扱いで WARN 抑止・バリデーション観点） |
| AC-6 明示＋実在（別配置） | `AGENTS_ROOT=custom/root`（必須ファイルを別配置に実在させる） | 0 | 0 | 0（Audit passed） | OK（AC-6・正しく別配置へ向けた消費者を誤検知しない） |

- P3 の WARN 文言（実測）: `WARN: AGENTS_ROOT が明示指定されていますが解決先ディレクトリが存在しません（環境変数の設定ミス/汚染の可能性・必須ファイルチェックをスキップします）: /nonexistent/xyz (resolved: <tmp>//nonexistent/xyz)`。
- 全パターンで終了コードは 0 で不変（後方互換維持）。

### 3.3 全体テストスイート（run-all.sh・回帰確認）

- コマンド: `env -u AGENTS_ROOT bash test/run-all.sh`
- 結果: `合計=17 PASS=17 FAIL=0 SKIP=0`（全体 rc=0）。
- 内訳確認済みの主なスイート: test-audit（PASS=39）、e2e-install-uninstall（PASS=131）、test-build-adapters-apm（PASS=15）、test-sync-version-apm（PASS=9）、write-workflow-log 系（multidoc/glob/prevhash/schema-idempotent/ts-utc）、test-workflow-db-guard、test-c4-bypass-resistance、test-cli-audit-doctor、test-export-ndjson、e2e-claude-hook 等。
- **audit.sh 本体変更が他監査項目・他スイートに新規回帰を与えていないことを確認**（write-workflow-log 系、issue1/issue2 追加テストを含め FAIL=0）。

---

## 4. コードレビュー

### 4.1 コード品質

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 変更箇所に根本原因コメントあり・意図が追える | OK | ADR-1/ADR-2 の意図がコメントで明示 |
| 保守性 | 最小差分（unset 1 ブロック＋ WARN 5 行）・抽象化を導入していない | OK | UNIX 哲学・スコープ規律に整合 |
| パフォーマンス | 冒頭 1 回の unset と #1 の分岐のみ | OK | スイート実行時間への実質影響なし |
| セキュリティ | 品質ゲート（必須ファイル欠落検知）の fail-open 抜け穴を隔離＋可視化で塞ぐ | OK | 新たな権限・秘密情報の扱いなし |
| 後方互換 | `audit.sh` の `$1`/`$2`・上書き env 機構・終了コードが不変 | OK | AC-3/AC-6・既存 CI 非破壊 |
| set -u 安全性 | unset は変数名列挙のみで値参照しない | OK | `set -uo pipefail` 下で未定義参照を起こさない |

### 4.2 指摘事項

#### 指摘 1: 00 §6 の 3 番目の成功基準の文言が採用設計（WARN）と不整合（重要度: 低・非ブロッカー）

- **指摘内容**: 00_要求定義 §6 の 3 点目は「是正後、`AGENTS_ROOT` を**汚染した状態**で `audit.sh <必須ファイル欠落済み最小ツリー>` を**直接実行**しても `FAIL: Missing required file` が出力されること」と、あたかも fail-closed を採る前提で書かれている。しかし 02 ADR-2 は選択肢 (C) WARN を採用し（汚染 env での保守者自身の audit 実行を阻害しない／非採用消費者を誤 FAIL しないため）、実測でも汚染 env の直接実行では WARN が出て `rc=0`・Missing は出ない（本レビュー 3.2 P3 と同型）。すなわち 00 §6 3 点目の**字義どおりの検証は成立しない**。
- **影響範囲**: 00 のこの 1 文のみ。01（AC-4 で「WARN 出力・fail-closed 化等から選択して確定」と設計フェーズに委譲）・02 ADR-2・03 §2.3.3（「隔離を経たテスト経路では `Missing required file` が出る」と再解釈）は内部整合しており、AC-1〜AC-6 はすべて充足済み。実装・テストの欠陥ではなく、要求フェーズ時点の文言が設計決定（WARN 採用）を反映せず残った**ドキュメント上のドリフト**にとどまる。今回の diff で 00 は行番号の 1 箇所（216-224→216-225）だけ更新され、§6 3 点目は据え置かれている。
- **対応方法**: クローズをブロックしない。00 §6 3 点目を「隔離を経たテスト経路（ADR-1）で `Missing required file` が出ること／直接実行の汚染 env は WARN で可視化されること」に軽微修正するのが望ましい。進行役の判断で本 issue 内で 1 行修正するか、別途追随とするかを決定されたい（fresh reviewer としては修正推奨だが、AC 充足と機能正当性には影響しないため必須ではない）。

---

## 5. ドキュメントの確認

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（行番号追随のみ・§6 3 点目は指摘1参照） | fresh reviewer | 2026-07-12 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | fresh reviewer | 2026-07-12 |
| [`02_設計.md`](./02_設計.md) | 更新済み | fresh reviewer | 2026-07-12 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | fresh reviewer | 2026-07-12 |

- **要件と実装の整合性**: AC-1〜AC-6 すべて実測で充足（指摘1の 00 §6 文言ドリフトを除き整合）。
- **実装と設計の整合性**: ADR-1（許可リスト unset）・ADR-2（明示指定判別＋ WARN `elif`）とも設計どおりに実装され、逸脱なし。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本リポジトリの `docs/` は生きたシステム仕様書（`docs/01_システム概要` 等）を持たず、`AI_CI_CD_VISION.md`（ビジョン文書）と `maintainer/`（ワークフロー記録・時点レビュースナップショット）で構成される。`audit.sh` #1 に言及する `docs/maintainer/IMPLEMENTATION_REVIEW.md` は旧 `.agents` パスや過去の行番号を参照する**時点固定のレビュー記録**であり、生きた仕様書ではない。本変更は内部挙動（テスト隔離＋防御的 WARN）にとどまり終了コード・呼び出し IF を変えないため、いずれの docs も本変更で陳腐化しない。[DOCS_RULES.md §継続追随ゲート](../../../../../../../.agent-skill-chain/source/DOCS_RULES.md) の軽量パス（根拠付き更新不要判定 1 件）で充足。`docs/00_review/` は本リポに存在せず新規作成不要。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: UNIX 哲学（小さく作る）に整合。修正は unset 1 ブロックと #1 の分岐数行に限定され、抽象化・共通化を導入していない（02 §1.2）。
- **単一責務**: テストの隔離責務は `test-audit.sh`（テストハーネス）に、監査ロジックは `audit.sh`（監査エンジン）に置かれ、境界が保たれている。汚染源そのもの（外部ハーネスの env 注入）の是正は本 issue スコープ外として境界を越えていない。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。`test-audit.sh` → `audit.sh` はサブプロセス実行・読み取りのみ。循環参照なし。
- **依存関係**: `audit.sh` #1 → `AGENTS_ROOT` → `$PROJECT_ROOT/$AGENTS_ROOT` の解決経路のみに変更が閉じている。#2〜#32 の判定ロジックは不変（run-all.sh で全体退行なしを実測）。
- **後方互換**: 終了コード・呼び出しインターフェース不変。既存 CI（`.github/workflows/self-enforce.yml`）・別配置消費者への影響なし（AC-6 実測）。
- **tmp 隔離規約**: 追加シナリオ・本レビューの直接検証はいずれも `mktemp -d` の隔離ツリーで実施し、本開発リポの `.agent-skill-chain/source/` `.claude/` `.agent-skill-chain/runtime/` `workflow.db` を変更していない（自己拡張ワークフロー §テストの tmp 隔離 遵守）。
- **指摘・推奨**: 指摘1（00 §6 文言ドリフト・重要度低）以外に設計・境界上の問題なし。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| 汚染・クリーン両 env で test-audit.sh が PASS=39 FAIL=0 | observed_runtime / test_output | 本レビューで両 env 再実行（3.1） |
| ADR-2 WARN 分岐が 3 パターン＋境界 2 件で設計どおり | observed_runtime | 直接 audit.sh 実行の実測（3.2） |
| audit.sh 変更が他監査項目・他スイートに回帰なし | test_output | run-all.sh 合計=17 PASS=17 FAIL=0（3.3） |
| 実装が ADR-1/ADR-2 に逸脱なく整合 | existing_code | 差分レビュー（audit.sh・test-audit.sh） |
| docs 更新不要 | existing_code | 生きた仕様書不在・時点レビュー記録のみ（docs 更新節） |
| 00 §6 3 点目の文言ドリフト | observed_runtime | 汚染 env 直接実行が WARN・rc=0 で Missing 非出力（指摘1） |

- inference_only のみに依存する重要判断は無し（すべて observed_runtime / test_output / existing_code で裏取り済み）。

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題1（=指摘1）**: 00 §6 3 点目の文言が採用設計（WARN）と不整合。
  - **影響範囲**: 00 の 1 文のみ。機能・AC 充足には影響しない。
  - **対応方法**: 進行役判断で 00 §6 3 点目を軽微修正（ADR-1 隔離テスト経路での検知＋直接実行汚染 env の WARN 可視化に文言更新）を推奨。クローズはブロックしない。

### 10.2 改善提案

- なし（最小差分で目的を達成しており、追加の抽象化・機能追加は不要＝スコープ規律に整合）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（設計 ADR-1/ADR-2 に逸脱なく最小差分、後方互換維持）。
- **テスト品質**: 良好（汚染・クリーン両 env で決定的 PASS=39、ADR-2 の 3 パターン＋境界を恒久回帰＝ENV-1/ENV-2 として固定）。
- **ドキュメント品質**: 概ね良好（01/02/03 は整合。00 §6 3 点目のみ軽微ドリフト＝指摘1）。
- **総合評価**: **合格（クローズ可）**。指摘1 は重要度低・非ブロッカーであり、AC-1〜AC-6 はすべて実測で充足。サブ issue 分割なし（本 issue 直下に子 issue ディレクトリなし）＝ 90_issues.md 追加も不要。

### 12.2 承認状況

- **レビュー承認者**: fresh reviewer（監査ロール）
- **承認日**: 2026-07-12
- **承認コメント**: 実装・テスト・後方互換いずれも独立再実行で確認済み。close 前に進行役の判断で 00 §6 3 点目の文言修正を検討されたい（任意）。書記記録（write-workflow-log）実行をもって verify-and-close の DoD を満たす。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- `.agent-skill-chain/source/enforcement/ci/audit.sh`（83 行 default 置換／225 行 elif WARN）
- `test/test-audit.sh`（25-28 行 隔離ブロック／106-127 行 ENV-1/ENV-2）

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- verify-and-close の DoD 充足（本 04_review 作成＋書記記録）。close 可。トップレベル issue 完了時に close 移動（本 issue は単一サブ issue のため単独では移動しない）。
