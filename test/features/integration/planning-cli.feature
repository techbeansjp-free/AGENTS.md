@integration
Feature: Planning CLIの初回入力案内

  Scenario: SCN-PRAT-004 雛形が既存parserとhelpに一致し不正optionでは副作用を持たない
    Given Planning CLIの隔離した作業directoryがある
    When Verification Set雛形を実CLIで出力して選定入力へ渡す
    Then CLIのstageと成果物とSCN案内が現行契約に一致する
