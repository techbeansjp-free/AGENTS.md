@integration
Feature: 収束済みreview sessionだけをStep 10へ記録する

  Scenario: SCN-INT-REVIEWCONV-001 Step 10を永続session digestとexact HEADへ結び付ける
    Given Step 9まで進んだquick stagingと収束済みreview sessionがある
    When 保存済みreview session digestでStep 10をCLI記録する
    Then Step 10記録は成功する
    And Step 10にreview session bindingが永続化される
    When 自己申告した別digestでStep 10をCLI記録する
    Then Step 10記録は拒否される

  Scenario: SCN-INT-REVIEWCONV-002 review後のHEAD変更をPR作成前に拒否し再reviewとStep 10で再認可する
    Given Step 10まで進んだquick stagingとPR preview入力がある
    When Step 10後に新しいcommitを追加し旧bindingでPR previewする
    Then PR previewはreview binding不一致でprovider呼び出し前に拒否される
    When 新しいHEADをround 2で再reviewしStep 10を再記録する
    And 新しいbindingでPR previewする
    Then PR previewは成功する
