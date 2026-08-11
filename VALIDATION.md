# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。
#
# 注意: src/commands/verify.ts の acCoverage() は本ファイル全体を単一の
# YAML文書として readYamlFile() で読み込む。Markdown見出しや複数の
# ```yaml``` フェンスを混在させると parse() が失敗するため、本ファイルは
# 常に純粋なYAMLとして記述し、見出し相当の情報はコメント（#）で表現する。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-592
target_sha: 4bf585ca1ebb409962e87e9202a27a0e2fc23231

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "grep -n '§' .agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md .agent-skill-chain/templates/adr/ADR.md（該当行なし、grep終了コード1で確認）"
      - "git show 4bf585ca1: 対象5ファイルの冒頭コメントから「AGENTS.md §<見出し名>」形式の記述を除去し、セクション記号を用いない由来表記へ置換したdiffを確認"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "node bin/agents-md.js lint references .agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md .agent-skill-chain/templates/adr/ADR.md（対象5ファイルへの明示パス指定実行、終了コード0）"
      - "node bin/agents-md.js lint references（引数なし、既定のリポジトリ全体走査、終了コード0）"
      - "PR #637 Check Run 'verify'（.github/workflows/agent-skill-chain-ci.yml、lint-references.sh 既定走査を含む）: pass"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "node bin/agents-md.js lint references（引数なし、既定のリポジトリ全体走査、対象5ファイル以外の新規違反なし、終了コード0）"
      - "git diff origin/main...4bf585ca1 --stat（変更ファイルが対象5ファイル・Issue成果物SPEC.md/DESIGN.md/PLAN.md/docs/adr/ADR-0057-*.mdのみであることを確認、対象5ファイル以外の生きたファイルへの変更なし）"
      - ".agent-skill-chain/ci/verify-doc-length.sh（対象5ファイルの行数上限超過なし、終了コード0）"

regression:
  executed: true
  evidence:
    - "PR #637 Check Run 'verify': pass（https://github.com/techbeansjp-free/AGENTS.md/actions/runs/31497828199/job/93799886691）"
    - "PR #637 Check Run 'verify-config-doc-sync': pass（https://github.com/techbeansjp-free/AGENTS.md/actions/runs/31497828188/job/93799886669）"
    - "node bin/agents-md.js lint references（引数なし、既定のリポジトリ全体走査、終了コード0、対象5ファイル以外への回帰なし）"
    - ".agent-skill-chain/ci/verify-doc-length.sh（全対象文書、終了コード0）"
