schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-492
target_sha: b28c99d96b4be0c37060d47e1337a879bf7e7f35

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/init.test.ts::init: 所有権記録(.owned-files.json)が新規作成され、書き込んだファイル一覧を復元できる（Issue #492 AC-1）"
      - "test/integration/init.test.ts::init: 既存所有権記録にretainedとして残っていたエントリは、再実行後も消失しない（手動implementation-gateレビュー指摘: init-rerun-drops-prior-ownership-entries）"
      - "test/unit/ownership-record.test.ts::writeOwnershipRecord → readOwnershipRecord: ラウンドトリップで元の記録を復元する"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 配布元で廃止され導入先で未改変のファイルは削除され、更新結果一覧に含まれる（AC-2）"
      - "test/unit/stale-assets.test.ts::resolveStaleAssets: 未改変の廃止ファイルは削除され、次回記録から除去される（AC-2）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 導入先で内容が変更されたファイルは削除されず、dry-run有無を問わず同一の警告になる（AC-3）"
      - "test/unit/stale-assets.test.ts::resolveStaleAssets: 内容が変更されたファイルは削除されず、dry-run有無を問わず同一の警告になる（AC-3）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 所有権記録に無いファイルは削除候補にならず、通常のファイルと区別されない（AC-4）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: .agent-skill-chain/project/配下は所有権記録に含まれていても削除候補にならない（AC-5）"
      - "test/unit/stale-assets.test.ts::computeCandidateKeys: .agent-skill-chain/project/配下は候補から除外される（AC-5 防御的除外）"
      - "test/unit/stale-assets.test.ts::computeCandidateKeys: 正規化後にproject/配下を指す改ざん・散乱キーも候補から除外される（手動implementation-gateレビュー指摘: protected-prefix-not-normalized）"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade --dry-run: 削除予定一覧は非dry-run実行時の削除結果一覧と同一パス集合になる（AC-6）"
      - "test/unit/stale-assets.test.ts::resolveStaleAssets --dry-run: 削除候補は実削除されず一覧提示され、記録は書き込まれない（AC-6）"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 削除に失敗した場合は異常終了し失敗ファイルを明示するが、他の正常な更新結果は隠されない（AC-7・AC-11）"
      - "test/unit/stale-assets.test.ts::resolveStaleAssets: 削除操作自体が失敗した場合は異常終了対象になり、次回記録に保持される（AC-7）"

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 削除候補ファイルが既に物理的に存在しない場合はエラーにも警告にもならず、次回記録から除去される（AC-8）"
      - "test/unit/stale-assets.test.ts::classifyCandidate: ファイルが物理的に存在しない場合はAbsent（要件7・AC-8）"
      - "test/unit/stale-assets.test.ts::resolveStaleAssets: 物理的に既に存在しないファイルはエラーにも警告にもならず、次回記録から除去される（AC-8）"

  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 配布元に依然として存在するファイルは削除候補にならず通常の上書き更新に従う（AC-9）"
      - "test/unit/stale-assets.test.ts::computeCandidateKeys: 現行配布元に無い記録済みファイルのみ候補になる（AC-9: 現存ファイルは対象外）"

  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 削除候補判定のための読み取り自体が失敗した場合は削除せず警告し、異常終了しない（AC-10）"
      - "test/unit/stale-assets.test.ts::classifyCandidate: 読み取り自体がENOENT以外の理由で失敗する場合はUnreadable（要件8・AC-10）"
      - "test/unit/stale-assets.test.ts::resolveStaleAssets: 読み取り不能なファイルは削除されず警告され、次回記録に保持される（AC-10）"

  - ac_id: AC-11
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/upgrade.test.ts::upgrade: 削除に失敗した場合は異常終了し失敗ファイルを明示するが、他の正常な更新結果は隠されない（AC-7・AC-11）"
      - "test/unit/stale-assets.test.ts::resolveStaleAssets: 複数候補中1件のみ削除失敗しても、他の正常な削除結果は隠されない（AC-11）"

regression:
  executed: true
  evidence:
    - "npm test（node --import tsx --test、pretestでtsc build含む）ローカル実行: tests 942, pass 942, fail 0, cancelled 0, skipped 0, duration_ms 471106.174619（target_sha b28c99d96b4be0c37060d47e1337a879bf7e7f35 のworktreeで実測、Issue #492関連の新規テスト（test/unit/ownership-record.test.ts、test/unit/stale-assets.test.ts、test/integration/upgrade.test.ts・init.test.tsの追加分）を含むリポジトリ全942件）"
