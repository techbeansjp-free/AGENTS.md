# 正本: AGENTS.md §不変条件I7
#
# ISSUE-215 独立検証レポート（セグメント: validation、ゲート: validation-gate）。
# SPEC.md の AC-1〜AC-5 全てに対応する（孤児AC不可、I7）。
# 本ファイルは純粋なYAMLとして記述する（src/commands/verify.ts の acCoverage() が
# 単一YAML文書として読み込むため、Markdown見出し・複数YAMLフェンス禁止）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-215
target_sha: 3b9d15ec8e1939ad52cedc53bb9a5e7e54c16df2

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: >-
        npm-ecosystem Dependabot PR (typescript・@types/node bump) の verify job
        自動成功は、Dependabot が実際に生成する PR 上でしか実 run 観測できないが、
        Dependabot PR #192〜#195 は本 PR (bugfix/215) がまだ main へ未マージのため
        古いワークフロー定義のままで CI が動く（Dependabot PR の CI は当該 PR 自身の
        base 状態＝旧定義に依存する）。よって本修正を含む実 run 観測はマージ後にしか
        できず、本レポート時点では静的検証＋該当 shell スニペットのローカル実行までを
        証跡とする（残りはマージ後フォローアップ）。
      procedure: >-
        (a) .github/workflows/agent-skill-chain-ci.yml「Derive issue_id」の 3 分岐
        bash ロジックのシェル構文レビュー・トレース。第1分岐(^ISSUE-[0-9]+$)=
        skip_checks=false、第2分岐(ACTOR==dependabot[bot] AND BRANCH==dependabot/*)=
        skip_checks=true、第3分岐=exit 1 が排他かつ網羅であることを確認。
        (b) 該当 run: ブロックを逐語抽出したスクリプトへ BRANCH=
        'dependabot/npm_and_yarn/typescript-5.5.4' ACTOR='dependabot[bot]' を与えて
        ローカル bash 実行し、exit=0・output に skip_checks=true・issue_id 空が
        出力されることを実測（誤爆せず追跡系検査群がスキップ経路へ入ることを確認）。
        追跡系検査ステップには一律 if:steps.ctx.outputs.skip_checks!='true' が付与され、
        npm ci/build/test と verify-template-sync には if: が無く無条件実行される
        ことを YAML 差分でも確認。.github/workflows/ を変更しない npm-ecosystem PR は
        本体・テンプレート正本に差分が出ず verify-template-sync も成功するため verify
        job 全体が自動成功する。
        (c) 本 PR マージ後、実際の npm-ecosystem Dependabot PR の実 run で verify job
        全体の自動 green 化を最終確認予定（本レポートでは静的検証までを証跡とする）。
      executor: validation-worker（静的検証・ローカル bash トレース）／進行役（マージ後の実 run 観測フォローアップ）
    evidence:
      - "scratchpad:trace_derive.sh 実行結果 [AC-1] BRANCH=dependabot/npm_and_yarn/typescript-5.5.4 ACTOR=dependabot[bot] => exit=0 output={issue_id= skip_checks=true}"
      - ".github/workflows/agent-skill-chain-ci.yml Derive issue_id 第2分岐（skip_checks=true）＋追跡系各ステップの if:steps.ctx.outputs.skip_checks!='true'"
      - "マージ後フォローアップ予定: 実 npm-ecosystem Dependabot PR の agent-skill-chain / ci verify job 実 run"

  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: >-
        github-actions-ecosystem Dependabot PR (actions/checkout・actions/setup-node
        bump、.github/workflows/*.yml を書き換える。PR #192/#193 該当) での「追跡系
        検査の誤爆解消」＋「verify-template-sync の正しい失敗継続」は、Dependabot が
        生成する当該 PR 上でしか実 run 観測できない。AC-1 と同理由で Dependabot PR は
        本 PR マージ前は旧ワークフロー定義のままで CI が動くため、実 run 観測は
        マージ後にのみ可能。本レポート時点では静的検証＋ローカル bash 実行までを証跡とする。
      procedure: >-
        (a) 3 分岐 bash ロジックのシェル構文レビュー・トレース（AC-1 と同一ステップ）。
        (b) 該当 shell スニペットへ BRANCH='dependabot/github_actions/actions/checkout-7'
        ACTOR='dependabot[bot]' を与えてローカル bash 実行し、exit=0・skip_checks=true が
        出力され、Derive issue_id の exit 1 による追跡系検査の誤爆（job 即死）が解消される
        ことを実測。一方 verify-template-sync ステップには if: も continue-on-error も
        付与されず、修正前と同一の無条件ブロッキング実行のまま（YAML 差分で確認）である
        ため、テンプレート正本が古い github-actions PR ではこのステップが正しくブロッキング
        失敗し続け、verify job 全体は BLOCKED のまま自動解消しない（偽陽性ではなく正しい
        検出）。この BLOCKED 解消は本 Issue スコープ外で、マージ前に人間（進行役）が
        .agent-skill-chain/templates/github/.github/workflows/ 配下を .github/workflows/
        の内容へ手動同期する運用に委ねる（自動化しない）。
        (c) 本 PR マージ後、実 github-actions-ecosystem Dependabot PR の実 run で
        「追跡系検査のスキップ＝非誤爆」と「verify-template-sync の失敗継続」を最終確認予定。
      executor: validation-worker（静的検証・ローカル bash トレース）／進行役（マージ後の実 run 観測フォローアップ）
    evidence:
      - "scratchpad:trace_derive.sh 実行結果 [AC-2] BRANCH=dependabot/github_actions/actions/checkout-7 ACTOR=dependabot[bot] => exit=0 output={issue_id= skip_checks=true}（誤爆＝exit 1 が解消）"
      - ".github/workflows/agent-skill-chain-ci.yml verify-template-sync ステップに if:・continue-on-error が付与されていないこと（挙動不変＝失敗継続）"
      - "マージ後フォローアップ予定: 実 github-actions-ecosystem Dependabot PR (#192/#193) の agent-skill-chain / ci verify job 実 run"

  - ac_id: AC-3
    verification:
      mode: hybrid
      result: pass
      reason: >-
        Dependabot ブランチでの reconcile job 早期スキップは、jobs.reconcile.if の
        GitHub Actions 式で制御される。実 skip 観測は Dependabot push 上でしか
        できず、AC-1/AC-2 と同理由でマージ後にのみ可能。本レポート時点では if 式の
        真偽トレースと同等 bash シミュレーションまでを証跡とする。
      procedure: >-
        (a) .github/workflows/agent-skill-chain-reconcile.yml の
        jobs.reconcile.if: !(github.actor=='dependabot[bot]' &&
        startsWith(github.ref_name,'dependabot/')) を静的レビューし、Dependabot
        push のみ if=false（job スキップ）・Issue ブランチ push は if=true（job 実行）
        となる網羅性を確認。
        (b) 同一真偽ロジックの bash シミュレーションへ (ACTOR=dependabot[bot],
        REF=dependabot/github_actions/actions/checkout-7) と (ACTOR=adachi-tatsuru,
        REF=bugfix/215-...) を与え、前者=job SKIPPED（失敗しない）・後者=job RUNS
        （従来通り）となることを実測。job 内 Derive issue_id の exit 1 ガードは二重の
        安全網として現状維持（YAML で確認）。
        (c) 本 PR マージ後、実 Dependabot push の reconcile job が skipped 状態で
        失敗しないことを最終確認予定。
      executor: validation-worker（静的検証・bash シミュレーション）／進行役（マージ後の実 run 観測フォローアップ）
    evidence:
      - "scratchpad:trace_derive.sh 実行結果 [AC-3] ACTOR=dependabot[bot] REF=dependabot/... => job SKIPPED、ACTOR=adachi-tatsuru REF=bugfix/215-... => job RUNS"
      - ".github/workflows/agent-skill-chain-reconcile.yml jobs.reconcile.if の Dependabot 限定否定条件"
      - "マージ後フォローアップ予定: 実 Dependabot push の agent-skill-chain / reconcile job（skipped）"

  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: >-
        Issue ブランチ（{type}/{issue_id}-{slug} 適合）に対する既存検査挙動の不変
        （回帰なし）は、YAML 条件式の静的トレースに加え、本 PR 自身のブランチ
        bugfix/215-dependabot-ci-skip-non-issue-branch がまさに第1分岐（skip_checks=
        false）経路の実地テストケースとなるため、本 PR の実 CI run で追跡系検査群が
        スキップされず実際に実行された事実を実測して証跡とする（hybrid）。
      procedure: >-
        (a) 静的トレース: Derive issue_id 第1分岐が最優先評価され、規約適合ブランチは
        必ず issue_id 設定・skip_checks=false になることを確認。ローカル bash 実行で
        BRANCH='bugfix/215-dependabot-ci-skip-non-issue-branch' ACTOR='adachi-tatsuru'
        => exit=0 output={issue_id=ISSUE-215 skip_checks=false} を実測。追跡系ステップの
        if:steps.ctx.outputs.skip_checks!='true' はこの経路で真となり全て実行される。
        あわせて許可リスト外の非適合ブランチ（'random-branch-name'／dependabot ブランチ名
        だが actor 詐称／actor は Dependabot だが branch が dependabot/ 非該当）の 3 反証
        ケースが全て第3分岐 exit 1 に落ちることを実測し、規約強制（I4）の維持と AND 条件の
        厳密性を確認。
        (b) 実 run 観測: 本 PR (bugfix/215) の agent-skill-chain / ci verify job（commit
        3b9d15e, run 30005629195 / job 89200816768）で、Derive issue_id・verify-branch-name・
        verify-worktree-path・verify-template-sync が全て実行（✓）され、skip_checks=false
        経路が実環境でも成立していることを実測。当該 run は verify-artifacts(validation
        セグメント) のみ X だが、これは本レポート（VALIDATION.md）が未 push だったことに
        起因する期待どおりの欠落であり、本コミットの push で解消する。追跡系検査が
        スキップされず実行された事実こそが AC-4（Issue ブランチで既存挙動不変）の実証である。
      executor: validation-worker（静的トレース＋本 PR 実 run 観測）
    evidence:
      - "ci-run:30005629195 job:89200816768 (commit 3b9d15e) verify-branch-name/verify-worktree-path/verify-template-sync が全て✓実行（skip_checks=false 経路の実証）"
      - "https://github.com/techbeansjp-free/AGENTS.md/actions/runs/30005629195/job/89200816768"
      - "scratchpad:trace_derive.sh 実行結果 [AC-4]（skip_checks=false, issue_id=ISSUE-215）＋3 反証ケースが全て exit 1"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "node bin/agents-md.js verify template-sync => CLI_EXIT=0（本体とテンプレート正本一致）"
      - "./.agent-skill-chain/ci/verify-template-sync.sh => SH_EXIT=0"
      - "ci-run:30005629195 job:89200816768 verify-template-sync ステップ✓（本 PR 実 run でも exit 0）"
      - ".github/workflows/agent-skill-chain-ci.yml verify-template-sync ステップに if:・continue-on-error が未付与＝挙動不変を YAML 差分で確認"

regression:
  executed: true
  evidence:
    - "npm test => # tests 474 / # pass 474 / # fail 0 / # skipped 0、NPM_TEST_EXIT=0（ローカル実測、実装ワーカー確認値を再現）"
    - "node bin/agents-md.js verify template-sync => exit 0、./.agent-skill-chain/ci/verify-template-sync.sh => exit 0"
    - "ci-run:30005629195 job:89200816768 npm ci/build/test 全て✓（commit 3b9d15e の CI 実 run）"
