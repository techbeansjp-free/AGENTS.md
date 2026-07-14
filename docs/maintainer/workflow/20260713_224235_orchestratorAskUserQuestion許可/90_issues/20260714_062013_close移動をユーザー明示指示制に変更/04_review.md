---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "3f2a9c14-6d5b-4e07-9a1c-8b47e2f5a930"
---

# レビュー記録: close 移動をユーザー明示指示制に変更（verify-and-close）

**プロジェクト名**: close 移動をユーザー明示指示制に変更
**作成日**: 2026 年 07 月 14 日
**issue_id**: `91aa0b10-12ee-4a8d-a9cb-0eb6e5077184`
**親 issue**: [`../../00_要求定義.md`](../../00_要求定義.md)（orchestrator AskUserQuestion 許可、issue_id: `62b7c166-baa6-4d40-9f6b-f79ffe83a11d`）
**設計書**: [`02_設計.md`](02_設計.md)（document_id: `c1338e9b-c854-4d73-9eb3-30ef1ce14483`）
**実装計画**: [`03_実装計画.md`](03_実装計画.md)（document_id: `be2faefe-6756-4c04-a00f-a15e16f85efc`）
**ブランチ / PR**: `docs/orchestrator-askuserquestion-gate` / PR #38（親 issue に集約・追加コミット）
**レビューモード**: full（ユーザー指示により肯定的＋敵対的の二観点を必須適用。[REVIEW_DUAL_LENS.md](../../../../../../.agent-skill-chain/source/REVIEW_DUAL_LENS.md) 準拠）

> 本記録は verify-and-close の skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）の産物。実装前 review-docs（[memo/20260714_083932_review-docs.md](memo/20260714_083932_review-docs.md)）の両観点結論を継承し、実装後の実体（`git diff`）に対して再検証した。

---

## 1. 実装成果物（スコープ確認）

本 issue はドキュメント（実行契約）改訂のみ。実装フェーズの差分（`git diff HEAD`）は次の 2 ファイルに限定されることを確認した。

| ファイル | 変更内容 | 行数 |
| --- | --- | --- |
| `.agent-skill-chain/source/workflow/PHASES.md` | §完了 issue の close 移動 の「close ステップ」直後に「実行確定手段（分岐・原則）」箇条を 1 件新設（原則のみ・具体は project 委譲） | +1 箇条 |
| `.agent-skill-chain/project/自己拡張ワークフロー.md` | §完了 issue の close 移動（上書き）に「### 実行確定の 2 分岐（本リポ具体）」小節を追加＋§CI 具体値 に猶予再解釈バレットを 1 件追加 | +19 行 |

新規ドキュメント（本 issue 直下の `00_要求定義.md`・`02_設計.md`・`03_実装計画.md`・本 `04_review.md`）は成果ドキュメントとして別枠。

**スコープ境界の厳密確認（重点確認事項 #1・#4）**:

- `git diff main -- .agent-skill-chain/source/enforcement/ci/audit.sh` は**空**（`check_close_move_pending` を含め audit.sh はコミット・作業ツリーとも無変更）。→ CI #33 のコード不変を最終確認（成功基準 効果3・ADR-5・MP-2）。evidence_source: repo_file, `git diff main`／`git log main..HEAD -- audit.sh`（該当コミット 0 件）。
- `CORE.md`・`enforcement/README.md` の差分は存在するが、**いずれも close 移動とは無関係**（それぞれ「enforcement ロックアウトからの復旧」宣言、「orchestrator allowlist の project 拡張点」記述＝親 issue 本体＝AskUserQuestion 許可の成果物）。close 移動節に相当する変更は**両ファイルとも無い**。→ MP-3（CORE §close 分離 の宣言不変）・ADR-4（配置境界）保持。evidence_source: repo_file, `git diff main -- CORE.md / enforcement/README.md` の実読。

---

## 2. 受け入れ基準の確認（generate-scenarios / map-coverage）

00 §6 成功基準・FR・効果と、実装実体（`git diff`・`grep`）の対応表。全項目 PASS。

| 00 成功基準 / FR / 効果 | 検証方法 | 結果 |
| --- | --- | --- |
| **FR-1**（PHASES トリガー節に「ユーザー明示指示＝git mv 必須条件」「進行役自己判定のみ禁止」を明記） | `grep -nE 'PR 経由\|direct push\|ユーザーの明示指示' PHASES.md` → :77 でヒット。文中に「GitHub 非連携時は…ユーザーの明示指示を受けてから移動する（進行役の自己判定のみでの移動は行わない）」を確認 | PASS（AC-1） |
| **FR-2**（CI #33 の扱いを ADR 化・結論＋理由＋evidence） | 02 ADR-5 に「コード・仕様不変・猶予の意味のみ運用再解釈」の結論と evidence_source（README:299／audit.sh:1007-1012）を確認 | PASS（AC-4） |
| **FR-3**（PR 統一の採否＋理由を 02 ADR に記録・採用時は 03 反映） | 02 ADR-6「GitHub 連携時のみ PR 統一採用」＋理由を確認。03 T2 分岐 A（feature branch→リンク補正→git mv→gh pr create→レビュー→マージ）へ反映済み | PASS（AC-5） |
| **成功基準 4**（第三者が「完了検知後は PR マージ／ユーザー指示を経て close 移動」と一意に読み取れる） | PHASES.md:77＋自己拡張:202-215 を実読。完了検知 →（連携:PR マージ／非連携:ユーザー明示指示）→ close 移動 の順序が一意に読める | PASS（AC-6） |
| **効果 3**（完了検知・CI #33 不変） | audit.sh 無変更・README #33 無変更・PHASES の「完了の定義」「移動の検知（汎用原則）」箇条が `git diff` で無変更（新設箇条のみ +） | PASS（AC-2） |
| **効果 4**（判定シグナルを既存と同一として明記・重複実装回避） | 自己拡張:204 で §3「`git remote -v` に `github.com`」（audit.sh #34 SKIP と同一・ADR-4）を参照のみで再利用。新規判定ロジック無し | PASS（AC-3） |

**BDD 相当（03 §5）の充足**:

- Given GitHub 連携リポ / When トップレベル完了検知 / Then direct push で確定せず feature branch→PR→マージ経路 → PHASES:77・自己拡張:205-210 の文言で担保。PASS。
- Given GitHub 非連携リポ / When トップレベル完了検知 / Then AskUserQuestion 肯定応答 or 明示コマンド句まで移動しない → 自己拡張:211-215 で担保。PASS。
- Given 本改訂 / When `git diff` / Then enforcement #33・CORE.md 宣言に変更無し → §1 で確認。PASS。
- Given 分岐 A/B の手順 / When 手順を読む / Then リンク補正・検証が移動前完結・移動後 close/ 配下を読まない → 自己拡張:207・214 で「移動前に完結」を明記。PASS（MP-5）。

**カバレッジ欠落**: なし。全 FR・効果・成功基準・BDD が実装実体に写像され、未達 0 件。

---

## 3. 実装内容の確認（review-code）

- **規約遵守**: 追記は既存の箇条スタイル・用語・参照リンク深度（同ファイル内 §参照中心）を踏襲。最小差分。R2（リンク深度誤り）該当なし。
- **実装前 review-docs 指摘 #1（A-7: CI #33 猶予再解釈の記載二重化）の解消を実体で確認**: 自己拡張ワークフロー.md 上で、2 分岐小節の「CI #33 との関係」バレットは「実体記載は §close 移動未実施の検知（CI・具体値）の 1 か所に置く。本節からはそれを**参照するのみ**」とし、実体（「猶予の意味（実行確定 2 分岐に伴う再解釈）」）は §CI 具体値 の 1 か所のみに記載。→ 同一文の実体重複は無く、1 ファイル 1 責務・重複禁止（MP-7）を保持。evidence_source: repo_file, `git diff HEAD -- 自己拡張ワークフロー.md` の実読。
- **テスト**: 実行コード変更が無いためユニットテストは無し。受け入れ確認は grep・`git diff`・目視で実施（§2）。CI（audit.sh）は無変更のため既存グリーンを維持（回帰リスクなし）。
- **非干渉（重点確認事項 #2）**: 分岐 B(i) が依存する `AskUserQuestion` は、親 issue 本体が `PreToolUse.sh`（:236 の R2 orchestrator allowlist）へ追加済みであることを確認。サブ issue の変更（PHASES/自己拡張の 2 ファイル）と親 issue 本体の変更（PreToolUse.sh・CORE.md 復旧宣言・README allowlist 記述・project allowlist 機構）は**責務が非交差**で、矛盾・衝突なし。分岐 B(ii)（明示コマンド句）が(i)未稼働時のフォールバックとなるためハード依存の単一障害点も無い。

---

## 4. 設計・境界の確認（review-architecture）

- **3 層分担の保持**: 宣言（CORE.md・不変）→ ライフサイクル原則（PHASES.md・分岐原則を追記）→ 本リポ具体（自己拡張ワークフロー.md・判定シグナル/PR/AskUserQuestion 手順）の一方向委譲を維持（ADR-4）。トリガー分岐は「いつ・どう移動するか」＝ライフサイクル詳細のため PHASES の責務に正しく配置され、宣言（CORE）不変は妥当。
- **参照方向**: CORE→PHASES→自己拡張→（§3 判定シグナル・§リンク補正手順）の一方向。循環参照なし。判定シグナルは単一情報源（§3・audit.sh #34）を参照のみで再利用（MP-6）。
- **CI #33 との整合**: #33 は Query 専任（`git mv` 非強制・完了済み未移動の検知のみ）であり、実行確定トリガーを変えても検知目的は不変。分岐 B の「完了したがユーザー指示待ち」状態を放置防止リマインダとして督促し続ける設計は整合的（ADR-5・MP-2）。

---

## 5. 敵対的観点リスト（反証・破壊を試みた観点と結論）

| # | 攻めた観点 | 反証試行 | 結論 |
| --- | --- | --- | --- |
| AD-1 | 実装差分が申告どおり 2 ファイルに限定され、CORE/enforcement/audit.sh を実は触っていないか | `git diff HEAD --stat`＝PHASES.md/自己拡張の 2 ファイルのみ。`git diff main -- audit.sh`＝空。CORE/README の差分は close 移動と無関係（allowlist/復旧宣言＝親本体） | 問題なし。スコープ境界厳守を実体確認 |
| AD-2 | 過去の direct push 事例（41d2722 型）が分岐 A で再発する抜け道はないか | 分岐 A は「PR 経由に統一・main への direct push で確定してはならない」を明記。ただし**機械強制（hook で git push を block）は無い**＝うっかり direct push は技術的には依然可能。設計は §3.3 で「人手監査領域・#24/#25 同型」と正直に開示し過大主張していない。00 のスコープは「トリガー規則の文書化」であり機械強制は要求外 | 問題なし（残余リスクとして§7に記録。文書規約＋PR 紐づけ監査#36＋通常 PR 運用が実効的抑止。要求範囲は充足） |
| AD-3 | 分岐 B「明示指示」の判定が曖昧で、進行役が推測移動する誤発火余地はないか | (i)AskUserQuestion 肯定応答 or (ii)明示コマンド句に限定し「**進行役が『指示があったと推測』して移動してはならない**」の否定規範を明記（ADR-7）。自然言語句の残存曖昧性はあるが否定規範で誤発火を抑止。発話は痕跡を残さず機械強制不能（#22-#24 同型）を正直に開示 | 問題なし（否定規範＋構造化確認経路で緩和。過大主張なし） |
| AD-4 | CI #33 のコード不変が「本当に検知条件へ影響しない」か（トリガー変更が猶予判定式に波及しないか） | #33 は 04_review.md 検出＋verify-and-close ts_utc からの猶予超過判定のみ。実行確定手段（PR/ユーザー指示）は #33 の入力（完了検知・ts_utc）に一切影響しない。猶予は「意味の再解釈」のみで閾値・grandfather・式・メッセージは不変 | 問題なし。コード不変は構造的に妥当 |
| AD-5 | PHASES への追記が既存「完了の定義」「移動の検知（汎用原則）」箇条を破壊していないか | `git diff HEAD -- PHASES.md`＝新設「実行確定手段」箇条の +1 のみ。既存 2 箇条に -/+ なし（挿入は close ステップ直後・検知箇条と非干渉） | 問題なし（MP-1・T-2 保持） |
| AD-6 | 自己拡張内で CI #33 猶予再解釈が二重実体記載されていないか（実装前 A-7 指摘の実装反映） | 2 分岐小節は「参照のみ」、§CI 具体値 に実体 1 か所。実体重複なし | 問題なし（指摘 #1 の解消を実体確認） |
| AD-7 | 分岐 B(i) が親 issue の allowlist 追加に依存し未マージで破綻しないか | 同一 PR #38 で着地。仮に(i)未稼働でも(ii)明示コマンド句で運用可能＝単一障害点なし。`PreToolUse.sh:236` に AskUserQuestion が既に列挙済みであることも確認 | 問題なし |

判断が不確実な項目は安全側（要記録）に倒した結果、**新規のブロッキング指摘 0 件**。AD-2 の機械強制不在は仕様上の意図的スコープ外であり残余リスクとして §7 に記録する。

---

## 6. must-preserve リスト（壊してはならない不変条件と保持確認）

| # | 不変条件（must-preserve） | 本改訂での保持確認 |
| --- | --- | --- |
| MP-1 | 完了検知ロジック（verify-and-close DoD＝04_review.md＋書記記録・トップレベル残タスク無し）を変更しない | `git diff` で完了定義箇条無変更。ADR-1・AD-5。保持 |
| MP-2 | CI #33（check_close_move_pending）の Query 専任・grandfather・猶予判定式・閾値・FAIL メッセージを変更しない | audit.sh/README #33 が `git diff main` で無変更。ADR-5・AD-4。保持 |
| MP-3 | CORE.md §close 分離 の宣言不変（宣言→ライフサイクル→具体の 3 層分担） | CORE.md の差分は close 移動と無関係な復旧宣言のみ。close 分離節は無変更。ADR-4。保持 |
| MP-4 | 移動先パス（`docs/maintainer/workflow/close/<issue>/`）・相対リンク深度補正の手順本体を変更しない | 追記は手順本体を参照するのみ（新設せず）。00 §5 除外要件。保持 |
| MP-5 | 「リンク補正・検証は移動前に完結／移動後 close/ 配下を Read/Grep/Glob しない」強制手順（.claude/settings.json deny 対応） | 分岐 A 手順2・分岐 B とも「移動前に完結」を明記。ADR-9・AD なし。保持 |
| MP-6 | GitHub 連携判定シグナルの単一情報源（自己拡張 §3・audit.sh #34 と同一）を重複実装しない | §3 を参照のみで再利用。ADR-3。保持 |
| MP-7 | 記載粒度分担（汎用原則=コア PHASES／具体=project）と 1 ファイル 1 責務・重複禁止 | 原則=PHASES／具体=自己拡張の分離を維持。ファイル内 CI 再解釈も参照/実体を分離。AD-6。保持 |

---

## 7. 残余リスク・申し送り

- **RR-1（AD-2 由来・低）**: close 移動の direct push 防止は**機械強制ではなく文書規約＋人手監査**（enforcement #22-#24/#25 と同型・発話や push 経路に機械検知の痕跡が残らない）。分岐 A は PR 紐づけ監査 #36・通常 PR 運用が実効的抑止として働く。将来、pre-push フックで「close/ への git mv を含む main への直接 push」を検知する機械ゲートを追加する余地はあるが、本 issue のスコープ（トリガー規則の文書化）外であり別 issue 相当。00 の成功基準は本残余リスクを許容している（機械強制を要求していない）。

---

## 8. レビュー結論

- **判定**: PASS（承認可）。00 の全 FR・効果・成功基準を実装実体が充足し、未達・ブロッキング指摘 0 件。
- **反復結果**: 実装前 review-docs（round-1/2）で検出・解消済みの指摘 #1（CI #33 二重化）が実装で正しく反映されていることを確認。実装後レビューで新規指摘 0 件（残余リスク RR-1 は仕様上のスコープ外・申し送りのみ）。
- **evidence_source の種別**: 本レビューの重要判断は repo_file（`git diff`・`grep`・対象ファイル実読）と human_decision（00 に記録されたユーザー決定）に基づく。inference_only のみに依存する承認判断はない。
- **DoD 充足**: issue 直下に本 04_review.md を作成（絶対必須）／敵対的観点リスト（§5）・must-preserve リスト（§6）の両方を記載（REVIEW_DUAL_LENS §3）。次段 write-workflow-log で証跡記録。

---

## 9. 参考

- [00_要求定義.md](00_要求定義.md) / [02_設計.md](02_設計.md) / [03_実装計画.md](03_実装計画.md)
- [memo/20260714_083932_review-docs.md](memo/20260714_083932_review-docs.md)（実装前二観点レビュー）
- [`.agent-skill-chain/source/workflow/PHASES.md`](../../../../../../.agent-skill-chain/source/workflow/PHASES.md) §完了 issue の close 移動（改訂対象）
- [`.agent-skill-chain/project/自己拡張ワークフロー.md`](../../../../../../.agent-skill-chain/project/自己拡張ワークフロー.md) §完了 issue の close 移動（上書き）（改訂対象）
- [`.agent-skill-chain/source/REVIEW_DUAL_LENS.md`](../../../../../../.agent-skill-chain/source/REVIEW_DUAL_LENS.md)
