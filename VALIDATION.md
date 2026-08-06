schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-461
target_sha: e8a9f6cbc4de7bedcb0e09367e732e502830399a

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts:1375 「verify spec-bdd: Thenの正当なパス変数表記はプレースホルダとして検出しない」"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts:1401 「verify spec-bdd: テンプレートのプレースホルダがGiven/When/Then/検証方法見込みに残っていると検出する」"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts:1389 「verify spec-bdd: 実内容中に説明的プレースホルダが残っていると検出する」"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts:1477 「verify design-diagram: 根拠の正当なパス変数表記はプレースホルダとして検出しない」"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts:1541 「verify design-diagram: テンプレート自体（プレースホルダ未置換）は判断・根拠の両方を検出する」"
      - "test/integration/verify.test.ts:1554 「verify design-diagram: 「### 図示要否の判断」セクション自体が無いと検出する」"

regression:
  executed: true
  evidence:
    - "node --import tsx --test $(find test/unit test/integration -name '*.test.ts') 実行結果: 887件中885件pass・2件fail（/tmp/full-test-run-461.log）。失敗2件（worker-adapters.test.ts:1914 ISSUE-442関連, test/unit/paths.test.ts:3376 repoRoot .git未検出ケース）は本Issueの変更差分（DESIGN.md/PLAN.md/SPEC.md/docs/adr/ADR-0033/src/commands/verify.ts/test/integration/verify.test.tsのみ、git diff origin/main...HEAD --statで確認）と無関係な既存ファイルであり、本Issueの変更が原因ではない"
