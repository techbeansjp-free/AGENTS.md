# 正本: AGENTS.md §不変条件I7
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-326
target_sha: 4f790e6716a15463724e81e360d639aeb9ed8367

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/project-policy.test.ts: 'loadProjectPolicyDocuments: documents.commonの登録文書を読み込む'"
      - "test/integration/issue-lifecycle.test.ts: segment start出力に自己拡張の project rules（RULES.mdの内容）が含まれることをassert"
      - "実機確認: `agent-skill-chain segment start ISSUE-326 implementation` の出力にdocuments.common登録済みRULES.mdの内容が含まれることを目視確認（2026-08-01）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/project-policy.test.ts: '要求segmentのrole文書だけを追加する'（documents.roles.implementationのみ登録した文書がimplementation要求時に含まれ、documents.roles.specのみ登録した文書は含まれないことを確認）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/project-policy.test.ts: 'manifest.yamlがないconsumer projectでは空配列を返す'"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/project-policy.test.ts: 'スキーマに適合しないmanifestはエラーにする'"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "ci-run: PR #327の agent-skill-chain/self-test（npm test実行）が成功（2m31s）"
      - "ローカル: test/unit/project-policy.test.ts・test/unit/schema.test.ts・test/unit/model-selection.test.ts・test/integration/self-extension-policy.test.ts・test/integration/issue-lifecycle.test.ts の60件が全てpass"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/project-policy.test.ts: 'loadProjectPolicyDocuments: documents.commonに登録された文書の実体が無い場合はエラーにする'（documents.commonへ実体の無いファイルパスを登録し、loadProjectPolicyDocumentsがENOENTを含む例外を投げることをassert）"
      - "test/unit/project-policy.test.ts: 'loadProjectPolicyDocuments: documents.roles.<segment>に登録された文書の実体が無い場合はエラーにする'（documents.roles.implementationへ実体の無いファイルパスを登録し、implementation segment指定時に同様の例外を投げることをassert）"
      - "ローカル: npm test（test/unit・test/integration全件）実行、追加した2件を含め全件pass、既存テストへの回帰なし"

regression:
  executed: true
  evidence:
    - "ci-run: PR #327の agent-skill-chain/self-test（npm test全件、既存テストへの回帰なし）"
    - "既知の別因（Issue #325・Issue #300、いずれも既存・別Issueで追跡中）によるverify / verify-and-publishの失敗は、本Issueの変更が原因ではないことを個別のCIログで確認済み（gh run view --log-failedで根本原因を特定）"
    - "ローカル: AC-6検証テスト追加後にnpm testを再実行し、test/unit・test/integration全件（追加分含む）がpassすることを確認、既存テストへの影響なし"
