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

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-219
target_sha: 31dc69522258cc20346a999be5651165bfabfe1b

acceptance_criteria:
  # AC-1: ci.yml の Dependabot 許可判定が PR 作成者基準で追加 push 実行者に非依存
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/dependabot-ci-skip.test.ts: 'ci: Derive issue_id の env.ACTOR は PR 作成者（pull_request.user.login）由来であり github.actor を参照しない'"
      - "test/unit/dependabot-ci-skip.test.ts: 'ci: Derive issue_id ステップは Dependabot 許可リストで skip_checks=true を出力する'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'ci実行(b): Dependabot が開いた直後の PR は skip_checks=true'"
      - "test/unit/dependabot-ci-skip-exec.test.ts: 'ci実行(c): Dependabot PR へ人間が追加 push しても skip_checks=true（push実行者に非依存）'"

  # AC-2: reconcile.yml の Dependabot 判定が実 PR 作成者の API 確認に依存し追加 push 実行者に非依存
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
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
      mode: automated
      result: pass
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
