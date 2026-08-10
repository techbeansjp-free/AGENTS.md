schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-586
target_sha: ab3105c0adaff07719d2d55298afc6f99549551d

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/init.test.ts: 'init: 新規導入時に.agent-skill-chain/project/manifest.yaml・RULES.mdが自動生成され、案内メッセージが出力される（ISSUE-586 AC-1）'"
      - "test/integration/init.test.ts: 'init --dry-run: .agent-skill-chain/project/配下は一切作成されない（ISSUE-586）'"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/project-policy-scaffold.test.ts: 'scaffoldProjectPolicy: 生成したmanifest.yamlはproject-policy.schema.yamlの必須フィールドを満たす'"
      - "test/integration/init.test.ts: 'init: 生成された.agent-skill-chain/project/manifest.yamlはproject-policy.schema.yamlの必須フィールドを満たす（ISSUE-586 AC-2）'"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts: 'upgrade: initが自動生成したproject/manifest.yaml・RULES.mdを独自の値へ書き換えても、upgrade実行後も変更されない（ISSUE-586 AC-3）'"
      - "test/integration/upgrade.test.ts: 'upgrade: .agent-skill-chain/project/配下のカスタム内容は変更されず、標準アセットはパッケージ同梱版へ上書きされる'"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/uninstall.test.ts: 'uninstall: initが自動生成したproject/manifest.yaml・RULES.mdは、uninstall実行後も削除されず保持される（ISSUE-586 AC-4）'"
      - "test/integration/uninstall.test.ts: 'uninstall: 安全確認を通過した場合、project/を除く導入資産が削除され、project/は保持される'"

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: "対象文書（docs/PROJECT_POLICY.md）が最小具体例をmanifest.yamlの必須フィールドを過不足なく満たす形で自己完結して記載しているかは、スキーマ検証だけでなく文書としての読みやすさ・自己完結性（AGENTS.md『成果物の自己完結性』節）を人間可読の観点で確認する必要があり、自動テストでは検査しきれないため。"
      procedure: "docs/PROJECT_POLICY.md（91行）を読み、(a) .agent-skill-chain/project/manifest.yamlの必須フィールド（schema_version・project.id/policy_version・documents.common/roles・precedence.level/overrides・constraints.may_override_core_invariants/unregistered_documents_are_normative）を全て埋めた最小具体例が記載されていること、(b) 対応するRULES.mdの記述例が併記されていること、(c) upgrade/uninstallの.agent-skill-chain/project/への不可侵/保持という既存不変条件がAGENTS.mdを由来として自己完結して記載されていることを目視確認した。"
      executor: "validation_worker（本ISSUE-586のvalidationセグメント担当）"
    evidence:
      - "docs/PROJECT_POLICY.md"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/project-policy-scaffold.test.ts: 'scaffoldProjectPolicy: manifest.yamlが既に存在する場合は完全no-op（RULES.mdの独自内容も変更しない）'"
      - "test/integration/init.test.ts: 'init: 既に.agent-skill-chain/project/manifest.yamlが存在する状態で再実行しても、既存のRULES.md・manifest.yamlの内容を変更しない（ISSUE-586 要件6・AC-6）'"

regression:
  executed: true
  evidence:
    - "npm test（node --import tsx --test、test/unit + test/integration 全体）: 1092 tests, 1092 pass, 0 fail（commit ab3105c0adaff07719d2d55298afc6f99549551d時点でのローカル実行）"
