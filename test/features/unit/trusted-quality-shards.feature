@unit
Feature: 登録済みshard品質契約の許容形と保護境界

  Scenario: SCN-UNIT-TQAP-001 直列形を引き続き受理する
    Given shard品質契約の隔離候補がある
    When 候補のtestを"serial"形として品質検査する
    Then shard品質契約は候補を受理する

  Scenario: SCN-UNIT-TQAP-002 shard形を受理する
    Given shard品質契約の隔離候補がある
    When 候補のtestを"shards"形として品質検査する
    Then shard品質契約は候補を受理する

  Scenario: SCN-UNIT-TQAP-003 不正なscriptと保護済みrunnerの改変を拒否する
    Given shard品質契約の隔離候補がある
    When 候補のtestを"invalid"形として品質検査する
    Then shard品質契約は"test scriptを自己緩和"を理由に拒否する
    When 候補のtestを"serial"形として品質検査する
    Then shard品質契約は候補を受理する
    When 候補の保護済みshard runnerを改変して品質検査する
    Then shard品質契約は"versioned staged proposalと完全一致"を理由に拒否する
