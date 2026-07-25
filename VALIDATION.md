schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-236
target_sha: 5a9ea3f1fca1faedbc4f40c04c084f6b56764a21

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/test-execution-log-ci.test.ts: CI step uses pipefail, tee, always upload-artifact, and synchronized template"
      - "ci-run: https://github.com/techbeansjp-free/AGENTS.md/actions/runs/30154977929 (verify passed; npm-test-execution-log artifact upload completed)"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "手動の独立検証におけるログ保存・証跡記録の運用は、CIだけでは代替できない。"
      procedure: "TEST_POLICY.md の手順をレビューし、set -o pipefail と npm test 2>&1 | tee test-execution.log、成功時のログパス記録、失敗時の抜粋記録が明記されていることを確認する。"
      executor: "Codex validation worker"
    evidence:
      - ".agent-skill-chain/standards/TEST_POLICY.md: 独立検証におけるテスト実行ログの保存"
      - "test/unit/test-execution-log-ci.test.ts: 手順に必要な保存・証跡項目を静的検査"

  - ac_id: AC-3
    verification:
      mode: manual
      result: pass
      reason: "将来の間欠的失敗が発生した時点の Issue 更新と follow-up 起票は、現在は事前の手順レビューでのみ検証できる。"
      procedure: "TEST_POLICY.md をレビューし、Issue #236 へテストファイル名、テストケース名、エラーメッセージ、スタックトレースを記録し、タイミング依存、順序依存、リソース競合、非同期処理の race condition を評価する follow-up Issue を起票する手順を確認する。"
      executor: "Codex validation worker"
    evidence:
      - ".agent-skill-chain/standards/TEST_POLICY.md: 間欠的失敗時の記録と follow-up 手順"
      - "test/unit/test-execution-log-ci.test.ts: 失敗記録と四つの原因類型を静的検査"

regression:
  executed: true
  evidence:
    - "ci-run: https://github.com/techbeansjp-free/AGENTS.md/actions/runs/30154977929 (npm test: 526/526 pass)"
    - "local targeted: npm run typecheck; node --import tsx --test test/unit/dependabot-ci-skip.test.ts test/unit/test-execution-log-ci.test.ts (21/21 pass)"
