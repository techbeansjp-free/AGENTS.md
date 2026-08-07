schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-493
target_sha: 675c8dee3b39ece226de3520a8d8a7baaa2e2ffa

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts::pr merge (AC-1/AC-3): behindな対象PRは --admin を指定しても自動最新化オプトイン無しでは中断される（AC-1）"
      - "test/integration/pr-merge.test.ts::pr merge (Issue #493 blocking是正): mergeStateStatusがCLEANでも実際にはbehind（compare API）なら中断する（AC-1: mergeStateStatus単独に依存しないbehind判定）"
      - "test/integration/pr-merge.test.ts::pr merge (Issue #493 blocking是正): mergeStateStatusがBLOCKEDでも実際にはbehind（compare API）なら中断する（AC-1）"
      - "test/unit/pr-freshness.test.ts::checkFreshness: mergeStateStatusがCLEANでも実際にbehind（compare API）ならbehindと判定する（AC-1の判定ロジック単体）"
      - "test/unit/pr-freshness.test.ts::checkFreshness: mergeStateStatusがBLOCKEDでも実際にbehind（compare API）ならbehindと判定する（AC-1の判定ロジック単体）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts::pr merge (AC-2): auto_update_branch有効時、update-branch API自体が失敗すれば中断する（AC-2）"
      - "test/integration/pr-merge.test.ts::pr merge (AC-2): auto_update_branch有効でもポーリング上限まで反映されなければ中断する（AC-2）"
      - "test/integration/pr-merge.test.ts::pr merge (AC-2 正常系): 複数回のポーリングを経てfreshに到達すれば最新化後にマージへ進む（AC-2の許容挙動の裏付け）"
      - "test/integration/pr-merge.test.ts::pr merge (Issue #493 blocking是正): 対象識別子がブランチ名でもupdate-branch APIは正規化されたPR番号で呼ばれる（AC-2実装前提の回帰防止）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts::pr merge (AC-1/AC-3): behindな対象PRは --admin を指定しても自動最新化オプトイン無しでは中断される（AC-3: --adminバイパス不可）"
      - "test/unit/pr-freshness.test.ts::resolveMergeTarget: -R/--repo の値取りは対象識別子探索から除外する（--admin等の値取りオプションを含む引数からの対象PR識別の正しさ）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts::pr merge (AC-4): 最新性確認自体（gh pr view）が失敗した場合はマージを実行しない（AC-4）"
      - "test/integration/pr-merge.test.ts::pr merge (AC-4): 対象識別子省略時にcwdベースの暗黙解決も失敗すれば中断する（AC-4: 対象PR自体を特定できないケース）"
      - "test/unit/pr-freshness.test.ts::checkFreshness: compare API呼び出し自体が失敗した場合はcheck_failedのままとする（AC-4の判定ロジック単体）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts::pr merge (AC-5): 対象識別子省略時、cwdベースの暗黙解決が成功しfreshなら従来通りマージが成立する（AC-5）"
      - "test/integration/pr-merge.test.ts::pr merge (AC): gh pr merge 成功後、cwdがissue worktreeでもmain worktreeをorigin/mainへfast-forward同期する（AC-5: 既存syncMainWorktree挙動の回帰防止）"
      - "test/integration/pr-merge.test.ts::pr merge (Issue #493 warning是正): 事後検知は撤去済みのため、通常の成功マージでは追加のfreshness確認も警告も発生しない（AC-5: fresh時に追加I/Oが挟まらないことの確認）"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts::pr merge (AC-6): 最新性と無関係な失敗（権限不足）は既存のgh pr merge出力をそのまま維持する（AC-6）"
      - "test/integration/pr-merge.test.ts::pr merge (AC): gh pr merge が失敗した場合、main worktreeの同期は実行されず非0で終了する（AC-6: 既存失敗時挙動の回帰防止）"
      - "test/unit/pr-freshness.test.ts::MergeFailureClassifier.classifyMergeFailure: 権限不足は unrelated（AC-6の分類ロジック単体）"
      - "test/unit/pr-freshness.test.ts::MergeFailureClassifier.classifyMergeFailure: 既にマージ済みは unrelated（AC-6）"
      - "test/unit/pr-freshness.test.ts::MergeFailureClassifier.classifyMergeFailure: 既にクローズ済みは unrelated（AC-6）"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts::pr merge (AC-7): 確認通過後のTOCTOU競合でgh pr mergeが失敗した場合は安全側エラーを付加する（AC-7）"
      - "test/unit/pr-freshness.test.ts::MergeFailureClassifier.classifyMergeFailure: 未知の失敗理由（base branch進行等）は安全側でambiguous（AC-7の分類ロジック単体）"
      - "test/unit/pr-freshness.test.ts::MergeFailureClassifier.classifyMergeFailure: 空文字列も安全側でambiguous（AC-7）"

regression:
  executed: true
  evidence:
    - "npm test（node --import tsx --test、pretestでtsc build含む）ローカル実行: tests 944, pass 944, fail 0, cancelled 0, skipped 0, duration_ms 418751.176913（target_sha 675c8dee3b39ece226de3520a8d8a7baaa2e2ffa のworktreeで実測、Issue #493関連の新規テスト（test/lib/pr-freshness.ts対応のtest/unit/pr-freshness.test.ts、test/integration/pr-merge.test.tsの追加分、test/helpers/gh-stub.ts・tmp-repo.tsの拡張）を含むリポジトリ全944件）"
    - "test/unit/pr-freshness.test.ts と test/integration/pr-merge.test.ts のみの絞り込み再実行（node --import tsx --test）: tests 48, pass 48, fail 0（AC-1〜AC-7全件を含む本Issue関連テストの単独再現）"
    - "npm run typecheck（tsc --noEmit -p tsconfig.test.json）: エラー無し"
