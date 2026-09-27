@unit
Feature: CLIのJSON入力契約を--helpと診断で示す

  Scenario: SCN-UNIT-CLIINPUT-001 helpの項目一覧は検証の受理集合と一致する
    Given 3コマンドのusageと有効な入力例がある
    When inputContract.fieldsの最上位の必須項目を1つずつ欠いた入力を検証する
    Then 欠いた項目だけが必須fieldとして名指され受理値の一覧は検証の列挙と一致する

  Scenario: SCN-UNIT-CLIINPUT-002 未知と欠落を同時に含む入力は1回の診断で両方を示す
    Given 未知fieldと欠落fieldを同時に含む3コマンドの入力がある
    When それぞれを検証する
    Then 1件のerrorが未知fieldと欠落fieldの名前を両方含む

  Scenario: SCN-UNIT-CLIINPUT-003 enum違反は受理値を示しfindingはIDで名指し入力値を複写しない
    Given enum違反とfindingの誤りを含む入力がある
    When それぞれを検証する
    Then 診断は受理値の集合とfinding IDを含み違反した入力値を含まない
