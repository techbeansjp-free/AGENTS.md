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
| AC-3 | root-cleanupは常にmain上の短命ブランチ（`chore/root-cleanup-*`）のみを扱い、他Issueのブランチ・worktreeへは一切触れない | 「証跡方式の設計判断」節で却下理由を示す。自動検証はPLAN.mdの専用タスク（並行Issue不干渉テスト）で行う |
| AC-4 | `verify root-clean`（新設、`verify.ts`への独立追加）をroot-cleanupワークフロー内の事後確認として使う | SPEC.mdが要求する「automated（mainルート直下ファイル一覧チェック）」の実体 |
| 要件5 | `.agent-skill-chain/config/segments.yaml` の `outputs`、`.agent-skill-chain/templates/issue/` は無変更 | 新設物は既存の「独立した構造検査」カテゴリ（branch-name/worktree-path等と同格）に位置づける |
| 要件6 | 「I5（進行役の純粋性）との整合」節・「I8（安全側ラチェット）との整合」節 | 実行主体はCI自動化であり進行役（AI）ではないこと・内容非解釈であること（I5）、admin mergeの自動発動がautonomy昇格に該当しないこと（I8）を論証する |

## 責務・境界

### コンポーネント構成

- `root-cleanup run`（`src/commands/root-cleanup.ts`、新設）: repoRoot直下に `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`（固定・非設定化のリテラル4件、`checkOutputExists()`の`code`ケースの除外リストと同一の4件を踏襲）が存在するか検出する。0件なら no-op で終了。1件以上あれば、現在のmain先端から短命ブランチ `chore/root-cleanup-<UTC timestamp>` を作成し、該当ファイルのみを `git rm` して固定メッセージ（`chore: remove stray root-level issue segment artifacts [skip ci]`、Issue固有内容を一切含まない）でcommit・pushし、PRを作成して `gh pr merge --admin --squash --subject` でmainへ反映する。マージ直前に、(a) headブランチ名が `chore/root-cleanup-*` に一致し、かつ (b) 変更内容が `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`（repoRoot直下のみ）の**削除のみ**で構成されている（追加・変更・他パスへの変更が一切無い）ことを機械的に検査する。いずれか一方でも満たさない場合は admin merge を行わず `human_required` として停止する（`release bump`・ADR-0005と同型の安全弁。詳細な境界解釈は「I8（安全側ラチェット）との整合」節）。同名の未マージ cleanup ブランチ/PRが既に存在する場合は、スコープ検査を通過したときのみ再利用する（冪等、`release bump`と同型）。**引数・設定入力は一切受け付けない**（対象ファイル名はコード内リテラルのみで、`workflow_dispatch`等の外部入力トリガも持たない）。admin merge bypassを行使するcommit・push・PR作成・マージの各操作は、既定の`GITHUB_TOKEN`では実行できない（branch protectionのadmin bypassには昇格された権限を要する）ため、既存リリース自動化（`agent-skill-chain-release.yml`の`release bump`ステップ）と**同一の`secrets.RELEASE_MAIN_PAT`を再利用する**。新規credentialは追加しない——このPATは既に「admin merge可能」という能力を持つ既存の権限分離済み資格情報であり、本設計はその発動条件をコード内スコープ検査で狭めるのみで、PAT自体の権限範囲を拡張しない。
- `verify root-clean`（`src/commands/verify.ts`への新規独立エクスポート追加、新設）: repoRoot直下に上記4ファイルが存在しないことを確認するだけの単純な存在チェック。`checkOutputExists()`・`wasEverAddedOrModified()`・`segments.yaml`には一切関与しない別関数として追加する。**PRごとの必須ステータスチェック（`main.json`の`required_status_checks`）には追加しない**——Issue自身のPRは開発途中で必ずこの4ファイルを保持するため、PR単位の必須チェックにすると通常のIssueマージ自体を阻害する。あくまでmainへのpush後の事後確認としてのみ用いる。
- `agent-skill-chain / root-cleanup`（`.github/workflows/agent-skill-chain-root-cleanup.yml`、新設。配布元は`.agent-skill-chain/templates/github/.github/workflows/`）: `on: push: branches: [main]` のみをトリガとし、コミットメッセージに `[skip ci]` を含む場合は実行しない（既存 `agent-skill-chain-release.yml` と同型の再帰防止）。`concurrency: {group: root-cleanup}` で同時実行を直列化する。ステップは `root-cleanup run`（`env: GH_TOKEN: ${{ secrets.RELEASE_MAIN_PAT }}`——push・PR作成・admin mergeに昇格権限を要するため）→ `verify root-clean`（読み取りのみのため `${{ github.token }}` で足り、追加権限は不要）の順。`permissions: contents: write` をjob単位で宣言する（`agent-skill-chain-release.yml`と同型）。
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

`checkOutputExists()`/`wasEverAddedOrModified()`（Issue #200・#202導入分）は本設計のどの経路からも呼び出されない。循環依存なし。

**`agent-skill-chain-reconcile.yml`との関係（訂正）**: `agent-skill-chain-reconcile.yml` は `branches-ignore: [main]`（main以外の全ブランチへのpushが対象）であるため、root-cleanupが作成する`chore/root-cleanup-*`ブランチへのpushも対象に含まれ、gate-reconcileジョブは起動する。このジョブはブランチ名から`ISSUE-<数字>`形式のissue_idを抽出しようとして失敗し（`chore/root-cleanup-*`はこの形式に一致しない）、`exit 1`でジョブが失敗する。ただし実害は無い——このジョブは`main.json`の`required_status_checks`に含まれておらず、cleanup PRのadmin merge可否を左右しない。また対象は`chore/root-cleanup-*`ブランチ自身であり、他Issueのgate-reportを誤って参照・無効化することもない（`gate-reconcile.sh`は起動時に渡されたissue_idに対応する自Issueのworktreeのみを操作対象とする）。
この既知の失敗が今後CIのノイズとして蓄積することを避けるため、`.github/workflows/agent-skill-chain-reconcile.yml`（および配布元テンプレート）の`branches-ignore`に`chore/root-cleanup-*`を追加し `branches-ignore: [main, 'chore/root-cleanup-*']` とする対応を**採用する**。変更は既存トリガ条件への1行追加のみで、reconcileジョブ自体のロジック・`gate-reconcile.sh`には触れない。同種の非Issueブランチ（例: `release/bump-v*`）にも同じ問題が存在しうるが、これは本Issueの対象外（既存の受容済み挙動）として扱い、本Issueでは新設する`chore/root-cleanup-*`のみを除外対象に追加する。

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

削除の実行主体はCI自動化（git commitの著者名義は`github-actions[bot]`、push・PR作成・admin merge操作の認証は`secrets.RELEASE_MAIN_PAT`——「コンポーネント構成」節で確定済み）であり、`.agent-skill-chain/config/roles.yaml`が定義するいずれのAIロール（`orchestrator`/`worker`/`gate_reviewer`/`adr_finalization_worker`）にも該当しない。既存の版数bump自動化（Issue #196/#198/#204、`release bump`）と同一カテゴリの、進行役とは別主体によるmainへの直接的な反映であり、進行役の権限・責務には一切変更を加えない。行為の内容も「4件の固定リテラルファイル名のパス一致による削除」のみであり、ファイル内容の読解・解釈・執筆を一切伴わないためI5が禁じる「成果物の著述・内容の取り込み」に該当しない。トリガは`push: branches: [main]`のみで`workflow_dispatch`等の外部パラメータ入力を持たないため、進行役や他の主体がこの仕組みを介して任意ファイルの削除・内容操作を行う迂回経路にもならない。

## I8（安全側ラチェット）との整合

`root-cleanup run`のPR作成・admin merge（`gh pr merge --admin`）は、`main.json`の`required_status_checks`・`pull_request`ルールをbypassする特権行使である。I8は「autonomyの昇格は人間の明示行為のみ」「昇格workflowが存在しないことを含め検査」と定めるため、無人ワークフローがこのbypassを自動発動すること自体がI8抵触の疑義を生む。この論点はADR-0005（release自動化、accepted）が同一カテゴリの決定として既に扱っている——ADR-0005は、design-gate strictレビューでの規範解釈対立を受け、「既に人間が承認済みで恒久的に存在する`bypass_actor`（admin）の固定特権を、機械検査可能な狭スコープに限って自動発動すること」はI8が禁ずる「autonomyレベルそのものを機械が自律的に引き上げる昇格workflow」には該当しない、という境界解釈をリポジトリオーナーの明示確認により確定し、その適用範囲を「head=`release/bump-v*` かつ変更=`package.json`（±`package-lock.json`）のみ」という狭スコープに限定した。

本設計が新設するbypassも、ADR-0005が確定した同一の境界解釈が適用される同種の決定である。適用にあたり、本設計はADR-0005よりもさらに狭いスコープを課す：自動発動条件は「(a) headブランチ名が`chore/root-cleanup-*`に一致し、かつ (b) 変更内容がrepoRoot直下の`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`の**削除のみ**（追加・変更・他パスへの変更を一切含まない）」の両方を機械的に満たす場合に限る（「コンポーネント構成」節）。ADR-0005の対象（`package.json`の内容書き換え）は値の書き込みを伴うのに対し、本設計の対象は4件の固定ファイル名への削除操作のみであり、書き込む内容が存在しない分、境界はより狭い。いずれかの条件を満たさない場合は`human_required`として停止し、自動admin mergeは行わない。

本Issueのdesign-gate strictレビューでこの論点がinconclusive（human_required）として指摘されたことを受け、進行役がリポジトリオーナーへ上記(a)(b)の自動発動条件の適用可否を確認し、明示的な承認を得た（判断内容・承認記録の詳細はADR-0007「I8『昇格workflow』禁止規定との関係と人間承認」節に記録済み）。I8が要求する「人間の明示行為」はこの確認と承認によって充足されている。

## 障害・ロールバック考慮

- 想定される失敗モード: 近接した2つのマージが競合し、cleanup PRのpushがnon-fast-forwardで失敗する場合がある。この場合は再fetchして削除対象を再計算し再試行する（対象ファイル集合の再計算は冪等であるため安全）。スコープ検査（削除のみで構成されているか）に失敗した場合は`human_required`として停止し、無関係な変更を伴うmergeは行わない。
- ロールバック手順: cleanup PRのマージcommitを通常のPR同様に`git revert`すれば即座に復元できる（I3、完全可逆）。本設計の変更は新規ファイル追加（`root-cleanup.ts`・ワークフロー・ラッパー・`verify.ts`への独立関数追加）のみに閉じており、既存コマンド・既存判定ロジックの削除・書き換えを伴わない。
- 影響を受ける既存機能: `checkOutputExists()`/`wasEverAddedOrModified()`・`segments.yaml`・`roles.yaml`・既存の4ゲートフローは無変更（AC-2）。現在main root直下に残存しているIssue #202由来のSPEC.md等は、本設計適用後の次回mainへのpush（本Issue自身のマージ含む）で発火するroot-cleanupにより副次的に解消される。
