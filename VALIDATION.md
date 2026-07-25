schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-271
target_sha: a3f8b321b6a8791beef723b3901f22ff115ac35b
acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - test/unit/model-selection.test.ts
      - test/integration/self-extension-policy.test.ts
      - .agent-skill-chain/schemas/project-policy.schema.yaml
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-judgment.test.ts
      - test/integration/gate-adapters.test.ts
      - test/unit/gate-credentialless-ci.test.ts
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-adapters.test.ts
      - test/unit/gate-credentialless-ci.test.ts
      - .github/workflows/agent-skill-chain-gate.yml
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-adapters.test.ts
      - test/unit/gate-credentialless-ci.test.ts
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-adapters.test.ts
      - test/integration/gate-judgment.test.ts
      - test/unit/gate-credentialless-ci.test.ts
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - test/unit/model-selection.test.ts
      - test/integration/gate-adapters.test.ts
  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/self-extension-policy.test.ts
      - test/unit/gate-credentialless-ci.test.ts
      - .agent-skill-chain/ci/verify-template-sync.sh
      - test-execution.log
regression:
  executed: true
  evidence:
    - "test-execution.log: npm test 548 passed, 0 failed"
    - "npm run typecheck: passed"
    - "git diff --check: passed"
    - "verify-template-sync, lint-vocab, lint-references, verify-adr, adr-lint: passed"
    - "lint-secrets --diff origin/main: passed"
    - "npm audit --offline --audit-level=high: 0 vulnerabilities"
