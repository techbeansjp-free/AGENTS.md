@unit @SCN-UNIT-ATOMIC
Feature: 耐久性のある原子的なfile公開
  transaction markerとstaging recordを中途半端な状態にしないために
  書込み途中の一時fileをdigest管理directoryの外へ隔離し
  完全な内容だけをatomicに公開したい

  @SCN-UNIT-ATOMIC-001
  Scenario: SCN-UNIT-ATOMIC-001 staging外の同一filesystem一時fileから完全なrecordを公開する
    Given digest管理directoryと既存recordがある
    When sibling directoryを一時領域としてrecordをatomic更新する
    Then recordは完全な新版だけを保持する
    And digest管理directoryとsibling directoryに一時fileを残さない

  @SCN-UNIT-ATOMIC-002
  Scenario: SCN-UNIT-ATOMIC-002 異なるfilesystemの一時領域は公開前に拒否する
    Given digest管理directoryと既存recordがある
    When 利用可能なら異なるfilesystemを一時領域としてrecordをatomic更新する
    Then 異なるfilesystemだった場合は旧recordを維持して拒否する

  @SCN-UNIT-ATOMIC-003
  Scenario: SCN-UNIT-ATOMIC-003 検査対象directoryを外部symlinkへ差し替えても境界外へ書かない
    Given digest管理directoryと既存recordがある
    And digest管理directoryを外部directoryへのsymlinkへ差し替える
    When 差し替え後のrecordをatomic更新しようとする
    Then directory境界を拒否して外部fileを作らない

  @SCN-UNIT-ATOMIC-004
  Scenario: SCN-UNIT-ATOMIC-004 一時directoryをsymlinkで偽装しても公開しない
    Given digest管理directoryと既存recordがある
    And sibling一時directoryを外部directoryへのsymlinkへ差し替える
    When 偽装した一時directoryからrecordをatomic更新しようとする
    Then 一時directory境界を拒否して旧recordを維持する
