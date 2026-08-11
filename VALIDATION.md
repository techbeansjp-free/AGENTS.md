schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-619
target_sha: c251c6d5582d60a4c8570830254217264a103aa2

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: '対象ファイルが1件以上のとき、該当ファイルのみを短命ブランチで削除しPRをadmin mergeする（無関係ファイルは削除しない）'（mainチェックアウト中に実行し完了後mainへ戻ることを検証）"
      - "test/unit/checkout-state.test.ts: 'captureCheckoutState/restoreCheckoutState: ブランチチェックアウト中の記録・復元'"
      - "npm test 実行結果（2026-08-11）: 該当テストはpass"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run (ISSUE-619 AC-2): main以外のブランチをチェックアウト中に実行した場合、完了後に元のブランチへ戻る'"
      - "npm test 実行結果（2026-08-11）: 該当テストはpass"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: '対象4ファイルが0件のときno-opになり、PR作成・admin mergeを一切行わない'（チェックアウト状態不変のアサーション含む）"
      - "npm test 実行結果（2026-08-11）: 該当テストはpass"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run 自己修復: 1回目のadmin merge失敗後、次runは既存のOPEN cleanup PRを再利用し重複作成せず再試行に成功する'（既存OPENブランチ・PR再利用時にチェックアウト状態が変化しないことを検証）"
      - "npm test 実行結果（2026-08-11）: 該当テストはpass"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run (ISSUE-619 AC-5): commit・push成功後にPR作成が失敗した場合も、エラー終了しつつチェックアウト状態が実行前へ戻る'"
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run (ISSUE-619): チェックアウト状態の復元自体が失敗した場合、スコープ検査・admin mergeを実行せずエラー終了する'（復元失敗時のfail-closedを検証）"
      - "test/unit/checkout-state.test.ts: 'restoreCheckoutState: 復元先が存在しない場合、復元失敗の旨と失敗後の現在ブランチ名を含むエラーメッセージを返す'"
      - "npm test 実行結果（2026-08-11）: 該当テストはpass"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 既存の成功系テスト（'対象ファイルが1件以上のとき...'／'対象4ファイルすべてが存在する場合はすべて削除対象になる'／ISSUE-588関連テスト）が本変更後も標準出力（PR番号）・終了コード0で完了することを確認"
      - "npm test 実行結果（2026-08-11）: 該当テスト群はいずれもpass"

regression:
  executed: true
  evidence:
    - "npm test 実行結果（2026-08-11、target_sha=c251c6d5）: 1147 tests, 1146 pass, 1 fail"
    - "失敗1件（既存回帰）: test/integration/pr-merge.test.ts の 'pr merge (ISSUE-590 AC-3): マージ・同期成功後、root直下混入ファイルをroot-cleanup runが自動検出・削除する' が失敗（748行目、fs.existsSync(SPEC.md) が true。期待値 false）。原因: `pr merge` は syncMainWorktree() でmain worktreeを最新化した直後に同一プロセス内で root-cleanup run を連鎖呼び出しするが、本Issueの restoreCheckoutState は一時ブランチでのcommit・admin merge完了後、実行前に記録したブランチ名（main）へ `git checkout` するのみで、root-cleanup run自身が実行したadmin merge（origin側の新しいmainの先端）へローカルのmainブランチ参照を追随（fetch + --ff-only）させない。そのため復元後のmain worktreeの作業ツリーは削除前の内容のまま残り、`pr merge` 呼び出し元から見るとroot直下混入ファイルが削除されていないように見える回帰が生じる。"
    - "同一commit（5ed26bb55、本Issue着手前のmain）でtest/integration/pr-merge.test.tsを単独実行した結果: 26 tests, 26 pass, 0 fail（本Issueのtarget_sha c251c6d5でのみ発生する回帰であることを確認済み）"
    - "本回帰はSPEC.mdのAC-1〜AC-6のいずれの検証対象（`root-cleanup run` 単体のチェックアウト状態）にも該当しない（SPEC.mdのスコープ外節は『root-cleanup run 以外のコマンドのチェックアウト状態管理』を明示的に対象外としている）が、`pr merge` からの連鎖呼び出し時に既存機能（ISSUE-590 AC-3）を壊す実際の回帰であるため、ここに記録する。DESIGN.md/PLAN.mdの追加変更（`pr merge` 連鎖呼び出し後のローカルmain追随、または `root-cleanup run` 自身によるadmin merge後のff-only同期）を伴う設計判断が必要であり、本ロール（validation_worker）はSPEC.md/DESIGN.md/PLAN.mdの編集権限を持たないため、この回帰の是正は本Issueの後続対応（設計セグメントの再訪または別Issue）に委ねる。"
