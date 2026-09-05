@unit @scan-boundary
Feature: ローカルgateの走査境界の観測と差分
  各gateが何を走査し何を除外するかを観測し、ignored生成物による走査差分と判定差分を分けて返す。

  Scenario: SCN-UNIT-SCANBND-001 観測は4項目を返し判定不能な入力を除外側へ倒さない
    Given 走査境界の観測入力がある
    When 走査境界を観測する
    Then gateごとにpathとincluded・excludedと理由codeと件数が返る
    And 未知のgate keyとroot外pathと相対参照は不完全として報告される

  Scenario: SCN-UNIT-SCANBND-002 除外が効くgateでは走査差分だけが増える
    Given 代表ignored生成物を足した観測と足さない観測がある
    When 2つの観測を比較する
    Then 走査差分は0より大きく判定差分は0になる

  Scenario: SCN-UNIT-SCANBND-003 除外判定を欠落させた反例で判定差分が検出される
    Given 除外述語を無効化した走査境界の観測がある
    When 2つの観測を比較する
    Then 判定差分が0より大きく寄与pathが名指しされる

  Scenario: SCN-UNIT-SCANBND-004 不完全な観測は理由codeで区別され成功へ倒れない
    Given 除外述語を公開していないgateを含む観測入力がある
    When 走査境界を観測する
    Then 述語未公開と未知gateと判定不能pathが別の理由codeで報告される
    And 対象gate一覧が一致しない2観測の比較は拒否される
