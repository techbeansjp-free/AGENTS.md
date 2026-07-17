---
document_id: "3443589a-b767-43f5-a4e0-205c5460b6c2"
---

# レビュー書: CORE へのデザイナー視点（UX/プロダクトデザイン）の組込

**プロジェクト名**: CORE へのデザイナー視点（UX/プロダクトデザイン）の組込
**作成日**: 2026 年 07 月 17 日
**最終更新**: 2026 年 07 月 17 日

> **重要**: 本ドキュメントは verify-and-close（レビューフェーズ）の成果物。skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）を最後まで実行して作成した。
> **レビュー深度**: **full**（新規 skill domain 1 つ＋関連 command/テンプレート/索引/ゲートの一体改修＝新規・中〜大規模のため。RULES.md §実行モード）。
> **テストの性質**: 本件はコードを持たないフレームワーク定義（ドキュメント成果物・ワークフロー定義）の静的変更である。実行可能な単体テストは存在しない。したがって全観点は **静的レビュー（review-docs 相当のチェックリスト照合・実差分照合）で検証した**。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

implement-feature（T1-T6）で実装した 15 ファイル（新規 7・改修 8）が、03_実装計画のテスト観点（§2.x.3）・BDD（§2.x.4）・01 受け入れ基準を満たしているかを検証し、既存 chain・ゲート・テンプレートを破壊していないことを確認して、issue クローズ可否を判定する。

### 1.2 レビュー対象（必須）

- **実装範囲**: 新規 skill domain `experience`（frame/map/detail-experience の 3 フェーズ capability・7 ファイル）を design-feature chain 冒頭にトリガー条件付きで追加し、既存 review-docs ゲート・索引・テンプレートに相乗りさせるフレームワーク改修（改修 8 ファイル）。commit `27d1367`（T1）／`cade177`（T2-T5）／`0032ade`（T6）。
- **レビュー期間**: 2026-07-17 ～ 2026-07-17
- **レビュー担当者**: verify-and-close 委譲サブ（opus / レビュー役）

---

## 2. 実装内容の確認

（review-code の結果。実差分＝`git diff bab69a2..0032ade` を全 15 ファイルで照合した。）

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T1: experience 3 フェーズ capability 新規作成 | domain README ＋ frame/map/detail-experience（各 README/SKILL）計 7 ファイル | 2026-07-17 | implement-change | 完了 |
| T2: design-feature.md PROCESS 改修 | step0a/0b/0c 追加・委譲粒度分割規定・00 明示 no: 転記検証責務 | 2026-07-17 | implement-change | 完了 |
| T3: requirement-discovery.md 軽微改修 | 実行時の注意に experience_surface 記録 1 項 | 2026-07-17 | implement-change | 完了 |
| T4: 00 テンプレート改修 | frontmatter に experience_surface（任意・null） | 2026-07-17 | implement-change | 完了 |
| T5: 02 テンプレート §7 拡張 | §7 を UI/UX・体験設計へ拡張（7.0〜7.4）・旧 7.1/7.2 を 7.5/7.6 へ再配置 | 2026-07-17 | implement-change | 完了 |
| T6: review-docs＋索引整合 | review-docs.md／README.md／TEMPLATES.md／SKILL_MANDATORY.md 改修 | 2026-07-17 | implement-change | 完了 |

### 2.2 実装内容の詳細（規約遵守・テスト観点の充足）

- **1 ファイル 1 責務・最小 diff**: 改修 8 ファイルはいずれも既存記載を残したまま追記中心（`git diff --stat`: 450 insertions / 6 deletions のみ、削除は 02 テンプレートの §7 見出し・番号再配置に限る）。README/TEMPLATES/SKILL_MANDATORY はいずれも 1〜2 行の追記。META_LAYER Rule 3 遵守を確認。
- **IO_CONTRACT 6 見出し（新規 SKILL 猶予なし）**: frame/map/detail の 3 SKILL.md すべてに Purpose / Inputs / Process / Outputs / Done / Forbidden が揃っていることを実ファイルで確認（T1 §2.1.3 単体観点 ✓）。
- **フェーズ責務の非重複**: frame Forbidden=「IA/UXフロー/UI 具体化へ踏み込まない」、map Forbidden=「UI 具体化しない・責務境界を確定しない」、detail Forbidden=「責務境界を確定しない・特定技術スタックを固定しない」。frame=目的/ユーザー、map=IA/流れ、detail=UI/実装可能性 に分離されており相互侵食が Forbidden で機械的に排除されている（T1 バリデーション観点 ✓）。
- **既存 chain 不変（回帰）**: requirement-discovery PROCESS（extract-goals→identify-assumptions→define-constraints→write-bdd の 4 skill）は実ファイル grep で不変を確認。design-feature の既存 step1-3（define-boundaries／design-api-contract／review-dependencies）は順序・内容とも不変（0a/0b/0c を前段に挿入したのみ）。**run_command.md・CLOSEOUT.md は無変更**（`git diff` 空を確認＝02 M14 遵守）。
- **命名・配置**: domain 名 `experience`（「デザイン」を含まない）、capability 名 `frame-experience`/`map-experience`/`detail-experience`。既存 `skills/requirements/` の README＋SKILL 構成に準拠（T1 バリデーション ✓）。
- **証跡（CORE）**: implement-feature の 3 commit すべてに workflow.db 記録あり（entry_id `42a34a7b`/`5dc8dc54`/`f94fbfcb`）を確認。証跡省略なし。

### 2.3 二観点リスト（REVIEW_DUAL_LENS §3・実装内容）

**敵対的観点リスト（攻めた観点と結論）**:

1. 「0a/0b/0c を挿入したことで既存 step1-3 の番号・意味がずれていないか」→ 番号は 0a/0b/0c（新規）と 1-3（既存）で衝突せず、既存 3 step の記述は完全一致。**問題なし**。
2. 「detail-experience が特定技術（React/Figma・7 層）をコピペ固定していないか」→ SKILL/README とも技術非依存節を持ち、階層名は「相当（テンプレート相当・コンポーネント相当…）」の抽象語で記述。特定フレームワーク・ディレクトリ構成の固定なし。**問題なし**（ADR-8・リスク管理 §5.1 の丸写しリスクを回避できている）。
3. 「フェーズ間 OUT/IN 連鎖が矛盾しないか」→ frame OUT=§7.1 ⇒ map IN=§7.1・OUT=§7.2 ⇒ detail IN=§7.2・OUT=§7.3 ⇒ define-boundaries。連鎖は一貫。**問題なし**。
4. 「幻覚ペルソナ注意の記録先が SKILL とテンプレートで一致するか」→ **不一致を検出**（指摘 1・低）。frame SKILL/README は §7.1、02 テンプレートは §7.4（共通）。機能破壊はないが記録先が二重定義気味。
5. 「新規 skill が enforcement R1（PreToolUse）や audit の保護範囲に抵触しないか」→ 03 §2 注記・02 §9.2/A23 の「新規 skill は R1 保護範囲外・テンプレートは carve-out で編集可」の検証どおり、新規 audit は追加していない（ADR-4）。本 issue も Edit/Write で issue ドキュメントを編集できている。**問題なし**。

**must-preserve リスト（不変条件と保持の確認）**:

1. 既存 chain の順序・内容（requirement-discovery 4 skill／architecture 3 skill）— 実ファイルで不変を確認。**保持**。
2. run_command.md・CLOSEOUT.md の I/F（委譲手順の正本）— 無変更。**保持**。
3. 00/02 テンプレートの後方互換（既存項目・既存 §7 画面設計）— experience_surface は任意（null 既定）、画面遷移図/画面設計は §7.5/§7.6 として内容不変で温存。**保持**。
4. review-docs の完了定義（memo＋指摘収束＋書記委譲）— 追記は DUAL_LENS 観点への 1 サブ項目のみで完了定義を再定義せず。**保持**。
5. 既存 Mandatory 3 capability（SKILL_MANDATORY 設計行の define-boundaries 等）の記載 — 変更なし、条件付き 3 capability を末尾追記のみ。**保持**。

---

## 3. テスト結果の確認

### 3.1 単体テスト

**本件はコードを持たないフレームワーク定義（skill/command/テンプレート/索引の Markdown）の静的変更であり、実行可能な単体テストは存在しない。** したがって「テスト」は 03 §2.x.3 のドキュメント検証観点・§2.x.4 の BDD（Given/When/Then で表現した監査観点）であり、**静的レビュー（実差分照合・チェックリスト照合）で検証した**。再実行すべきテストコードは無いため「テスト未実行のまま監査完了」には該当しない（RULES.md §テスト再実行はコード成果物向けの規定）。

- 実行日: 2026-07-17（静的検証）
- テストファイル数: 0（コードなし）
- テストケース数: 0（BDD は静的検証観点・§4 で対応表化）
- 成功 / 失敗 / スキップ: 該当なし（0 / 0 / 0）

### 3.2 統合テスト / 3.3 E2E テスト

該当なし。消費者ランタイムでの実運用検証は本 issue のスコープ外（03 §2.1.3 E2E・実装後の実運用で担保）。フェーズ間 OUT/IN 連鎖の整合は §2.3 敵対的観点 3 で静的確認済み。

---

## 4. コードレビュー

### 4.1 コード品質

- リント/フォーマット/型チェック: 該当なし（Markdown 定義ファイル）。Markdown 構造（見出し階層・表・frontmatter）の整合を目視確認、破綻なし。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 3 SKILL の 6 見出し・観点シードが簡潔か | OK | チェックボックス化せずナラティブ観点シードで記述 |
| 保守性 | 判断基準優先順位を domain README に単一定義し二重定義していないか | OK | 設計判断・レビュー判断で同一 8 段リストを参照 |
| 最小 diff | 改修 8 ファイルが追記中心・既存不変か | OK | 450 挿入 / 6 削除、削除は §7 番号再配置のみ |
| 規約準拠 | run_command/CLOSEOUT 不変・chain 順序保持 | OK | 実 diff 空を確認 |

### 4.2 指摘事項

#### 指摘 1: 幻覚ペルソナ注意の記録先が SKILL と 02 テンプレートで不一致

- **重要度**: 低
- **指摘内容**: `frame-experience` の SKILL.md・README.md は「幻覚ペルソナ注意」を **§7.1 に**記録すると規定（SKILL Outputs/Done・README 手順 7）。一方 02 テンプレートは専用の **§7.4 幻覚ペルソナ注意（共通）** を設けている。設計者が frame SKILL に従うと §7.1 に書き、テンプレートに従うと §7.4 に書くため、記録先が二重化し混乱の余地がある。機能・トリガー・後方互換への影響は無い（純粋な記載位置の不整合）。
- **対応状況**: 未対応（指摘のみ・修正要否は進行役判断）
- **対応方法（案）**: いずれか片方に寄せる。(a) frame SKILL/README の Outputs/Done の「§7.1（…幻覚ペルソナ注意）」を「§7.4」に直す、または (b) 02 テンプレート §7.4 の共通注意はそのまま残しつつ frame SKILL 側を「§7.1 に前提、幻覚ペルソナ注意は §7.4（共通）へ」と明記する。02 §7.4 が「共通（§7.1〜§7.3 のペルソナに係る）」の位置づけである点を踏まえると (b) が自然。1 行修正で解消可能。

#### 指摘 2（軽微・情報）: map/detail の Done は「体験面=あり」のみ記載

- **重要度**: 低（設計意図どおり・要修正ではない可能性が高い）
- **指摘内容**: map-experience/detail-experience の SKILL.md Done は「体験面=あり の場合」のみを記す。これは frame-experience が「なし」を判定して後続をスキップする設計（frame が唯一のゲート）と整合しており欠陥ではない。ただし読み手が単体で map/detail SKILL を読んだ際に「なし時の扱い」を frame へ辿る必要がある。各 SKILL の参照節に frame への導線があるため実害は小さい。
- **対応状況**: 未対応（情報提供。修正不要と判断してよいレベル）
- **対応方法（案）**: 必要なら map/detail の Done 冒頭に「発動は frame の『あり』判定が前提」の 1 行を足す。任意。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| 00_要求定義.md | 更新済み（experience_surface 方針・fable 例外記録） | verify-and-close | 2026-07-17 |
| 01_要件定義.md | 更新済み（6 観点・トリガー・fable 限定） | verify-and-close | 2026-07-17 |
| 02_設計.md | 更新済み（ADR-1〜8・§5.2 契約・§7 受け皿） | verify-and-close | 2026-07-17 |
| 03_実装計画.md | 更新済み（T1-T6・BDD・§4.2 対応表） | verify-and-close | 2026-07-17 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している。02 §5.2 契約1-3 ⇔ frame/map/detail SKILL、02 §7 受け皿 ⇔ 02 テンプレート §7.0-7.4、ADR-6（新規 7＋改修 8＝15）⇔ 実 `git diff --stat`（15 ファイル）、ADR-7（3 フェーズ fresh サブ）⇔ design-feature 0a/0b/0c＋委譲粒度分割規定、ADR-8（再利用優先）⇔ detail-experience Process/Done がすべて一致。
- **要件と実装の整合性**: 整合している（§4 対応表参照）。指摘 1 の記録位置不整合のみ軽微な非整合。
- **コメント**: docs/ システム仕様書の更新要否は下記「docs 更新」参照。

---

## 6. パフォーマンス確認 / 7. セキュリティ確認

該当なし。本件は Markdown 定義変更で実行時パフォーマンス・認証/データ保護の対象を持たない。トリガー非該当（体験面=なし）issue はフィルタを素通りしオーバーヘッド 0（02 §2.2 根拠）である点が非機能要件（01 §3.1）を満たす。外部書き込みなし（01 §3.2）。

---

## 受け入れ基準の確認（generate-scenarios ＋ map-coverage の結果）

（03 §2.x.4 BDD シナリオと 01 受け入れ基準を実装へ突き合わせたカバレッジ表。「検証方法」は静的レビューでの照合先を示す。）

| 受け入れ基準 / BDD シナリオ | 対応実装 | 検証方法 | 結果 |
| --------------------------- | -------- | -------- | ---- |
| T1-S1: 3 SKILL が 6 見出し・責務分離・各 Process に却下案 | frame/map/detail SKILL.md | 実ファイルの見出し・Forbidden・Process 却下案を確認 | 通過 |
| T1-S2: 各フェーズ fresh サブ委譲前提・規模比例統合可 | experience/README §委譲モデル・各 SKILL 参照 | README に fresh サブ分割＋規模比例統合の明記を確認 | 通過 |
| T1-S3: detail が再利用優先（探索順序①-⑥・探索一覧義務・新規作成条件・技術非依存） | detail-experience SKILL/README | Process 探索順序・Done 探索一覧・技術非依存節を確認 | 通過 |
| T2-S1: 体験面=あり で 3 フェーズが chain 冒頭発動・各々 fresh サブ | design-feature PROCESS 0a/0b/0c＋委譲粒度分割規定 | PROCESS・実行時の注意の実差分を確認 | 通過 |
| T2-S2: 体験面=なし はスキップし工程欠落としない | design-feature DONE「なし＝§7.0 記録・正常系」 | DONE/実行時の注意を確認 | 通過 |
| T2-S3: 小規模はフェーズ統合可 | 実行時の注意「規模比例統合可・統合記録 1 行」 | 記述の存在を確認 | 通過 |
| T3: 要求時に experience_surface を 00 に任意記録・chain 不変 | requirement-discovery 実行時の注意 1 項 | PROCESS 4 skill 不変＋注記追加を確認 | 通過 |
| T4: experience_surface 任意追加・後方互換 | 00 テンプレート frontmatter（null 既定） | 既存項目不変＋yes:/no: 形式が frame Inputs と一致 | 通過 |
| T5: §7 に 7.0-7.4 の受け皿・画面設計保持 | 02 テンプレート §7.0-7.4／§7.5-7.6 | 3 フェーズ受け皿＋画面遷移図/画面設計温存を確認 | 通過 |
| T6-S1: 体験面=あり で §7 空を差し戻す観点 | review-docs 体験観点確認 1 項 | DUAL_LENS 相乗り記述を確認 | 通過 |
| T6-S2: 体験面=なし を体験欠落で差し戻さない | 同上（過剰適用回避明記） | 記述を確認 | 通過 |
| T6-S3: 機械的「なし」を形骸化防止で差し戻す | review-docs＋design-feature §7.0 転記検証責務 | ADR-3 記述（矛盾時差し戻し）を確認 | 通過 |
| 01 UC1-S1（6 観点確認・追跡） | T1＋T2＋02 §7 | 6 観点が 3 フェーズへ配分され §7 で追跡可 | 通過 |
| 01 UC1-S1 拡張（ADR-8 再利用優先） | detail Process/Done＋02 §7.3 | 探索一覧・正当化根拠欄を確認 | 通過 |
| 01 UC2（過剰適用回避・トリガー明確） | T4＋T2＋T6 | experience_surface で一意判定・非該当スキップ | 通過 |
| 01 UC3（fable アドバイザー限定） | 02 §2.5・00/01 記録（source タスクなし） | MODEL_TIER_TABLE 既定で担保・恒常運用化しない記載 | 通過（実装タスク非生成） |
| 01 ストーリー5（CORE へ届く） | 全 15 ファイルが source/・runtime/templates/ 配下 | 変更対象パスを確認（project 限定でない） | 通過 |

**カバレッジ判定**: 03 §4.2 対応表の全行を実ファイルへ突き合わせ、**欠落なし**。全 BDD シナリオ・受け入れ基準が実装に対応する（テストコード化不能な理由＝フレームワーク定義の静的変更であることは 03 §単体テストに明記済み）。必須成果物（00/01/02/03、本 04）の必須セクション欠落なし。PHASES 監査観点（全シナリオのテストコード化網羅の説明・フォーマットの正しさ）を満たす。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本件の変更対象は `.agent-skill-chain/source/`（配布パッケージ正本・CORE）および `.agent-skill-chain/runtime/templates/` であり、これら自身がシステム仕様の正本を成す。別途 `docs/` 配下のシステム仕様書（消費者向けアプリ仕様）に影響する実装は無い。本リポの `docs/maintainer/workflow/` は issue ワークフロー成果物置き場であって DOCS_RULES §継続追随ゲートの対象たる `docs/`（プロダクト仕様書）ではないため、本ゲートは不発動と判定する。

---

## 9. 設計・境界の確認

（review-architecture の結果。02_設計.md との整合・責務境界の非重複・既存ゲートとの整合を確認した。）

### 9.1 設計の確認

- **設計原則の準拠**: spec/01「組み合わせ可能・単一責務」、spec/06「可読性 > 単一責務」に準拠（02 §1.2・§2.2 根拠）。experience domain は「体験の流れから責務・API を逆算する観点確認」に単一責務化され、requirements（要求抽出）・architecture（責務境界）と分離（02 §2.1.2 境界）。
- **ディレクトリ構成**: 既存 `skills/{domain}/{capability}/{README,SKILL}.md` 構造に準拠（`skills/experience/` 配下 3 capability）。spec/02 方針に沿う。
- **命名規則**: domain=`experience`、capability=`{frame,map,detail}-experience`。SKILL 配備名 `experience__{phase}-experience`（既存 `architecture__define-boundaries` 等と同一の `__` 規約）と整合。

### 9.2 境界・依存の確認

- **責務の境界**: frame（目的/ユーザー）→ map（IA/流れ）→ detail（UI/実装可能性）の 3 分担が Forbidden 節で相互侵食を排除。experience→architecture は「責務候補の提示」に留め境界確定は define-boundaries が行う（02 §2.1.2）。非重複を確認。
- **依存関係**: フェーズ間は §7.x の確定出力のみを一方向で引き継ぎ（frame→map→detail→define-boundaries）、循環なし。会話文脈は継承しない（fresh サブ分割）。
- **既存ゲートとの整合**: review-docs DUAL_LENS へ 1 観点を相乗りさせ（新規 audit なし・ADR-4）、既存 review-docs 完了定義・二観点必須を再定義していない。SKILL_MANDATORY 設計行は条件付き必須を末尾追記のみで既存 Mandatory 不変。**整合を確認**。
- **指摘・推奨**: §4.2 指摘 1（幻覚ペルソナ記録先 §7.1 vs §7.4）は設計整合上の軽微な不一致。指摘 2 は設計意図どおりで要修正でない可能性が高い。いずれも境界・依存の欠陥ではない。

### 9.3 敵対的観点／must-preserve リスト（REVIEW_DUAL_LENS §3・設計/境界）

**敵対的観点リスト**:

1. 「3 フェーズ分割が extract-goals/write-bdd と重複し形骸化しないか」→ 差し込みを design-feature 冒頭に限定（ADR-2）、frame Forbidden に 00/01 再定義禁止を明記。**重複回避を確認**。
2. 「META_LAYER 目安（基盤修正 ≤2）超過を隠していないか」→ ADR-6 で 15 ファイル超過を明示し 6 簡素化で正当化。**隠蔽なし**。
3. 「新規ファイル 7 が肥大化を招かないか」→ 新規 command・audit・成果物ファイルを増やさず既存機構に相乗り（ADR-3/4/5）。フェーズ分担に不可欠な粒度。**許容範囲**。

**must-preserve リスト**:

1. PHASE_COMMAND_MAP・02 所有権（設計 phase → design-feature）不変 — ADR-7(c) で維持を確認。**保持**。
2. トリガー機構（00 frontmatter・02 §7・review-docs・DUAL_LENS）の既存挙動 — 相乗りのみで置換なし。**保持**。
3. 消費者の技術非依存性 — detail-experience が特定技術を固定しない（ADR-8）。**保持**。

### 9.4 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| 実装 15 ファイルが 03 テスト観点・BDD を満たす | existing_code（実ファイル・実 diff 照合） | `git diff bab69a2..0032ade` 全 15 ファイルを確認 |
| 既存 chain（4+3 skill）・run_command・CLOSEOUT 不変 | existing_code | requirement-discovery grep・run_command/CLOSEOUT diff 空を確認 |
| 変更ファイル数がちょうど 15（新規 7＋改修 8） | test_output（`git diff --stat` の出力） | source/ 配下 15 ファイル、ADR-6 と一致 |
| 幻覚ペルソナ記録先の不一致（指摘 1） | existing_code（grep で §7.1 vs §7.4 を確認） | frame SKILL/README vs 02 テンプレート |
| workflow.db 記録・親 entry_id 存在 | test_output（sqlite3 クエリ） | entry_id f94fbfcb（T6）を確認 |

**inference_only のみに依存する重要判断は無い**（全判断が実ファイル・実 diff・DB 出力の外部根拠を持つ）。したがって RULES.md §高リスク操作該当の「要人間確認」ブロッキングには当たらない。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好。15 ファイルすべてが 03 のテスト観点・BDD・01 受け入れ基準に対応し、最小 diff・既存不変・規約準拠を満たす。
- **テスト品質**: 該当なし（コードなし）。BDD 全シナリオを静的検証観点として整理し、対応表で欠落なしを確認。
- **ドキュメント品質**: 良好。設計（ADR-1〜8）と実装が一致。軽微な記録位置不整合（指摘 1）1 件のみ。
- **総合評価**: **合格（クローズ可）**。検出した指摘はいずれも重要度「低」であり、機能・トリガー・後方互換・既存 chain/ゲートへの影響を持たない。指摘 1 は 1 行修正で解消可能な記載位置の不一致、指摘 2 は設計意図どおりで要修正でない可能性が高い。ブロッキング欠陥は 0 件。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 委譲サブ（opus）
- **承認日**: 2026-07-17
- **承認コメント**: クローズ可。指摘 1・2 の修正要否は進行役が判断（本サブは修正を行わず指摘記録に留める）。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- `.agent-skill-chain/source/REVIEW_RULE.md` / `REVIEW_DUAL_LENS.md` / `workflow/PHASES.md`（監査観点）
- 実装 commit: `27d1367`（T1）・`cade177`（T2-T5）・`0032ade`（T6）

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

## 15. 次のステップ

- 本 issue はコード実装を伴わないフレームワーク定義変更であり、05_最終確認チェックリスト（外部設定）は不要。指摘 1・2 の対応要否を進行役が判断後、issue クローズへ。
