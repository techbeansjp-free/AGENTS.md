schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-619
target_sha: 67528492d533cc32f0d1326487df5519301367b9

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: '対象ファイルが1件以上のとき、該当ファイルのみを短命ブランチで削除しPRをadmin mergeする（無関係ファイルは削除しない）'（mainチェックアウト中に実行し完了後mainへ戻ることを検証）"
      - "test/unit/checkout-state.test.ts: 'captureCheckoutState/restoreCheckoutState: ブランチチェックアウト中の記録・復元'"
      - "npm test 実行結果（2026-08-11、target_sha=67528492d）: 該当テストはpass"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run (ISSUE-619 AC-2): main以外のブランチをチェックアウト中に実行した場合、完了後に元のブランチへ戻る'"
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run (design-gate再通過, PLAN #16): baseと異なるブランチをチェックアウト中は、admin merge成功後もfetch/ff-only同期を試みない'（design-gate再通過分の追加検証。base以外へ復元・滞在している場合はsyncBaseBranchAfterAdminMergeが何もしないことを確認し、AC-2の『main以外のブランチへの復元』とチェックアウト状態不変の両立を裏付ける）"
      - "npm test 実行結果（2026-08-11、target_sha=67528492d）: 該当テストはpass"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: '対象4ファイルが0件のときno-opになり、PR作成・admin mergeを一切行わない'（チェックアウト状態不変のアサーション含む）"
      - "npm test 実行結果（2026-08-11、target_sha=67528492d）: 該当テストはpass"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run 自己修復: 1回目のadmin merge失敗後、次runは既存のOPEN cleanup PRを再利用し重複作成せず再試行に成功する'（既存OPENブランチ・PR再利用時にチェックアウト状態が変化しないことを検証）"
      - "npm test 実行結果（2026-08-11、target_sha=67528492d）: 該当テストはpass"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run (ISSUE-619 AC-5): commit・push成功後にPR作成が失敗した場合も、エラー終了しつつチェックアウト状態が実行前へ戻る'"
      - "test/integration/root-cleanup.test.ts: 'root-cleanup run (ISSUE-619): チェックアウト状態の復元自体が失敗した場合、スコープ検査・admin mergeを実行せずエラー終了する'（復元失敗時のfail-closedを検証）"
      - "test/unit/checkout-state.test.ts: 'restoreCheckoutState: 復元先が存在しない場合、復元失敗の旨と失敗後の現在ブランチ名を含むエラーメッセージを返す'"
      - "npm test 実行結果（2026-08-11、target_sha=67528492d）: 該当テストはpass"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts: 既存の成功系テスト（'対象ファイルが1件以上のとき...'／'対象4ファイルすべてが存在する場合はすべて削除対象になる'／ISSUE-588関連テスト）が本変更後も標準出力（PR番号）・終了コード0で完了することを確認"
      - "npm test 実行結果（2026-08-11、target_sha=67528492d）: 該当テスト群はいずれもpass"

regression:
  executed: true
  evidence:
    - "初回検証（2026-08-11、target_sha=c251c6d5）: npm test（1147 tests）で1件failを検出。失敗内容: test/integration/pr-merge.test.ts の 'pr merge (ISSUE-590 AC-3): マージ・同期成功後、root直下混入ファイルをroot-cleanup runが自動検出・削除する'。原因は `pr merge` の `syncMainWorktree()` 直後の `root-cleanup run` 連鎖呼び出しにおいて、`root-cleanup run` 自身のadmin mergeがbase branchのorigin先端を前進させても、`restoreCheckoutState` は実行前に記録したブランチ名（main）へ `git checkout` するのみでローカルmain参照をその先端へ追随（fetch + --ff-only）させないことだった。詳細はISSUE-619 PR #623のvalidation_workerコメント（2026-08-11T10:10:30Z）に記録済み。"
    - "本回帰を受け、design_workerがDESIGN.md/PLAN.md/ADR-0048へdesign-gate再通過分（`root-cleanup run` 自身に `syncBaseBranchAfterAdminMerge` を新設し、自身のadmin merge成功直後・現在のチェックアウトがbaseと一致する場合のみfetch+ff-onlyでローカルを追随させる設計）をcommit 3f6c80d89へpushし、implementation workerがcommit 67528492dへ実装（`src/commands/root-cleanup.ts` への `syncBaseBranchAfterAdminMerge` 追加、`test/helpers/gh-stub.ts` へのadmin merge時base branch前進シミュレーション追加、`test/integration/root-cleanup.test.ts` への新規テスト・既存テスト是正を含むPLAN #13〜#17）を反映した。"
    - "再検証（2026-08-11、target_sha=67528492d）: npm test 全件実行結果 1148 tests, 1148 pass, 0 fail（新規テスト1件増加分を含め全pass、既存回帰は解消）。"
    - "個別再実行（2026-08-11、target_sha=67528492d）: `npx tsx --test test/integration/pr-merge.test.ts` 全26件pass（うち 'pr merge (ISSUE-590 AC-3): マージ・同期成功後、root直下混入ファイルをroot-cleanup runが自動検出・削除する' がpassし回帰解消を確認）。`npx tsx --test test/integration/root-cleanup.test.ts test/unit/checkout-state.test.ts` 全16件pass（design-gate再通過分の新規テスト 'root-cleanup run (design-gate再通過, PLAN #16): baseと異なるブランチをチェックアウト中は、admin merge成功後もfetch/ff-only同期を試みない' を含む）。"
    - "本是正（`syncBaseBranchAfterAdminMerge` 新設）はSPEC.mdのAC-1〜AC-6のいずれの検証対象（`root-cleanup run` 単体のチェックアウト状態）にも該当しない新規の『要件』（DESIGN.mdの対応表に記載、SPEC.md自体は変更なし）として実装されており、SPEC.mdのスコープ外節が定める『`root-cleanup run` 以外のコマンドのチェックアウト状態管理』（`pr merge` 側の変更）には踏み込んでいない。`pr merge`（`src/commands/pr.ts`）自体は本Issueを通じて変更されていない。"
