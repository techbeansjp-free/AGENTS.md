@unit
Feature: 新たに保護対象へ加えるfileを同じPRで変更させない

  # base validatorは自分のPROTECTED_FILESでsnapshotを取るため、候補が追加した対象は
  # hash照合を受けない。保護対象へ加えるのと同時に悪意ある版を初期値として封印できる。
  # 2026-08-27の実測では、backdoorを追記したfileを保護対象へ加える候補が合格した。
  Scenario: SCN-UNIT-PROTBOOT-001 保護追加と同じPRでの改竄を拒否する
    Given 保護対象へfileを追加した候補treeがある
    And 追加したfileを候補側で改竄する
    When 候補treeへ品質契約checkを実行する
    Then 保護bootstrap拘束は追加fileの変更を報告する

  Scenario: SCN-UNIT-PROTBOOT-002 改竄のない保護追加は報告しない
    Given 保護対象へfileを追加した候補treeがある
    When 候補treeへ品質契約checkを実行する
    Then 保護bootstrap拘束は何も報告しない

  Scenario: SCN-UNIT-PROTBOOT-003 保護対象一覧を読み取れないときは拒否する
    Given 保護対象一覧を読み取れない候補treeがある
    When 候補treeへ品質契約checkを実行する
    Then 保護bootstrap拘束は読み取り失敗を報告する
