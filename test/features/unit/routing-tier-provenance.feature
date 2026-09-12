@unit
Feature: routing tierは判定の信頼源と用途を出力し仕様外のprovider値を拒否する

  Scenario: SCN-UNIT-TIERPROV-001 codex以外のprovider値を拒否する
    Given trusted policyを持つ隔離repositoryがある
    When routing tierをcodex以外のprovider値で実行する
    Then すべてcodexだけを受理する案内つきで拒否される

  Scenario: SCN-UNIT-TIERPROV-002 未指定経路の成功出力はfilesystemの信頼源と互換検証の用途を持つ
    Given trusted policyを持つ隔離repositoryのworking treeへtierMappingのkeyを未commitで足す
    When routing tierをprovider未指定で実行する
    Then 成功出力はfilesystemの信頼源とcompatibility-onlyの用途を含む

  Scenario: SCN-UNIT-TIERPROV-003 未指定経路の失敗診断はtrustedを主張しない
    Given trusted policyを持つ隔離repositoryがある
    When routing tierを未定義のmodelでprovider未指定で実行する
    Then 失敗出力は信頼源を含みtrustedの語が無く必要authorityは不要である

  Scenario: SCN-UNIT-TIERPROV-004 信頼源の語彙を読み替えずそのまま写す
    Given policy loaderが返しうる信頼源の語彙を5件すべて用意する
    When それぞれを出力用の信頼源へ写す
    Then どの語彙も読み替えられずそのまま現れる
