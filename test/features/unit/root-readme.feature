@unit
Feature: root READMEの公開案内契約

  Scenario: SCN-UNIT-README-001 READMEが現行の公開CLI 4 commandを記載する
    Given repository rootに利用者向けREADMEがある
    When READMEの公開案内を検査する
    Then READMEは製品目的と前提条件と現行の公開CLI 4 commandを記載する

  Scenario: SCN-UNIT-README-002 READMEが旧CLI aliasを推奨表現として含まない
    Given repository rootに利用者向けREADMEがある
    When READMEの公開案内を検査する
    Then READMEは旧CLI aliasをnpx commandとして推奨しない

  Scenario: SCN-UNIT-README-003 READMEがpreview既定と--applyを明示する
    Given repository rootに利用者向けREADMEがある
    When READMEの公開案内を検査する
    Then READMEは対象directoryとpreview既定とapply条件を明示する

  Scenario: SCN-UNIT-README-004 READMEが規約を再定義せず正本へlinkする
    Given repository rootに利用者向けREADMEがある
    When READMEの公開案内を検査する
    Then READMEはhost連携と規範と仕様の正本へ有効なlinkを持つ
