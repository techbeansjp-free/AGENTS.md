---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "f860d651-37ef-49cb-adca-5019b8fe795e"
---

# レビュー書: 上流フェーズ（要件定義・設計）でのフィジビリティ確認・ADR 的根拠記録の必須化

**プロジェクト名**: フィジビリティ・ADR 必須化（上流フェーズの根拠記録の process 化）
**作成日**: 2026 年 07 月 11 日
**最終更新**: 2026 年 07 月 11 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
>
> **必須**: 本レビューは [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md) を参照して実施した。レビュー深度は **standard**（ドキュメント・ポリシー変更・新設1ファイル＋既存4ファイル追記の中規模。実行コードを持たず静的検証中心）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認および品質保証。上流フェーズの根拠記録 process 化（`EVIDENCE_POLICY.md` 新設＋既存4ファイルへの参照接続）が、01 の受け入れ基準（AC-1〜AC-11）・00 の成功基準（SC-1〜SC-7）を独立検証で満たしているかを確認し、close 相当の完了可否を判定する。

### 1.2 レビュー対象（必須）

- **実装範囲**: 03_実装計画のタスク1〜6。① `EVIDENCE_POLICY.md`（新設正本・5節）、② `commands/requirement-discovery.md` への参照接続、③ `commands/design-feature.md` への参照接続、④ `boot/LOAD_POLICY.md` トリガー行追加、⑤ `.agent-skill-chain/runtime/templates/02_設計.md` への「横断設計判断（ADR）」節追加、⑥ 静的検証。
- **レビュー期間**: 2026-07-11 ～ 2026-07-11
- **レビュー担当者**: verify-and-close ワーカー（監査・書記）

### 1.3 実施した検証（skill chain）

verify-and-close の skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）を順に実行した。テストは実行コードを持たないため静的検証（grep・存在確認・realpath リンク解決・git diff）で行い、実装担当の自己申告に依存せず本レビューで独立に再実行した。

---

## 2. 実装内容の確認（review-code）

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| タスク1 | `EVIDENCE_POLICY.md`（5節・新設正本）作成 | 2026-07-11 | implement-feature | 完了 |
| タスク2 | `requirement-discovery.md` §実行時の注意 に参照接続（:75） | 2026-07-11 | implement-feature | 完了 |
| タスク3 | `design-feature.md` §実行時の注意 に参照接続（:71） | 2026-07-11 | implement-feature | 完了 |
| タスク4 | `LOAD_POLICY.md` トリガー表に結線行追加（:31） | 2026-07-11 | implement-feature | 完了 |
| タスク5 | `templates/02_設計.md` に §2.5 横断設計判断（ADR）節追加（:116-） | 2026-07-11 | implement-feature | 完了 |
| タスク6 | 静的検証（grep/存在/リンク/git diff） | 2026-07-11 | implement-feature | 完了 |

### 2.2 実装内容の詳細（独立再検証の結果）

#### タスク1: `EVIDENCE_POLICY.md`（新設正本）

- **変更ファイル**: `.agent-skill-chain/source/EVIDENCE_POLICY.md`（新規・未追跡）
- **確認**: 節1（上流フェーズの義務）／節2（ADR 記録形式）／節3（重要判断の定義＋規模比例の軽量パス）／節4（inference_only の執筆時顕在化）／節5（greenfield 土台決定の ADR 対象化・docs/spec 役割分担）の5節を確認。5キーワード（フィジビリティ3件／ADR 7件／重要判断11件／inference_only 7件／greenfield 5件）が各1件以上ヒット。
- **SC-3 の要点**: 本ファイルに evidence_source の6分類定義表（`| human_decision |` 相当）は **存在しない**（grep 件数 0）。CONCEPTS.md §外部根拠の必須化 への参照が4件存在。正本の複製なし。

#### タスク2: `requirement-discovery.md` への参照接続

- **変更ファイル**: `.agent-skill-chain/source/commands/requirement-discovery.md`（:75）
- **確認**: `grep -n "evidence_source"` が1件ヒット（AC-1/SC-1 充足）。追記行は `重要判断については [EVIDENCE_POLICY.md](../EVIDENCE_POLICY.md) に従い…evidence_source を付記すること（軽量 issue の軽量パスは EVIDENCE_POLICY.md 参照）` の参照表現（`EVIDENCE_POLICY.md` を参照）で、分類定義の複製なし。

#### タスク3: `design-feature.md` への参照接続

- **変更ファイル**: `.agent-skill-chain/source/commands/design-feature.md`（:71）
- **確認**: `grep -n "evidence_source"` が1件ヒット（AC-2/SC-2 充足）。追記行に `EVIDENCE_POLICY.md` の ADR 形式参照・`greenfield` の土台決定（アーキテクチャ/コーディング規約/ディレクトリ構成）を重要判断に含む旨を確認（AC-10 接続）。

#### タスク4: `LOAD_POLICY.md` トリガー行追加

- **変更ファイル**: `.agent-skill-chain/source/boot/LOAD_POLICY.md`（:31）
- **確認**: トリガー表内に「上流フェーズでの根拠記録・フィジビリティ確認・ADR 記録時 → EVIDENCE_POLICY.md（重要判断・規模比例・inference_only 顕在化）」の1行がテーブル形式で追加され、既存行を破壊していない。「トリガー→読むファイル」正本の一元性を維持。

#### タスク5: `templates/02_設計.md` への ADR 節追加

- **変更ファイル**: `.agent-skill-chain/runtime/templates/02_設計.md`（:116-）
- **確認**: §2.4 データフローの後に §2.5「横断設計判断（ADR）」を新設。`EVIDENCE_POLICY.md` の ADR 形式（コンテキスト・検討した選択肢・決定・根拠[evidence_source 付き]・帰結）を参照し、`#### ADR-{連番}: {判断のタイトル}` の記入枠を提供。既存 §1〜§12 のトップレベル見出しは12件すべて保持され連番破損なし。テンプレートの `document_id`（`00000000-...`）は無変更。分類定義の複製なし（CONCEPTS.md 参照のみ）。

### 2.3 コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 接続行が「参照1行」に限定され、正本1ファイルへ結線されているか | OK | grep 可能な明示的参照。訓示のみの抽象記述ではない |
| 保守性 | 1ファイル1責務・重複禁止。evidence_source 分類の正本一元化 | OK | 分類表は CONCEPTS.md のみ（SC-3 で0件確認） |
| 互換性 | 既存 command / skill chain の順序・DoD・enforcement を破壊しないか | OK | 追記は「実行時の注意」「トリガー表」「§2 配下の新節」への末尾追加に限定 |
| セキュリティ | 高リスク操作の事前確認ルールを緩和していないか | OK | EVIDENCE_POLICY.md 節1で不緩和を明記 |

---

## 3. テスト結果の確認（静的検証の再実行）

本 issue はドキュメント・ポリシー変更のため実行コードの単体テストは該当なし。02_設計 §6.1 の割当表に従い、静的検証（grep・存在確認・realpath リンク解決・git diff）を **本レビューで独立に再実行**した。

### 3.1 静的検証（単体相当）

- **実行日**: 2026-07-11
- **検証ケース数**: 18（AC-1〜AC-11 の11件 ＋ SC-1〜SC-7 の7件。§4 に対応表）
- **成功（期待どおり）**: 18
- **失敗（FAIL）**: 0
- **スキップ**: 0（本 issue スコープ外の既知問題は §10.1 に別記）

### 3.2 リンク解決

- 変更・新設した `source/` 配下4ファイル（EVIDENCE_POLICY.md / requirement-discovery.md / design-feature.md / LOAD_POLICY.md）の markdown リンクを realpath で解決 → **未解決0件**。
- テンプレート `templates/02_設計.md` は、テンプレート実在地点から見ると相対深度不整合が15件検出された（新設 ADR 節の2件を含む）。ただしこれは本 issue 導入の欠陥ではなく **Story8 の `.agents/` → `.agent-skill-chain/source/` 改名に起因する既存テンプレート全体の問題**であり、本 issue のスコープ外（詳細・根拠は §10.1）。

### 3.3 テストコード化の網羅（監査観点）

01 の全 BDD シナリオ（ユースケース1〜4）は静的検証（grep/存在/リンク）でテストコード化されており、03_実装計画 §2.x.4 に BDD インライン（Given/When/Then）付きのシェル検証が記載されている。実行系 E2E は本 issue に存在せず、未達理由（実行コードなし・静的検証で代替）が 02 §6.1・03 §2.x.3 に明記されている。網羅は妥当。

---

## 4. 受け入れ基準・成功基準の確認（generate-scenarios / map-coverage）

**独立再検証**: 各項目を実装担当の報告に依らず本レビューで grep / 存在確認 / git diff により再実行した。結果はすべて期待どおり（FAIL 0件）。

### 4.1 成功基準（00 §6）

| 項目 | 内容（要約） | 検証方法 | 結果 |
| ---- | ------------ | -------- | ---- |
| SC-1 | requirement-discovery に evidence_source 記録義務 | `grep -n evidence_source requirement-discovery.md` → :75（1件） | OK |
| SC-2 | design-feature に同義務 | `grep -n evidence_source design-feature.md` → :71（1件） | OK |
| SC-3 | 分類定義正本が CONCEPTS.md の1か所のまま | `grep -rl '\| human_decision \|' source/` → CONCEPTS.md のみ（他0件） | OK |
| SC-4 | ADR 形式正本化＋02設計との接続 | EVIDENCE_POLICY.md §節2 に形式定義、templates/02 §2.5 が参照 | OK |
| SC-5 | 規模比例の適用基準（重要判断定義・軽量パス） | EVIDENCE_POLICY.md §節3、CONTEXT_EFFICIENCY.md へ相互参照 | OK |
| SC-6 | inference_only のみの重要判断を「要人間確認」明示 | EVIDENCE_POLICY.md §節4（CONCEPTS.md 参照・再定義なし） | OK |
| SC-7 | greenfield 土台決定を ADR 対象・02設計に明記 | EVIDENCE_POLICY.md §節5、design-feature :71、templates/02 §2.5 | OK |

### 4.2 受け入れ基準（01 §2.1）

| 項目 | 内容（要約） | 検証方法 | 結果 |
| ---- | ------------ | -------- | ---- |
| AC-1 | requirement-discovery に 00/01 執筆時の義務明記 | grep（SC-1 と同一）→ :75 | OK |
| AC-2 | design-feature に 02/03 執筆時の義務明記 | grep（SC-2 と同一）→ :71 | OK |
| AC-3 | 接続方式を 02 で確定し ADR 形式で記録 | 02_設計 §2.5 ADR-1（新設ポリシー正本＋参照追記のハイブリッド採用）が ADR 形式で記録済み | OK |
| AC-4 | ADR 形式が source/ 1か所に正本化・テンプレ/command から参照接続 | EVIDENCE_POLICY.md §節2 正本、templates/02 §2.5 が参照 | OK |
| AC-5 | 6分類定義正本が CONCEPTS.md の1か所（重複なし） | SC-3 と同一（他ファイル0件） | OK |
| AC-6 | inference_only のみの重要判断は「要人間確認」明示（CONCEPTS 参照で足りる） | EVIDENCE_POLICY.md §節4 | OK |
| AC-7 | verify-and-close の既存事後検証は無変更・process/event 役割分担が読み取れる | 作業ツリー変更に verify-and-close.md 非該当（§4.3）。EVIDENCE_POLICY.md §節4 に process/event 分担明記 | OK |
| AC-8 | 義務適用が「重要判断を含む場合」に限定・軽量パス定義 | EVIDENCE_POLICY.md §節3 | OK |
| AC-9 | 適用基準が CONTEXT_EFFICIENCY §適用のスケーリング と矛盾しない | EVIDENCE_POLICY.md §節3 が同ファイルへ相互参照 | OK |
| AC-10 | アーキテクチャ・規約・ディレクトリ構成決定が「重要判断」の代表例として接続先に明記 | design-feature :71、EVIDENCE_POLICY.md §節5、templates/02 §2.5 | OK |
| AC-11 | spec を上書きせず docs 側に位置づける旨を明記 | EVIDENCE_POLICY.md §節5（spec/00_spec概要 §spec と docs の違い 参照） | OK |

### 4.3 AC-7（verify-and-close 無変更）の詳細確認

- **作業ツリー**: `git status --short` に `commands/verify-and-close.md` は **含まれない**（本 issue の未コミット変更＝EVIDENCE_POLICY.md 新設＋4ファイル追記＋issueドキュメントのみ）。
- **main 比較の注意**: `git diff --name-only main` には verify-and-close.md が現れるが、これは本 issue の実装ではなく、同一ブランチ上の **Story8 コミット c2b703d**（ディレクトリ名前空間統合ネスト）に由来する無関係の変更である。本 issue が verify-and-close.md を変更していないことは確定。AC-7 充足。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（要求確定） | verify-and-close | 2026-07-11 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（AC-1〜AC-11・ユースケース1〜4） | verify-and-close | 2026-07-11 |
| [`02_設計.md`](./02_設計.md) | 更新済み（ADR-1〜ADR-5・§6 テスト割当） | verify-and-close | 2026-07-11 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（タスク1〜6・BDD） | verify-and-close | 2026-07-11 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（02 §2.1.1 の責務一覧＝新設1＋追記4ファイルと、実際の差分ファイルが一致）。
- **要件と実装の整合性**: 整合している（AC/SC 全18項目が実装で満たされ、§4 で再検証済み）。
- **コメント**: 02_設計 §2.5 自体が本 issue の ADR 形式の自己適用例となっており、正本化した形式が実践されている点は良好。

---

## 6. パフォーマンス確認

- **該当なし**（ドキュメント・ポリシー変更）。規模比例（AC-8/AC-9・EVIDENCE_POLICY.md §節3）により、義務化のコンテキスト・調査コスト増を「重要判断を含む issue」に限定し軽量 issue の起票所要を悪化させない設計であることを確認。

---

## 7. セキュリティ確認

| 項目 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 高リスク操作 | 一次情報調査を口実とした外部書込・大量削除の事前確認省略を許していないか | OK | EVIDENCE_POLICY.md 節1で既存ルール（CORE/RULES/enforcement）不緩和を明記 |
| データ保護 | 外部アクセス（WebFetch 等）時も既存ルールを変更・緩和しないか | OK | 節1/節4 に不変を明記 |

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本 issue の変更対象は `.agent-skill-chain/source/`（パッケージ実行契約）および `.agent-skill-chain/runtime/templates/` であり、`docs/`（システム仕様書）の記載内容に影響しないため。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: OK。02_設計 §1.2 が spec/01_設計原則 の「単一責務」「明確な境界」「AIフレンドリー設計（小さなファイル・grep 可能な参照1行）」「KISS/YAGNI（enforcement 自動検査は新設しない）」に沿っている。新設 `EVIDENCE_POLICY.md` は上流フェーズの根拠記録という**新しい関心事**のみに責務を限定しており、既存 shared の肥大化を招いていない。
- **ディレクトリ構成**: OK。正本を `.agent-skill-chain/source/` 直下に置き、テンプレートは `.agent-skill-chain/runtime/templates/` に置く既存の名前空間分離（自己拡張ワークフロー.md）に整合。
- **命名規則**: OK。`EVIDENCE_POLICY.md` は既存ポリシーファイル群（`CONTEXT_EFFICIENCY.md`・`DOCS_RULES.md` 等）の大文字スネーク命名と一致。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。「分類定義（CONCEPTS.md）／process の義務・ADR 形式（EVIDENCE_POLICY.md）／event の事後検証（verify-and-close.md）」の三分が保たれ、責務の重なりがない。
- **依存関係**: 意図しない依存・循環なし。参照はすべて一方向（上流 command・LOAD_POLICY・テンプレート → EVIDENCE_POLICY.md → CONCEPTS.md）。CONCEPTS.md は EVIDENCE_POLICY.md を参照し返さない（02 §2.1.3 の記載どおりを grep で確認）。
- **指摘・推奨**: 設計・境界について新規指摘なし。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考（参照元） |
| -------- | --------------- | -------------- |
| AC/SC 全18項目の充足判定 | test_output | 本レビューで grep/存在確認/realpath/git diff を再実行した出力に基づく（§3・§4） |
| SC-3 分類定義の非重複 | test_output / existing_code | `grep -rl '\| human_decision \|' source/` が CONCEPTS.md のみを返した実測 |
| AC-7 verify-and-close 無変更 | observed_runtime | `git status --short`・`git log -- verify-and-close.md`（Story8 c2b703d 由来）の実測 |
| テンプレート相対リンク不整合が既存問題である判定 | existing_code | `git show HEAD:templates/02_設計.md` で改名済み9リンクが既存であることを確認（§10.1） |
| close 相当の完了可否 | human_decision / test_output | 上記実測に基づく総合判断（§12） |

本レビューの重要結論はいずれも一次情報（test_output / existing_code / observed_runtime）に基づいており、inference_only のみに依存する承認不可の判断は含まない。

---

## 10. 課題と改善点

### 10.1 発見された課題（本 issue 範囲外・既知の問題として記録）

- **課題1（既知・本 issue スコープ外）: テンプレート `02_設計.md` の相対リンク階層不整合**
  - **内容**: `.agent-skill-chain/runtime/templates/02_設計.md` 内の `../../.agent-skill-chain/source/...`（2階層上）リンクは、テンプレートの実在地点（リポジトリルートから3階層下）から realpath 解決すると未解決になる。正しい深さは `../../../`（3階層上）で、これなら実在ファイルに解決することを本レビューで確認した。検出総数15件。
  - **本 issue との関係（重要）**: この不整合は本 issue の導入欠陥ではない。`git show HEAD:.agent-skill-chain/runtime/templates/02_設計.md` の時点で既に `../../.agent-skill-chain/source/` 形式のリンクが **9件存在**しており、これは **Story8（commit c2b703d）の `.agents/` → `.agent-skill-chain/source/` 改名**時に、パス文字列は機械置換されたが相対深度プレフィックス（`../../`）が当時の構造のまま残ったことに由来するテンプレート全体の既存問題である。
  - **本 issue の新設 ADR 節の扱い（妥当）**: タスク5 が追加した §2.5 の2リンク（EVIDENCE_POLICY.md・CONCEPTS.md）も同じ `../../.agent-skill-chain/source/` 形式を用いている。これは 03_実装計画 §2.5.2 の指示（既存テンプレート慣行に合わせる）どおりであり、**新たな不整合を持ち込んだのではなく、既存の（不整合な）慣行に一貫して従った**ものである。単独で深度を直すと、テンプレート内で新設2リンクだけが他9リンクと異なる深さになり不整合が拡大するため、本 issue 単独での是正はむしろ不適切。
  - **影響範囲**: テンプレート `02_設計.md` 全体（本文リンク＋新設 ADR 節リンク）。消費者ランタイム／自己拡張ランタイムのいずれで配置されるかにより正しい深さは変わり得るため、テンプレート相対リンクの深さ規約そのものの見直しが必要。
  - **対応方法（本 issue では是正しない）**: テンプレート全体の相対リンク深度を一括是正する独立 issue（または Story8 追補）での対応を推奨する。本 issue のスコープ（evidence_source/ADR の command 接続）とは目的・成果物系統が異なるため、ここでは是正せず既知の問題として記録するに留める。
  - **重要度**: 中（テンプレートは記入枠であり、消費者が実際に 02 を執筆する際は自身の配置基準でリンクを書き直すため即時の機能障害は限定的。ただし放置は追随性・可読性を損なう）。

### 10.2 改善提案

- **改善1**: 上記テンプレート相対リンク深度の是正 issue を起票し、Story8 改名の残課題として一括処理する。
  - **効果**: テンプレート由来リンクの realpath 解決が全件成立し、自己拡張ワークフローの close 時リンク補正（自己拡張ワークフロー.md §close 移動時の相対リンク補正）とも整合する。

---

## 11. システム仕様書の更新

### 11.1 確認結果

- 本 issue は `docs/`（システム仕様書）の記載内容に影響しない（変更対象はパッケージ実行契約 `.agent-skill-chain/source/` とテンプレート）。したがってシステム仕様書の加筆修正は不要。`docs/00_review/` への追加記載も不要。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好。新設1ファイル＋既存4ファイル追記が設計（02 ADR-1）どおりに実装され、正本一元化・参照結線・分類非重複が保たれている。
- **テスト品質**: 良好（静的検証）。AC/SC 全18項目を本レビューで独立再実行し FAIL 0件。BDD インライン付きの検証手順が 03 に記載済み。
- **ドキュメント品質**: 良好。00〜03 と実装が整合し、02 §2.5 が正本化した ADR 形式の自己適用例になっている。
- **総合評価**: **合格（close 相当と判断してよい）**。本 issue スコープ内の指摘は **0件**。§10.1 の1件はスコープ外の既知問題（Story8 由来）として記録し、別 issue での是正を推奨する（本 issue の完了を妨げない）。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close ワーカー（監査）
- **承認日**: 2026-07-11
- **承認コメント**: AC-1〜AC-11・SC-1〜SC-7 の全18項目を独立検証で充足確認。verify-and-close.md 無変更（AC-7）・分類非重複（SC-3）も再確認。本サブ issue はレビューフェーズ完了（04_review 作成＋書記記録）をもって完了と判断してよい。ただし親トップレベル issue（agentsOS 汎用化・ポリシー統合）の close 移動は、姉妹サブ issue 含む全サブ issue の完了と親完了判断を待って別途行う（本レビューの範囲外）。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- [.agent-skill-chain/source/EVIDENCE_POLICY.md](../../../../../../.agent-skill-chain/source/EVIDENCE_POLICY.md) - 本 issue の新設正本
- [.agent-skill-chain/source/CONCEPTS.md §外部根拠の必須化](../../../../../../.agent-skill-chain/source/CONCEPTS.md#外部根拠の必須化external-anchor) - evidence_source 分類の正本
- [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md)・[.agent-skill-chain/source/workflow/PHASES.md](../../../../../../.agent-skill-chain/source/workflow/PHASES.md) - 監査観点

---

## 14. 前のステップ

このレビュー書は、以下のドキュメントを基に作成されています：

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本サブ issue はレビュー完了（04_review 作成＋書記記録）により完了とみなしてよい。
- close 移動（`docs/maintainer/workflow/close/`）はトップレベル親 issue 完了時にのみ行うため、本サブ issue 単独では移動しない（PHASES §完了 issue の close 移動）。
- §10.1 の既知問題（テンプレート相対リンク深度）の是正は別 issue で対応することを推奨する。
