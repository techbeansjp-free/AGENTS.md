@unit
Feature: 製品仕様の要件と追跡を正規化する

  Scenario: SCN-UNIT-SPECNORM-001 要件IDがrepository全体で一意であることを検査する
    Given 正規化済み仕様の単体fixtureがある
    When 仕様正規化検査を実行する
    Then 要件IDの一意性検査は合格する

  Scenario: SCN-UNIT-SPECNORM-002 重複した要件IDをerrorとし、該当fileを全件列挙する
    Given 同じ要件IDを2つの仕様fileで定義する
    When 仕様正規化検査を実行する
    Then 重複要件IDと該当する2つのfileを報告する

  Scenario: SCN-UNIT-SPECNORM-003 追跡表から要件一覧への未解決参照をerrorとする
    Given 追跡表が存在しない要件IDを参照する
    When 仕様正規化検査を実行する
    Then 未解決の要件参照を報告する

  Scenario: SCN-UNIT-SPECNORM-004 15_要件追跡にしか本文が無い要件をerrorとする
    Given 要件本文が15_要件追跡にだけ存在する
    When 仕様正規化検査を実行する
    Then 追跡directoryだけにある要件本文を報告する

  Scenario: SCN-UNIT-SPECNORM-005 どのSCNからも参照されない要件を孤立として列挙する
    Given 要件に対応する追跡行がない
    When 仕様正規化検査を実行する
    Then 到達不能な要件を孤立理由と共に報告する

  Scenario: SCN-UNIT-SPECNORM-006 どの要件にも紐づかないSCNを孤立として列挙する
    Given SCNに対応する追跡行がない
    When 仕様正規化検査を実行する
    Then 到達不能なSCNを孤立理由と共に報告する

  Scenario: SCN-UNIT-SPECNORM-007 孤立判定の理由を日本語で含める
    Given 要件とSCNが共に孤立している
    When 仕様正規化検査を実行する
    Then 孤立判定の理由は日本語である

  Scenario: SCN-UNIT-SPECNORM-008 参照判定がpath全体で行われる
    Given 別directoryに同名Feature fileがある
    And 追跡表がbasenameだけを参照する
    When 仕様正規化検査を実行する
    Then 同名fileは互いの参照を充足しない

  Scenario: SCN-UNIT-SPECNORM-009 二重列挙の不一致をerrorとし、どちらにしか無いかを示す
    Given 索引と定義見出しの要件ID集合が異なる
    When 仕様正規化検査を実行する
    Then 二重列挙の両方向の差分を報告する

  Scenario: SCN-UNIT-SPECNORM-010 所定location外の要件本文をerrorとする
    Given 要件本文を04_機能に定義する
    When 仕様正規化検査を実行する
    Then 所定location外の定義pathを報告する

  Scenario: SCN-UNIT-SPECNORM-011 要件数が増えても計算量が二乗にならない
    Given 2000件の要件と追跡を持つ入力がある
    When 仕様正規化検査を実行する
    Then 走査操作数は入力件数に対して線形である
