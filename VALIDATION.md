schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-538
target_sha: 67d9bc2ab5e0f46889e6d1f39aa996371fb966af

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/setup.test.ts: 'setup github --dry-run: .github/への実書込みを一切行わず、setup labels/setup rulesetも呼ばない'"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/sync.test.ts: 'sync templates --dry-run: 実書込みを一切行わず、変更予定一覧を終了コード0で表示する'"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/setup.test.ts: 'setup github --help / -h: --dry-run フラグの説明が含まれる'"
      - "test/integration/sync.test.ts: 'sync templates --help / -h: --dry-run フラグの説明が含まれる'"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/fs-copy.test.ts: 'detectCaseCollision:true・大文字小文字のみ異なる既存ファイルがあると CliError で中断し、既存ファイルは変更されない'"
      - "test/integration/setup.test.ts: 'setup github: 大文字小文字のみ異なる既存ファイルがあると検知され、既存ファイルは無警告で上書きされない'"
      - "test/integration/sync.test.ts: 'sync templates: 大文字小文字のみ異なる既存ファイルがあると検知され、既存ファイルは無警告で上書きされない'"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/fs-copy.test.ts: 'detectCaseCollision:true・dryRun:trueでも実書込み無しに同じ衝突検知結果になる'"
      - "test/integration/sync.test.ts: 'sync templates --dry-run: 大文字小文字衝突は実書込み無しに検知される'"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/fs-copy.test.ts: 'detectCaseCollision:true・完全一致（大文字小文字含む）の既存ファイルは従来どおり上書きされ、衝突検知は発火しない'"
      - "test/integration/sync.test.ts: 'sync templates: 大文字小文字含め完全一致する既存ファイルへの既存動作（無条件上書き）は変更しない'"

regression:
  executed: true
  evidence:
    - "node --import tsx --test test/unit/fs-copy.test.ts test/integration/setup.test.ts test/integration/sync.test.ts (# tests 64, # pass 64, # fail 0)"
    - "node --import tsx --test test/integration/verify.test.ts (# tests 69, # pass 69, # fail 0。commit 67d9bc2ab で verify ac-coverage のAC-ID抽出をSPEC.md見出しベースへ修正した際の回帰確認を含む)"
    - "npm run build (tsc, エラー無し)"
    - "npm run typecheck (tsc --noEmit -p tsconfig.test.json, エラー無し)"
    - ".agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-538 (commit 67d9bc2ab、exit 0)"
    - "ci-run: https://github.com/techbeansjp-free/AGENTS.md/actions/runs/31429397803 (verify, commit cd73db15a, success)"
    - "ci-run: https://github.com/techbeansjp-free/AGENTS.md/actions/runs/31429398483 (verify-config-doc-sync, commit cd73db15a, success)"
