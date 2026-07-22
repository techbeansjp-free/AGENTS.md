<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0007
status: proposed   # proposed | accepted | superseded | deprecated
title: root直下へのIssueセグメント成果物の恒久混入は、Issueブランチ内削除ではなくmain post-merge cleanup自動化で解消する
tags: [artifacts, ci, merge, root-cleanup, github-workflow]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

AGENTS.md §ディレクトリ構成は、mainリポジトリルート直下を `AGENTS.md`・`CLAUDE.md`・`README.md`・`docs/`・`.github/`・`.worktrees/` のみに限定する。しかし各Issueのworktree直下で作業ワーカーが作成する `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` は、PRがsquash mergeされるたびにmainのルート直下へ持ち込まれ、次のIssueがマージされるまで恒久的に残存する。Issue #200はこの構造的原因（マージ時にこれらのファイルをmainから除外する仕組みが存在しないこと）への恒久対策を明示的に別Issueへ先送りしており、その別Issueが起票されないまま、以降にマージされた Issue #204・#202 は自身の4ファイルを削除せずにマージされ、mainルート直下にはIssue #202由来の内容が現在も残存している（Issue #208、本ADRの起点）。

恒久対策の実現方式として、以下3案を検討した。

1. **Issueブランチ内削除commit案**: validation_worker（またはいずれかのセグメント作業ワーカー）が、自身のPRブランチ上で検証完了後に4ファイルを`git rm`する最終commitをpushする。squash mergeの性質上、mainとの差分は正味ゼロになりmainに一切現れなくなる。
2. **main post-merge cleanup自動化案**: マージ後のmainへのpushを契機に、CI自動化が短命ブランチ上で4ファイルを削除するPRを作成し、admin mergeでmainへ反映する。
3. **5番目のcleanupセグメント/ゲート新設案**: 4セグメント・4ゲートモデルに、マージ前の後処理を担う新セグメントを追加する。

案1は、実装調査の過程で致命的な技術的欠陥が判明した。`.github/workflows/agent-skill-chain-reconcile.yml`は`branches-ignore: [main]`でありIssueブランチへの全pushを対象に`gate-reconcile.sh`を実行する。このスクリプトはpushごとに`gate-report`の`approved_artifacts`（各ゲートが承認したファイルパスとdigestの一覧。`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`はいずれかのゲートで承認済み成果物として記録される）を現在のファイルと照合し、`src/commands/verify.ts`の`gateReport()`はファイルが削除されていれば「digest不一致」として扱い、当該ゲートと全下流ゲートを無効化する（`gate-report.schema.yaml`末尾の無効化ルール）。したがって案1の最終commitは、マージに必要な全ゲート成功状態そのものを自己破壊してしまい、実行不能である。

案3は、`.agent-skill-chain/config/segments.yaml`の`outputs`の意味変更を伴う破壊的変更であり、AGENTS.mdの規約によりADR＋AGENTS.md改定＋schema_version更新＋migrationを要する重い変更である。本件は立証(conformance)/反証(falsification)の2観点レビューを要する判断ではなく、機械的なhousekeepingであり、この重さに見合わない。

## Decision

案2（main post-merge cleanup自動化）を採用する。CI自動化（`root-cleanup run`、既存のリリース自動化と同一の権限分離済みcredential）が、mainへのpush（`[skip ci]`を含まないもの）を契機に、repoRoot直下の`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`（コード内リテラル4件、設定化しない）の存在を検出し、1件以上あれば短命ブランチ`chore/root-cleanup-*`上で該当ファイルのみを`git rm`し、既存の`release bump`（Issue #196、ADR-0005）と同型のPR作成→スコープ検査→`gh pr merge --admin --squash --subject`によりmainへ反映する。この方式はIssueのブランチ・worktree・gate-reconcileの対象範囲に一切触れないため、案1が抱える自己破壊問題が構造的に発生しない（`agent-skill-chain-reconcile.yml`は`branches-ignore: [main]`であり、cleanup用の短命ブランチ・main本体のいずれもgate-reconcileの対象にならない）。

対象ファイル名を設定可能にする案は採用しない。ADR-0006が同種の判断（`unit_test_results`のテストディレクトリパス）で示した理由（プロジェクト単位で変わる具体的必要性が本Issue時点で提示できないこと）をそのまま踏襲する。将来、他のディレクトリ配置規約を持つconsumer projectからの実需が生じた場合に、そのときの新たなADR＋config schema更新として再検討する。

## Consequences

- 利点: `checkOutputExists()`/`wasEverAddedOrModified()`（Issue #200・#202導入分）・`segments.yaml`・`roles.yaml`を一切変更せずに実現でき、既存の4セグメント・4ゲートフロー、および進行中の他Issueのブランチ・gate-reconcileには構造的に影響を与えない。既存のリリース自動化（Issue #196/#198/#204）と同一のCI bot主体・admin mergeパターンを再利用するため、新規の権限モデル・新規credentialを追加しない。副次効果として、現在mainルート直下に残存しているIssue #202由来の4ファイルも、本対策適用後の次回mainへのpush（本Issue自身のマージを含む）で自動的に解消される。
- 欠点・フォローアップ: マージ完了からcleanup PRのマージ完了までの間、短時間ではあるがmainルート直下に当該4ファイルが存在する window が生じる（完全な即時性は持たない）。近接する複数マージが競合した場合のpush再試行、および削除以外の変更を検出した場合の`human_required`停止は`root-cleanup run`の責務としてDESIGN.md/PLAN.mdで具体化する。対象ファイル名のハードコードは、他のディレクトリ配置規約を持つプロジェクトへ配布する段階になった場合、設定可能化を別ADRとして再検討する必要がある。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。
