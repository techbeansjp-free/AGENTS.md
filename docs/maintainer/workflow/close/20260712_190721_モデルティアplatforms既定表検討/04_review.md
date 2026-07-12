---
document_id: "d73401bd-6a87-4357-b564-c27aca2394ef"
---

# レビュー書: Claude 向け推奨デフォルト・モデルティア表を source/platforms/claude/ に置く折衷案（条件付き採用）

**プロジェクト名**: モデルティア推奨デフォルトの platforms 配置検討
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **重要**: **このドキュメントは常に更新**。本 04 は verify-and-close（レビューフェーズ）の成果物であり、実装完了後の 5 ファイル（新設 1＋更新 4）に対する規約整合レビュー結果を記録する。
>
> **本 issue の性質**: 規約ドキュメント（Markdown）の設計・編集であり、実行コード・自動テストを伴わない。したがってテスト＝**規約整合レビュー観点**（03 §テスト観点・02 §6）として検証した。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。

---

## 1. レビュー概要

### 1.1 レビュー目的

02 の ADR-A〜F（条件付き採用）を前提とした実装（新設 1＋更新 4 ファイル）が、01 の受け入れ基準（AC-1〜AC-6）・03 のタスク別テスト観点（各 §2.x.3）・02 の ADR と責務境界（§2.1）を実際に満たしているかを、実ファイルを読んで検証し、クローズ可否を判定する。

### 1.2 レビュー対象

- **実装範囲**: 新設 `source/platforms/claude/MODEL_TIER_RECOMMENDED.md`、更新 `source/MODEL_SELECTION.md`・`project/MODEL_TIER_TABLE.md`・`source/platforms/README.md`・`project/README.md`（03 のタスク 1〜5）。
- **レビュー深度**: standard（新規 1＋既存更新 4 の規約ドキュメント。実行コードなし）。
- **レビュー担当者**: verify-and-close サブエージェント（監査役）。

---

## 2. 実装内容の確認（review-code 相当＝規約整合レビュー）

### 2.1 実装完了タスク

| タスク | 実装内容 | 変更ファイル | ステータス |
| ------ | -------- | ------------ | ---------- |
| タスク1 | 推奨デフォルト新設（役割→抽象ティア・advisory） | `source/platforms/claude/MODEL_TIER_RECOMMENDED.md`（新設） | 完了 |
| タスク2 | §汎用/固有境界に但し書き追加（PF限定名前空間の例外明文化） | `source/MODEL_SELECTION.md` | 完了 |
| タスク3 | 一般行の参照化・固有上書きのみ残す | `project/MODEL_TIER_TABLE.md` | 完了 |
| タスク4 | platforms/README スコープ1行＋project/README 明確化注記 | `source/platforms/README.md`・`project/README.md` | 完了 |
| タスク5 | 横断整合検証（相互参照・重複・優先順位） | （検証タスク・本 04 で実施） | 完了 |

### 2.2 実装内容の詳細と検証結果

#### タスク1: MODEL_TIER_RECOMMENDED.md（新設）

- **検証観点（03 §2.1.3）と結果**:
  - **モデル ID（世代付き文字列）不在（ADR-B）**: `grep -nE '[a-z]+-[0-9]+(-[0-9]+)*'` の結果、ヒットは frontmatter の UUID（document_id）のみ。役割→ティア表・本文に世代付きモデル ID（`<モデル名>-<世代番号>` 形式）は存在しない。**OK**。§4 の但し書きにも「版番号付きの世代モデル ID は記載しない」と明記されている。
  - **fable 原則禁止・opus 要否先行の順序規定・降格閾値の非混入（ADR-D 除外基準・AC-4-3）**: §5 除外事項で、これらを「本ファイルに含めず `project/` に委ねる」と**除外対象として列挙**しているのみ。実際の禁止方針・順序手順・閾値そのものは記載されていない。**OK**。
  - **advisory・MODEL_SELECTION 従属の明記**: 冒頭 blockquote と §1 責務で advisory（必需物でない）である旨、および MODEL_SELECTION 抽象原則への従属を明記。**OK**。
  - **列構成が「役割｜推奨ティア｜一般適用条件」の3列**: §4 の表は当該 3 列で構成。**OK**。
- **判定**: 完了。01 シナリオ 3・4 の受け入れを満たす。

#### タスク2: MODEL_SELECTION.md §汎用/固有境界（更新）

- **検証観点（03 §2.2.3）と結果**:
  - **既存本文の保全（追記のみ・BR-2）**: 「対応表はコアに置かない（PF 中立性）」本文（:57）は残存。その下に「但し書き」段落（:59）を追加。既存本文の削除・改変なし。**OK**。
  - **暗黙例外を残さない（AC-2-2）**: 『コア』＝全 PF 共通の PF 中立なコア本体と明確化し、PF 限定名前空間 `platforms/<pf>/` への advisory 推奨デフォルトを (i)〜(iii) 条件付きで**明示的に例外許容**。**OK**。
  - **advisory 限定・固有運用除外の明記（AC-2-3）**: 但し書きに「advisory に限る」「本リポ固有運用を含まない」「settings.enforce.json 等の機構上の必需物とは根拠が異なる（前例流用しない）」を明記。**OK**。
- **判定**: 完了。01 シナリオ 1 の受け入れを満たす。

#### タスク3: MODEL_TIER_TABLE.md（更新）

- **検証観点（03 §2.3.3）と結果**:
  - **一般行の重複排除（AC-4-2・BR-3）**: §一般ティア方向性 で正本を `MODEL_TIER_RECOMMENDED.md` に置き「一般行は再掲せず参照する」と明記。役割→ティアの一般表そのものは MODEL_TIER_TABLE に再掲されていない（「設計・レビュー・監査」は参照文中の 1 箇所のみで、表としての再掲なし）。正本は platforms/claude 側の表 1 箇所。**OK**。
  - **ADR-1 順序規定・fable 原則禁止の残存（AC-5-2）**: 本リポ固有の上書き表に「実装のティア選定順序（ADR-1・opus 要否先行）」「fable 原則禁止」が残存。加えて §opus 要否先行検討の選定手順・§裁量禁止との整合 に ADR-1 の非裁量手順が保持。**OK**。
  - **参照リンク追加**: §参照 に `../source/platforms/claude/MODEL_TIER_RECOMMENDED.md` を追加。実在ファイルを指す。**OK**。
- **判定**: 完了。01 シナリオ 3・5 の受け入れを満たす。

#### タスク4: platforms/README.md スコープ ＋ project/README.md §優先順位（更新）

- **検証観点（03 §2.4.3）と結果**:
  - **project/README 一般2層規約の保全（AC-3-3）**: 「project > source の 2 層」規約（:17）は改変・削除なし。§明確化注記 を追加したのみ。**OK**。
  - **tier固有3層順序を README に重複させない（ADR-C・BR-3）**: 明確化注記は「特化ドメインの具体的解決順序は当該ドメインのドキュメント側を正本とし、本 README には重複記載しない（単一責務）」と明記。3 層順序の具体は tier ドキュメント側に置かれている。**OK**。
  - **platforms/README スコープにティア推奨を明記**: 冒頭スコープに「PF 固有のモデルティア推奨デフォルト（advisory）」を追記。新設ファイルが未記載の暗黙例外にならない。**OK**。
  - **表なし時フォールバックの接続（AC-3-2）**: MODEL_TIER_RECOMMENDED.md §2・§3 に「表がどこにも無い環境は MODEL_SELECTION §1 のランタイム既定動作へフォールバック」と明記。**OK**。
- **判定**: 完了。01 シナリオ 2 の受け入れを満たす。

#### タスク5: 横断整合検証

- **相互参照リンクの実在性**: 全対象リンク（MODEL_SELECTION.md／platforms/README.md／MODEL_TIER_RECOMMENDED.md／MODEL_TIER_TABLE.md／project/README.md／settings.enforce.json／plugin.json／scribe_claude.md）の実在を確認。デッドリンクなし。**OK**。
- **アンカー解決**: MODEL_SELECTION の `#汎用固有境界`・`#1-適用条件`・`#2-ティア明記義務`・`#3-品質ゲート最上位固定`・`#4-未収束エスカレーション`・`#裁量の禁止と形骸化防止` の各見出しが実在。**OK**。
- **一般ティア方向性の正本1箇所（BR-3）**: 役割→ティアの一般表は platforms/claude の MODEL_TIER_RECOMMENDED.md にのみ存在。MODEL_TIER_TABLE は参照のみ。重複ゼロ。**OK**。
- **優先順位の一意性（AC-3-1）**: 「project MODEL_TIER_TABLE > platforms/claude 推奨デフォルト > MODEL_SELECTION 抽象原則」が MODEL_TIER_RECOMMENDED §3・MODEL_TIER_TABLE §一般ティア方向性/§参照・project/README §明確化注記 で一致。矛盾なし。**OK**。
- **ADR-A 4条件（i〜iv）**: (i) 抽象ティア限定＝ADR-B充足、(ii) 一般推奨のみ＝ADR-D充足、(iii) 3層整合＋フォールバック＝ADR-C充足、(iv) 明示例外＝ADR-F充足。全て実ファイルで満たされている。**OK**。

---

## 3. テスト結果の確認

- **自動テスト**: 該当なし。本 issue は規約ドキュメント（Markdown）の設計・編集であり、実行コード・自動テストを伴わない（02 §6・03 §テスト観点）。
- **機械的チェック（grep 等）実施結果**:
  - 世代付きモデル ID 検索（RECOMMENDED）: ヒット 0 件（UUID を除く）。**OK**。
  - fable／opus 要否／降格 の MODEL_TIER_TABLE 残存: 該当行検出。**OK**。
  - 相互参照リンク実在チェック: MISSING 0 件。**OK**。
- **クリティカル観点4点（03 §テスト観点）**: 重複ゼロ／暗黙例外ゼロ／モデル ID 焼き込みゼロ／固有運用の非混入 — 全て充足。

---

## 4. コードレビュー（規約整合）観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 意図の分かる命名・小さいファイル・浅い構造 | OK | `MODEL_TIER_RECOMMENDED.md` は責務が命名から明確。 |
| 保守性 | 1ファイル1責務・重複禁止・陳腐化耐性 | OK | 一般方向性の正本は1箇所。モデル ID 焼き込みなしで更新点局所化。 |
| 相互参照整合 | リンク・アンカー・用語の一致 | OK | デッドリンクなし。用語（advisory・限定名前空間）一致。 |
| 規約遵守 | BR-2（暗黙骨抜き禁止）・BR-3（重複禁止） | OK | 既存原則は残置し但し書きで限定。重複ゼロ。 |

### 4.2 指摘事項

- **指摘（実装フェーズ前に解消済み）**: review-docs サイクル1で 03 の「but し書き」タイポ2箇所を検出→修正済み（memo `20260712_194248_review-docs.md`・`20260712_194333_review-docs.md`）。本 04 時点で残存指摘なし。
- **本 04 での新規指摘**: なし（0 件）。

---

## docs 更新（継続追随ゲート）

- **要否**: 不要
- **対象**: なし
- **理由**: 本変更は `.agent-skill-chain/source/` および `.agent-skill-chain/project/` の**規約（ガバナンス）ファイル**の変更であり、`docs/` 配下のシステム仕様書（01_システム概要／02_画面設計／03_データ設計／04_機能設計）ではない。本リポの `docs/` は maintainer 用ドキュメントであってアプリのシステム仕様書ではなく、`docs/00_review/` も存在しない。DOCS_RULES §継続追随ゲートはシステム仕様書の as-built 同期を対象とするため、本変更には**該当セクションが存在せず不発動**。軽量パス（根拠付き「更新不要」判定 1 件）で通過する。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠（spec/01・06）**: 単一責務・明確な境界・「再利用より責務の明確さ」に準拠。抽象原則（core）／PF 固有推奨（platforms/claude）／本リポ固有運用（project）を責務で分離し重複記載を排除。**OK**。
- **ディレクトリ構成**: 新設は `source/platforms/claude/` 配下（PF 限定名前空間）で適切。既存前例（settings.enforce.json・plugin.json）と同じ名前空間。**OK**。
- **命名規則**: `MODEL_TIER_RECOMMENDED.md` は意図の分かる命名。**OK**。

### 9.2 境界・依存の確認（ADR-A〜F との一致）

- **ADR-A（条件付き採用・4条件）**: 実装は 4 条件 i〜iv を全て満たす。**一致**。
- **ADR-B（抽象ティア限定・モデル ID 不在）**: RECOMMENDED にモデル ID なし。**一致**。
- **ADR-C（3層整合・README注記のみ）**: 解決順は tier ドキュメント正本、README は明確化注記のみ。一般2層規約は不変。**一致**。
- **ADR-D（一般推奨と固有運用の切り分け）**: platforms/claude は方向性のみ、fable/順序規定/閾値/モデル ID は project へ除外。正本配置＝platforms/claude、MODEL_TIER_TABLE は参照＋固有上書き。**一致**。
- **ADR-E（独立決定・不採用時帰結）**: MODEL_TIER_TABLE の ADR-1 順序規定は温存され採用・不採用いずれでも矛盾なし。**一致**。
- **ADR-F（§汎用/固有境界の但し書き＋platforms/README スコープ）**: 但し書き1段落＋スコープ1行を追加、暗黙例外を排除。**一致**。
- **責務境界（§2.1）**: `project → source(platforms/claude) → source(MODEL_SELECTION)` の一方向依存。循環なし。**一致**。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| モデル ID 不在の充足 | test_output | grep によるモデル ID 検索でヒット0件（UUID 除く） |
| 相互参照リンク・アンカーの解決 | existing_code | 対象ファイル・見出しの実在を確認 |
| 一般行の重複排除・固有運用残存 | existing_code | MODEL_TIER_TABLE と RECOMMENDED の実文照合 |
| ADR-A 採否の最終Go（採用の望ましさ） | human_decision | 採否の価値判断はメンテナ承認事項（02 ADR-A）。本レビューは技術的整合の成立のみを確認 |

**注記**: 本 04 のレビュー結論（技術的整合の成立）は test_output・existing_code に基づき、inference_only のみに依存する重要判断はない。ADR-A の「採用の望ましさ」自体は human_decision 事項であり、実装が既に行われている（採用が承認済み）前提での整合確認である。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（5 ファイル全てが ADR・AC・タスク観点を実ファイルで満たす）。
- **規約整合品質**: 良好（重複ゼロ・暗黙例外ゼロ・モデル ID 焼き込みゼロ・固有運用非混入の4クリティカル観点を全充足）。
- **ドキュメント品質**: 良好（00〜03 と実装の整合、相互参照の解決を確認）。
- **総合評価**: **合格**。要修正の指摘なし（0 件）。

### 12.2 受け入れ基準（AC-1〜AC-6）の充足状況

| AC | 内容 | 充足 | 根拠 |
| -- | ---- | ---- | ---- |
| AC-1 | 折衷案の採否判断軸・○×評価・不採用選択肢 | 充足 | 02 ADR-A/E で条件付き採用と不採用帰結を定義、実装で4条件充足 |
| AC-2 | §汎用/固有境界の更新（論点a） | 充足 | タスク2の但し書き（暗黙例外排除・advisory限定・前例非流用） |
| AC-3 | 優先順位3層整合（論点b） | 充足 | タスク4（一意順序・フォールバック接続・README注記のみ・2層規約不変） |
| AC-4 | 一般推奨と固有運用の切り分け（論点c） | 充足 | タスク1除外事項＋タスク3参照化（正本1箇所・固有運用非混入） |
| AC-5 | 本検討とADR-1の関係 | 充足 | 02 ADR-E（独立決定）＋MODEL_TIER_TABLE のADR-1残存 |
| AC-6 | 制約(1)〜(4)のGiven反映・陳腐化耐性評価軸 | 充足 | 01 BDD の Given＋ADR-B（抽象ティア限定） |

### 12.3 承認状況

- **レビュー結論**: 合格（クローズ可）。
- **承認コメント**: 新設1＋更新4ファイルは 02 の ADR-A〜F・01 の AC-1〜AC-6・03 のタスク観点を実ファイルで満たす。相互参照は全て解決。指摘0件。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- [.agent-skill-chain/source/platforms/claude/MODEL_TIER_RECOMMENDED.md](../../../../../.agent-skill-chain/source/platforms/claude/MODEL_TIER_RECOMMENDED.md)（新設）
- [.agent-skill-chain/source/MODEL_SELECTION.md](../../../../../.agent-skill-chain/source/MODEL_SELECTION.md) / [.agent-skill-chain/project/MODEL_TIER_TABLE.md](../../../../../.agent-skill-chain/project/MODEL_TIER_TABLE.md) / [.agent-skill-chain/source/platforms/README.md](../../../../../.agent-skill-chain/source/platforms/README.md) / [.agent-skill-chain/project/README.md](../../../../../.agent-skill-chain/project/README.md)
- memo（実装前ドキュメントレビュー証跡）: `memo/20260712_194248_review-docs.md`・`memo/20260712_194333_review-docs.md`

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ（implement-feature 完了）

---

## 15. 次のステップ

- 本 issue は 1 まとまりの規約更新でありサブ issue なし。verify-and-close 完了（04_review 作成＋ write-workflow-log 記録）をもって、トップレベル issue の close 移動条件を満たす。
