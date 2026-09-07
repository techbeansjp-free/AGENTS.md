@integration
Feature: provider観測fixtureの応答と環境復元を一定に保つ

  Scenario: SCN-INT-PIO-002 模擬catalogを複数chunkで再送しない
    Given 実routing用のCodex fixture scriptがある
    When model/listの前後と残余を制御したchunkで送る
    Then 初期化とcatalogは各1件でexec応答も維持する

  Scenario: SCN-INT-PIO-003 PATHを元の状態へ復元する
    Given PATHの未設定と空文字と値ありを検証する隔離processがある
    When 実routing用のPATH helperで成功と失敗を実行する
    Then 全経路でPATHのproperty有無と値が開始前に戻る
