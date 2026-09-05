@unit @named-scenario-trace
Feature: 要件本文が名指しするSCNと追跡表の突合
  帰属文が強制主体として断定したSCNが、同じ要件の追跡表行に登録されているかを検査する。

  Scenario: SCN-UNIT-NAMEDSCN-001 名指しSCNが同要件へ結線されていないと拒否される
    Given 帰属文の名指しSCNが同要件へ結線されていない仕様がある
    When 帰属文の突合を含む仕様正規化検査を実行する
    Then 要件IDと不足SCNと本文位置を名指しして拒否される

  Scenario: SCN-UNIT-NAMEDSCN-002 範囲表記は厳格な条件でだけ展開される
    Given 正常な範囲と不正な範囲を含む仕様がある
    When 帰属文の突合を含む仕様正規化検査を実行する
    Then 正常な範囲は連番展開され不正な範囲は明示errorになる
    And 安全整数を超える数値部は展開されず検査が停止しない

  Scenario: SCN-UNIT-NAMEDSCN-003 帰属文でない記述とcode fence内では拒否されない
    Given 帰属文を持たないSCN参照とcode fence内の帰属文がある仕様がある
    When 帰属文の突合を含む仕様正規化検査を実行する
    Then 帰属文の突合errorは報告されない

  Scenario: SCN-UNIT-NAMEDSCN-004 名指しSCNが他要件へも結線されていても拒否されない
    Given 名指しSCNが名指し元と別要件の双方へ結線された仕様がある
    When 帰属文の突合を含む仕様正規化検査を実行する
    Then 多対多に結線された名指しは不足として報告されない
    And 別要件からのみ到達できる名指しは不足として報告される

  Scenario: SCN-UNIT-NAMEDSCN-005 断定でない文とtilde fenceは帰属文として扱われない
    Given 否定文と未決文とtilde fence内の帰属文がある仕様がある
    When 帰属文の突合を含む仕様正規化検査を実行する
    Then 帰属文の突合errorは報告されない

  Scenario: SCN-UNIT-NAMEDSCN-006 改行をまたぐ帰属文も突合される
    Given soft line breakで折り返した帰属文がある仕様がある
    When 帰属文の突合を含む仕様正規化検査を実行する
    Then 折り返した帰属文の不足SCNが本文位置とともに報告される

  Scenario: SCN-UNIT-NAMEDSCN-007 列挙と範囲の混在は正しく解釈され不正な接続は拒否される
    Given 列挙と範囲を混在させた帰属文と連続した範囲がある仕様がある
    When 帰属文の突合を含む仕様正規化検査を実行する
    Then 混在した範囲の中間IDが不足として報告され連続した範囲は明示errorになる
