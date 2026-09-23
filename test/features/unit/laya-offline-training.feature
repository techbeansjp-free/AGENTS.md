@unit
Feature: ASC公開履歴を使うLaya契約

  Scenario: SCN-UNIT-LAYA-002 AIレビュー単独を強い正解にしない
    Given Layaのレビュー証拠だけを持つdecision caseがある
    When そのcaseを強い正解として検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-003 修正前失敗と修正後成功を強い証拠にする
    Given Layaの再現済みdecision caseがある
    When decision caseを検証する
    Then Laya操作は成功する

  Scenario: SCN-UNIT-LAYA-005 teacherの目的をpartition間で流用しない
    Given seal済みのLaya splitがある
    When 学習用teacher assessmentをholdoutへ指定する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-006 同じ原因groupを複数partitionへ置かない
    Given 300件のgroup化したLaya caseがある
    When Laya splitをsealする
    Then 全caseが1つのpartitionだけに属する

  Scenario: SCN-UNIT-LAYA-010 critical findingの見逃しでcandidateを拒否する
    Given criticalなLaya findingをinvalidと予測している
    When Laya評価を計算する
    Then Laya candidateは拒否される

  Scenario: SCN-UNIT-LAYA-013 teacher viewのtoken境界を強制する
    Given teacher token上限を超えるLaya caseがある
    When teacher viewを作る
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-016 変更したsplitで旧assessmentを再利用しない
    Given seal済みのLaya splitがある
    When assessmentへ異なるsplit digestを指定する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-025 private固有情報の代表形式を全て拒否する
    Given private固有情報の攻撃fixtureがある
    When 全fixtureをprivate構造caseへ変換する
    Then 全てのprivate固有情報fixtureが拒否される

  Scenario: SCN-UNIT-LAYA-029 output directory差替え時もGitへ書かない
    Given private corpus用にGit worktreeの差替え先がある
    When 固定済みoutput directoryをsymlinkへ差し替える
    Then corpusはGit worktreeへ書かれない
