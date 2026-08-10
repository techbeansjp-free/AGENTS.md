schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-593
target_sha: 7fb28b05ed6d1821195531f183b1a3257e6554f3

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/setup.test.ts: 'setup ruleset (ISSUE-593): 既定テンプレートはASC_GATE_APP_ID未設定でも初回POST・2回目PUTが完走し、gate check contextを含まない'（required_status_checksが[{context:'verify'}]のみであることを検証）"
      - ".agent-skill-chain/templates/github/provisioning/rulesets/main.json の required_status_checks.required_status_checks が verify の1件のみであることを目視確認"
      - "gh api repos/techbeansjp-free/AGENTS.md/rulesets/19276510 の実行結果: required_status_checks が verify の1件のみで配布テンプレートと一致することを確認"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "GitHub branch rulesetの実挙動確認であり、実リポジトリの適用状態・過去PRのマージ実績に対する目視確認が必要なため自動化できない"
      procedure: "(1) gh api repos/techbeansjp-free/AGENTS.md/rulesets/19276510 で現在適用中rulesetのrequired_status_checksがverifyのみであることを確認する。(2) このリポジトリ自身が個人アカウント認証でgate publishのCheck Runを一度も発行していない状態のまま、直近のPR（#585, #587等）がagent-skill-chain/{spec,design,implementation,validation}-gateのいずれも必須ステータスに含まれずマージ済みであることをgh pr checks/gh pr viewで確認する。"
      executor: validation_worker
    evidence:
      - "gh api repos/techbeansjp-free/AGENTS.md/rulesets/19276510 の実行結果: required_status_checksがverifyの1件のみ"
      - "gh pr checks 585 の実行結果: verify/verify-config-doc-sync/CodeRabbitのみでgate check 4件を含まずマージ済み"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/issue-sync.test.ts: 'gate publish (ISSUE-593): Check Run発行が失敗してもissue-syncは独立して試行され、失敗理由と転記結果の両方が出力に含まれる'"
      - "src/commands/gate.ts publish(): syncGateArtifacts()呼び出しをpublishCheckRun()失敗判定より前に配置していることをコードレビューで確認"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - ".agent-skill-chain/ci/verify-template-sync.sh 実行結果: 成功（終了コード0）"
      - "test/integration/setup.test.ts: 'setup ruleset (ISSUE-593): ...' および 'setup github (ISSUE-593): 既定テンプレートはgate check contextを含まないためASC_GATE_APP_ID未設定でも完走する' が、loadRenderedRuleset()経由でテンプレートJSONをそのまま適用に用いる経路を検証"

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: "文書内容の記載箇所・文言の充足確認であり、成果物を人が読んで趣旨が網羅されているかを判断する必要があるため自動化しない"
      procedure: "README.md（gate publishコマンド一覧付近）とdocs/ASC_GATE_APP_ID_RUNBOOK.mdを目視確認し、(a) Check Run発行元CI workflowが不在であること、(b) rulesetのrequired statusへ現状寄与しないこと、(c) 進行役が任意実行する記録専用ツールであることの3点が記載されていることを確認する。"
      executor: validation_worker
    evidence:
      - "README.md 27行目付近: gate publishの運用制約とASC_GATE_APP_ID_RUNBOOK.mdへの参照を記載"
      - "docs/ASC_GATE_APP_ID_RUNBOOK.md 59行目付近: 発行元workflow不在・required status不寄与・記録専用ツールである旨を記載"

regression:
  executed: true
  evidence:
    - "npm test 実行結果: 1110 tests, 1110 pass, 0 fail"
    - "npm run build 実行結果: 成功"
    - ".agent-skill-chain/ci/verify-template-sync.sh: 成功"
    - ".agent-skill-chain/ci/verify-doc-length.sh: 成功"
    - ".agent-skill-chain/scripts/lint-vocab.sh: 成功"
    - ".agent-skill-chain/scripts/lint-references.sh: 成功"
    - ".agent-skill-chain/scripts/adr-lint.sh check: 成功"
    - "gh pr checks 594 実行結果（target_sha=7fb28b05e）: verify pass, verify-config-doc-sync pass"
