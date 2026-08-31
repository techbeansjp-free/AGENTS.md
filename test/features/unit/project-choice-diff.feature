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

  Scenario: SCN-UNIT-CHOICE-009 登録済み提案に従って禁止test suffixを縮小できる
    Given 既定branch側に禁止test suffixの縮小提案が登録されている
    When 提案と一致する縮小を判定する
    Then 分類は弱化のままで最終判定は受理となりfield pathが記録される

  Scenario: SCN-UNIT-CHOICE-010 登録済み提案に従ってtest層を縮小できる
    Given 既定branch側にtest層の縮小提案が登録されている
    When 提案と一致する縮小を判定する
    Then 分類は弱化のままで最終判定は受理となりfield pathが記録される

  Scenario: SCN-UNIT-CHOICE-011 登録済み提案に従って禁止型を縮小できる
    Given 既定branch側に禁止型の縮小提案が登録されている
    When 提案と一致する縮小を判定する
    Then 分類は弱化のままで最終判定は受理となりfield pathが記録される

  Scenario: SCN-UNIT-CHOICE-012 提案が存在しない縮小を拒否する
    Given 既定branch側に縮小提案が登録されていない
    When 提案と一致する縮小を判定する
    Then 縮小はASC-TRUST-001で拒否される

  Scenario: SCN-UNIT-CHOICE-013 提案と1 byteだけ違う縮小を拒否する
    Given 既定branch側に禁止test suffixの縮小提案が登録されている
    When 提案と値の内側の空白1個だけが違う候補の縮小を判定する
    Then 縮小はASC-TRUST-001で拒否され比較したfragment file pathと両sha256が記録される

  Scenario: SCN-UNIT-CHOICE-014 拒否診断が縮小提案の登録手順を案内する
    Given 既定branch側に縮小提案が登録されていない
    When 提案と一致する縮小を判定する
    Then 拒否診断は提案の登録先と次の操作を含む

  Scenario: SCN-UNIT-CHOICE-015 提案が無い場合の分類結果が変更前と一致する
    Given test層を削除したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then test層の縮小は検証弱化として分類される

  Scenario: SCN-UNIT-CHOICE-016 対象3 field以外の弱化分類が変更前と一致する
    Given 対象3 field以外を弱化した入力の一覧がある
    When 一覧の各入力をfield単位で分類する
    Then 対象3 field以外の弱化分類は全件が変更前と一致する

  Scenario: SCN-UNIT-CHOICE-017 提案の型不正とraw byte列の欠落をfail-closedで拒否する
    Given 型不正な縮小提案とraw byte列を取得できない入力がある
    When 不正な提案で縮小を判定する
    Then 縮小はASC-TRUST-001で拒否される
    And 正当な提案でもraw byte列が無ければ受理されない

  Scenario: SCN-UNIT-CHOICE-018 3 fieldの単調性検知が維持されている
    Given test層を削除したproject choice差分がある
    When project choice差分をfield単位で分類する
    Then test層の縮小は検証弱化として分類される

  Scenario: SCN-UNIT-CHOICE-019 対象3 field以外を対象とする提案では受理されない
    Given 既定branch側に対象外fieldを指す縮小提案が登録されている
    When 対象外fieldの弱化を判定する
    Then 縮小はASC-TRUST-001で拒否される
    And 対象外fieldの縮小entryは提案が一致しても受理されない
