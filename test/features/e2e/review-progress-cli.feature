@e2e
Feature: parallel progress evidenceのCLI入口と従来経路

  Scenario: SCN-E2E-PROGRESS-018 marker無しは直列経路へ戻る
    Given parallel progressの純粋fixtureがある
    When "absent" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-E2E-PROGRESS-019 journal無しの既存anchorを読める
    Given parallel progressの純粋fixtureがある
    When "legacy" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-E2E-PROGRESS-020 公開CLI入口にprogress操作がある
    Given parallel progressの純粋fixtureがある
    When "cli" のparallel progress反例を評価する
    Then parallel progress契約を満たす
