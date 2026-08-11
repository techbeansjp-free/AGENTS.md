schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-611
target_sha: e6c6899fc011ececd789d4ab419dc699608f777c

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "手動実行確認（target_sha=e6c6899fc）: 一時ディレクトリへ `node bin/agents-md.js init <tmp>` → `node bin/agents-md.js setup github <tmp>` を実行し、展開先 `<tmp>/.github/` を列挙した結果 `dependabot.yml` が一切生成されないことを確認（CODEOWNERS/ISSUE_TEMPLATE/SECURITY.md/pull_request_template.md/workflows/ のみが存在）"
      - "test/integration/verify.test.ts: 'verify template-sync: 未同期・同期後の一致・再改変による差分検出をすべて確認する' 等の既存 sync templates 成功パス（配布元に dependabot.yml が存在しない状態で afterSync.status===0 を検証）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - ".agent-skill-chain/templates/github/.github.seed-only.yaml（target_sha=e6c6899fc）: `paths:` が `CODEOWNERS` のみで `dependabot.yml` エントリが存在しないことを目視・grep確認済み"
      - "test/integration/verify.test.ts: 'verify template-sync: seed-only指定ファイル（CODEOWNERS）はプレースホルダー書き換え後も差分として報告しない（AC-1）'（CODEOWNERSエントリのseed-only判定が引き続き機能することを確認、旧dependabot.yml向けケースはPLAN.md変更単位#3のとおり削除済み）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test 実行結果（target_sha=e6c6899fc）: 1111 tests, 1111 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo（test/integration/verify.test.ts・test/integration/doctor.test.ts含む全スイート）"
      - "test/integration/verify.test.ts: 'verify template-sync: 未同期・同期後の一致・再改変による差分検出をすべて確認する' / 'verify template-sync: seed-only指定ファイル（CODEOWNERS）はプレースホルダー書き換え後も差分として報告しない（AC-1）' / 'verify template-sync: 展開先だけに存在する本体専用ファイルは差分として報告しない' の3ケースがいずれも成功し、配布元に dependabot.yml が存在しないことによる誤検知が起きないことを確認"
      - "手動実行確認: `.agent-skill-chain/ci/verify-template-sync.sh`（本リポジトリ自身に対する実行、target_sha=e6c6899fc）が終了コード0で成功"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/dependabot-ci-skip.test.ts・test/unit/dependabot-ci-skip-exec.test.ts（target_sha=e6c6899fc、コード変更なしのまま全ケース実行）: 92 tests中の該当ケース（'ci実行(a)〜(e)' 等）が全てpass。判定ロジック・関連ワークフローステップに変更が無いことを確認"
      - "git diff main..e6c6899fc の変更ファイル一覧（.github.seed-only.yaml, .github/dependabot.yml削除, src/lib/template-sync.ts, test/integration/verify.test.ts）に .github/workflows/agent-skill-chain-ci.yml のskip_checks判定・test/unit/dependabot-ci-skip*.test.tsが含まれないことをコードレビューで確認（DESIGN.mdのAC-4設計時確認結果どおり変更不要）"

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: "このリポジトリ自身のdogfooding用ファイル1点の無変更確認であり、専用の自動テストは存在しない（既存のverify template-sync等は配布元テンプレートツリーを対象とし、リポジトリ本体の.github/を対象としないため）"
      procedure: "`git diff main -- .github/dependabot.yml`（target_sha=e6c6899fc）を実行し差分が0であることを確認、`cat .github/dependabot.yml` の内容が変更前と同一（npm・github-actions週次更新設定）であることを目視確認"
      executor: validation_worker
    evidence:
      - "手動実行確認（target_sha=e6c6899fc）: `git diff main -- .github/dependabot.yml` の出力が空であることを確認"

regression:
  executed: true
  evidence:
    - "npm test 実行結果（target_sha=e6c6899fc）: 1111 tests, 1111 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo, duration_ms=821294.97"
    - "npm run build 実行結果（target_sha=e6c6899fc）: 成功（tsc、エラー無し）"
    - ".agent-skill-chain/ci/verify-template-sync.sh 実行結果: 成功（終了コード0）"
    - ".agent-skill-chain/ci/verify-doc-length.sh 実行結果: 成功（終了コード0）"
    - "node bin/agents-md.js lint vocab（既定の生きたファイル対象）実行結果: 成功（終了コード0、違反0件）"
    - "node bin/agents-md.js lint references（既定の生きたファイル対象）実行結果: 成功（終了コード0、違反0件）"
    - ".agent-skill-chain/scripts/adr-lint.sh check 実行結果: 成功（終了コード0）"
