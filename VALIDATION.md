schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-244
# 再検証対象には ADR-0008 の frontmatter 修正も含む。sandbox 内の同一テストは
# npm 子プロセスの制約で失敗詳細を出力しなかったため、判定が得られる環境で再実行した。
target_sha: 717d9360ce6c75f543a242f498dfd15d47d93094

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/package-files.test.ts
      - npm pack --dry-run --json
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/package-files.test.ts
      - package.json
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - test/integration/package-files.test.ts
      - npm pack --dry-run --json

regression:
  executed: true
  evidence:
    - node --import tsx --test test/integration/package-files.test.ts
    - npm run typecheck
    - node bin/agents-md.js verify adr docs/adr/ADR-0008-npm-package-asset-allowlist.md
    - node bin/agents-md.js verify artifacts ISSUE-244 validation
