schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-553
target_sha: ac938bfa77afa22ba0685a71c81016892a9dc63b

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "grep -n 'verify-template-sync.sh' AGENTS.md → AGENTS.md:103 の1件のみで、記載は `.agent-skill-chain/ci/verify-template-sync.sh`。`ls .agent-skill-chain/ci/verify-template-sync.sh` は実在確認成功、`ls .agent-skill-chain/scripts/verify-template-sync.sh` は失敗（存在しない）。"
      - ".agent-skill-chain/scripts/lint-references.sh AGENTS.md → exit 0（本AC対象箇所は禁止参照なし。同スクリプトが検出するAGENTS.md:87の1件は本Issue差分と無関係な既存事象であり、origin/mainに対する同スクリプト実行でも同一箇所が同一内容で検出されることを確認済み＝本PRによる新規混入ではない）"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "AGENTS.md内2箇所（「GitHub配布・マルチAI対応」節と「ディレクトリ構成」節）が同一ディレクトリを指しているかは意味的な突合が必要であり、既存の自動チェック（lint-references等）はこの種の整合性を検査対象としていないため目視確認とする。"
      procedure: "AGENTS.md:103の「GitHub配布・マルチAI対応」節にある `.agent-skill-chain/ci/verify-template-sync.sh` という記載と、AGENTS.md:126-132の「ディレクトリ構成」節のツリー表記（`ci/` 配下の一覧に `verify-template-sync` が列挙されている）を突き合わせ、両方とも `.agent-skill-chain/ci/` を指しており矛盾が無いことを確認した。"
      executor: "validation_worker(claude)"
    evidence:
      - "grep -n 'verify-template-sync' AGENTS.md → AGENTS.md:103（`.agent-skill-chain/ci/verify-template-sync.sh`）とAGENTS.md:132（`ci/  (verify-branch-name, verify-worktree-path, verify-template-sync, ...)`）の2箇所がいずれも`ci/`配下を指し一致することを確認"

  - ac_id: AC-3
    verification:
      mode: manual
      result: pass
      reason: "併記されているsetup-labels.sh・setup-ruleset.shへの言及が意図せず変更されていないことの確認は、commit差分中の当該部分文字列比較を要するため目視確認とする。"
      procedure: "git diff main...ac938bfa77afa22ba0685a71c81016892a9dc63b -- AGENTS.md で該当行の差分を確認し、`.agent-skill-chain/scripts/setup-labels.sh`・`.agent-skill-chain/scripts/setup-ruleset.sh` への言及部分が変更前後で完全に同一の文字列のまま維持されていること（差分箇所は`verify-template-sync.sh`のパス部分のみ）を確認した。両ファイルが `.agent-skill-chain/scripts/` 配下に実在することも `ls` で確認済み。"
      executor: "validation_worker(claude)"
    evidence:
      - "git show ac938bfa77afa22ba0685a71c81016892a9dc63b -- AGENTS.md の差分1行のうち、setup-labels.sh・setup-ruleset.sh記載部分は変更行内でも文字列として不変（変更箇所は`.agent-skill-chain/scripts/verify-template-sync.sh`→`.agent-skill-chain/ci/verify-template-sync.sh`のみ）"
      - "ls .agent-skill-chain/scripts/setup-labels.sh .agent-skill-chain/scripts/setup-ruleset.sh → 両方とも実在確認成功"

regression:
  executed: true
  evidence:
    - "npm run typecheck (tsc --noEmit -p tsconfig.test.json) → exit 0、ログ: typecheck-execution.log"
    - "npm test（test/unit・test/integration 全84ファイル、node --test）→ 全件 ok、失敗0件、ログ: test-execution.log"
    - ".agent-skill-chain/ci/verify-doc-length.sh → exit 0"
    - ".agent-skill-chain/scripts/lint-vocab.sh AGENTS.md SPEC.md DESIGN.md PLAN.md → exit 0"
    - ".agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md → exit 0"
    - ".agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0040-agents-md-verify-template-sync-path-doc-only-fix.md → exit 0"
    - ".agent-skill-chain/ci/verify-branch-name.sh / verify-worktree-path.sh / verify-root-clean.sh / verify-config-doc-sync.sh / verify-template-sync.sh → いずれもexit 0"
