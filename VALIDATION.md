schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-243
target_sha: 47a15cb60f27cec24ae6a450da5e4e1ca1f6fd35
acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "node --import tsx --test --test-name-pattern='release bump (AC-1, AC-6)' test/integration/release.test.ts"
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "node --import tsx --test --test-name-pattern='Issue #243' test/integration/release.test.ts"
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "node --import tsx --test --test-name-pattern='release bump スコープ検査違反' test/integration/release.test.ts"
regression:
  executed: true
  evidence:
    - "npm run typecheck"
    - "npm run build"
    - "release bump integration tests for lockfile present, lockfile absent, and scope rejection"
