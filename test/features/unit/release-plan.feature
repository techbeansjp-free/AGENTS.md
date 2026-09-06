@unit @release
Feature: release計画と結果集約
  外部更新前にversion・ref・品質gateを検証し、操作結果と復旧手順を曖昧なく示す。

  Scenario: SCN-UNIT-RELEASE-001 dry-runは外部更新stageを無効にする
    Given release可能な入力でdry-runを有効にする
    When release計画を作成する
    Then release計画はdry-runになる
    And 検証以外のstageはdry-runを理由に無効になる

  Scenario: SCN-UNIT-RELEASE-002 versionが単調増加でなければ拒否する
    Given 現在以下または同じ優先順位のversionを指定する
    When 単調増加しないrelease計画を作成する
    Then すべてのrelease計画はversionを根拠に拒否される

  Scenario: SCN-UNIT-RELEASE-003 既存tagと重複するreleaseを拒否する
    Given 作成予定tagが既に存在する
    When release計画を作成する
    Then release計画はtag重複を根拠に拒否される

  Scenario: SCN-UNIT-RELEASE-004 既定branch以外のrefを拒否する
    Given release対象refが既定branchと異なる
    When release計画を作成する
    Then release計画はbranch不一致を根拠に拒否される

  Scenario: SCN-UNIT-RELEASE-005 必須gateの欠落と失敗を拒否する
    Given 必須gateが欠落した入力と失敗した入力を用意する
    When 不完全なgateのrelease計画を作成する
    Then すべてのrelease計画はgateを根拠に拒否される

  Scenario: SCN-UNIT-RELEASE-006 release計画はnpm公開stageを持たない
    Given dry-run有無のrelease入力を用意する
    When npm公開条件ごとのrelease計画を作成する
    Then どの計画にもnpm公開stageが現れない

  Scenario: SCN-UNIT-RELEASE-007 途中失敗を部分成功として報告し復旧手順を返す
    Given tag成功後にGitHub Releaseが失敗した操作結果がある
    When release操作結果を集約する
    Then 結果は部分成功として完了stageと未完了stageを分離する
    And 外部更新済み状態ごとの日本語復旧手順を返す

  Scenario: SCN-UNIT-RELEASE-008 不正なversion形式と不正なSHAを拒否する
    Given 不正なversion形式と不正なSHAの入力を用意する
    When 不正入力のrelease計画を作成する
    Then すべてのrelease計画は具体的な入力根拠で拒否される
