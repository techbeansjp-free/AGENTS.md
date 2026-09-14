@integration
Feature: 計画単位テンプレートの配布

  Scenario: SCN-INT-ADMIT-007 新ディレクトリが導入先へ配置され診断が入口不足を報告しない
    Given 計画テンプレート検証用の隔離directoryがある
    When 隔離先へpackage資産を導入する
    Then 計画単位テンプレートとディレクトリ入口が配置され診断が入口不足を報告しない
