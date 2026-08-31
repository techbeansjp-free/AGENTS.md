@integration @project-policy-file-target
Feature: policy validate CLIが利用者の指定したmanifestで合否を決める

  Scenario: SCN-INT-POLICYFILE-001 壊れたmanifestを渡すとCLIの終了値が非0になる
    Given trusted originを持つ隔離repositoryと"契約違反"の候補manifestがある
    When 候補manifestへpolicy validate CLIを実行する
    Then policy validate CLIの結果は"不合格"である

  Scenario: SCN-INT-POLICYFILE-002 実manifestを渡すとCLIの終了値が0のままである
    Given trusted originを持つ隔離repositoryと"同一内容"の候補manifestがある
    When 候補manifestへpolicy validate CLIを実行する
    Then policy validate CLIの結果は"合格"である
