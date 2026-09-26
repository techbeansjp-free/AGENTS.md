@integration @verification-run
Feature: verify runで検証をshellを通さず実行し観測だけを記録する
  検証の合格は自己申告ではなく観測である。verify runはH_implと影響集合に束縛した
  実行結果をstagingへ追記し、生の出力は保存しない。

  Scenario: SCN-INT-VERIFYRUN-001 shellを通さずargvを実行し終了値を返して観測だけを記録する
    Given verify run用のIssue stagingを持つrepositoryがある
    When 失敗するcommandとshell記法を含むargvでverify runを実行する
    Then 終了値をそのまま返しshellを展開せずHEADと影響集合digestと出力digestだけを記録する

  Scenario: SCN-INT-VERIFYRUN-002 未commit変更・区切り欠落・比較基点なし・fullへのtargeted・実行中の変更を拒否し記録しない
    Given verify run用のIssue stagingを持つrepositoryがある
    When 不正な条件でverify runを実行する
    Then 各条件を理由つきで拒否し観測記録を追記しない

  Scenario: SCN-INT-VERIFYRUN-003 trusted policyの宣言外のcommand・scope省略・宣言なしを実行前に拒否する
    Given verify run用のIssue stagingを持つrepositoryがある
    When trusted policyの宣言と異なるcommandとscope省略でverify runを実行する
    Then trusted policyの宣言外とscope省略と宣言なしを実行前に拒否し記録しない

  Scenario: SCN-INT-VERIFYRUN-004 Step 11記録後はstaging digestを再固定せずmerge段階以降は拒否する
    Given verify run用のIssue stagingを持つrepositoryがある
    When PR停止のStep 11記録後とmerge準備後にverify runを実行する
    Then Step 11後は記録してもstaging digestを再固定せずmerge段階では拒否する
