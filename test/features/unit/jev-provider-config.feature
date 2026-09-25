@unit
Feature: ローカルJev provider設定のloader

  Scenario: SCN-UNIT-JEVCFG-001 有効な設定とenv varで有効configを返す
    Given jev-provider.jsonがenabled trueかつ有効なapiKeyEnvVarで存在する
    And 指定したenv varがprocess.envに設定されている
    When loadJevProviderConfigを実行する
    Then 有効なJevProviderConfigが返る

  Scenario: SCN-UNIT-JEVCFG-002 fileが存在しない場合はundefinedを返す
    Given jev-provider.jsonが存在しない
    When loadJevProviderConfigを実行する
    Then 例外を投げずundefinedが返る

  Scenario: SCN-UNIT-JEVCFG-003 JSON構文が不正な場合はundefinedを返す
    Given jev-provider.jsonのJSON構文が壊れている
    When loadJevProviderConfigを実行する
    Then 例外を投げずundefinedが返る

  Scenario: SCN-UNIT-JEVCFG-004 未知keyを含む場合はundefinedを返す
    Given jev-provider.jsonに未知keyが含まれている
    When loadJevProviderConfigを実行する
    Then 例外を投げずundefinedが返る

  Scenario: SCN-UNIT-JEVCFG-005 enabledがtrue以外の場合はundefinedを返す
    Given jev-provider.jsonのenabledがfalseまたは欠落している
    When loadJevProviderConfigを実行する
    Then 例外を投げずundefinedが返る

  Scenario: SCN-UNIT-JEVCFG-006 指定env var未設定の場合はundefinedを返す
    Given jev-provider.jsonは有効だが指定env varがprocess.envに設定されていない
    When loadJevProviderConfigを実行する
    Then 例外を投げずundefinedが返る

  Scenario: SCN-UNIT-JEVCFG-007 生のAPIキー値がどのfileにも書かれない
    Given env varへ設定したAPIキー値を持つ実行環境がある
    When loadJevProviderConfigを実行し関連fileを走査する
    Then APIキー値を含む代入形が.agent-skill-chain/local/配下のどのfileにも見つからない

  Scenario: SCN-UNIT-JEVCFG-008 modelMappingとtrusted project policyを読まない
    Given modelMapping.jsonとproject-policy.jsonが対象repositoryに存在する
    When loadJevProviderConfigを実行する
    Then modelMappingとtrusted project policyの内容は結果に影響せず読み込まれない
