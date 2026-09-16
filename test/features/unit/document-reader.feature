@unit @document-reader
Feature: 文書の読者を定め、概要が単体で全体像を伝える

  Scenario: SCN-UNIT-SPECDOC-001 規範文書が文書の読者を案内として定める
    Given 配布される規範文書がある
    When 実repositoryの開発ワークフロー正本を読む
    Then 文書の読者の節がある
    And 読者表は発注・評価する人、実装・レビューする人、運用する人の3区分を持つ
    And 文書の読者の節は強制点を持たないと明記する

  Scenario: SCN-UNIT-SPECDOC-002 システム概要が単体で全体像を伝え索引が読み手別の読み順を持つ
    Given 製品のシステム仕様書がある
    When 実repositoryのシステム概要と仕様書索引を読む
    Then 概要は目的、利用者、解決する課題、提供する価値、対象外、全体の流れの見出しを持つ
    And 概要はStep 0からStep 11までの工程図を1枚持つ
    And 索引は読み手別の読み順の表に3区分の読者を持つ
