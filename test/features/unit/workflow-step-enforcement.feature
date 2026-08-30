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
