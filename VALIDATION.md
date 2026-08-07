schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-484
target_sha: 1eaf707c27384df5883d4a810a000d0a2dbe4381

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 'lint vocab: 非散文ファイルの単一行コメント中にある禁止語リテラルを検出する（Issue #484 AC-1・AC-2）'（.tsケース: `const value = 1; // deprecated values: ('issue', 'legacy')` が exit 1 かつ `quoted-literal-comment.ts:1: 禁止語 'issue' が見つかりました（'成果物' を使用してください）` で検出されることを確認、npx tsx --test test/integration/lint.test.ts, 19/19 pass）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 同テスト内の .sh/.yaml/.yml ケース（`# deprecated values: ('issue', 'legacy')`）がいずれも exit 1 かつ同一メッセージで検出されることを確認（npx tsx --test test/integration/lint.test.ts, 19/19 pass）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 'lint vocab: 単一引用符の禁止語リテラルは非散文コードの配列要素・関数引数で誤検出されない（Issue #469 AC-1・AC-2）'（`gh(['issue', 'view', issueNumber, '--json', 'labels'], root);` を含む複数ケースが exit 0・stderr空で非退行を維持することを確認）"
      - "node bin/agents-md.js lint vocab src/lib/review-light.ts 実行結果: exit 0, review-light.ts:60 の 'issue' が違反として報告されない"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "npx tsx --test test/integration/lint.test.ts 実行結果: 19/19 pass（コード識別子文脈・YAML識別子文脈・CLIサブコマンド文脈・散文中の禁止語誤用・屈折形・外部語彙許可リスト・Issue #469 コード値リテラル文脈・lint referencesケース・lint adr checkケースを含む既存全ケースが現行の期待結果のまま成功）"
      - "npm test 実行結果: 899/899 pass（test/unit・test/integration 全体、regressionなし）"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "AC-5のThen条件は「本Issueが意図した検出（非散文ファイルのコメント中の禁止語）以外に、既存の生きたファイル群で新規の違反・既存動作からの変化が生じない」ことであり、この判定はリポジトリ全体への実行結果を人手で確認する必要があるためhybridとした。"
      procedure: "ビルド後（npm run build）、リポジトリルートで `node bin/agents-md.js lint vocab`（対象省略時のデフォルト全体）を実行し、出力（終了コード・stderr）を確認した。"
      executor: validation_worker
    evidence:
      - "node bin/agents-md.js lint vocab（対象省略時のデフォルト全体）実行結果: exit 0, stderr空, 違反0件。本Issueが解消する意図した検出漏れパターン（非散文ファイルのコメント中の禁止語）に該当する既存の生きたファイルは本リポジトリに存在せず、また本Issueの変更により新規の誤検知・既存動作からの変化も生じていないことを確認した。"
      - "npm run build (tsc) 実行結果: エラーなし"
      - "PR #485（headブランチ bugfix/484-lint-vocab-comment-suppress、target_sha 1eaf707c）は本検証時点でDraft状態であり、`agent-skill-chain / ci` workflow（`on: pull_request: types: [opened, synchronize, reopened, ready_for_review]`）はDraft中は起動しないため、実際のGitHub Actions CI実行結果は本検証には含まれない（`gh api repos/techbeansjp-free/AGENTS.md/commits/1eaf707c.../status` で確認、CodeRabbit以外のstatusなし）。CI実行の確認は、進行役がPRをReady for Reviewへ遷移させた後に別途必要となる。"

regression:
  executed: true
  evidence:
    - "npm test: 899/899 pass"
    - "npx tsx --test test/integration/lint.test.ts: 19/19 pass"
    - "node bin/agents-md.js lint vocab（対象省略時のデフォルト全体）: exit 0, 違反0件"
    - "npm run build (tsc): エラーなし"
