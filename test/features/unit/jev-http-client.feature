@unit
Feature: Jev HTTP adapter（fake transport経由の決定的検証）

  Scenario: SCN-UNIT-JEVHTTP-001 200応答をokとして返し実際にfetchへ渡されたbodyを検証できる
    Given jev-latestのconfigとfakeなok transportがある
    When dispatchJevChoiceを実行する
    Then outcomeはokであり送信したbodyのmodelとquestion keyが正しい

  Scenario: SCN-UNIT-JEVHTTP-002 apiKeyEnvVarが未設定の場合はtransportを呼ばずauth-errorを返す
    Given env varが未設定のconfigとfakeなtransportがある
    When dispatchJevChoiceを実行する
    Then outcomeはauth-errorでtransportは呼ばれない

  Scenario: SCN-UNIT-JEVHTTP-003 egress policyに違反するstateはtransportを呼ばずschema-errorを返す
    Given egress違反のstateとfakeなtransportがある
    When dispatchJevChoiceを実行する
    Then outcomeはschema-errorでtransportは呼ばれない

  Scenario: SCN-UNIT-JEVHTTP-004 transportが例外を投げてもnetwork-errorとして返り例外は外へ漏れない
    Given 例外を投げるfakeなtransportがある
    When dispatchJevChoiceを実行する
    Then outcomeはnetwork-errorであり呼び出しは例外を投げない

  Scenario: SCN-UNIT-JEVHTTP-005 401応答はauth-errorとして返る
    Given 401を返すfakeなtransportがある
    When dispatchJevChoiceを実行する
    Then dispatch outcomeはauth-errorである

  Scenario: SCN-UNIT-JEVHTTP-006 retry-after headerがあるとrate-limitedのretryAfterMsへ変換される
    Given retry-after headerを持つ429を返すfakeなtransportがある
    When dispatchJevChoiceを実行する
    Then outcomeはrate-limitedでretryAfterMsが5000である

  Scenario: SCN-UNIT-JEVHTTP-007 Authorization headerに実際のAPIキー値が渡るがログ・戻り値には現れない
    Given 秘密値を持つconfigとfakeなok transportがある
    When dispatchJevChoiceを実行する
    Then Authorization headerには秘密値のBearer tokenが渡り戻り値には秘密値が含まれない
