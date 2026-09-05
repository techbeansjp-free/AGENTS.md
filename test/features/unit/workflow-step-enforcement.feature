@unit
Feature: ワークフローStepの定義とjournalを決定的に検証する

  Scenario: SCN-UNIT-WFSTEP-001 fullのstep列が0〜11であること
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFSTEP-001"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFSTEP-002 quickのstep列が0,1,4,9,10,11であること
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFSTEP-002"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFSTEP-003 pocのstep列がquickと同一であること
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFSTEP-003"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFSTEP-004 quickのskippableStepsが2,3,5,6,7,8であること
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFSTEP-004"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFSTEP-005 step 4がどのモードでも省略対象でないこと
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFSTEP-005"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFSTEP-006 step 11がどのモードでも省略対象でないこと
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFSTEP-006"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFSTEP-007 空のStep番号を拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFSTEP-007"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFPATH-001 staging path定数が1箇所から供給される
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFPATH-001"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFPATH-002 共通検査ロジックがdomainとadapterで同じ結果を返す
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFPATH-002"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFPATH-003 契約を満たしたまま未完のstagingをinterruptedにする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFPATH-003"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFPATH-004 契約を満たさない記録を持つstagingはinterruptedにしない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFPATH-004"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFPATH-005 完了したstagingはinterruptedにしない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFPATH-005"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-001 正しいjournalをvalidとする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-001"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-002 quickでstep 4欠落をmissingStepsとして検出する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-002"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-003 fullでstep 2欠落をmissingStepsとして検出する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-003"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-004 quickでstep 5の記録をunexpectedStepsとして検出する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-004"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-005 順序違反をoutOfOrderとして検出する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-005"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-006 同一stepの重複記録を許容する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-006"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-007 quickからfullへの昇格を許容する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-007"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-008 fullからquickへの降格をmodeConflictsとする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-008"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-009 quickからpocへの変更をmodeConflictsとする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-009"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-010 未知fieldを持つentryをerrorとする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-010"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-011 壊れたJSON行をerrorとし他行の解析を止めない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-011"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-012 recordedAtが逆順でも行順で判定する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-012"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-013 artifactsが空配列のentryをerrorとする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-013"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-014 昇格前の後続Step履歴がfull補完開始を順序違反にしない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-014"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-015 通常fullの後続Step履歴は過去Stepの後付けを順序違反にする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-015"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-016 full昇格後は旧modeのStep 4と9を再実施対象とする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-016"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-017 中断された一時journalは正本を壊さず次のatomic追記を妨げない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-017"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-018 journal publish後の停止はtransactionからstaging digestを前向き復旧する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-018"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFMODE-001 モード判定成果物を正準JSONで生成する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFMODE-001"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFMODE-002 Q-01〜Q-08の欠落をerrorとする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFMODE-002"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFMODE-003 pocでPocDeclaration欠落をerrorとする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFMODE-003"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFMODE-004 未知fieldを拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFMODE-004"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFMODE-005 changedFilesを保存して再分類でもfull昇格を再現する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFMODE-005"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFOVR-001 instructedAtがnowより未来のHumanOverrideを拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFOVR-001"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFOVR-002 expiresAtがnowより過去のHumanOverrideを拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFOVR-002"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFOVR-003 instructedAtがnow以下でnowがexpiresAtより前のHumanOverrideを受理する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFOVR-003"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFOVR-004 対象Issueが一致しないHumanOverrideを拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFOVR-004"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-019 transaction開始時点のstaging観測をmarkerとstaging recordへ同じ値で固定する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-019"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-020 未復旧transactionが残る状態で追記を開始しない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-020"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-021 stagingDigestBeforeとstaging recordが食い違うmarkerをbefore-publishにしない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-021"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-022 Step 11後のpost-terminal intake記録を順序違反にしない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-022"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-023 Step 11より前のpost-terminal intake記録を拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-023"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-024 intake指定のないStep 11後のStep 10再記録は順序違反にする
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-024"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-025 Step 10以外のpost-terminal intake指定を拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-025"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-026 post-terminal intakeはtrue以外を受理しない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-026"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-027 post-terminal intakeがjournalの往復で保持される
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-027"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-WFJRNL-028 Step 11記録後の追記はpost-terminal intakeのStep 10だけ通す
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-WFJRNL-028"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる
