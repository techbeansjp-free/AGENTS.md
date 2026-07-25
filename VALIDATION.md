schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-271
target_sha: 53171a1d7619af10fe0ca59f10bbd667c2d72ff2
acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-adapters.test.ts
      - test/unit/gate-credentialless-ci.test.ts
      - .github/workflows/agent-skill-chain-gate.yml
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - test/unit/model-selection.test.ts
      - test/integration/gate-adapters.test.ts
      - .agent-skill-chain/config/roles.yaml
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-evidence.test.ts
      - test/unit/review-evidence.test.ts
      - src/lib/review-evidence.ts
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-adapters.test.ts
      - test/integration/gate-evidence.test.ts
      - test/unit/review-evidence.test.ts
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-judgment.test.ts
      - test/unit/review-evidence.test.ts
      - test/unit/gate-artifact-digest.test.ts
      - .agent-skill-chain/schemas/gate-report.schema.yaml
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - test/unit/model-selection.test.ts
      - test/integration/gate-adapters.test.ts
      - test/integration/gate-judgment.test.ts
  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/self-extension-policy.test.ts
      - test/integration/upgrade.test.ts
      - test/unit/gate-credentialless-ci.test.ts
      - .agent-skill-chain/ci/verify-template-sync.sh
  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - test/unit/trusted-gate-recorder.test.ts
      - test/unit/trusted-gate-workflow.test.ts
      - test/unit/github-app-auth.test.ts
      - test/integration/gate-evidence.test.ts
      - .github/workflows/agent-skill-chain-trusted-gate.yml
regression:
  executed: true
  evidence:
    - "test-execution.log: target 53171a1d7619af10fe0ca59f10bbd667c2d72ff2, npm test 589 passed, 0 failed"
    - "targeted local-review/gate/adapter/verifier regression: 134 passed, 0 failed"
    - "npm run typecheck: target 53171a1d7619af10fe0ca59f10bbd667c2d72ff2 passed"
    - "git diff --check: validation checkpoint passed"
    - "shell syntax, verify-ac-coverage, verify-template-sync, verify-doc-length, lint-vocab, lint-references, verify-adr, adr-lint: passed"
    - "lint-secrets --diff origin/main: passed"
    - "npm audit --offline --audit-level=high: 0 vulnerabilities"
