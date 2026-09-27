@unit
Feature: 番号だけを進めた旧policy schemaを現行schemaの別名として読む
  既定branchが旧番号のpolicyを宣言している移行期間中も、trusted policyの読取りを止めない。

  Scenario: SCN-UNIT-SCHEMAALIAS-001 v0.3.1を宣言するmanifestとdefault policyを現行schemaとして検証する
    Given 現行のproject policy manifestとdefault policyのschemaVersionをv0.3.1へ置き換える
    When manifestとdefault policyを検証する
    Then どちらも合格する

  Scenario: SCN-UNIT-SCHEMAALIAS-002 別名でない旧版と未知の版を現行schemaとして扱わない
    Given policy schemaの版の一覧がある
    When 各版が現行schemaとして扱われるかを判定する
    Then v0.4.4とv0.3.1だけが現行schemaとして扱われる
    And v0.3.2を宣言するmanifestは不正な版として拒否される
