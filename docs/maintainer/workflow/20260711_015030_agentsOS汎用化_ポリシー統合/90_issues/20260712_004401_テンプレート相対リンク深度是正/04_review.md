---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "f15890b2-10df-4ec1-9af4-4933da06e68d"
---

# レビュー書: テンプレート群のクロス参照相対リンク深度是正

**プロジェクト名**: テンプレート相対リンク深度是正
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
>
> **必須**: **レビュー実施時は、[`.agent-skill-chain/source/REVIEW_RULE.md`](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md) を必ず参照してください。** 本レビュー深度は **standard**（変更 15 ファイル・41 行、機械検証で確定可能な範囲）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

`.agent-skill-chain/runtime/templates/` 配下 15 ファイルの genuine 深度不整合 54 件の是正が、02_設計.md のグループ別補正ルール（A〜D）どおりに適用され、機械検証（grep + realpath）で「genuine unresolved 0 件・placeholder 18 件不変・本文不変」を満たすことを、実装担当と独立した fresh reviewer が再実測で検証し、close 可否を判定する。

### 1.2 レビュー対象（必須）

- **実装範囲**: 02_設計 §3.2 グループ A（templates 直下 source/ 参照 33 件・一律 +1）・B（`agents/` 配下 source/ 参照 13 件・一律 +1）・C（`docs/` 配下 7 件・リンク先実体基準で個別是正）・D（`00_要求定義.md:182` の参照方向修正 1 件）の計 54 件の相対リンク深度是正。
- **レビュー期間**: 2026-07-12 ～ 2026-07-12
- **レビュー担当者**: fresh reviewer（実装担当・過去レビュー担当のいずれとも別インスタンス。監査ティア opus）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| --- | --- | --- | --- | --- |
| T1 グループA（33件） | templates 直下 9 ファイルの source/ 参照を `../../`→`../../../` に是正 | 2026-07-12 | 実装担当 | 完了 |
| T2 グループB（13件） | `agents/scribe_claude.md`(9)・`scribe_cursor.md`(4) の source/ 参照を `../../../`→`../../../../` に是正 | 2026-07-12 | 実装担当 | 完了 |
| T3 グループC（7件） | `docs/` 配下 4 README の DOCS_RULES 参照を深く、MERMAID 参照を浅く、実体基準で個別是正 | 2026-07-12 | 実装担当 | 完了 |
| T4 グループD（1件） | `00_要求定義.md:182` の `../00_システム理解.md`→`./00_システム理解.md`（方向修正） | 2026-07-12 | 実装担当 | 完了 |
| T5 全体機械検証 | grep+realpath 再実行で genuine unresolved 0 件を確認 | 2026-07-12 | 実装担当 | 完了 |
| T6 恒久テスト化 要否判断 | `test/` 追加は本 issue では起票・実装せず提案のみ | 2026-07-12 | 実装担当 | 完了（提案のみ） |

### 2.2 実装内容の詳細（fresh reviewer 独立再検証）

#### 検証1: grep + realpath 全体再検査（実装担当の主張を独立再実行）

01 §2.2 / 02 §3.3 と同一パイプラインを reviewer 自身で再実行した結果:

- **抽出した相対リンク総数: 233 件**（変更なし）。
- **OK: 215 件**（変更前 161 → +54）。
- **BROKEN: 18 件**。
- **genuine unresolved: 0 件**。

変更前（git HEAD の templates を現リポ構造基準で解決）は **OK 161 / BROKEN 72** であり、BROKEN が 72→18 に減少（54 件解決）した。実装担当の報告値（OK +54・BROKEN=18・genuine=0）と完全一致。

#### 検証2: BROKEN 18 件 = placeholder 集合、かつ変更前と同一

変更後の BROKEN 18 件は、変更前 BROKEN 72 件の部分集合として**同一の file:line:link 文字列**で存在し（減っただけで新規発生・改変なし）、01 §5・02 §3.1 の placeholder 除外集合と完全一致した:

- `00_システム理解.md:33,34,35,192,285,286,287`（7）
- `90_issues.md:22,23`（2）
- `docs/04_機能設計/README.md:43`（1）
- `docs/04_機能設計/機能名/README.md:126,127`（2）
- `docs/99_ID命名規則と管理/README.md:51,52,58,59,65,66`（6）

合計 7+2+1+2+6 = **18 件**。placeholder は 1 件も実パス化されておらず、意図的未実在のまま。

#### 検証3: git diff がリンク深度トークン以外を改変していないこと

`git diff .agent-skill-chain/runtime/templates/` は 15 ファイル 41 insertions / 41 deletions（1:1 の行置換）。各変更行について、リンクトークン先頭の相対深度連続（`](../)+` / `](./)`）を単一マーカーに正規化したうえで HEAD と working を比較したところ、**全 15 ファイルで差分ゼロ**。すなわち本文・見出し・バッククォート内言及・placeholder・例示パスは一切改変されておらず、変更は `](` 直後のリンク深度トークンに厳密に限定されている（実装計画のバリデーション観点「本文中の `../` 言及を改変しない」を充足）。

- **変更ファイル**: `00_システム理解.md`・`00_要求定義.md`・`01_要件定義.md`・`02_設計.md`・`03_実装計画.md`・`04_review.md`・`05_最終確認チェックリスト.md`・`90_issues.md`・`99_PR.md`・`agents/scribe_claude.md`・`agents/scribe_cursor.md`・`docs/README.md`・`docs/01_システム概要/README.md`・`docs/02_画面設計/README.md`・`docs/03_データ設計/README.md`（すべて `.agent-skill-chain/runtime/templates/` 配下）。
- **確認事項**: グループC は一律置換でないため念入りに個別検証（§4.2 指摘なし・下記検証4）。

#### 検証4: グループC 7 件 + グループD 1 件の individual realpath 確認（reviewer が 1 件ずつ実行）

| file:line | 是正後リンク | realpath 解決先 | 判定 |
| --- | --- | --- | --- |
| `docs/README.md:7` | `../../../../.agent-skill-chain/source/DOCS_RULES.md` | `…/.agent-skill-chain/source/DOCS_RULES.md` | OK |
| `docs/01_システム概要/README.md:6` | `../../../../../.agent-skill-chain/source/DOCS_RULES.md` | 同上 | OK |
| `docs/01_システム概要/README.md:7` | `../../AGENTS_MERMAID_RULES.md` | `…/.agent-skill-chain/runtime/templates/AGENTS_MERMAID_RULES.md` | OK |
| `docs/02_画面設計/README.md:7` | `../../../../../.agent-skill-chain/source/DOCS_RULES.md` | `…/.agent-skill-chain/source/DOCS_RULES.md` | OK |
| `docs/02_画面設計/README.md:8` | `../../AGENTS_MERMAID_RULES.md` | `…/templates/AGENTS_MERMAID_RULES.md` | OK |
| `docs/03_データ設計/README.md:7` | `../../../../../.agent-skill-chain/source/DOCS_RULES.md` | `…/.agent-skill-chain/source/DOCS_RULES.md` | OK |
| `docs/03_データ設計/README.md:8` | `../../AGENTS_MERMAID_RULES.md` | `…/templates/AGENTS_MERMAID_RULES.md` | OK |
| `00_要求定義.md:182`（D） | `./00_システム理解.md` | `…/templates/00_システム理解.md` | OK |

- グループC は増減混在（DOCS_RULES 参照は深さ**不足**を補って深く＝`docs/README.md:7` は +2 / サブディレクトリ配下は +1、MERMAID 参照は深さ**過剰**を縮めて浅く＝-1）が正しく反映され、**一律 +1 になっていない**（過剰是正リスクの回避を実測確認）。MERMAID の解決先が `.agent-skill-chain/source/` ではなく `.agent-skill-chain/runtime/templates/AGENTS_MERMAID_RULES.md` 実体である点も ADR-1/ADR-2 の根拠どおり。
- グループD は深度増減でなく `../`→`./` の方向修正であり、同一ディレクトリ内 `00_システム理解.md` に正しく解決。

---

## 3. テスト結果の確認

本 issue の成果物はテンプレートの相対リンク文字列であり、テストコード（ソフトウェアテスト）を伴わない。「テスト」に相当するのは 02 §3.3 / 03 T5 の grep+realpath 機械検証パイプラインであり、reviewer が独立再実行した（§2.2 検証1〜4）。

### 3.1 機械検証（結合/E2E 相当）実行結果（必須: 数値で記載）

- **実行日**: 2026-07-12
- **検証対象リンク数**: 233
- **成功（OK）**: 215（変更前 161 → +54）
- **失敗（genuine unresolved）**: 0
- **意図的未実在（placeholder BROKEN・回帰対象）**: 18（変更前と同一集合・不変）

### 3.2 BDD シナリオ ↔ 実装のカバレッジ（map-coverage）

| BDD（03 タスク） | 受け入れ基準 | 検証方法 | 結果 |
| --- | --- | --- | --- |
| T1 グループA | 33 件が `../../../` で解決 | grep+realpath 全体再実行（BROKEN 72→18 の差分に包含） | OK |
| T2 グループB | 13 件が `../../../../` で解決 | 同上 | OK |
| T3 グループC | DOCS_RULES=実体基準で深く / MERMAID=`../../` で短縮、一律+1でない | 7 件を個別 realpath 確認（§2.2 検証4） | OK |
| T4 グループD | `./00_システム理解.md` に解決（方向修正） | 個別 realpath 確認（§2.2 検証4） | OK |
| T5 全体検証 | genuine unresolved=0・placeholder 18 不変・OK=215 | 全体再実行（§2.2 検証1・2・3） | OK |
| T6 恒久テスト化 | `test/` 未変更・提案のみ | `git status test/` 空・新規サブissueなし（§10.2） | OK |
| 01 AC-1〜AC-5 | 棚卸し実測値・genuine 明細・placeholder 明細・docs 二重コンテキスト・方針候補2案以上 | 00/01/02 記載を検証（要件・設計フェーズ成果、実装と整合） | OK |

未達・欠落なし。01 §2.2 の 3 シナリオ（シナリオ1→T5、シナリオ2→T1/T2/T4、シナリオ3→T3）すべてに実装タスクが対応。

---

## 4. コードレビュー

### 4.1 コード品質

- **リント/型チェック**: 該当なし（Markdown リンク文字列のみ）。
- **フォーマット**: 問題なし（正規化差分ゼロにより本文フォーマット不変を確認）。

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | 是正後リンクがリンク先正本へ到達する | OK | 233 件中 215 件 realpath 解決 |
| 保守性 | 再実行可能な検証コマンドが 02/03 に明文化 | OK | close 補正の先例と同一道具立て |
| 正確性 | グループC の増減混在が実体基準で正しい | OK | 一律+1でないことを個別確認 |
| 回帰安全性 | placeholder 18・既存 OK リンクを壊さない | OK | placeholder 不変・OK は単調増加 |

### 4.2 指摘事項

**指摘なし（0 件）。** 是正は設計・実装計画どおりで、機械検証・個別 realpath・diff 正規化のいずれも合格。過剰是正・本文改変・placeholder 誤是正のいずれも検出されなかった。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み | fresh reviewer | 2026-07-12 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | fresh reviewer | 2026-07-12 |
| [`02_設計.md`](./02_設計.md) | 更新済み | fresh reviewer | 2026-07-12 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | fresh reviewer | 2026-07-12 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（グループA〜D の対象 file:line・現状→是正後がすべて実装と一致）。
- **要件と実装の整合性**: 整合している（genuine 54・placeholder 18 の切り分けが不変集合として守られている）。
- **コメント**: 02/03 は本 issue の design-feature フェーズ成果物であり、まだ git 未追跡（`??`）。実装（templates 変更）とセットで 1 論理コミットに含める想定（§8）。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本変更は `.agent-skill-chain/runtime/templates/`（パッケージ配布物のテンプレート）内の相対リンク深度の是正のみであり、システム仕様書（`docs/` 直下の消費者向けシステム仕様書）の記述内容・仕様に影響しない。テンプレート自体の挙動・意味（参照先の識別）は不変で、DOCS_RULES.md §継続追随ゲートの対象となる「実装変更に伴う仕様の変化」に該当しない。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: 準拠。抽出（grep）→解決（realpath）→分類→補正→検証の UNIX パイプライン（spec/01 UNIX 哲学）を新規ツールなしで踏襲し、close 補正手順と同一道具立てを再利用（重複実装なし）。
- **ディレクトリ構成**: 変更は `.agent-skill-chain/runtime/templates/` 内に限定。境界（placeholder 除外・個別 issue 成果物除外・本文不変）を逸脱しない。
- **命名規則**: 該当なし（リンク文字列のみ）。

### 9.2 境界・依存の確認

- **責務の境界**: 保たれている。placeholder（18）・個別 issue 成果物・本文は一切変更されていない（§2.2 検証2・3 で実測）。
- **依存関係**: 循環なし。MERMAID 参照が `templates/` 直下実体・DOCS_RULES が `.agent-skill-chain/source/` 実体という物理位置差を ADR-1/ADR-2 の決定どおり個別に反映。
- **指摘・推奨**: なし。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| --- | --- | --- |
| genuine 54 件がすべて解決した | observed_runtime | reviewer が grep+realpath を独立再実行（BROKEN 72→18） |
| BROKEN 18 が placeholder と一致・変更前と同一集合 | observed_runtime / existing_code | HEAD 版 templates との file:line:link 突合 |
| diff がリンク深度トークンに限定 | observed_runtime | 正規化後 HEAD==working 差分ゼロ（全15ファイル） |
| グループC が実体基準で正しく増減 | observed_runtime | 7 件を個別 realpath 実行 |
| close 可 | observed_runtime | 上記すべて OK・指摘 0 件 |

inference_only のみに依存する重要判断はない（すべて機械実行結果に基づく）。

---

## 10. 課題と改善点

### 10.1 発見された課題

なし。

### 10.2 改善提案（T6・別issue候補・本issueでは起票しない）

- **改善 1（T6・提案のみ）**: `test/` 配下に「templates のクロス参照リンク健全性（genuine unresolved=0）」を assert する恒久回帰テストの追加。
  - **効果**: Story8 類似の一括改名時にテンプレートのリンク深度不整合を機械検知でき、再発を防止できる。
  - **扱い**: ADR-3（案X 採用・案Y は要否提示のみ）および 03 T6 に従い、**本 issue では test/ を変更せず起票もしない**。サブによる独断起票の禁止に従い、メイン（進行役）の承認判断に委ねる提案に留める。
  - **reviewer 確認**: `git status test/` は空（test/ 未変更）、親 `90_issues/` 配下に T6 相当の新規サブ issue ディレクトリは作成されていない。提案のみに留まっていることを実測確認済み。

---

## 11. システム仕様書の更新

- 本 issue は実装変更（テンプレートのリンク深度是正）を伴うが、§docs 更新のとおりシステム仕様書（`docs/`）の記述内容には影響しないため、継続追随ゲートは「更新不要」を根拠付きで判定（軽量パス）。指摘 0 件。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良（設計どおり・過剰是正なし・本文不変）。
- **検証品質**: 良（reviewer 独立再実行で全数一致、グループC は個別 realpath）。
- **ドキュメント品質**: 良（00〜03 と実装が整合）。
- **総合評価**: **合格（close 可）**。

### 12.2 承認状況

- **レビュー承認者**: fresh reviewer（opus・監査ティア）
- **承認日**: 2026-07-12
- **承認コメント**: genuine 深度不整合 54 件の是正は grep+realpath 再検査で genuine unresolved 0 件・OK 215 件・placeholder 18 件不変を満たし、diff はリンク深度トークンに厳密限定、グループC の個別是正も実体基準で正しい。指摘 0 件。T6 は提案のみで起票なし・test/ 未変更。**close を承認する**（実際の commit・close 移動はメインの判断による）。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義（棚卸し実測値・placeholder 列挙の正）
- [`02_設計.md`](./02_設計.md) - 設計（グループ別補正ルール・ADR）
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画（T1〜T6）
- [.agent-skill-chain/project/自己拡張ワークフロー.md §close 移動時の相対リンク補正](../../../../../../.agent-skill-chain/project/自己拡張ワークフロー.md#close-移動時の相対リンク補正) - 検証パイプラインの先例

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本レビュー合格により issue/タスク完了（close 可）。commit（1 サブ issue = 1 論理コミット・feature ブランチ・push はユーザー明示時のみ）はメインの判断で実施。
