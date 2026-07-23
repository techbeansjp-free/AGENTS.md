# ISSUE-219 独立検証レポート（validation セグメント成果物）
#
# 目的: Dependabot許可判定の起源基準化（ci.yml=PR作成者env、reconcile.yml=実PR作成者API確認）
# について、SPEC.md の AC-1〜AC-5 全てを受入・統合・回帰テストで検証した結果を記録する。
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）準拠の純粋なYAMLである。
#
# 検証手段の要旨:
# - test/unit/dependabot-ci-skip.test.ts: ワークフローYAML実体をパースし判定構造を静的に固定
# - test/unit/dependabot-ci-skip-exec.test.ts: Derive issue_id の bash 本文を GitHub Actions 相当
#   （bash -e -o pipefail、GITHUB_OUTPUT、モック gh）で実行し終了コード・出力を実測
# - .agent-skill-chain/ci/verify-template-sync.sh: テンプレート正本と展開結果の同期検査
# - npm test 全件: 回帰確認
# - AC-1/AC-2/AC-4 は SPEC.md の検証方法見込みどおり hybrid。bash 実行テストは run スクリプトの
#   ロジックを確定的に検証するが、GitHub Actions 実行環境でのみ確認可能な部分（コンテキスト式の
#   実解決・実 CI run での挙動）は各 procedure 記載の実地確認手順としてマージ後に実施する
#   （Issue #219 の完了条件に含める既知の残作業）。
#
# target_sha は検証対象スナップショット（実装＋引用する全 evidence のテストを含む commit）を
# 指す。本レポート自身を含む commit の SHA は内容が SHA に依存するためレポート内に自己記載
# できず、直前の検証対象 commit を指す（引用する全 evidence・回帰件数はこの SHA で成立する）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-219
target_sha: 2228f5c18b8989c84488dc6e88297776f554e2f1

acceptance_criteria:
  # AC-1: ci.yml の Dependabot 許可判定が PR 作成者基準で追加 push 実行者に非依存
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: >-
        実行テスト（dependabot-ci-skip-exec.test.ts）は Derive issue_id の run スクリプト本文へ
        bash 変数として値を手動注入して実行しており、判定ロジック（PR作成者が dependabot[bot]
        かつ dependabot/ ブランチなら skip_checks=true、追加 push 実行者に非依存）は確定的に
        実測済みである。一方、コンテキスト式 ${{ github.event.pull_request.user.login }} が
        実際のワークフロー実行時に GitHub の式解決エンジンで想定値へ解決されること自体は
        GitHub Actions 実行環境でしか確認できず、本テストの範囲外である。現時点で pass とする
        根拠は次の3点。(a) ロジック自体は実行テストで確定的に検証済み。
        (b) github.event.pull_request.user.login は GitHub 公式に文書化された標準コンテキスト値で、
        PR 作成時に固定され PR 存続中変化せず、その解決自体を疑う積極的理由がない
        （原 Issue の誤りは github.actor という追加 push で変化する別のコンテキスト値を選んだ
        ことであり、コンテキスト式が解決されるか否かの誤解ではない）。
        (c) 実地の最終確認は procedure の手順としてマージ後に実施し、Issue #219 の完了条件に
        含める。すなわち暫定 pass であり、実地確認は既知の残作業として明示する。
      procedure: >-
        本 Issue の修正が main へマージされた後、Dependabot 起源 PR（例: PR #192 / PR #193）を
        「@dependabot rebase」等でブランチ更新し（rebase 自体が synchronize イベントとなる。
        必要なら人間が追加 push する）、その後の「agent-skill-chain / ci」（verify job）の
        CI run で Derive issue_id が skip_checks=true となり verify job が成功することを観察して
        確認する。pull_request イベントは merge commit コンテキストで実行されるため、main
        マージ直後は該当 PR へ自動反映されず、ブランチ更新後でなければ実施できない
        （構造的にマージ後にのみ実施可能）。
      executor: 進行役（PR #220 マージ後、Issue #219 の完了条件として実施）
    evidence:
      - "test/unit/dependabot-ci-skip.test.ts: 'ci: Derive issue_id の env.ACTOR は PR 作成者（pull_request.user.login）由来であり github.actor を参照しない'"
      - "test/unit/dependabot-ci-skip.test.ts: 'ci: Derive issue_id ステップは Dependabot 許可リストで skip_checks=true を出力する'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'ci実行(b): Dependabot が開いた直後の PR は skip_checks=true'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'ci実行(c): Dependabot PR へ人間が追加 push しても skip_checks=true（push実行者に非依存）'"

  # AC-2: reconcile.yml の Dependabot 判定が実 PR 作成者の API 確認に依存し追加 push 実行者に非依存
  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: >-
        実行テスト（dependabot-ci-skip-exec.test.ts）は Derive issue_id の run スクリプト本文を
        モック gh・手動注入した環境変数で実行しており、3分岐ロジック（実 PR 作成者が
        dependabot[bot] のときのみ skip_checks=true、不一致/empty/API 障害は安全側 exit 1）は
        確定的に実測済みである。一方、実際の push イベント駆動のワークフロー実行において
        gh api が github.token（permissions: pull-requests: read）で実 PR 作成者を返すこと、
        steps.ctx.outputs.skip_checks の受け渡しと照合ステップの if スキップが GitHub 側で
        想定通り機能することは GitHub Actions 実行環境でしか確認できず、本テストの範囲外である。
        現時点で pass とする根拠は次の3点。(a) ロジック自体は実行テストで確定的に検証済み。
        (b) 用いる仕組み（github.token・step outputs・step-level if）はいずれも GitHub 公式に
        文書化された標準機能であり、その動作自体を疑う積極的理由がない（原 Issue の誤りは
        github.actor という追加 push で変化するコンテキスト値を選んだことであり、これらの
        機構が機能するか否かの誤解ではない）。(c) 実地の最終確認は procedure の手順として
        マージ後に実施し、Issue #219 の完了条件に含める。すなわち暫定 pass であり、実地確認は
        既知の残作業として明示する。
      procedure: >-
        本 Issue の修正が main へマージされた後、Dependabot 起源 PR（例: PR #192 / PR #193）を
        「@dependabot rebase」等でブランチ更新し、人間が追加 push した後（または rebase による
        push 後）の「agent-skill-chain / reconcile」の CI run で、Derive issue_id が
        skip_checks=true を出力し、照合ステップ（Reconcile gates against pushed SHA）が
        スキップされて reconcile が失敗しないことを観察して確認する。マージ前は当該 PR の
        ブランチへ修正が反映されないため、構造的にマージ後にのみ実施可能。
      executor: 進行役（PR #220 マージ後、Issue #219 の完了条件として実施）
    evidence:
      - "test/unit/dependabot-ci-skip.test.ts: 'reconcile: jobs.reconcile に job-level if の早期スキップが存在しない'"
      - "test/unit/dependabot-ci-skip.test.ts: 'reconcile: Derive issue_id が3分岐で実PR作成者を gh api で確認し dependabot[bot] と比較する'"
      - "test/unit/dependabot-ci-skip.test.ts: 'reconcile: 照合ステップに skip_checks ガードの if が付与されている'"
      - "test/unit/dependabot-ci-skip.test.ts: 'reconcile: permissions に pull-requests: read が含まれる（PR検索APIに必要）'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'reconcile実行(b)(c): 実PR作成者が dependabot[bot] なら push 実行者に関係なく skip_checks=true'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'reconcile実行(f): gh api が非0終了する API 障害時は skip されず安全側の exit 1'（レート制限・認証失敗等の API 障害を模擬し、|| true による空文字化→安全側 exit 1 を実測）"

  # AC-3: 既存の agent-skill-chain 管理下 Issue ブランチに対する挙動が無回帰
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'ci実行(a): 通常Issueブランチは issue_id 抽出・skip_checks=false'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'reconcile実行(a): 通常Issueブランチは issue_id 抽出・skip_checks=false'"
      - "test/unit/dependabot-ci-skip.test.ts: 'ci: npm ci / build / test の各ステップは if 条件を持たない（常時実行）' ほかガード配置固定テスト一式"

  # AC-4: 人間が dependabot/ ブランチ名を騙っても ci.yml・reconcile.yml いずれの許可判定もなりすましを許さない
  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: >-
        実行テスト（dependabot-ci-skip-exec.test.ts）は偽装ブランチ入力（人間作成者・対応 PR
        なし・branch.pattern 衝突形）に対する exit 1 を、run スクリプト本文へ値を手動注入して
        確定的に実測済みである。一方、実際の GitHub Actions 実行時にコンテキスト式
        ${{ github.event.pull_request.user.login }} の解決と gh api の実 PR 作成者応答を経て
        同じ exit 1 に到達することは GitHub Actions 実行環境でしか確認できず、本テストの
        範囲外である。現時点で pass とする根拠は次の3点。(a) 拒否ロジック自体は実行テストで
        確定的に検証済み。(b) 依拠するコンテキスト値・API はいずれも GitHub 公式に文書化された
        標準機能で、PR 作成者値は PR 作成時に固定され変化せず、その解決自体を疑う積極的理由が
        ない（原 Issue の誤りは github.actor という別のコンテキスト値の選定ミスであり、式が
        解決されるか否かの誤解ではない）。(c) 実地の最終確認は procedure の手順としてマージ後に
        実施し、Issue #219 の完了条件に含める。すなわち暫定 pass であり、実地確認は既知の
        残作業として明示する。
      procedure: >-
        本 Issue の修正が main へマージされた後、SPEC.md の manual 見込みどおり、人間が
        branch.pattern 非一致の偽装ブランチ（例: dependabot/npm_and_yarn/fake-verify）を作成して
        push・PR 作成し、「agent-skill-chain / ci」（verify job）と「agent-skill-chain /
        reconcile」がいずれも日本語理由付きの exit 1 で失敗する（照合スキップを得られない）
        ことを CI run で観察して確認する。確認後、偽装ブランチと PR は削除する。
      executor: 進行役（PR #220 マージ後、Issue #219 の完了条件として実施）
    evidence:
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'ci実行(d): 人間が dependabot/ ブランチ名を偽装した PR は exit 1 で拒否される'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'ci実行(e): branch.pattern と衝突する dependabot/223-fake は第1分岐で通常検査される'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'reconcile実行(d): 偽装ブランチは対応PRなし（empty）で exit 1'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'reconcile実行(d): 偽装ブランチは PR 作成者が人間でも exit 1'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'reconcile実行(e): branch.pattern と衝突する dependabot/223-fake は第1分岐で通常照合される'"

  # AC-5: テンプレート正本と展開結果の完全一致維持
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/dependabot-ci-skip.test.ts: '本体 agent-skill-chain-ci.yml とテンプレート正本が完全一致する'"
      - "test/unit/dependabot-ci-skip.test.ts: '本体 agent-skill-chain-reconcile.yml とテンプレート正本が完全一致する'"
      - "コマンド実行: ./.agent-skill-chain/ci/verify-template-sync.sh → exit 0（同期一致）"

regression:
  executed: true
  evidence:
    - "npm run build && npm test → 504件全成功（pass 504 / fail 0、2026-07-24 実測）。ci-run: PR #220 の agent-skill-chain / ci でも同一スイートを実行"
    - "test/unit/dependabot-ci-skip-exec.test.ts 単体実行 → 11件全成功（pass 11 / fail 0）"
