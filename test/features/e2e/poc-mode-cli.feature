@e2e
Feature: 隔離した実行経路でquickとPoCを区別する

  Scenario: SCN-E2E-POC-001 通常quickとpocの成果物差分を隔離ディレクトリで確認する
    Given quickとpocを実行する隔離ディレクトリがある
    When 公開staging経路からquickとpocを生成する
    Then quickとpocはどちらも00要求定義だけを生成する
    And quickにはPoC宣言がなくpocにはPoC宣言と停止点がある
