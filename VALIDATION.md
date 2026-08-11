schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-539
target_sha: a6cd6fd17830e64216327dfb3e11b9ad0dc7b23a

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts『lint adr check: 同一idを持つ複数ファイルは違反として検出され、重複を解消すると違反なしになる』（前半）: 自作docs/adr/に同一id: ADR-0001を持つ2ファイルを置きlint adr checkを実行、終了コード1・stderrに『重複ADR ID 'ADR-0001'』とADR-0001-a.md/ADR-0001-b.mdの2ファイル名が含まれることを確認"
      - "src/lib/adr-consistency.tsのcheckAdrIdUniqueness()実装（重複IDグループごとに『重複ADR ID '<id>': <file1>, <file2>, ...』形式で出力）をコードレビューで確認"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts『lint adr check: 同一idを持つ複数ファイルは違反として検出され、重複を解消すると違反なしになる』（後半）: 上記の重複を一意なidへ解消した後にlint adr checkを再実行し、終了コード0で終了することを確認"
      - "手動実行確認（target_sha=a6cd6fd17、plain clone・後述の理由により通常のディレクトリチェックアウトで実行）: `node bin/agents-md.js lint adr check` を本リポジトリのdocs/adr/（本Issueの再採番後）に対して実行し、終了コード0・標準エラー出力が空であることを確認"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "手動実行確認（target_sha=a6cd6fd17）: git worktree内で `node bin/agents-md.js lint adr check` を実行すると『重複ADR ID ...』の3件が報告されるが、これはrepoRoot()がlinked worktreeの.gitポインタをmainのcommon worktreeへ解決する既定設計（ADR-0004）により、本worktree自身のdocs/adr/ではなくmain（本Issueマージ前で旧重複が残る）を検査してしまうためと特定した。同一branch（commit a6cd6fd17）を`git clone --local`した通常のディレクトリ（.gitが実ディレクトリ、GitHub Actions actions/checkoutと同型の構成）で同コマンドを実行したところ終了コード0・標準エラー出力が空であることを確認し、worktree内実行時のみに現れる環境依存の誤検知（本Issueの実装内容に起因しない）であると切り分けた"
      - "docs/adr/ 一覧確認（target_sha=a6cd6fd17）: `ls docs/adr` の出力にADR-0008-*.md/ADR-0016-*.md（3件）/ADR-0039-*.mdの旧ファイル名が存在せず、ADR-0049〜ADR-0055（DESIGN.md『既存重複7ファイルの再採番マッピング』節の対応表どおり）が存在することを確認"
      - "test/integration/lint.test.ts『lint adr check: 実物 docs/adr/ は違反0で通る』: 上記のplain clone（通常のディレクトリチェックアウト）でnode --import tsx --test実行し、110 tests中0 failで本テストがpass（`ok`）することを確認（worktree内でのnpm test実行では上記と同じrepoRoot()解決の理由でこの1testのみnot okになるが、CIのactions/checkoutは通常のディレクトリチェックアウトのためplain cloneでの確認結果が実際のCI挙動と一致する）"

  - ac_id: AC-4
    verification:
      mode: manual
      result: pass
      reason: "構造化参照・バレテキスト直接参照の突き合わせは、DESIGN.md『参照影響調査』節が事前調査済みの対応表と現状のファイル内容を目視・grepで照合する作業であり、専用の自動テストを新設する対象ではない（DESIGN.mdのスコープ、SPEC.mdのAC-4検証方法見込みもmanual）"
      procedure: "(1) `grep -rn \"ADR-0016\\b\" --include=\"*.md\" --include=\"*.ts\" --include=\"*.sh\" --include=\"*.yaml\" --include=\"*.yml\" .`（node_modules/.worktrees除外）を再実行し、SPEC.md/DESIGN.md/PLAN.md（再採番マッピングの記述自体）・ADR-0056（本Issueの決定記録、旧番号への言及は由来提示）・src/lib/adr-finalize-guard.ts（本検証で追加したISSUE-539コメント、旧ファイル名への言及は由来提示）以外にADR-0016への残存参照が無いことを確認する。(2) docs/adr/ADR-0044-ruleset-template-drift-and-dedicated-app-binding-condition.md（3箇所）とdocs/ASC_GATE_APP_ID_RUNBOOK.md（1箇所）がDESIGN.md『参照影響調査』節の対応表どおりADR-0052へ更新済みであることを目視確認する。(3) 再採番対象7ファイル間・他ADRからの`related_adrs:`/`supersedes`/`superseded-by`参照が再採番前から0件（DESIGN.md記載どおり）であることをdocs/adr/*.mdへのgrepで再確認する。(4) node bin/agents-md.js lint adr check（AC-3のplain clone実行結果、対称性検査checkAdrSymmetry()を含む）で断線が0件であることを確認する。"
      executor: validation_worker
    evidence:
      - "手動実行確認（target_sha=a6cd6fd17）: grep -rn ADR-0016 の結果、SPEC.md/DESIGN.md/PLAN.md（再採番マッピングの記述自体）・docs/adr/ADR-0056-adr-id-uniqueness-check-and-duplicate-renumbering.md（決定記録としての由来提示）・src/lib/adr-finalize-guard.ts（KNOWN_FINALIZE_DEVIATIONSコメント、旧ファイル名への由来提示）以外に残存参照が無いことを確認"
      - "手動実行確認（target_sha=a6cd6fd17）: docs/adr/ADR-0044-ruleset-template-drift-and-dedicated-app-binding-condition.md（Consequences節2箇所・対象外節1箇所）とdocs/ASC_GATE_APP_ID_RUNBOOK.mdの計4箇所が、いずれもADR-0052へ更新済み（`ADR-0052のDecision節が言及するdedicated_app backend` 等）であることを確認"
      - "test/integration/verify.test.ts『verify adr: finalize経由でacceptedになった後にファイル名とidを変更（git mv）しても手順逸脱として誤検知しない（ISSUE-539）』: 検証作業中に発見したverify-adrのfinalize経路検査（Issue #188由来、checkAdrFinalizePath）の副作用――acceptedなADRをリネームするとgit showのパス固定が原因で新規finalize commitと誤認する不具合――を再現・修正し、再発防止の回帰テストとして追加。修正詳細はcommit a6cd6fd17のコミットメッセージに記載"
      - "PR #622のCheck Run『verify』再実行結果（コミットa6cd6fd17push後に確認予定、本ファイルcommit直後にpushする）"

regression:
  executed: true
  evidence:
    - "npm test 実行結果（target_sha=a6cd6fd17、本worktree内）: 1143 tests, 1142 pass, 1 fail（『lint adr check: 実物 docs/adr/ は違反0で通る』のみ、AC-3のevidence記載のとおりworktree内のrepoRoot()解決に起因する環境依存の誤検知と特定済み）, 0 cancelled, 0 skipped, 0 todo"
    - "node --import tsx --test test/integration/lint.test.ts test/integration/verify.test.ts 実行結果（target_sha=a6cd6fd17、`git clone --local`した通常のディレクトリチェックアウトで実行）: 110 tests, 110 pass, 0 fail（上記の唯一の失敗を含め全件pass、CIのactions/checkoutと同型の環境で再現性を確認）"
    - "npm run build 実行結果（target_sha=a6cd6fd17）: 成功（tsc、エラー無し）"
    - "node bin/agents-md.js verify adr docs/adr/ADR-0051-codex-exec-unsupported-flag-as-config-override.md / ADR-0052-reconcile-workflow-run-trust-boundary.md 実行結果（target_sha=a6cd6fd17）: いずれも終了コード0（本検証で修正したfinalize経路検査の副作用が解消済み）"
    - "node bin/agents-md.js lint vocab / lint references（既定の生きたファイル対象、target_sha=a6cd6fd17）実行結果: いずれも成功（終了コード0、違反0件）"
