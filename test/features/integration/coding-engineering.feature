@integration
Feature: Coding Engineeringを工程を増やさず配布する

  Scenario: SCN-INT-CODING-1552-001 内部skillを追加してもStepは12件で参照が解決する
    Given Coding Engineeringを含む隔離package資産がある
    When Coding Engineeringの配布参照を検証する
    Then 内部skillの参照とdirectory入口は有効でStepは12件である

  Scenario: SCN-INT-CODING-1552-002 選択されるLensが欠落した配布物を拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When 冪等性Lensを欠落させて配布参照を検証する
    Then 欠落したLensへの到達不能を報告する

  Scenario: SCN-INT-CODING-1552-003 未登録skillを内部skillとして暗黙に許可しない
    Given Coding Engineeringを含む隔離package資産がある
    When 未登録skillを追加して配布参照を検証する
    Then skillの正規集合違反を報告する

  Scenario: SCN-INT-CODING-1552-004 Lensからの境界外参照を拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When Lensにpackage境界外参照を追加して配布参照を検証する
    Then Lensの不正な参照先を報告する

  Scenario: SCN-INT-CODING-1552-005 タイトル付きLens参照も境界外なら拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When Lensにタイトル付き境界外参照を追加して配布参照を検証する
    Then Lensの不正な参照先を報告する
