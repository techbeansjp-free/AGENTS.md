schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-245
target_sha: 63a043fdbe96ca293fae74fa022cb4c8ad19b143
acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/self-extension-policy.test.ts
      - .agent-skill-chain/project/manifest.yaml
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/self-extension-policy.test.ts
      - .agent-skill-chain/project/README.md
      - docs/maintainer/workflow/README.md
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - .gitignore
      - test/integration/self-extension-policy.test.ts
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/self-extension-policy.test.ts
regression:
  executed: true
  evidence:
    - npm run typecheck
    - node --import tsx --test test/integration/self-extension-policy.test.ts
    - node bin/agents-md.js verify artifacts ISSUE-245 implementation
