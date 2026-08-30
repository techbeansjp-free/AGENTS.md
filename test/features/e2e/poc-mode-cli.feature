@e2e
Feature: 隔離した実行経路でquickとPoCを区別する

  Scenario: SCN-E2E-POC-001 通常quickとpocの成果物差分を隔離ディレクトリで確認する
    Given quickとpocを実行する隔離ディレクトリがある
    When 公開staging経路からquickとpocを生成する
    Then quickとpocはどちらも00要求定義とstaging記録を生成する
    And quickにはPoC宣言がなくpocにはPoC宣言と停止点がある

  Scenario: SCN-E2E-POC-002 隔離fixtureの即時観測EvidenceでPoCをStep 10まで進める
    Given PoC即時観測用の隔離Git repositoryがある
    When 公開CLIでPoC観測Evidenceを固定してStep 10まで進める
    Then 公開CLIは待機期間なしでexact HEADのPoC Evidenceをgateにする
