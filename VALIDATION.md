# VALIDATION: CI/gate運用の本番導入とE2Eフロー実地一周
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# (agent-skill-chain/validation-report/v1) に完全一致する単一YAMLドキュメントである。
#
# 注記: .agent-skill-chain/templates/issue/VALIDATION.md のテンプレートは
# Markdown見出し + AC毎に分割した複数の```yaml```フェンスという構造だが、
# src/commands/verify.ts の acCoverage() は本ファイル全体を readYamlFile()
# （yamlパッケージの parse() を生のテキストへ直接適用）で1つのYAML文書として
# 読み込む実装であり、Markdown見出しや複数フェンスが混在すると
# 「Implicit keys need to be on a single line」でパースに失敗する
# （実機確認済み。ADR.md/SPEC.mdは正規表現でフェンス抽出、またはAC-IDの正規表現走査のみのため
# この制約を受けないが、VALIDATION.mdのみ本制約を受ける）。
# よって本ファイルはテンプレートの見出し構造ではなく、スキーマが要求する
# フィールドをすべて満たす1つのYAMLとして記述する（見出し相当の情報は
# 本コメントとキー名・配列構造で表現する）。この既知の齟齬は
# docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/04_review.md に追記した。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-171
target_sha: bae0fdaf2bb509ff3e08b308f07da27f7ff5343f

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: manual
      result: pass
      reason: "本リポジトリ自身へのinit実行という一度きりの運用操作であり、自動テストではなく実機実行・出力目視確認で検証する"
      procedure: "node bin/agents-md.js init --dry-run 実行後 node bin/agents-md.js init を実行し、.github/配下18ファイルがcreated、AGENTS.md/CLAUDE.md/.agent-skill-chain一式がunchangedであることを出力で確認した"
      executor: claude
    evidence:
      - "docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/04_review.md#2-レビュー結論-conformance-立証-実行手順ごとの実測結果"
      - "commit:703b179"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "dry-runと実行結果のファイル一覧比較は一度きりの実機確認であり自動テスト化していない"
      procedure: "init --dry-run のplanned createdファイル一覧と、init実行のcreatedファイル一覧を目視で突き合わせ、完全一致を確認した"
      executor: claude
    evidence:
      - "docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/04_review.md#2-レビュー結論-conformance-立証-実行手順ごとの実測結果"

  - ac_id: AC-3
    verification:
      mode: manual
      result: pass
      reason: "設定ファイル1行の変更確認であり自動テスト化していない"
      procedure: "grep で .agent-skill-chain/config/agent-skill-chain.yaml の review.adapter が human になっていることを確認した"
      executor: claude
    evidence:
      - "commit:703b179"
      - ".agent-skill-chain/config/agent-skill-chain.yaml"

  - ac_id: AC-4
    verification:
      mode: manual
      result: pass
      reason: "既存schemaファイルの記述確認であり自動テスト化していない"
      procedure: ".agent-skill-chain/schemas/config.schema.yaml の adapter フィールドの enum に human が含まれることをコード読解で確認した"
      executor: claude
    evidence:
      - ".agent-skill-chain/schemas/config.schema.yaml"

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: "CLIコマンドの実機実行結果確認であり、専用の自動テストケースとしては未登録（test/integration/verify.testでの一般的なbranch-nameテストとは別に、本Issueブランチでの実地実行を直接確認した）"
      procedure: "node bin/agents-md.js verify branch-name process/171-ci-gate-dogfood と引数省略実行の両方を行い終了コード0を確認した"
      executor: claude
    evidence:
      - "docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/04_review.md#2-レビュー結論-conformance-立証-実行手順ごとの実測結果"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
      reason: "npm test はリポジトリの自動テストスイート全体を実行するCI相当のコマンドである"
      procedure: "npm test を実行し、pass/fail件数を実測した。初回314/322pass・8fail（review.adapterデフォルト値変更・.installed_version混入起因、原因特定済み）を経て、fixture結合解消・detached HEAD対応等の修正後は335/335pass（既存328件＋新規7件）まで到達した"
      executor: claude
    evidence:
      - "docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/04_review.md#3-falsification-反証-8件のtest-failの根本原因"
      - "docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/04_review.md#10-追記-5回目-pr-172-実地実行で9の修正後verifyジョブのverify-branch-nameが同種のdetached-headバグで失敗"
      - "commit:9fb39e9"
      - "commit:bae0fda"

  - ac_id: AC-7
    verification:
      mode: manual
      result: pass
      reason: "verify artifacts / verify ac-coverage はCLIの検証コマンドであり、その実行結果自体を目視・終了コードで確認する一度きりの検証である"
      procedure: "node bin/agents-md.js verify artifacts ISSUE-171 {spec,design,implementation,validation} を4回、node bin/agents-md.js verify ac-coverage ISSUE-171 を1回実行し、いずれも終了コード0であることを実機確認した"
      executor: claude
    evidence:
      - "SPEC.md"
      - "DESIGN.md"
      - "PLAN.md"
      - "VALIDATION.md"
      - "docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/04_review.md#11-追記-6回目"

regression:
  executed: true
  evidence:
    - "npm test（335/335 pass、実行日時は04_review.md参照）"
