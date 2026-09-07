@integration @evidence-reanchor
Feature: 証跡再固定がCLIと診断経路で機能する

  Scenario: SCN-INT-REANCHOR-001 再固定がprovider呼び出しを行わない
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 再固定をCLIから適用する
    Then provider呼び出しは0件になる

  Scenario: SCN-INT-REANCHOR-002 実git fixtureで到達性が報告される
    Given 実git fixtureのstagingがある
    When 到達性を観測する
    Then 到達性の三値が報告される

  Scenario: SCN-INT-REANCHOR-003 到達性観測は1 stagingにつき1回を超えない
    Given 実git fixtureのstagingがある
    When 到達性を観測する
    Then provider観測は1回になる

  Scenario: SCN-INT-REANCHOR-004 再固定後にpr createのbinding検査を通過する
    Given 収束済みreview sessionと等価なrebaseがある
    When review層の再固定のあとにpr createのbinding検査を通す
    Then binding検査は停止しない

  Scenario: SCN-INT-REANCHOR-005 再固定後にpr mergeの再観測が通過する
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When delivery層の再固定のあとにpr mergeのbinding検査を通す
    Then pr mergeのbinding検査は通過する

  Scenario: SCN-INT-REANCHOR-006 再固定記録のないstagingは固定済みheadだけを受理する
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 再固定せずに新headでpr mergeのbinding検査を通す
    Then pr mergeのbinding検査は固定済みheadとの不一致で停止する

  Scenario: SCN-INT-REANCHOR-007 連鎖条件を満たさない記録は実効HEADの導出に使わない
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 連鎖しない記録を積んで新headでpr mergeのbinding検査を通す
    Then pr mergeのbinding検査は固定済みheadとの不一致で停止する

  Scenario: SCN-INT-REANCHOR-008 旧baseが旧headの祖先でない場合の診断一致
    Given 旧baseが旧headの祖先でないdelivery stateがある
    When 同じ再固定入力でpreviewとapplyをCLIから実行する
    Then 両方が同じruleIdと理由で拒否し旧側比較役割と4 SHAを示す

  Scenario: SCN-INT-REANCHOR-009 新baseが新headの祖先でない場合の診断一致
    Given 新baseが新headの祖先でないdelivery stateがある
    When 同じ再固定入力でpreviewとapplyをCLIから実行する
    Then 両方が同じruleIdと理由で拒否し新側比較役割と4 SHAを示す

  Scenario: SCN-INT-REANCHOR-010 入力と耐久状態の拒否一致
    Given 再固定できるdelivery stateがある
    When 不正SHAと空理由とstate欠落をpreviewとapplyで評価する
    Then 各入力のpreviewとapplyが同じ既存理由で拒否される

  Scenario: SCN-INT-REANCHOR-011 previewの無書込みと正常適用
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When stagingとGitを観測してpreviewの後にapplyする
    Then previewはstaging親directoryとGitを変えずapplyだけが追記する

  Scenario: SCN-INT-REANCHOR-012 二層等価と冪等性をpreviewでも維持
    Given SHA行だけを更新したrebase後のreview証跡がある
    When 二層等価な入力をpreviewして二回applyする
    Then previewは成功し初回だけ追記して二回目はunchangedになる

  Scenario: SCN-INT-REANCHOR-013 内容非等価とartifact不正の拒否一致
    Given SHA行に加えて判定も書き換えたrebase後のreview証跡がある
    When 同じ再固定入力でpreviewとapplyをCLIから実行する
    Then 内容非等価のpreviewとapplyが同じ既存理由で拒否される

  Scenario: SCN-INT-REANCHOR-014 成功preview後の状態変化をapplyで拒否
    Given 収束済みreview sessionと等価なrebaseがある
    When 成功preview後にreview sessionを未収束へ変えてapplyする
    Then applyは最新状態を拒否しchainを追記しない

  Scenario: SCN-INT-REANCHOR-015 拒否previewの無書込み
    Given 旧baseが旧headの祖先でないdelivery stateがある
    When stagingとGitを観測して拒否previewを実行する
    Then 拒否previewはstaging親directoryとGitを変えない
