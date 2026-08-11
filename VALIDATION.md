schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-602
target_sha: 8bd47eb9e28b6849fa2bd3ca9c461002ec4b545a

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lease-status.test.ts: 'lease status (github): 有効なleaseの現在状態を副作用無しで表示する（AC-1）'（acquire直後の正本値と一致するholder/segment/acquired_at/expires_at/remaining_secondsを標準出力で確認し、実行前後でlease refのSHAとIssueコメント一覧が不変であることを検証）"
      - "test/integration/lease-status.test.ts: 'lease status (local): 有効なleaseの現在状態を副作用無しで表示する（AC-1, AC-6）'（実行前後でlease.yamlの内容が不変であることを検証）"
      - "test/unit/github-lease.test.ts: 'classifyLeaseState: expires_atが未来ならactiveと残り秒数（正）を返す（AC-1）'（分類関数の純粋ロジックを単体で検証）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lease-status.test.ts: 'lease status (github): Issueコメントの古い記載ではなくgit ref上の実際の値を返す（AC-2）'（acquire時のIssueコメント記載expires_atとrenew後のgit ref上expires_atを意図的に乖離させ、lease statusの出力がgit ref側の値と一致しコメント側の古い値とは一致しないことを検証）"
      - "src/commands/lease.ts status(): GithubLeaseStatusReader経路（allLeasesFor/activeLeasesFor経由でreadLeaseFromRefのみを呼ぶ）をコードレビューで確認し、Issueコメント本文を読む経路を一切含まないことを確認"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lease-status.test.ts: 'lease status (github): leaseが存在しない場合と期限切れの場合を区別可能な形で出力する（AC-3）'（not_found/expiredの出力が互いに排他であることを検証）"
      - "test/integration/lease-status.test.ts: 'lease status (github): Coordination Backendへの接続失敗はコマンド自体の異常終了として区別される（AC-3）'（存在しないremoteへの接続失敗時、終了コード1・status行なし・「接続に失敗しました」を含むstderrであることを検証）"
      - "test/integration/lease-status.test.ts: 'lease status (local): leaseが存在しない場合と期限切れの場合を区別可能な形で出力する（AC-3）' / 'lease status (local): segmentがlease.yamlの記録と一致しない場合はnot_foundを返す（AC-3）'"
      - "test/unit/github-lease.test.ts: 'classifyLeaseState: writer_leaseが無い場合はnot_foundを返す（AC-3）' / 'classifyLeaseState: expires_atが現在時刻以前ならexpiredと負の残り秒数を返す（AC-3）' / 'classifyLeaseState: expires_atが現在時刻と厳密に等しい場合もexpiredとして扱う（境界値）' / 'checkGithubLeaseBackendReachable: origin remoteへ到達できる場合はokを返す（AC-3）' / 'checkGithubLeaseBackendReachable: origin remoteへ到達できない場合はstderrと共にng（コマンド自体の異常終了用、AC-3）'"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lease-status.test.ts: 'lease status (github): --jsonで機械可読な構造化出力を返す（AC-4）'（JSON.parseで配列を復元し、holder/segment/acquired_at/expires_atが正本値と一致しtokenを含まないことを検証）"
      - "test/integration/lease-status.test.ts: 'lease status (local): --jsonで機械可読な構造化出力を返す（AC-4）'"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lease-status.test.ts: 'lease status (github): segment省略時は対象Issueの有効なwriter leaseを全件返す（AC-5）'（期限切れの他segmentは除外され有効なsegmentのみ残ること、segment指定時と同等の情報量であることを検証）"
      - "test/integration/lease-status.test.ts: 'lease status (github): 対象Issueに有効leaseが複数存在する場合はいずれも欠落せず表示する（AC-5）'（複数有効leaseがいずれも欠落せず返ることを検証）"
      - "test/integration/lease-status.test.ts: 'lease status (local): segment省略時は対象Issueの有効なwriter leaseを返す（AC-5）'"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lease-status.test.ts: 'lease status (github): writer lease credentialを保持しない実行主体でも現在状態を返し、credentialを新規作成しない（AC-6）'（readLeaseCredentialがacquire相当の直接ref操作後もundefinedのままであることを実行前後で確認し、lease statusが結果を返しかつcredentialを新規作成しないことを検証）"
      - "test/integration/lease-status.test.ts: 'lease status (local): 有効なleaseの現在状態を副作用無しで表示する（AC-1, AC-6）'（ローカルモードでもcredential等の書込み系関数を一切呼ばない読み取り専用経路であることを実行前後のファイル内容不変で確認）"
      - "src/commands/lease.ts status(): lease-credential.ts（readLeaseCredential等）をimportしない実装であることをコードレビューで確認"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "PLAN.md #6の方針通り、既存lease系サブコマンドのテストを無変更のまま実行し回帰が無いことを確認: test/unit/github-lease.test.ts、test/integration/lease-reclaim.test.ts、test/integration/lease-renew.test.ts、test/integration/lease-resume.test.ts、test/integration/lease-concurrency.test.ts"
      - "npm test 実行結果（target_sha=8bd47eb9e）: 1131 tests, 1131 pass, 0 fail, 0 cancelled（上記回帰対象を含む全テストスイート、duration_ms=2100653.65）"
      - "src/lib/cli-routes.ts: 既存の'lease acquire'/'lease release'/'lease renew'/'lease resume'/'lease reclaim'エントリが無変更で残り、'lease status'エントリが1行追加されたのみであることをコードレビューで確認"

regression:
  executed: true
  evidence:
    - "npm test 実行結果（target_sha=8bd47eb9e）: 1131 tests, 1131 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo"
    - "npm run build 実行結果: 成功（tsc、エラー無し）"
    - ".agent-skill-chain/ci/verify-template-sync.sh: 成功（終了コード0）"
    - ".agent-skill-chain/ci/verify-doc-length.sh: 成功（終了コード0）"
    - ".agent-skill-chain/scripts/lint-vocab.sh（既定の生きたファイル対象）: 成功（終了コード0、違反0件）"
    - ".agent-skill-chain/scripts/lint-references.sh（既定の生きたファイル対象）: 成功（終了コード0、違反0件）"
    - ".agent-skill-chain/scripts/adr-lint.sh check: 成功（終了コード0）"
    - "gh pr checks 603 実行結果（PR #603, target_sha=8bd47eb9e）: CodeRabbit pass（Draft PRのためレビュー自体はskip、CI失敗無し）"
