# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-643
target_sha: 3ffd4aceda04f53d16dc4a1d28ea01e1ac99ac85

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-local-review.test.ts::gate-local-review: default branch HEADがbase_shaより前進していてもbase_shaの隔離cloneで実行する"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-local-review.test.ts::gate-local-review: default branch以外のworktreeでは隔離clone作成前に拒否する"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-local-review.test.ts::gate-local-review: base_shaがdefault branchから到達不能なら隔離clone作成前に拒否する"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-local-review.test.ts::gate-local-review: protected base worktreeがdirtyなら引き続き拒否する"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-local-review.test.ts::gate-local-review: default branch HEADがbase_shaより前進していてもbase_shaの隔離cloneで実行する（review_root/head/remotes/trusted_baseトレースおよび共有worktreeのHEAD・remote・statusの不変を検証）"

  - ac_id: AC-6
    verification:
      mode: manual
      result: pass
      reason: "エラーメッセージ文言に detach checkoutを促す `expected=<base_sha>` 形式が含まれないことは、自動テストのdoesNotMatch(/expected=/)assertionで機械検証済みだが、文言全体が「拒否理由（root不一致／default branch不一致／到達不能／dirty）のみを述べる」という定性的要件はソースの目視確認で最終確認する"
      procedure: |-
        .agent-skill-chain/scripts/gate-local-review.sh の全 echo ...>&2 分岐（前提チェック関連の
        4行: root不一致・default branch不一致・到達不能・dirty）を grep -n で列挙し、各文言が
        (a) 拒否理由のみを述べていること、(b) `expected=` 形式を含まないこと、(c) 共有worktreeの
        detach checkoutを促す表現（例:「〜へcheckoutしてください」等base_sha指定のcheckout誘導）
        を含まないことを目視確認した。
      executor: validation_worker (claude)
    evidence:
      - "test/integration/gate-local-review.test.ts::gate-local-review: default branch以外のworktreeでは隔離clone作成前に拒否する（assert.doesNotMatch(result.stderr, /expected=/)）"
      - "test/integration/gate-local-review.test.ts::gate-local-review: base_shaがdefault branchから到達不能なら隔離clone作成前に拒否する（assert.doesNotMatch(result.stderr, /expected=/)）"
      - ".agent-skill-chain/scripts/gate-local-review.sh の該当echo文言目視確認（root不一致・default branch不一致・到達不能・dirtyの4分岐いずれもexpected=形式・detach checkout誘導文言を含まない）"

regression:
  executed: true
  evidence:
    - "npm run build (tsc, 成功)"
    - "npm test (node --import tsx --test, 全1164件成功。初回実行でtest/integration/worker-adapters.test.tsの
      Issue #364回帰guard（$var直後の非ASCII文字検出）が.agent-skill-chain/scripts/gate-local-review.shの
      新設エラーメッセージ3箇所を検出したため、当該箇所を${var}の明示区切り記法へ修正（commit
      3ffd4aceda04f53d16dc4a1d28ea01e1ac99ac85）した上で全1164件成功を再確認済み)"
