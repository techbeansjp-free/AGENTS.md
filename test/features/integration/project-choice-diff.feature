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
