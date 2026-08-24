@unit @project-choice-diff
Feature: project choice差分をfield単位で分類する
  authority境界と検証弱化だけを拒否し、安全な拡張経路を維持する。

  Scenario: SCN-UNIT-CHOICE-001 authority fieldの変更を拒否する
    Given releaseだけを変更したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then release変更はauthority違反として分類される

  Scenario: SCN-UNIT-CHOICE-002 CI選択の変更を拒否する
    Given CI選択だけを変更したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then CI選択変更はauthority違反として分類される

  Scenario: SCN-UNIT-CHOICE-003 test層の削除を弱化として拒否する
    Given test層を削除したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then test層の縮小は検証弱化として分類される

  Scenario: SCN-UNIT-CHOICE-004 禁止型の縮小とstrict型検査の無効化を弱化として拒否する
    Given 禁止型を縮小しstrict型検査を無効にしたproject choice差分がある
    When project choice差分をfield単位で分類する
    Then 禁止型とstrict型検査の変更は検証弱化として分類される

  Scenario: SCN-UNIT-CHOICE-005 capabilityの格下げと補助言語宣言の削除を弱化として拒否する
    Given capabilityを格下げし補助言語宣言を削除したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then capabilityと補助言語の変更は検証弱化として分類される

  Scenario: SCN-UNIT-CHOICE-006 authority外のmodelMapping変更を許可し変更pathを記録する
    Given modelMappingだけを構造化値へ変更したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then modelMapping変更は許可されfield pathが記録される

  Scenario: SCN-UNIT-CHOICE-007 検証を強化する変更を拒否しない
    Given test層と禁止型を追加したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then 検証強化は許可され変更field pathが記録される

  Scenario: SCN-UNIT-CHOICE-008 未知fieldとobject以外の入力をfail-closedで拒否する
    Given 未知fieldを持つ入力とobjectでない入力がある
    When 不正なproject choice差分をfield単位で分類する
    Then 未知fieldとobjectでない事実は検証弱化として分類される
