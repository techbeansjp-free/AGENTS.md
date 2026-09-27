@integration
Feature: 既定full入口とconformance限定入口を合成する

  Scenario: SCN-INT-SWITCH-001 npm全件入口が登録済runnerを実行する
    Given unitとintegrationとe2eの小さなnpm検証fixtureがある
    When 本repositoryのnpm test scriptをfixtureで実行する
    Then compile後に全layerのscenarioが実行され失敗も伝播する

  Scenario: SCN-INT-SWITCH-002 conformance選択とJSON出力を維持する
    Given unitとintegrationとe2eの小さなnpm検証fixtureがある
    When conformanceの生成argvを実npmで実行する
    Then 完全ID一致で選択した全layerのJSONだけを生成し失敗を伝播する
