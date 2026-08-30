@unit @SCN-UNIT-EXEVER
Feature: 外部実行toolのversion判定
  provider副作用前のtoolchain gateとして
  platform固有suffixを含む正当なversionを誤拒否せず
  最低version未満と曖昧な出力はfail-closedにしたい

  @SCN-UNIT-EXEVER-001
  Scenario Outline: SCN-UNIT-EXEVER-001 正当なplatform固有suffixを含むversionを比較できる
    Given 外部toolがversion出力 "<output>" を返す
    When 最低version "2.38.0" と比較する
    Then 観測versionは "<version>" で対応済みである

    Examples:
      | output                         | version |
      | git version 2.43.0.windows.1  | 2.43.0  |
      | git version 2.43.0-apple-git  | 2.43.0  |
      | git version 2.43.0 (platform) | 2.43.0  |

  @SCN-UNIT-EXEVER-002
  Scenario: SCN-UNIT-EXEVER-002 最低version未満は拒否する
    Given 外部toolがversion出力 "git version 2.37.9.windows.1" を返す
    When 最低version "2.38.0" と比較する
    Then 観測versionは "2.37.9" で未対応である

  @SCN-UNIT-EXEVER-003
  Scenario: SCN-UNIT-EXEVER-003 数字へ直結する曖昧なversionは拒否する
    Given 外部toolがversion出力 "git version 2.43.0rc1" を返す
    When 最低version "2.38.0" と比較する
    Then versionを判定できず未対応である
