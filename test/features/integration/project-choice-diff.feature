@integration @project-choice-diff
Feature: 実repositoryのproject choice差分をtrusted policyと比較する
  実際のproject choiceを使い、正当な拡張とauthority変更を区別する。

  Scenario: SCN-INT-CHOICE-001 実repositoryのproject choiceに対しmodelMapping有効化を許可する
    Given 実repositoryのproject choiceでmodelMappingだけを有効化したcandidateがある
    When trusted policyとcandidate policyのproject choice差分を比較する
    Then policy比較はmodelMapping変更を許可し変更pathを返す

  Scenario: SCN-INT-CHOICE-002 実repositoryのproject choiceに対しrelease変更を拒否する
    Given 実repositoryのproject choiceでreleaseだけを変更したcandidateがある
    When trusted policyとcandidate policyのproject choice差分を比較する
    Then policy比較はrelease変更を日本語のauthority診断で拒否する

  Scenario: SCN-INT-CHOICE-003 候補側にだけ存在する提案では受理されない
    Given 候補側にだけ縮小提案を置いたpolicy setがある
    When trusted policyとcandidate policyのproject choice差分を比較する
    Then policy比較は縮小をASC-TRUST-001で拒否する

  Scenario: SCN-INT-CHOICE-004 policy migrateの互換性判定でも同じ受理条件が働く
    Given 既定branch側へ縮小提案を登録したpolicy setがある
    When migrate経路で縮小の互換性を判定する
    Then migrate経路の判定は縮小を受理する

  Scenario: SCN-INT-CHOICE-005 縮小提案の宣言形式と案内が配布物に含まれる
    Given 配布物のschemaと利用案内がある
    When 配布物から縮小提案の宣言形式を探す
    Then 配布物は縮小提案のschemaと二段階手順の案内を含む
