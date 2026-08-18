schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-703
target_sha: a692f01933f5d3f752fbf9beabb3d1f5515f3947

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-submit-evidence-reachability.test.ts: 単独実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-submit-evidence-reachability.test.ts: 単独実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-submit-evidence-reachability.test.ts: 単独実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-submit-evidence-reachability.test.ts: 単独実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-submit-evidence-reachability.test.ts: 単独実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-submit-evidence-reachability.test.ts: 単独実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-7
    verification:
      mode: hybrid
      result: pass
      reason: "5拒否原因の出力と次操作の文言を自動表明し、その対応関係を検証者が確認するため"
      procedure: "対象テストを単独実行し、5原因の相異なる日本語出力、推奨操作、到達不能出力にupdate-branchが無い表明を確認した"
      executor: "validation_worker"
    evidence:
      - "test/integration/gate-submit-evidence-reachability.test.ts: 単独実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-evidence.test.ts: Issue #703 AC-8を単独選択実行 tests=1, pass=1, fail=0, skipped=0, exit=0"
  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-local-review.test.ts: Issue #703 AC-9を単独選択実行 tests=3, pass=3, fail=0, skipped=0, exit=0"

regression:
  executed: true
  evidence:
    - "npm run build: exit=0"
    - "npm test: tests=1416, pass=1415, fail=0, skipped=1, cancelled=0, todo=0, exit=0"
    - ".agent-skill-chain/scripts/lint-references.sh: exit=0"
    - ".agent-skill-chain/scripts/lint-vocab.sh: exit=0"
    - ".agent-skill-chain/scripts/adr-lint.sh check: exit=0"
    - ".agent-skill-chain/ci/verify-doc-length.sh: exit=0"
    - ".agent-skill-chain/ci/verify-adr.sh: exit=1, stderr='adr_path は必須です'"
    - ".agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0074-recorder-base-reachability-and-published-head.md: exit=0"
    - "Issue #739: target_shaはVALIDATION.md追加前に検証したSHAであり、本ファイルのcommit後にvalidation-gate対象HEADと一致しない構造欠陥は本Issueで是正していない"
