@unit
Feature: Decision Contract定義と呼び出し元の名指し

  Scenario: SCN-UNIT-DC-001 Decision Contract型がvalue・confidence・callableTargetを持つ
    Given src配下にDecision Contract型定義がある
    When 型のfieldを確認する
    Then value、confidence、callableTargetの3fieldを持つ

  Scenario: SCN-UNIT-DC-002 候補一覧が最低5箇所file内一意anchorで確定している
    Given 有限選択判断候補の一覧DECISION_CANDIDATESがある
    When 採用された候補の件数を確認する
    Then 5件以上でありそれぞれ実在しfile内で一意なanchorを持つ判断箇所を持つ

  Scenario: SCN-UNIT-DC-003 呼び出し元を名指しできない候補は除外理由付きで記録される
    Given DECISION_CANDIDATESの各候補の採否を確認する
    When 採否が除外の候補を抽出する
    Then 除外理由が空でない

  Scenario: SCN-UNIT-DC-004 journal field設計は既存schemaと衝突しない
    Given 既存journal schema4fileのproperty名一覧を読み込む
    When DecisionJournalFieldのfield名と比較する
    Then field名の衝突が無い

  Scenario: SCN-UNIT-DC-005 callableTargetはfail-open方向の値を型として拒否する
    Given fail-open方向を表す文字列リテラル"quick-downgrade"をcallableTargetへ代入するsourceがある
    When TypeScript Compiler APIで型検査する
    Then 型の不一致によるcompile errorが報告される

  Scenario: SCN-UNIT-DCANCHOR-001 無関係な行の追加はanchorの一意な実在に影響しない
    Given anchor文字列の前後に無関係な行を追加したfixtureがある
    When anchorの一意な実在を確認する
    Then 一意に見つかる

  Scenario: SCN-UNIT-DCANCHOR-002 anchor文字列が重複するfileは一意と判定しない
    Given anchor文字列を2箇所に持つfixtureがある
    When anchorの一意な実在を確認する
    Then 一意には見つからない

  Scenario: SCN-UNIT-DCANCHOR-003 anchor文字列が存在しないfileは一意と判定しない
    Given anchor文字列を持たないfixtureがある
    When anchorの一意な実在を確認する
    Then 一意には見つからない
