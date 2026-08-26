@unit
Feature: lockfileの保護対象からpackage自身のversionだけを除く

  Scenario: SCN-UNIT-LOCKPROT-001 package自身のversionだけが違うlockfileは同一と扱う
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-001"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる

  Scenario: SCN-UNIT-LOCKPROT-002 packages配下のversionだけが違うlockfileも同一と扱う
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-002"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる

  Scenario: SCN-UNIT-LOCKPROT-003 dependencyのintegrity変更は別内容と扱う
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-003"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる

  Scenario: SCN-UNIT-LOCKPROT-004 dependencyのversion変更は別内容と扱う
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-004"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる

  Scenario: SCN-UNIT-LOCKPROT-005 dependency追加は別内容と扱う
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-005"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる

  Scenario: SCN-UNIT-LOCKPROT-006 lockfileVersion変更は別内容と扱う
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-006"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる

  Scenario: SCN-UNIT-LOCKPROT-007 release bumpと同型の差分でtrusted品質契約checkが通る
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-007"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる

  Scenario: SCN-UNIT-LOCKPROT-008 dependency改竄ではtrusted品質契約checkが拒否する
    Given lockfile保護単体検査の準備がある
    When "SCN-UNIT-LOCKPROT-008"のlockfile保護単体検査を実行する
    Then lockfile保護単体検査は期待結果になる
