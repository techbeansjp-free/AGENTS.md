schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-469
target_sha: c1d0e79e99e834a85bd1cdb73a862dcb56483caa

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
      result: fail
      reason: "AC-5のThen条件は「agent-skill-chain / ci workflowのverifyジョブが本Issueの誤検知を原因としてfailureを起こさない」ことであり、自動テストの再現確認だけでなく実際のCI実行結果の確認を要するためhybridとした。"
      procedure: "PR #481（headブランチ bugfix/469-lint-vocab-cli-arg-quote、target_sha c1d0e79e）に対する最新CI実行を `gh pr checks 481` および `gh run view <run-id> --log-failed` で確認した。"
      executor: validation_worker
    evidence:
      - "https://github.com/techbeansjp-free/AGENTS.md/actions/runs/31136560113 : agent-skill-chain / ci workflowの verify ジョブがfailしている。ただし失敗箇所は本Issueが対象とする lint-vocab ステップではなく、先行する verify-spec-bdd ステップである。ログ: 'SPEC.md: AC-5 の検証方法見込みは automated|manual|hybrid のいずれかである必要があります: `hybrid`（自動テストによる再現確認に加え、実際のCI実行結果を進行役が確認する）'。verify-spec-bdd.sh（実体 src/commands/verify.ts の specBdd()）の正規表現 `^`?(automated|manual|hybrid)`?$` はバッククォート付き単独語のみを許容し、本SPEC.md AC-5自身が付記した括弧書きの補足説明と一致しない。verify-spec-bddステップがfailで停止するため、後続の lint-vocab ステップ自体が実行されずスキップされている（ジョブログに lint-vocab ステップの出力が存在しない）。"
      - "ローカルでは node bin/agents-md.js lint vocab（対象省略時のデフォルト全体、review-light.ts:60 を含む）を実行しexit 0・違反0件を確認済み（AC-1〜AC-4のevidence参照）。本Issueが報告した誤検知自体はコード変更により解消されているが、上記の別原因（SPEC.md AC-5自身の検証方法見込み欄の記法が本リポジトリの既存慣行〔他Issueの検証済みSPEC.mdでは `hybrid` を注釈なしのバッククォート単独語として記載〕から逸脱している）により、CI上のverifyジョブは現時点でfailのままであり、AC-5のThen条件（verifyジョブのfailureが発生しない）を実CI結果として満たせていない。"

regression:
  executed: true
  evidence:
    - "npm test: 898/898 pass"
    - "node bin/agents-md.js lint vocab（対象省略時のデフォルト全体）: exit 0, 違反0件"
    - "npm run build (tsc): エラーなし"
