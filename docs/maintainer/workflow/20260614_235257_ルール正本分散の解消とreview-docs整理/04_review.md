---
document_id: "175a91d9-58c2-48e8-bbc3-52ed3d45f860"
---

# レビュー書: ルール正本分散の解消と review-docs の位置づけ整理

**プロジェクト名**: ルール正本分散の解消と review-docs の位置づけ整理
**作成日**: 2026 年 06 月 15 日
**最終更新**: 2026 年 06 月 15 日

> **用語**: [.agents/CONCEPTS.md §用語規約](../../../../.agents/CONCEPTS.md#用語規約) を参照。
> **必須**: 本レビューは [`.agents/REVIEW_RULE.md`](../../../../.agents/REVIEW_RULE.md) に従う。レビュー深度は **standard**（仕様ドキュメントの重複削除＋相互参照化。実行コード無し）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容（M1・M3・M4 の重複本文の正本化と review-docs の位置づけ確定）の確認・品質保証。「1ファイル1責務・重複禁止・正本1か所」原則の回復を検証する。

### 1.2 レビュー対象（必須）

- **実装範囲**: M1（完了定義の正本＝PHASES／run_command 相互参照化）、M3（自動適用段落の正本＝AGENTS／GETTING_STARTED 要約＋リンク）、M4（review-docs＝補助手順確定・PHASE_COMMAND_MAP/PHASES 整合・create-pr-review-issue:31 委譲一意化）。L1 は誤認として 00 §5 に記録のみ（実装対象外）。
- **レビュー期間**: 2026-06-15 ～ 2026-06-15
- **レビュー担当者**: verify-and-close サブエージェント（review-code / review-architecture / map-coverage）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| --- | --- | --- | --- | --- |
| T1 (M1) | 完了定義 (1)(2)(3) を PHASES に集約、run_command:54 を相互参照化 | 2026-06-15 | 実装サブ | 完了 |
| T2 (M3) | 自動適用段落を AGENTS に集約、GETTING_STARTED を要約＋リンク化 | 2026-06-15 | 実装サブ | 完了 |
| T3 (M4) | review-docs=補助手順確定、MAP/PHASES 整合、create-pr-review-issue:31 を review-docs 一本化 | 2026-06-15 | 実装サブ | 完了 |
| T4 (検証) | grep 重複検出・リンク解決・隔離 audit | 2026-06-15 | 本レビュー | 完了 |

### 2.2 実装内容の詳細

#### T1: M1 完了定義の正本化

- **変更ファイル**: `.agents/workflow/PHASES.md`（正本・本文保持）、`.agents/skills/agent/run_command.md`（相互参照化）。
- **実装方法**: 完了定義「(1) memo 作成 (2) 指摘がなくなるまでの修正反復 (3) 書記委譲」の本文を PHASES.md §レビュー成果物の配置ルール（63 行付近）に保持。run_command.md:54 は本文を削除し「完了判定の定義は [PHASES.md §レビュー成果物の配置ルール] を正本とする」相互参照に置換。
- **確認事項**: run_command 側に完了定義の本文が残っていないこと（後述 grep で本文ヒット 0）。enforcement/README #23 は引き続き PHASES／run_command を参照しており意味保持。

#### T2: M3 自動適用段落の正本化

- **変更ファイル**: `AGENTS.md`（正本・段落本文保持 14 行付近）、`.agents/GETTING_STARTED.md`（要約＋リンク化）。
- **実装方法**: 「通常依頼でも agents を自動適用」段落（解釈／進行役／自動選択／出力）の列挙本文を AGENTS.md に保持。GETTING_STARTED.md 冒頭は 1 文の要約（解釈＝agents workflow／進行役＝orchestrator／自動選択／出力＝IO_CONTRACT・RULES）＋「正本は AGENTS.md 冒頭」リンクに置換。自立進行ルール本文は AGENTS.md に維持。
- **確認事項**: 列挙本文が AGENTS.md の 1 か所のみ。GETTING_STARTED.md に「解釈:」「進行役:」等の本文列挙が無いこと。

#### T3: M4 review-docs の位置づけ確定と委譲一意化

- **変更ファイル**: `.agents/workflow/PHASE_COMMAND_MAP.md`（25 行付近に補助手順注記追加・39 行付近の禁止条項を限定）、`.agents/workflow/PHASES.md`（65 行付近に補助手順である旨明記）、`.agents/commands/create-pr-review-issue.md`（31 行付近の委譲を review-docs 一本化）。
- **実装方法**: review-docs を「特定 phase に対応しない横断的な補助手順（auxiliary）」と確定。PHASE_COMMAND_MAP に「本表に載せない理由」を注記し、「本表にない command の起動は禁止」は phase からの選択経路に限る旨を限定。PHASES.md にも同旨を明記し相互参照。create-pr-review-issue.md:31 の「review-docs **または** skills/review」を「commands/review-docs を参照して」に確定。
- **確認事項**: 「または」が消え委譲先が決定的。MAP/PHASES が矛盾なく整合。

---

## 3. テスト結果の確認

実行コードは無く、検証は **grep（本文重複検出）／相互参照リンク解決／enforcement 監査（隔離環境）** の 3 系統で行う（02 §6・03 §2.4）。

### 3.1 grep（本文重複検出）

| 検証 | コマンド（要旨） | 期待 | 結果 |
| --- | --- | --- | --- |
| SC-1 (M1) | `grep -rl "(1) memo 作成 (2) 指摘がなくなるまでの修正反復 (3) 書記委譲" .agents AGENTS.md` | 本文ヒット 1 か所（PHASES.md のみ） | **OK**（PHASES.md のみ・件数 1） |
| M1 (重複側) | `grep -c "...完了の定義..." run_command.md` | 0（本文ヒットなし＝リンクのみ） | **OK**（0） |
| SC-2 (M3) | `grep -rl "全依頼を ... agents workflow ... で解釈" .agents AGENTS.md` | 段落本文 1 か所（AGENTS.md のみ） | **OK**（AGENTS.md のみ・件数 1） |
| M3 (重複側) | GETTING_STARTED.md に「解釈:」「進行役:」本文列挙 | 無し（要約のみ） | **OK**（本文列挙なし・要約＋リンクのみ） |
| SC-4 (M4) | `grep -rnE "review-docs\s*(または\|or)\s*skills/review" .agents AGENTS.md` | 0 ヒット | **OK**（マッチ無し・exit 1） |

### 3.2 相互参照リンクの解決

| リンク | 参照先 | §見出し | 結果 |
| --- | --- | --- | --- |
| run_command.md:54 → PHASES | `.agents/workflow/PHASES.md` 実在 | `## レビュー成果物の配置ルール` 実在 | **OK** |
| GETTING_STARTED 冒頭 → AGENTS | `../AGENTS.md` 実在 | 冒頭段落 | **OK** |
| PHASES:65 → PHASE_COMMAND_MAP | `PHASE_COMMAND_MAP.md` 実在 | `#phase--command-一覧`（`## Phase → Command 一覧` に解決） | **OK** |
| PHASE_COMMAND_MAP:25 → review-docs | `../commands/review-docs.md` 実在 | — | **OK** |
| create-pr-review-issue:31 → review-docs | `review-docs.md` 実在 | — | **OK** |

未解決リンク: **0 件**。

### 3.3 enforcement 監査（audit.sh・隔離環境）

- **実行方法**: `.agents-project §テストの tmp 隔離` に従い `mktemp -d` ＋ 作業ツリースナップショット（`git stash create` のツリーを `git archive | tar -x`）で隔離環境を作成し、`bash .agents/enforcement/ci/audit.sh .` を実行。終了後 `rm -rf` で片付け。本リポ本体・workflow.db は破壊していない。
- **結果**: 隔離環境の audit は exit 1（FAIL 2 件）。ただし **2 件とも本 issue の対象外**であり、本 issue の変更（M1/M3/M4 の 8 ファイル）に起因しない:
  1. `90_issues.md` 不在 FAIL → 対象は `docs/maintainer/workflow/close/20260614_162712_コア取り込み候補調査/`（別 issue の close 済みサブ issue 親）。
  2. TODO/FIXME 残存 FAIL → 対象は同上 `…コア取り込み候補調査/04_review.md`（別 issue のレビュー文中で audit 仕様を説明している語の検出）。
- **切り分けの根拠（evidence_source: test_output）**: HEAD（本 issue 変更前のコミット状態）スナップショットの audit は FAIL 行を出力しない。FAIL は作業ツリー上の **別 issue の close 移動由来の未コミットファイル**から生じており、`#26〜#29`（本セッションの新 check）由来でも本 issue 由来でもない。
- **本 issue の 8 ファイルに TODO/FIXME 残存なし**（enforcement/README.md のヒットは audit 仕様を説明する散文であり、audit は当該 `.md` を重要パス対象として flag しない＝実害なし）。
- **判定**: 本 issue の変更は audit 失敗を**新規に増やしていない**（SC-6 充足。残存 FAIL は環境・別 issue 由来で本 issue のスコープ外）。

---

## 4. コードレビュー（review-code）

### 4.1 コード品質

- **対象**: Markdown 仕様ファイル。リント/型チェックは対象外。フォーマット: 問題なし。

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | 相互参照は §見出しアンカー付きで参照先が一意 | OK | run_command→PHASES、GETTING_STARTED→AGENTS とも到達可能 |
| 保守性 | 本文が正本 1 か所に集約され片側更新の二枚舌が解消 | OK | grep で重複 0 を実測 |
| パフォーマンス | 該当なし（実行性能に影響しない） | OK | — |
| セキュリティ | 該当なし | OK | — |

### 4.2 指摘事項

- 指摘 **なし**（重大度 高/中: 0 件）。本文消失なし・重複残存なし・曖昧委譲解消を確認。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本 issue は `.agents/` 仕様（パッケージ正本）の重複解消であり、`docs/` システム仕様書の記述内容には影響しない。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 「単一責務 + 参照集約（Single Source of Truth）」（02 §2.2）に準拠。完了定義（レビュー運用ルール）は RULES 層の責務を持つ PHASES.md に置き、SKILLS 層の run_command.md には本文を置かない方針が実装に反映されている。[META_LAYER §責務境界](../../../../.agents/META_LAYER.md) の「skill に rule を書く」禁止に整合。
- **命名規則・構成**: 既存ファイルの本文削除＋相互参照のみ。新規 .md 追加なし（SC-5）。

### 9.2 境界・依存の確認

- **責務の境界**: M1=run_command→PHASES、M3=GETTING_STARTED→AGENTS、M4=MAP/PHASES/create-pr-review-issue→review-docs の一方向参照。**循環なし**（02 §2.1.3 のとおり）。
- **review-docs の位置づけ（M4）**: 「補助手順（auxiliary）」確定が PHASE_COMMAND_MAP.md と PHASES.md の双方に矛盾なく記載され、「本表にない command の起動は禁止」が phase 選択経路に限定されたことで「実在するが起動経路が無い／禁止対象」という矛盾が解消。
- **互換性**: enforcement/README #23 が引き続き「PHASES §レビュー成果物の配置ルール」「run_command §実装前のドキュメントレビュー」を参照し、完了定義の意味が保持されている（監査結果は本変更で変わらない）。
- **指摘・推奨**: なし。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| --- | --- | --- |
| M1/M3 重複本文が正本 1 か所のみ | test_output | grep 実測（§3.1） |
| 相互参照リンクが解決する | existing_code | 参照先ファイル・§見出しの実在確認（§3.2） |
| audit FAIL は本 issue 由来でない | test_output | HEAD vs 作業ツリーの audit 差分（§3.3） |
| review-docs=補助手順の妥当性 | existing_code | PHASE_COMMAND_MAP の phase 行構造・create-pr-review-issue の呼び出し経路に基づく（02 §2.3） |

---

## 5. ドキュメントの確認

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（L1 誤認記録済み・SC-7） | レビューサブ | 2026-06-15 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | レビューサブ | 2026-06-15 |
| [`02_設計.md`](./02_設計.md) | 更新済み | レビューサブ | 2026-06-15 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | レビューサブ | 2026-06-15 |

- **実装と設計の整合性**: 整合（02 §3 の機能 1〜3 が実装に反映）。
- **要件と実装の整合性**: 整合（受け入れ基準 SC-1〜SC-7 を §12 で確認）。

---

## 受け入れ基準の確認（map-coverage）

| 受け入れ基準 | 検証方法 | 結果 |
| --- | --- | --- |
| SC-1 (M1) 完了定義本文が正本 1 か所のみ | grep（§3.1） | **OK**（PHASES.md のみ） |
| SC-2 (M3) 自動適用段落本文が正本 1 か所のみ | grep（§3.1） | **OK**（AGENTS.md のみ） |
| SC-3 (M4-a) review-docs 確定・MAP/PHASES 整合 | 本文確認・review-architecture（§9.2） | **OK**（補助手順確定・矛盾なし） |
| SC-4 (M4-b) create-pr-review-issue:31 委譲一意化 | grep（§3.1） | **OK**（「または」消失） |
| SC-5 新規 .md 追加なし | git status 確認 | **OK**（本 issue 由来の新規 .md なし。`.agents/` の untracked md 3 件は別 issue 由来） |
| SC-6 audit 通過・リンク解決 | 隔離 audit・リンク解決（§3.2-3.3） | **OK**（本 issue 由来の新規 FAIL 0・未解決リンク 0。残存 FAIL は別 issue/環境由来） |
| SC-7 (L1) 誤認の記録 | 00 §5 確認 | **OK**（誤認・根拠記録済み） |

**BDD カバレッジ**（01 UC1〜4 ↔ 03 T1〜T4）: UC1→T1/T4、UC2→T2/T4、UC3→T3、UC4→確認のみ。**全ユースケースが検証済み**。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良。重複本文の正本化・相互参照化・委譲一意化がすべて受け入れ基準どおり実装。
- **テスト品質**: 良。grep／リンク解決／隔離 audit の 3 系統で検証し、本 issue 由来の不合格なし。
- **ドキュメント品質**: 良。00〜03 と実装が整合。
- **総合評価**: **合格（承認可）**。指摘 0 件。

### 12.2 承認状況

- **承認コメント**: SC-1〜SC-7 をすべて充足。audit の残存 FAIL 2 件は別 issue（コア取り込み候補調査）の close 移動由来であり本 issue のスコープ外（test_output で切り分け済み）。本 issue の変更は新規の監査失敗・リンク切れを生じさせていない。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- [.agents/workflow/PHASES.md](../../../../.agents/workflow/PHASES.md) / [.agents/skills/agent/run_command.md](../../../../.agents/skills/agent/run_command.md)（M1）
- [AGENTS.md](../../../../AGENTS.md) / [.agents/GETTING_STARTED.md](../../../../.agents/GETTING_STARTED.md)（M3）
- [.agents/workflow/PHASE_COMMAND_MAP.md](../../../../.agents/workflow/PHASE_COMMAND_MAP.md) / [.agents/commands/review-docs.md](../../../../.agents/commands/review-docs.md) / [.agents/commands/create-pr-review-issue.md](../../../../.agents/commands/create-pr-review-issue.md)（M4）
- [.agents/enforcement/ci/audit.sh](../../../../.agents/enforcement/ci/audit.sh)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 外部設定不要。本 issue はレビュー合格をもって完了（close）へ進む。サブ issue 分割なし（90_issues.md 不要）。
</content>
