@integration
Feature: Step 10の再reviewへGit由来のfocused対象を渡す

  Scenario: SCN-DELEGATED-FOCUS-001 2 blockerを1入力へ集め全計画と無関係改善を再投入しない
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    When 同じHEADのfocused委譲入力をcaptureする
    Then focused委譲の1入力に両blockerと隣接対象があり全計画と無関係Mediumがない

  Scenario: SCN-DELEGATED-FOCUS-002 隣接回帰と前blockerへの新findingも対象に含める
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    When focused隣接fileと前blockerへの新findingをcaptureする
    Then 隣接回帰と前blockerの新findingを保持し無関係Mediumを除外する

  Scenario: SCN-DELEGATED-FOCUS-003 影響を証明できないときcompleteへ戻す
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    And focused委譲の影響を証明できない設定変更を含める
    When 同じHEADのfocused委譲入力をcaptureする
    Then complete委譲には承認済み計画と全差分がある

  Scenario: SCN-DELEGATED-FOCUS-004 収集打切りを成功としない
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    And focused委譲の隣接fileが収集上限を超える
    When 同じHEADのfocused委譲入力をcaptureする
    Then focused委譲は入力不成立としてexecutorを起動しない

  Scenario: SCN-DELEGATED-FOCUS-005 sessionの比較基点と入力を照合する
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    And focused委譲の比較基点がsessionと異なる
    When 同じHEADのfocused委譲入力をcaptureする
    Then focused委譲は入力不成立としてexecutorを起動しない

  Scenario: SCN-DELEGATED-FOCUS-006 Round 1のcompleteを維持する
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    And focused委譲をRound 1として起動する
    When 同じHEADのfocused委譲入力をcaptureする
    Then complete委譲には承認済み計画と全差分がある

  Scenario: SCN-DELEGATED-FOCUS-007 byte上限超過を成功としない
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    And focused委譲の差分がbyte上限を超える
    When 同じHEADのfocused委譲入力をcaptureする
    Then focused委譲は入力不成立としてexecutorを起動しない

  Scenario: SCN-DELEGATED-FOCUS-008 前回HEADからの祖先関係を検証する
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    And focused委譲の前回HEADが今回HEADのancestorではない
    When 同じHEADのfocused委譲入力をcaptureする
    Then focused委譲は入力不成立としてexecutorを起動しない

  Scenario: SCN-DELEGATED-FOCUS-009 起動中にsessionが変わった応答を成功としない
    Given focused委譲用の2つのblockerと大きな承認済み計画がある
    And focused委譲の実行中にsessionが変わる
    When 同じHEADのfocused委譲入力をcaptureする
    Then focused委譲はsession変更後の応答を破棄する
