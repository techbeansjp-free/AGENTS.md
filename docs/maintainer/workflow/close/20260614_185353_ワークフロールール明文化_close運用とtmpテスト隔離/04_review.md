---
document_id: "4e2afb87-d61c-43c8-88d2-1b0873ff8e5a"
---

# レビュー書: ワークフロールール明文化（close 運用と tmp テスト隔離）

**プロジェクト名**: ワークフロールール明文化（close 運用と tmp テスト隔離）
**作成日**: 2026 年 06 月 14 日
**最終更新**: 2026 年 06 月 14 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agents/CONCEPTS.md §用語規約](../../../../../.agents/CONCEPTS.md#用語規約) を参照。
>
> **必須**: レビュー実施時は [`.agents/REVIEW_RULE.md`](../../../../../.agents/REVIEW_RULE.md) を参照。本レビューの深度は **standard**（中規模・ドキュメント正本への追記）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

implement-feature の未コミット成果（2 つのワークフロールールの正本明文化）を verify-and-close で検証し、重複なく・既存ルールと矛盾なく・相互参照が実在する形で明文化されていることを確認する。

### 1.2 レビュー対象（必須）

- **実装範囲**: ルール1（完了 issue の close 移動）と ルール2（テストの tmp 隔離）を CORE.md・PHASES.md・.agents-project/自己拡張ワークフロー.md・RULES.md へ明文化した Markdown 変更（コード変更なし）。
- **レビュー期間**: 2026-06-14 ～ 2026-06-14
- **レビュー担当者**: auditor/scribe サブエージェント

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| ルール1 宣言 | CORE.md §完了 issue の close 分離（宣言）を追加 | 2026-06-14 | implementer | 完了 |
| ルール1 詳細 | PHASES.md §完了 issue の close 移動（ライフサイクル・トリガー・完了定義接続・配置先）を追加 | 2026-06-14 | implementer | 完了 |
| ルール1 上書き | .agents-project/自己拡張ワークフロー.md §完了 issue の close 移動（上書き）で配置先のみ上書き | 2026-06-14 | implementer | 完了 |
| ルール2 主 | .agents-project/自己拡張ワークフロー.md §テストの tmp 隔離（必須）を追加 | 2026-06-14 | implementer | 完了 |
| ルール2 汎用 | RULES.md §テスト隔離（汎用要約）を追加 | 2026-06-14 | implementer | 完了 |

### 2.2 実装内容の詳細

`git diff HEAD` で確認した実差分（evidence_source: existing_code）。

- **CORE.md**（135–140 行）: §完了 issue の close 分離（宣言）を「禁止事項」と「境界」の間に追加。宣言のみとし、ライフサイクル詳細は PHASES へ、配置先は .agents-project へ委譲。
- **PHASES.md**（67–77 行）: §完了 issue の close 移動を「レビュー成果物の配置ルール」と「監査観点」の間に追加。トリガー（厳密）・完了の定義（接続）・close ステップ・配置先（一般/自己拡張）・証跡保持を記載。
- **.agents-project/自己拡張ワークフロー.md**（20–37 行）: §完了 issue の close 移動（上書き、配置先 `docs/maintainer/workflow/close/<issue>/` のみ上書き）＋ §テストの tmp 隔離（必須）を追加。
- **RULES.md**（43 行〜）: §テスト隔離を末尾に追加。汎用要約とし、自己拡張固有は .agents-project を相互参照。

---

## 3. テスト結果の確認

### 3.1 単体テスト

- **実行日**: 2026-06-14
- **テストファイル数**: 0
- **テストケース数**: 0
- **成功**: 0
- **失敗**: 0
- **スキップ**: 0

本変更は Markdown 正本への追記のみでコード成果物・テストコードを含まない（00 §4.1）。よってテストコードの再実行対象は無い。代替として、相互参照リンク/アンカーの実在を `test -e` / `grep` で検証した（§3.2）。

### 3.2 検証スクリプト相当の結果（リンク・アンカー実在）

| 検証 | 方法 | 結果 |
| ---- | ---- | ---- |
| 変更4ファイルの実在 | `test -f` | OK（4/4 EXISTS） |
| アンカー見出しの実在（CORE/PHASES/.agents-project ×2/RULES） | `grep -n` | OK（全一致） |
| CORE→PHASES, CORE→.agents-project の相対リンク解決 | `cd .agents/boot && test -e` | OK |
| PHASES→CORE, PHASES→.agents-project の相対リンク解決 | `cd .agents/workflow && test -e` | OK |
| .agents-project→CORE/PHASES/RULES の相対リンク解決 | `cd .agents-project && test -e` | OK |
| RULES→.agents-project の相対リンク解決 | `cd .agents && test -e` | OK |

---

## 4. コードレビュー

### 4.1 コード品質

- **リント結果**: 対象外（Markdown のみ）
- **フォーマット**: 問題なし（既存節と同一の見出し階層・箇条書きスタイル）
- **型チェック**: 対象外

### 4.2 観点別確認（契約要件 (a)〜(f)）

| 観点 | 確認内容 | 結果 | コメント（evidence_source） |
| ---- | -------- | ---- | --------------------------- |
| (a) 1ファイル1責務・重複記載禁止 | close ルールの本文トリガー・完了定義が PHASES 1 か所に集約され、CORE は宣言のみ、.agents-project は配置先のみ上書き。RULES のテスト隔離は汎用要約・.agents-project は固有運用で役割分割 | OK | existing_code: CORE 145–146 §境界の「重複記載禁止」と整合。各節が相互参照で接続 |
| (b) ルール1 トリガー条件のユーザー原文一致 | 「トップレベル完了時のみ／サブ完了だけでは移動しない／サブ全完了かつ親完了判断時に移動」が CORE・PHASES・.agents-project の三所で一致 | OK | existing_code: CORE 137–138、PHASES 71、.agents-project 28。原文と語義一致 |
| (c) 完了判定の verify-and-close DoD 接続 | PHASES の「完了の定義（接続）」が「レビューフェーズ（verify-and-close）完了＝04_review.md 作成＋write-workflow-log 書記記録、本表レビュー DoD」を明示参照 | OK | existing_code: PHASES 72。表「レビュー」DoD（16 行）と整合 |
| (d) 配置先の整合 | 一般 `close/`（消費者 `.workflow/close/<issue>/`）／自己拡張 `docs/maintainer/workflow/close/<issue>/` が PHASES と .agents-project で一致 | OK | existing_code: PHASES 74–75、.agents-project 26 |
| (e) ルール2 の tmp 隔離・非破壊・片付け明記 | `mktemp -d` 隔離／いきなり自己インストール・本番実行しない／本リポ `.agents/.claude/.cursor/.workflow/workflow.db` 非破壊／検証後 `rm -rf` で片付け を明記 | OK | existing_code: .agents-project 33–36、RULES 45 |
| (f) 相互参照リンク/アンカーの実在 | 全リンク先ファイル・アンカー見出しが解決 | OK | existing_code: §3.2 の `test -e`/`grep` 結果（全 OK） |

### 4.3 指摘事項

#### 指摘 1: 既存ルールとの矛盾チェック

- **重要度**: 低（矛盾なし）
- **指摘内容**: PHASES 完了定義・verify-and-close 必須・memo/書記運用と矛盾しないか確認した。close の「完了」は既存のレビュー DoD（04_review＋書記）へ接続する形でのみ定義され、新規の完了概念を作っていない。`git show HEAD` で旧 CORE/PHASES に `close 移動` ルールは存在せず（CORE@HEAD の唯一の "close" 一致は command 名 verify-and-close）、純粋な新規追加で重複・矛盾なし。
- **対応状況**: 対応不要（矛盾なし）

#### 指摘 2: 04 テンプレートのリンク深度

- **重要度**: 低（本 04 で是正済み）
- **指摘内容**: テンプレート（.workflow/templates/04_review.md）は `../../.agents/...` を前提とするが、本 issue は `docs/maintainer/workflow/<issue>/` 配下で深さが 2 段深い。本 04 では 00_要求定義.md と同じく `../../../../.agents/...` に補正して記載した。
- **対応状況**: 完了

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（既存） | auditor | 2026-06-14 |

01/02/03 は本 issue では作成されていない（standard モード相当・ドキュメント正本への小～中規模追記。00 §4.3 で「本 implement-feature 内で完結」と明記）。

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合（00 の成功基準3項目＝ルール1明文化・ルール2明文化・相互参照実在 をすべて満たす）
- **要件と実装の整合性**: 整合（00 §2.2 の責務分割＝宣言CORE・詳細PHASES・固有.agents-project と一致）

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本変更はフレームワーク正本（.agents/.agents-project）のルール明文化であり、システム仕様書（docs/ 配下のシステム理解・画面・データ等）の内容に影響しないため。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: 準拠。1 ファイル 1 責務・正本 1 か所・参照は 1 行（RULES.md §ドキュメント）に沿う。close ルールの本文を PHASES 1 か所へ集約し、他は宣言/上書き/参照に限定。
- **ディレクトリ構成**: 妥当。CORE=絶対制約の宣言、PHASES=フェーズ/ライフサイクル詳細、.agents-project=本リポ固有上書き、RULES=実行要約、という既存の責務境界に沿って配置。
- **命名規則**: 妥当。節見出しは既存節（例 §レビュー成果物の配置ルール）と同一スタイル。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。close ルールは「宣言（CORE）→詳細（PHASES）→固有配置先（.agents-project）」の単方向参照。tmp 隔離は「主（.agents-project）↔ 汎用要約（RULES）」の相互参照。循環的な本文重複なし。
- **依存関係**: .agents-project が .agents を参照（最優先側→標準側）する向きは CORE §ルールの優先順位（.agents-project 最優先）と整合。意図しない依存・循環なし。
- **指摘・推奨**: なし（軽微な改善余地として、将来 close を実行する際は enforcement での自動検証追加が望ましいが本 issue スコープ外）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| トリガー条件がユーザー原文に一致 | existing_code | CORE 137–138 / PHASES 71 / .agents-project 28 を `grep`・読込で確認 |
| 完了定義が verify-and-close DoD に接続 | existing_code | PHASES 72 とフェーズ表「レビュー」DoD（16 行） |
| 重複記載なし・既存 close ルール不在 | existing_code | `git show HEAD:` で旧 CORE/PHASES に close 移動ルールなしを確認 |
| 相互参照リンク・アンカー実在 | test_output | `test -e`/`grep -n` の実行結果（§3.2 全 OK） |
| 配置先の整合 | existing_code | PHASES 74–75 と .agents-project 26 |

inference_only 単独依存の重要判断は無い（すべて existing_code または test_output で裏付け）。

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1**: 書記台帳の prev_hash 自動連結が未実装（write-workflow-log.sh が DB head を自動連結しない）。
  - **影響範囲**: 本記録の因果チェーン（prev_hash）が途切れうる。
  - **対応方法**: 別 issue `20260614_184756_台帳prev_hash自動連結` で是正予定。本 issue では現状ツールの素の挙動のまま記録する（タスク指示どおり）。

### 10.2 改善提案

- **改善 1**: close 実行（実移動）時の enforcement 自動検証の追加。
  - **効果**: トリガー条件違反（サブ単独完了での誤移動等）の物理的防止。本 issue スコープ外。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（要件 (a)〜(f) をすべて満たす）
- **テスト品質**: 対象外（コード成果物なし。リンク/アンカー実在を test_output で代替検証）
- **ドキュメント品質**: 良好（責務分割・相互参照整合・原文一致）
- **総合評価**: 承認可（ブロッカーなし）

### 12.2 承認状況

- **レビュー承認者**: auditor/scribe サブエージェント
- **承認日**: 2026-06-14
- **承認コメント**: 2 ルールが正本へ重複なく明文化され、トリガー条件はユーザー原文と一致、完了判定は verify-and-close DoD に接続、配置先整合、相互参照実在を確認。承認可。残課題（prev_hash 連結）は別 issue で是正予定。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md)
- [.agents/boot/CORE.md](../../../../../.agents/boot/CORE.md)
- [.agents/workflow/PHASES.md](../../../../../.agents/workflow/PHASES.md)
- [.agents-project/自己拡張ワークフロー.md](../../../../../.agents-project/自己拡張ワークフロー.md)
- [.agents/RULES.md](../../../../../.agents/RULES.md)

---

## 15. 次のステップ

本レビュー承認後、orchestrator が commit/push を実施する。完了確認後は本 issue（トップレベル・サブ issue なし）が PHASES §完了 issue の close 移動の完了条件を満たすため、`docs/maintainer/workflow/close/<issue>/` への移動候補となる（移動は orchestrator 判断）。
