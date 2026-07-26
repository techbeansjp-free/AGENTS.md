schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-271
target_sha: 4e854152b1c53d68f7ce22baf0169a3cc71f23a2
acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/gate-adapters.test.ts
      - test/unit/gate-credentialless-ci.test.ts
      - test/unit/trusted-gate-recorder.test.ts
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
      - test/unit/trusted-gate-recorder.test.ts
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
      - test/integration/init.test.ts
      - test/integration/upgrade.test.ts
      - test/unit/gate-credentialless-ci.test.ts
      - test/unit/release-workflow-guard.test.ts
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
    - "target 4e854152b1c53d68f7ce22baf0169a3cc71f23a2 matched origin/process/271-core-audit-model-selection before validation"
    - "test-execution.log: CI-like TMPDIR=/var/tmp npm test 590 passed, 0 failed; build included"
    - "targeted risk/profile, arbitrary reviewer override, legacy Check provenance, policy absence, recorder separation, and release sentinel regression: 51 passed, 0 failed"
    - "sandbox default /tmp contains an injected .git: first full run was 589/590; isolated paths rerun with CI-like TMPDIR=/var/tmp was 10/10 and full rerun was 590/590"
    - "npm run typecheck; branch/worktree/template/artifact/AC/doc/root/vocab/reference/secret/ADR checks; shell syntax; git diff --check: passed"
    - "npm audit --offline --audit-level=high: 0 vulnerabilities"
    - "npm pack --dry-run: 158 files, release sentinel absent and release-guard.sh present"
    - "GitHub PR #274 head 4e854152b1c53d68f7ce22baf0169a3cc71f23a2: verify and reconcile checks completed SUCCESS"
