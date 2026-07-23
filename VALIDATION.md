# 正本: AGENTS.md §不変条件I7
#
# ISSUE-215 独立検証レポート（セグメント: validation、ゲート: validation-gate）。
# SPEC.md の AC-1〜AC-5 全てに対応する（孤児AC不可、I7）。
# 本ファイルは純粋なYAMLとして記述する（src/commands/verify.ts の acCoverage() が
# 単一YAML文書として読み込むため、Markdown見出し・複数YAMLフェンス禁止）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-215
target_sha: b2059aac229f5af3a8b867f3195ff3ff4bfee097

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: >-
        本 AC の合否は、Derive issue_id の 3 分岐 bash ロジックへ npm-ecosystem
        Dependabot の実ブランチ名・実 actor を与えてローカル実行し、skip_checks=true
        （追跡系検査群がスキップ経路へ入る）を出力することを実測する「決定論的ロジック
        検証」により pass と確定している。この検証はワークフロー内の当該 run: ブロックを
        逐語抽出して同一入力で実行するため、GitHub Actions ランナー上の実挙動と一対一に
        対応する。本物の Dependabot トリガーによる実インフラ環境での最終確認（Dependabot
        PR の CI は当該 PR 自身の base 状態＝旧定義に依存するため、本修正を含む実 run は
        本 PR マージ後にのみ生成される）は、マージ後に進行役が実施し、決定論的検証との
        齟齬があれば追加 Issue で是正する運用上のフォローアップである（合否判定を先送り
        する未決事項ではない）。
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
        (c) 本レポートの合否は (a)(b) の決定論的ロジック検証で確定する。実 npm-ecosystem
        Dependabot PR での verify job 全体の自動 green 化は、本 PR マージ後に進行役が
        当該 PR の実 run URL を確認する運用フォローアップとし、齟齬時は追加 Issue で是正する。
      executor: validation-worker（決定論的ロジック検証＝合否確定）／進行役（マージ後の実インフラ最終確認フォローアップ）
    evidence:
      - "scratchpad:trace_derive.sh 実行結果 [AC-1] BRANCH=dependabot/npm_and_yarn/typescript-5.5.4 ACTOR=dependabot[bot] => exit=0 output={issue_id= skip_checks=true}"
      - ".github/workflows/agent-skill-chain-ci.yml Derive issue_id 第2分岐（skip_checks=true）＋追跡系各ステップの if:steps.ctx.outputs.skip_checks!='true'"
      - "test/unit/dependabot-ci-skip.test.ts: ctx が dependabot[bot]＋dependabot/ で skip_checks=true を出力する分岐を持つことを YAML パースで固定化（npm test 489 pass）"
      - "運用フォローアップ（マージ後・進行役実施）: 実 npm-ecosystem Dependabot PR の agent-skill-chain / ci verify job 実 run URL 確認"

  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: >-
        github-actions-ecosystem Dependabot PR (actions/checkout・actions/setup-node
        bump、.github/workflows/*.yml を書き換える。PR #192/#193 該当) での「追跡系
        検査の誤爆解消（Derive issue_id が exit 1 で job 即死せず skip 経路へ入る）」＋
        「verify-template-sync の挙動不変（if:・continue-on-error 未付与＝失敗継続）」は、
        当該ブランチ名・actor を Derive issue_id ロジックへ与えるローカル実行と YAML 差分
        検証という「決定論的ロジック検証」により pass と確定している。実インフラでの最終
        確認は、Dependabot PR の CI が本 PR マージ前は旧ワークフロー定義で動くため
        マージ後にのみ生成される実 run で進行役が実施する運用フォローアップである。
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
        (c) 本レポートの合否は (a)(b) の決定論的ロジック検証で確定する。実 github-actions
        -ecosystem Dependabot PR での「追跡系検査のスキップ＝非誤爆」と「verify-template-sync
        の失敗継続」の実インフラ確認は、本 PR マージ後に進行役が実施し、齟齬時は追加 Issue
        で是正する運用フォローアップとする。
      executor: validation-worker（決定論的ロジック検証＝合否確定）／進行役（マージ後の実インフラ最終確認フォローアップ）
    evidence:
      - "scratchpad:trace_derive.sh 実行結果 [AC-2] BRANCH=dependabot/github_actions/actions/checkout-7 ACTOR=dependabot[bot] => exit=0 output={issue_id= skip_checks=true}（誤爆＝exit 1 が解消）"
      - ".github/workflows/agent-skill-chain-ci.yml verify-template-sync ステップに if:・continue-on-error が付与されていないこと（挙動不変＝失敗継続）"
      - "test/unit/dependabot-ci-skip.test.ts: verify-template-sync が skip_checks を参照しないこと／npm ci・build・test が if を持たないことを YAML パースで固定化"
      - "運用フォローアップ（マージ後・進行役実施）: 実 github-actions-ecosystem Dependabot PR (#192/#193) の agent-skill-chain / ci verify job 実 run URL 確認"

  - ac_id: AC-3
    verification:
      mode: hybrid
      result: pass
      reason: >-
        Dependabot ブランチでの reconcile job 早期スキップは jobs.reconcile.if の
        GitHub Actions 式で制御される。本 AC の合否は、同一真偽ロジックの bash
        シミュレーションへ Dependabot と Issue ブランチ双方の入力を与え、前者=job SKIPPED・
        後者=job RUNS を実測する「決定論的ロジック検証」で確定している。実 Dependabot push
        での skipped 実観測は、本 PR マージ後に進行役が実施する運用フォローアップである。
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
        (c) 本レポートの合否は (a)(b) の決定論的ロジック検証で確定する。実 Dependabot
        push の reconcile job が skipped 状態で失敗しないことの実インフラ確認は、本 PR
        マージ後に進行役が実施し、齟齬時は追加 Issue で是正する運用フォローアップとする。
      executor: validation-worker（決定論的ロジック検証＝合否確定）／進行役（マージ後の実インフラ最終確認フォローアップ）
    evidence:
      - "scratchpad:trace_derive.sh 実行結果 [AC-3] ACTOR=dependabot[bot] REF=dependabot/... => job SKIPPED、ACTOR=adachi-tatsuru REF=bugfix/215-... => job RUNS"
      - ".github/workflows/agent-skill-chain-reconcile.yml jobs.reconcile.if の Dependabot 限定否定条件"
      - "test/unit/dependabot-ci-skip.test.ts: jobs.reconcile.if が dependabot[bot] と dependabot/ の両方を参照して除外することを YAML パースで固定化"
      - "運用フォローアップ（マージ後・進行役実施）: 実 Dependabot push の agent-skill-chain / reconcile job（skipped）"

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
        (b) 実 run 観測: 本 PR (bugfix/215) の agent-skill-chain / ci verify job で、
        Derive issue_id・verify-branch-name・verify-worktree-path・verify-template-sync・
        verify-artifacts(全セグメント)・verify-ac-coverage・lint-vocab が全て実行（✓）され、
        skip_checks=false 経路が実環境でも成立していることを実測。commit b2059aa の実 run
        30007987886 で verify-artifacts(implementation を含む全セグメント) が✓へ転じている。
        なお commit 3b9d15e の run では verify-artifacts が「segment 'implementation' の
        必須成果物 unit_test_results が欠落」で X だった。その真因は VALIDATION.md 未 push
        ではなく、src/commands/verify.ts の unit_test_results ケース（Issue #202 由来）が
        「base...HEAD の test/ 配下差分の存在」を実装セグメント完了の証跡として要求する仕様に、
        本 Issue が GitHub Actions YAML のみの変更で test/ 差分を持たなかったため構造的に
        引っかかっていたことである。本コミットで追加した test/unit/dependabot-ci-skip.test.ts
        （ワークフロー構造の実質的回帰テスト）が test/ 配下差分を成立させ、この欠落を解消した。
      executor: validation-worker（静的トレース＋本 PR 実 run 観測）
    evidence:
      - "ci-run:30007987886 (commit b2059aa) verify-branch-name/verify-worktree-path/verify-template-sync/verify-artifacts(全セグメント)/verify-ac-coverage/lint-vocab が全て✓（skip_checks=false 経路の実証、unit_test_results 欠落の解消）"
      - "https://github.com/techbeansjp-free/AGENTS.md/actions/runs/30007987886"
      - "真因: src/commands/verify.ts unit_test_results ケース（Issue #202 由来）の test/ 差分要求。解消手段: test/unit/dependabot-ci-skip.test.ts 追加による test/ 差分の成立（VALIDATION.md 未 push は真因ではない）"
      - "scratchpad:trace_derive.sh 実行結果 [AC-4]（skip_checks=false, issue_id=ISSUE-215）＋3 反証ケースが全て exit 1"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "node bin/agents-md.js verify template-sync => CLI_EXIT=0（本体とテンプレート正本一致）"
      - "./.agent-skill-chain/ci/verify-template-sync.sh => SH_EXIT=0"
      - "ci-run:30007987886 (commit b2059aa) verify-template-sync ステップ✓（本 PR 実 run でも exit 0）"
      - "test/unit/dependabot-ci-skip.test.ts: 本体2ファイルとテンプレート正本2ファイルの完全一致を verify-template-sync とは独立に固定化"
      - ".github/workflows/agent-skill-chain-ci.yml verify-template-sync ステップに if:・continue-on-error が未付与＝挙動不変を YAML 差分で確認"

# 既知の残 CI 失敗（本 Issue 起因ではない）:
# ci-run:30007987886 の lint-references ステップは
# .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml:1 の
# 禁止参照 '§不変条件I4・§ディレクトリ構成' で X となる。これは main（ISSUE-208 / PR #210,
# commit f4624d2）由来の既存違反で、本 Issue の変更対象外ファイルにある。従来は verify-artifacts
# の unit_test_results 欠落で job が早期失敗し lint-references まで到達せず顕在化しなかったが、
# 本 Issue の修正で job が進行したため露出した。是正は別 Issue（進行役判断）に委ねる。

regression:
  executed: true
  evidence:
    - "npm test => # tests 489 / # pass 489 / # fail 0 / # skipped 0、NPM_TEST_EXIT=0（ローカル実測、dependabot-ci-skip.test.ts 追加分15件を含む）"
    - "node bin/agents-md.js verify template-sync => exit 0、./.agent-skill-chain/ci/verify-template-sync.sh => exit 0"
    - "ci-run:30007987886 (commit b2059aa) npm ci/build/test 全て✓（本 PR の CI 実 run）"
