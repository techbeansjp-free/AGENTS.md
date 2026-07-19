---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "a4e6e703-4d18-4f8a-a8b3-706bb2bd776b"
---

# レビュー書: 実装着手前ゲートの直列化過多（quick モード免除）

**プロジェクト名**: 実装着手前ゲートの直列化過多
**作成日**: 2026 年 07 月 15 日
**最終更新**: 2026 年 07 月 15 日

> 本レビューは verify-and-close フェーズの独立検証（opus ティア）である。実装サブの自己申告値ではなく、worktree 上で `test/test-audit.sh`・`test/run-all.sh`・`enforcement/ci/audit.sh` を**独立実測**し、audit.sh の diff を機械確認した結果に基づく。

---

## 1. レビュー概要

### 1.1 レビュー目的

00 §6 成功基準「モード別ゲート適用条件（免除の有無）が regs に明記され、実行モードとゲート群の記述に矛盾がない状態」と、00 §ユーザー判断（quick は #32・#34 を免除、#35 は規模に関係なく維持）が、02_設計・03_実装計画どおりに実装されたことを確認する。特に **#35（branch 紐づけゲート）が mode を一切参照しない**こと（ユーザー決定の中核）を audit.sh の diff で機械確認する。

### 1.2 レビュー対象（変更ファイル・今回の実装分）

- `.agent-skill-chain/source/RULES.md` — quick 行に #32/#34 免除・#35 維持・「記録省略ではない」を明記。表下に mode 信号（00 frontmatter `mode:`・欠落時 standard）の正本定義を追加。
- `.agent-skill-chain/source/skills/agent/run_command.md` — Constraints #47（review-docs）/#48（GitHub Issue）に quick 免除、#49（branch）に「モードに関係なく維持・#35 は mode 非参照」を明記。
- `.agent-skill-chain/source/workflow/PHASES.md` #65/#66 — review-docs／GitHub Issue ゲートを mode 別適用へ改訂（正本参照）。
- `.agent-skill-chain/source/workflow/PHASE_COMMAND_MAP.md` §横断的必須ゲート — review-docs を「full/standard 一律必須・quick 免除」へ改訂。
- `.agent-skill-chain/source/commands/design-feature.md` DoD #61・注意 #73 — mode 別適用へ整合。
- `.agent-skill-chain/source/enforcement/README.md` 失敗条件レジストリ — #32/#34 行に quick SKIP、#35 行に「mode 非参照＝quick でも発火」を明記。
- `.agent-skill-chain/source/enforcement/ci/audit.sh` — ヘルパー `get_issue_mode` 新設、#32/#34 に mode:quick SKIP ガードを追加。**#35（`check_branch_linkage_before_implement`）は無改造**。
- `.agent-skill-chain/runtime/templates/00_要求定義.md` — frontmatter に `mode: standard`（既定）＋意味コメントを追加。
- `test/test-audit.sh` — #32/#34/#35 の mode 回帰テスト 7 シナリオを BDD 形式で追加。

---

## 2. 受け入れ基準の確認

| 受け入れ基準（00 §6 成功基準・01 §2.2 BDD） | 実測 | 結果 |
| --- | --- | --- |
| モード別ゲート適用条件が regs に明記され矛盾がない | RULES/run_command/PHASES/PHASE_COMMAND_MAP/design-feature/README の 6 ファイルで「full/standard 必須・quick 免除」「#35 は mode 非参照で維持」が一貫（実読） | PASS |
| quick は #32 を SKIP（review-docs 0 件でも FAIL しない） | test-audit.sh シナリオ8 で mode:quick → #32 SKIP を実測 PASS | PASS |
| quick は #34 を SKIP（github_issue null でも FAIL しない） | test-audit.sh #34 シナリオ9 で mode:quick → #34 SKIP を実測 PASS | PASS |
| quick でも #35 は FAIL（branch null 時・mode 非参照） | test-audit.sh #35 シナリオ7 で mode:quick+branch null → #35 FAIL を実測 PASS | PASS |
| full/standard は #32/#34 が従来どおり FAIL | #32 シナリオ9・#34 シナリオ10 で mode:standard → FAIL を実測 PASS | PASS |
| mode 欠落は standard 扱いで免除しない（fail-safe） | #32 シナリオ10 で mode キー無し → FAIL を実測 PASS | PASS |
| 免除は軽量化であり記録省略ではない | RULES quick 行・run_command #47/#48・template コメントに「設計メモ＋変更理由・workflow.db 証跡は残す」を明記（実読） | PASS |
| 単一正本 mode 信号（00 frontmatter `mode:`） | RULES 表下に正本定義・template に記入欄・audit.sh `get_issue_mode` が 00 を read（実読・実装確認） | PASS |

---

## 3. 実装内容の確認

### 3.1 実装完了タスク（03 §2 と対応）

| タスク | 実装内容 | ステータス |
| --- | --- | --- |
| T-A mode 正本・テンプレート | RULES.md §実行モードに mode 別ゲート適用＋mode 信号定義。00 テンプレートに `mode: standard`＋コメント | 完了 |
| T-B 規約ドキュメント整合 | run_command #47/#48/#49、PHASES #65/#66、PHASE_COMMAND_MAP、design-feature #61/#73 を mode 別適用へ改訂 | 完了 |
| T-C enforcement レジストリ | README 失敗条件表 #32/#34 に quick SKIP、#35 に mode 非参照を明記 | 完了 |
| T-D audit.sh mode ガード | `get_issue_mode` 新設・#32/#34 に mode:quick SKIP、#35 無変更 | 完了 |
| T-E テスト・整合検証 | test-audit.sh に #32×3・#34×2・#35×1 の BDD 回帰シナリオ追加 | 完了 |

### 3.2 audit.sh mode ガードの実装確認

- **ヘルパー `get_issue_mode`**: 00_要求定義.md の frontmatter（`awk` で `---`〜`---` ブロック抽出）から `mode:` を `grep -m1` で取り、`sed` トリム＋前後クオート（`"`/`'`）除去＋小文字化（`${mode_val,,}`）して返す。00 不在・mode 欠落は空文字を返し、呼び出し側は「quick 以外＝非免除」で従来判定する（fail-safe）。DB/FS 書き込みは無く read-only。02_設計 §3.2・ADR-2 と一致。
- **#32 ガード**: `check_reviewdocs_before_implement` の per-issue ループで、grandfather 判定直後・implement ログ判定の前に `get_issue_mode "$issue_dir/00_要求定義.md" == "quick"` なら `continue`。02_設計 ADR-5（grandfather 直後・per-issue 粒度）どおり。
- **#34 ガード**: `check_github_issue_before_implement` の同ループで、走査中の `$f`（＝00_要求定義.md）から mode を取り quick なら `continue`。冒頭のプロジェクト全体トグル `GITHUB_ISSUE_GATE_ENABLED` SKIP は不変。
- **#35 は無改造（ユーザー決定の中核・特に重要な確認）**: `git diff main...HEAD -- audit.sh` の追加・削除行を機械抽出した結果、`check_branch_linkage_before_implement`／`BRANCH_LINK` を含む `+`/`-` 行は **0 件**。#35 関数は mode を一切参照せず、branch null なら quick でも FAIL する（test-audit.sh #35 シナリオ7 で実測確認）。02_設計 ADR-3 と完全一致。

---

## 4. テスト結果の確認（独立実測）

### 4.1 audit 単体テスト

- **実行**: `bash test/test-audit.sh`
- **結果**: **PASS=129 FAIL=0**（実装フェーズ報告 129/129 を再現）。追加した mode 回帰 7 シナリオ（#32 quick SKIP／standard FAIL／欠落 FAIL、#34 quick SKIP／standard FAIL、#35 quick でも FAIL）を含め全 PASS。

### 4.2 一括テスト

- **実行**: `bash test/run-all.sh`
- **結果**: **合計=21 PASS=15 FAIL=0 SKIP=6**（exit 0）。実装フェーズ報告（15 PASS/0 FAIL/6 SKIP）を再現。

### 4.3 audit.sh 実行（本変更に起因する新規 FAIL の非発生）

- **実行**: `bash .agent-skill-chain/source/enforcement/ci/audit.sh .`（worktree・exit 0）。
- **確認手法**: worktree の FAIL 集合と main baseline の FAIL 集合を `sort`＋`diff` で比較。branch 側の FAIL は main 側の FAIL の**部分集合**（branch 固有の FAIL 行は 0 件）。残存 FAIL はすべて本 issue の変更ファイル**外**（他サブ issue の 04_review.md の docs 更新要否未記載、`src/agents-md.ts` の #26 コメント参照、`docs/00_review/*` の #37）で、既知・既存事項。
- **本 issue ディレクトリ（163206）を指す FAIL は 0 件**（grep で確認）。
- **注**: worktree には workflow.db が無いため #29/#32/#34/#35 は SKIP される。mode ガード自体の PASS/FAIL/SKIP 挙動は隔離 DB を用いる test-audit.sh（§4.1）で検証済み。

---

## 5. コードレビュー

- **可読性**: `get_issue_mode` は責務単一（mode 抽出・正規化）で、#32/#34 のガード呼び出しは各 1 行。コメントに免除の意味・fail-safe・ADR 番号を明記。
- **保守性**: mode 抽出ロジックを 1 ヘルパーへ集約し #32/#34 で共用。既存 #34 の frontmatter awk と同型のため既存パターンに整合。
- **回帰安全性**: #35・grandfather・トグル・close/templates 除外は無改造。ガードは grandfather 判定の後段・implement ログ判定の前段に置かれ、既存 SKIP を阻害しない。read-only で副作用なし。
- **fail-safe の正しさ**: quick 厳密一致のみ SKIP。欠落・不明値・大文字（小文字化後に不一致なら非 quick）・00 不在はすべて従来判定へ倒れる。test-audit.sh 欠落シナリオで実証。

### 5.1 指摘事項

- **指摘 1（情報・対応不要）**: worktree の workflow.db は gitignore 配下かつ未生成のため audit の DB 系チェックは worktree・CI とも SKIP。mode ガードの機能検証は隔離 DB の test-audit.sh が担保しており、PR 合否に影響しない。
- **指摘 2（軽微・許容）**: `get_issue_mode` は #32 では `$issue_dir/00_要求定義.md`、#34 では走査中の `$f` を渡す。#34 の走査対象は元々 00_要求定義.md であり参照先は一致。設計（02 §3.2）どおりで問題なし。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本変更は enforcement 基盤（`.agent-skill-chain/source/` の規約ドキュメントと audit スクリプト）およびランタイムテンプレート・テストに閉じ、`docs/` 配下のシステム仕様書（機能・画面・データ・API）の内容には影響しないため。

---

## 6. 設計・境界の確認

- **設計原則の準拠**: 「正本 1 か所・二重管理禁止」を自己適用。実行モード定義の正本は RULES.md §実行モード、免除条件の正本は run_command §Constraints、機械可読な mode 信号の正本は 00 frontmatter `mode:` に集約。PHASES/PHASE_COMMAND_MAP/design-feature/README は参照・整合記述に徹し、判定ルールを再掲していない。
- **境界の維持**: 規約層（人間の進行役が読む正本）と強制層（audit.sh）を単一 mode 信号で貫通させ、両面で矛盾のない状態を実現。#35 の非対象化はコア方針（branch は規模非依存で維持）どおり。
- **後方互換**: 既存 issue（mode 欠落）は standard 扱いで挙動不変。既存の grandfather 発効日・frontmatter を破壊しない。緩和のため新規 EFFECTIVE_FROM を設けていない（ADR-4）。

### 6.1 重要判断の根拠（evidence_source）

| 判断 | evidence_source | 備考 |
| --- | --- | --- |
| #35 が mode を一切参照しない | existing_code / test_output | audit.sh diff に #35 関数の +/- 行 0 件・test-audit.sh #35 シナリオ7 で quick+null→FAIL |
| quick 免除が #32/#34 で機能・fail-safe が効く | test_output | test-audit.sh の mode 7 シナリオ全 PASS（129/129） |
| 本変更に起因する新規 FAIL 無し | test_output | branch FAIL ⊆ main FAIL（diff で branch 固有 0 件） |

---

## 7. REVIEW_DUAL_LENS（#27・両リスト必須）

### A. 敵対的観点（壊れ得る所を能動的に探した結果）

1. **#35 が実は mode を参照するよう変わっていないか** → audit.sh diff の `+`/`-` 行を機械抽出し `check_branch_linkage`／`BRANCH_LINK` 該当 0 件。test-audit.sh #35 シナリオ7 で quick+branch null→**FAIL 維持**を実測。**#35 は不変**。
2. **免除範囲が quick 以外へ誤拡大していないか** → #32 シナリオ9（standard→FAIL）・#34 シナリオ10（standard→FAIL）で quick 以外は従来 FAIL を実測。**誤拡大なし**。
3. **mode 欠落で免除に倒れ品質が抜けないか（fail-open 事故）** → #32 シナリオ10（mode キー無し→FAIL）で fail-safe を実測。空文字→非 quick。**安全側に倒れる**。
4. **既存 grandfather／トグル SKIP がガード追加で壊れないか** → ガードは grandfather 判定の直後・per-issue ループ内に配置、冒頭トグルは不変。test-audit.sh 既存回帰（#32/#34/#35 の従来シナリオ）全 PASS。**破損なし**。
5. **規約 6 ファイル間で免除条件が食い違わないか** → 全ファイルで「full/standard 必須・quick 免除・#35 は mode 非参照」で一致（実読）。旧断定「全 issue 一律・免除なし」は full/standard 限定へ改められ、残存箇所は意図どおり。**矛盾なし**。
6. **クオート付き・大文字 mode で判定が破れないか** → `get_issue_mode` が前後クオート除去＋小文字化。`"quick"`・`QUICK` も quick 判定、それ以外は非 quick。**設計どおり**。

### B. must-preserve（壊してはならない既存挙動・保持を確認）

1. **#35（branch 紐づけ）の発火ロジック** → 関数無改造で保持（quick でも branch null なら FAIL）。
2. **#32/#34 の grandfather（EFFECTIVE_FROM）・#34 の全体トグル `GITHUB_ISSUE_GATE_ENABLED`** → 位置・値ともに不変。ガードは後段の追加 SKIP。
3. **close/templates/90_issues 除外・前方一致＋basename 末尾一致の走査** → 無改造で保持。
4. **既存 issue（mode 欠落）の従来判定** → standard 扱いで挙動不変（fail-safe）。
5. **audit の read-only 性（DB/FS 非書き込み）** → `get_issue_mode` は read のみ。保持。

---

## 8. 総合評価

- **総合評価**: **PASS**。00 §6 成功基準・§ユーザー判断（quick は #32/#34 免除、#35 は規模非依存で維持）を 02_設計・03_実装計画どおりに達成。#35 が mode を一切参照しないことを audit.sh diff と test-audit.sh #35 シナリオで二重に確認。test-audit.sh 129/129 PASS・run-all 15 PASS/0 FAIL/6 SKIP を再現。本変更に起因する新規 FAIL は無い（branch FAIL は main FAIL の部分集合）。

---

## 9. 前のステップ・次のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md)
- **次**: 本レビュー承認後、commit / push / PR（main へ統合）。PR マージは進行役・ユーザー判断。
