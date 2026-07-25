schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-266
target_sha: 64be29713aecf07e6cdbdd6f6575515ea4f8e152

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: Issue #266 base更新競合の再同期・同一PR再試行ケース"
      - "node --import tsx --test --test-name-pattern='Issue #266' test/integration/release.test.ts (pass: 2)"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: Issue #266 再試行merge失敗のhuman_required停止ケース"
      - "node --import tsx --test --test-name-pattern='Issue #266' test/integration/release.test.ts (pass: 2)"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: 再同期後のorigin/main SHAを使うtag/publish継続ケース"
      - "node --import tsx --test test/integration/release.test.ts (pass: 18)"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: 既存の通常bump・既存PR再利用・base乖離・スコープ検査ケース"
      - npm test (pass)

regression:
  executed: true
  evidence:
    - npm run build (pass)
    - npm run typecheck (pass)
    - "node --import tsx --test test/integration/release.test.ts (pass: 18)"
    - npm test (pass)
