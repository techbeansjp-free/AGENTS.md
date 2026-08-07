schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-469
target_sha: c04d23e91a67760b558deea99501d14fe4cf3446

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 'lint vocab: 単一引用符の禁止語リテラルは非散文コードの配列要素・関数引数で誤検出されない（Issue #469 AC-1・AC-2）' (npx tsx --test test/integration/lint.test.ts, 18/18 pass)"
      - "node bin/agents-md.js lint vocab src/lib/review-light.ts 実行結果: exit 0, review-light.ts:60 の 'issue' が違反として報告されない"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 'lint vocab: 単一引用符の禁止語リテラルは非散文コードの配列要素・関数引数で誤検出されない（Issue #469 AC-1・AC-2）'（配列要素・関数呼び出し引数それぞれの一般ケースを複数含む、npx tsx --test test/integration/lint.test.ts, 18/18 pass）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 'lint vocab: 単一引用符の禁止語を含む散文はコード値リテラル文脈として除外されない（Issue #469 AC-3）'（.md中の単一引用符表記が引き続き違反として検出されることを確認、exit 1・stderrに違反メッセージ一致）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test 実行結果: 898/898 pass（test/integration/lint.test.ts の既存18ケース全て、コード識別子文脈・YAML識別子文脈・CLIサブコマンド文脈・屈折形・外部語彙許可リスト等を含む）を含めregressionなし"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "AC-5のThen条件は「agent-skill-chain / ci workflowのverifyジョブが本Issueの誤検知を原因としてfailureを起こさない」ことであり、自動テストの再現確認だけでなく実際のCI実行結果の確認を要するためhybridとした。"
      procedure: "PR #481（headブランチ bugfix/469-lint-vocab-cli-arg-quote、target_sha c04d23e9）に対する最新CI実行を `gh pr checks 481` および `gh api repos/techbeansjp-free/AGENTS.md/actions/runs/<run-id>/jobs` で確認した。"
      executor: validation_worker
    evidence:
      - "https://github.com/techbeansjp-free/AGENTS.md/actions/runs/31138866548 : agent-skill-chain / ci workflowの verify ジョブが success で完了（target_sha c04d23e9）。`gh api repos/techbeansjp-free/AGENTS.md/actions/runs/31138866548/jobs` によるステップ別 conclusion 確認で、verify-spec-bdd・lint-vocab を含む全23ステップが success。lint-vocabステップが実行され、本Issueが報告した review-light.ts:60 の 'issue' 誤検知によるfailureが発生していないことを確認した。"
      - "先行するAC-5検証（target_sha c1d0e79e時点、run 31136560113）では、SPEC.md AC-5自身の検証方法見込み欄の記法が verify-spec-bdd 規約（バッククォート単独語）から逸脱しており verify-spec-bdd ステップがfailし、後続の lint-vocab ステップ自体が未実行のままジョブがfailしていた。これをcommit c04d23e9（AC-5検証方法見込み欄を `hybrid` の単独語表記へ修正）で是正した結果、verify-spec-bddが成功し後続のlint-vocabも実行・成功した。"
      - "ローカルでも node bin/agents-md.js lint vocab（対象省略時のデフォルト全体、review-light.ts:60 を含む）を実行しexit 0・違反0件を確認済み（AC-1〜AC-4のevidence参照）。"

regression:
  executed: true
  evidence:
    - "npm test: 898/898 pass"
    - "node bin/agents-md.js lint vocab（対象省略時のデフォルト全体）: exit 0, 違反0件"
    - "npm run build (tsc): エラーなし"
