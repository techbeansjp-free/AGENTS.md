@e2e @issue-1566
Feature: Step 9記録はstagingから導出したrepositoryのHEADが実装commitを含むことを要求する

  Scenario: SCN-E2E-STEP9BIND-001 主作業directoryのstagingで別worktreeの実装をStep 9へ記録すると拒否しworktreeへ移すと記録できる
    Given 主作業directoryにStep 4まで記録したquick stagingがあり別worktreeに実装commitがある
    When 別worktreeをcwdにして主作業directoryのstagingでStep 9を記録する
    Then Step 9記録は基点と次の操作を名指しして拒否されjournalとstaging記録は変わらない
    When stagingを別worktreeの同じ相対pathへ移してStep 9を記録する
    Then Step 9記録は別worktreeの実装HEADへ束縛される
    When 別worktreeで実装commitを足してStep 9を再記録する
    Then Step 9記録は別worktreeの実装HEADへ束縛される

  Scenario: SCN-E2E-STEP9BIND-002 他worktreeが並行して存在しても実装worktreeに置いたstagingのStep 9記録は拒否されない
    Given 実装worktreeにStep 4まで記録したquick stagingがあり他worktreeも並行して実装commitを持つ
    When 主作業directoryをcwdにして実装worktreeのstagingでStep 9を記録する
    Then Step 9記録は別worktreeの実装HEADへ束縛される

  Scenario: SCN-E2E-STEP9BIND-003 stagingのrepositoryのHEADが既定branch tipの祖先なら同一でなくてもStep 9記録を拒否する
    Given 主作業directoryにStep 4まで記録したquick stagingがあり既定branch tipだけが先へ進んでいる
    When 別worktreeをcwdにして主作業directoryのstagingでStep 9を記録する
    Then Step 9記録は祖先のHEADを名指しして拒否されjournalとstaging記録は変わらない
