<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: PRマージのたびにSPEC/DESIGN/PLAN/VALIDATION.mdがmainルート直下へ恒久的に混入する構造的欠陥の解消

- Issue: `ISSUE-208`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | `root-cleanup run`（新設CLIコマンド）+ `agent-skill-chain / root-cleanup` ワークフロー（新設） | mainへのpush契機で、root直下の当該4ファイルを検出し削除PRをadmin mergeする |
| AC-2 | `checkOutputExists()`/`wasEverAddedOrModified()`（`src/commands/verify.ts`）を一切変更しない設計とする | 新設ロジックはIssueブランチ・worktreeに一切触れず、既存判定と完全に独立させる |
| AC-3 | root-cleanupは常にmain上の短命ブランチ（`chore/root-cleanup-*`）のみを扱い、他Issueのブランチ・worktreeへは一切触れない | 「証跡方式の設計判断」節で、Issueブランチ内削除commit方式を却下した理由を示す |
| AC-4 | `verify root-clean`（新設、`verify.ts`への独立追加）をroot-cleanupワークフロー内の事後確認として使う | SPEC.mdが要求する「automated（mainルート直下ファイル一覧チェック）」の実体 |
| 要件5 | `.agent-skill-chain/config/segments.yaml` の `outputs`、`.agent-skill-chain/templates/issue/` は無変更 | 新設物は既存の「独立した構造検査」カテゴリ（branch-name/worktree-path等と同格）に位置づける |
| 要件6 | 「I5（進行役の純粋性）との整合」節 | 実行主体はCI自動化であり進行役（AI）ではないこと、内容非解釈であることを論証する |

## 責務・境界

### コンポーネント構成

- `root-cleanup run`（`src/commands/root-cleanup.ts`、新設）: repoRoot直下に `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`（固定・非設定化のリテラル4件、`checkOutputExists()`の`code`ケースの除外リストと同一の4件を踏襲）が存在するか検出する。0件なら no-op で終了。1件以上あれば、現在のmain先端から短命ブランチ `chore/root-cleanup-<UTC timestamp>` を作成し、該当ファイルのみを `git rm` して固定メッセージ（`chore: remove stray root-level issue segment artifacts [skip ci]`、Issue固有内容を一切含まない）でcommit・pushし、PRを作成して `gh pr merge --admin --squash --subject` でmainへ反映する。マージ直前に「diffが上記4ファイルの削除のみで構成されているか」のスコープ検査を行い、逸脱時は admin merge を行わず `human_required` として停止する（`release bump`・ADR-0005と同型の安全弁）。同名の未マージ cleanup ブランチ/PRが既に存在する場合は、スコープ検査を通過したときのみ再利用する（冪等、`release bump`と同型）。**引数・設定入力は一切受け付けない**（対象ファイル名はコード内リテラルのみで、`workflow_dispatch`等の外部入力トリガも持たない）。
- `verify root-clean`（`src/commands/verify.ts`への新規独立エクスポート追加、新設）: repoRoot直下に上記4ファイルが存在しないことを確認するだけの単純な存在チェック。`checkOutputExists()`・`wasEverAddedOrModified()`・`segments.yaml`には一切関与しない別関数として追加する。**PRごとの必須ステータスチェック（`main.json`の`required_status_checks`）には追加しない**——Issue自身のPRは開発途中で必ずこの4ファイルを保持するため、PR単位の必須チェックにすると通常のIssueマージ自体を阻害する。あくまでmainへのpush後の事後確認としてのみ用いる。
- `agent-skill-chain / root-cleanup`（`.github/workflows/agent-skill-chain-root-cleanup.yml`、新設。配布元は`.agent-skill-chain/templates/github/.github/workflows/`）: `on: push: branches: [main]` のみをトリガとし、コミットメッセージに `[skip ci]` を含む場合は実行しない（既存 `agent-skill-chain-release.yml` と同型の再帰防止）。`concurrency: {group: root-cleanup}` で同時実行を直列化する。ステップは `root-cleanup run` → `verify root-clean` の順。
- `.agent-skill-chain/scripts/root-cleanup.sh` / `.agent-skill-chain/ci/verify-root-clean.sh`（新設）: 既存の `release-bump.sh`・`verify-branch-name.sh` 等と同型の、CLIサブコマンドへの薄いラッパー。

### 依存関係

```text
Issue PRのマージ（squash） → mainへのpush（[skip ci]なし）
  → agent-skill-chain / root-cleanup ワークフロー起動
    → root-cleanup run
      → repoRoot直下の SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md 存在検出
        → 0件: no-op
        → 1件以上: chore/root-cleanup-* ブランチ作成 → git rm → commit → push
          → スコープ検査（削除のみか） → gh pr create → gh pr merge --admin --squash
    → verify root-clean（新設）でmain最新HEADを再確認、残存していればjob失敗
```

`checkOutputExists()`/`wasEverAddedOrModified()`（Issue #200・#202導入分）は本設計のどの経路からも呼び出されない。`agent-skill-chain-reconcile.yml` は `branches-ignore: [main]` であり、root-cleanupの短命ブランチ・main本体のいずれもgate-reconcileの対象にならない。循環依存なし。

## 証跡方式の設計判断（却下した代替案）

**却下案A: validation_workerが自身のPRブランチ内で、検証完了後に4ファイルを`git rm`する最終commitを打つ。** 一見単純だが、`agent-skill-chain-reconcile.yml`（`branches-ignore: [main]`、つまりIssueブランチへのpush全てが対象）が動作させる`gate-reconcile.sh`は、pushごとに`gate-report`の`approved_artifacts`のdigestを現在のファイルと照合し、ファイルが削除されていれば「digest不一致」として扱い当該ゲートと全下流ゲートを無効化する（`src/commands/verify.ts`の`gateReport()`、`gate-report.schema.yaml`末尾の無効化ルール）。`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`はいずれかのゲートの`approved_artifacts`に含まれるため、この最終commitはマージに必要なゲート成功状態そのものを自己破壊してしまう。したがって却下する。

**却下案B: 進行役（AI）が直接削除する。** `.agent-skill-chain/config/roles.yaml`の`orchestrator`は`forbidden: [artifact_branch.commit, artifact.author]`でありI5により機構的に禁止される。方式によらず採用不可。

**却下案C: 5番目の「cleanup」セグメント/ゲートを新設する。** `segments.yaml`の`outputs`意味変更を伴う破壊的変更でありADR＋AGENTS.md改定＋migrationを要する（要件5で明示的にスコープ外）。本件は立証/反証レビューを要する判断ではなく機械的housekeepingであり、既存の「セグメント非依存の構造検査」（`verify branch-name`/`worktree-path`等）と同格に位置づける方が軽量かつ整合的である。

採用した方式（main post-merge cleanup PR、admin merge）の詳細な比較・却下理由は本判断の由来として `ADR-0007` に記録する。

```yaml
related_adrs:
  - id: ADR-0007
    relation: adopts
```

## I5（進行役の純粋性）との整合

削除の実行主体はCI自動化（`github-actions[bot]`、または既存リリース自動化と同一の権限分離済みcredential）であり、`.agent-skill-chain/config/roles.yaml`が定義するいずれのAIロール（`orchestrator`/`worker`/`gate_reviewer`/`adr_finalization_worker`）にも該当しない。既存の版数bump自動化（Issue #196/#198/#204、`release bump`）と同一カテゴリの、進行役とは別主体によるmainへの直接的な反映であり、進行役の権限・責務には一切変更を加えない。行為の内容も「4件の固定リテラルファイル名のパス一致による削除」のみであり、ファイル内容の読解・解釈・執筆を一切伴わないためI5が禁じる「成果物の著述・内容の取り込み」に該当しない。トリガは`push: branches: [main]`のみで`workflow_dispatch`等の外部パラメータ入力を持たないため、進行役や他の主体がこの仕組みを介して任意ファイルの削除・内容操作を行う迂回経路にもならない。

## 障害・ロールバック考慮

- 想定される失敗モード: 近接した2つのマージが競合し、cleanup PRのpushがnon-fast-forwardで失敗する場合がある。この場合は再fetchして削除対象を再計算し再試行する（対象ファイル集合の再計算は冪等であるため安全）。スコープ検査（削除のみで構成されているか）に失敗した場合は`human_required`として停止し、無関係な変更を伴うmergeは行わない。
- ロールバック手順: cleanup PRのマージcommitを通常のPR同様に`git revert`すれば即座に復元できる（I3、完全可逆）。本設計の変更は新規ファイル追加（`root-cleanup.ts`・ワークフロー・ラッパー・`verify.ts`への独立関数追加）のみに閉じており、既存コマンド・既存判定ロジックの削除・書き換えを伴わない。
- 影響を受ける既存機能: `checkOutputExists()`/`wasEverAddedOrModified()`・`segments.yaml`・`roles.yaml`・既存の4ゲートフローは無変更（AC-2）。現在main root直下に残存しているIssue #202由来のSPEC.md等は、本設計適用後の次回mainへのpush（本Issue自身のマージ含む）で発火するroot-cleanupにより副次的に解消される。
