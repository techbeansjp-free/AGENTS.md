schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-588
target_sha: 60b8300f4f8cb455ee07c618481b4518cafcab89

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts『root-cleanup run (ISSUE-588 AC-1): default branchがmain以外(develop)のリポジトリでも、PRのbaseに実際のdefault branch名が使われ成功する』（`npx tsx --test test/integration/root-cleanup.test.ts` → ok 4、`--base develop` を検証しつつ `--base main` が渡されないことを確認）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts『root-cleanup run: 対象ファイルが1件以上のとき、該当ファイルのみを短命ブランチで削除しPRをadmin mergeする（無関係ファイルは削除しない）』（同ファイル92行目 `assert.match(prCalls[0].args.join(' '), /--base main/)`）を含む既存3件（ok 1, 2, 3）が `src/commands/root-cleanup.ts` 変更後も無修正のまま成功し、default branchが `main` のリポジトリでbaseが従来どおり `main` になることを確認"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts『root-cleanup run (ISSUE-588 AC-3): default branchを機械的に特定できない場合、PR作成を試みる前に原因を含むエラーで失敗する』（`npx tsx --test test/integration/root-cleanup.test.ts` → ok 5、終了コード非0・`デフォルトブランチを特定できません` を含む標準エラー・`prCreateCalls`/`mergeCalls` が0件であることを確認）"

regression:
  executed: true
  evidence:
    - "npx tsx --test test/integration/root-cleanup.test.ts → 全9件 pass、fail 0（AC-1・AC-3の新規テストに加え、スコープ検査・自己修復・並行worktree非干渉の既存テストも回帰なし）"
    - "npm run build（tsc） → exit 0"
    - "npm test（test/unit・test/integration 全スイート、node --test） → 全件 ok、失敗0件"
    - ".agent-skill-chain/ci/verify-doc-length.sh → exit 0"
    - ".agent-skill-chain/scripts/lint-vocab.sh AGENTS.md SPEC.md DESIGN.md PLAN.md → exit 0"
    - ".agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md → exit 0"
    - ".agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0043-root-cleanup-pr-base-branch-default-branch-resolution.md → exit 0"
    - ".agent-skill-chain/ci/verify-branch-name.sh / verify-worktree-path.sh / verify-root-clean.sh / verify-config-doc-sync.sh / verify-template-sync.sh → いずれもexit 0"
    - "GitHub Actions（PR #591、commit 60b8300f4f8cb455ee07c618481b4518cafcab89）: verify・verify-config-doc-sync ともにconclusion success（`gh api repos/techbeansjp-free/AGENTS.md/commits/60b8300f4f8cb455ee07c618481b4518cafcab89/check-runs`）"
