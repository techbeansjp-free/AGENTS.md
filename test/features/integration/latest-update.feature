@integration
Feature: 最新正式版への復旧導線を自動化する
  利用者に設定の手編集を要求せず、更新成功とhost session切替を分けて扱う。

  Scenario: SCN-INT-LATEST-001 最新正式版を固定して更新と診断を実行する
    Given 最新版更新用の導入済みprojectがある
    When 最新正式版への更新を依頼する
    Then 同じ正式配布物で更新とdoctorが完了する

  Scenario: SCN-INT-LATEST-002 session再起動ができなくても更新を成功として保持する
    Given 最新版更新用の導入済みprojectがある
    When hook欠落を最新版更新で修復する
    Then 更新成功と新sessionの案内を報告する

  Scenario: SCN-INT-LATEST-003 previewでは配布物を実行しない
    Given 最新版更新用の導入済みprojectがある
    When 最新版更新のpreviewと不正なreleaseを検査する
    Then 最新版更新の境界検査が成功する

  Scenario: SCN-INT-LATEST-004 doctor失敗は適用済みの更新と区別する
    Given 最新版更新用の導入済みprojectがある
    When 最新版更新後のdoctorと更新コマンドの失敗を検査する
    Then 最新版更新の境界検査が成功する
