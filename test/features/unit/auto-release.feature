@unit @auto-release
Feature: main mergeの自動release計画
  release対象変更、再帰防止、version衝突を外部処理なしで判定する。

  Scenario: SCN-UNIT-AUTORELEASE-001 release対象pathの変更でreleaseへ進む
    Given release対象pathを変更した自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は現在versionのreleaseへ進む

  Scenario: SCN-UNIT-AUTORELEASE-002 文書だけの変更ではreleaseしない
    Given 文書とtestとworkflowだけを変更した自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は対象pathなしを理由に停止する

  Scenario: SCN-UNIT-AUTORELEASE-003 skip ciを含むcommitではreleaseしない
    Given skip ciを含む自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は再帰防止を理由に停止する

  Scenario: SCN-UNIT-AUTORELEASE-004 既定branch以外のrefではreleaseしない
    Given 既定branch以外の自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画はbranch不一致を理由に停止する

  Scenario: SCN-UNIT-AUTORELEASE-005 既存tagと衝突するversionはbump後にreleaseする
    Given 現在versionのtagが存在する自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は次のprereleaseへbumpしてからreleaseする

  Scenario: SCN-UNIT-AUTORELEASE-006 prereleaseとpatchのbump規則が0.3.xの範囲を出ない
    Given prereleaseと通常versionと解決不能versionの衝突入力がある
    When 衝突した自動release計画を作成する
    Then 解決可能なversionは0.3.x内でbumpし解決不能なversionは停止する

  Scenario: SCN-UNIT-AUTORELEASE-007 bump経路のgateがaudit:checkを含まない
    Given audit:checkを含むbump経路のworkflow本文がある
    When 自動release workflow契約を検証する
    Then 自動release workflow検証はbump経路のaudit:checkを根拠に拒否する
