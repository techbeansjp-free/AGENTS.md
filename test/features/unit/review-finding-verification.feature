@unit
Feature: 差分findingを進行役確認候補として渡す

  Scenario Outline: SCN-UNIT-FINDVERIFY-001 健全な修正の誤検知を自動確定せず候補として渡す
    Given "<case>" の修正前後を持つ隔離Git repositoryがある
    When 初回reviewerが修正前の欠陥を再掲し検証者が却下する
    Then 補助レビューは初回候補と検証者の却下を進行役確認へ渡す

    Examples:
      | case |
      | SQLi修正 |
      | nullガード追加 |
      | resource leak修正 |

  Scenario Outline: SCN-UNIT-FINDVERIFY-002 欠陥を混入したdiffのfindingを維持する
    Given "<case>" の修正前後を持つ隔離Git repositoryがある
    When 初回reviewerが現在の欠陥を報告し検証者が確認する
    Then 補助レビューはHigh候補と検証者の採用を進行役確認へ渡す

    Examples:
      | case |
      | SQLi混入 |
      | null未チェック |
      | resource leak混入 |
      | authz削除 |

  Scenario: SCN-UNIT-FINDVERIFY-003 検証応答が不正でも初回候補を失わない
    Given "SQLi混入" の修正前後を持つ隔離Git repositoryがある
    When 検証者が不正な応答を返す
    Then 補助レビューは検証不能の初回候補を進行役確認へ渡す

  Scenario: SCN-UNIT-FINDVERIFY-004 valid判定に遮断根拠が併記されたら公開しない
    Given "nullガード追加" の修正前後を持つ隔離Git repositoryがある
    When 検証者の判定と遮断根拠が矛盾する
    Then 補助レビューは検証不能の初回候補を進行役確認へ渡す

  Scenario: SCN-UNIT-FINDVERIFY-005 存在しない障害行を根拠にしたら公開しない
    Given "SQLi混入" の修正前後を持つ隔離Git repositoryがある
    When 検証者が存在しない障害行を根拠にする
    Then 補助レビューは検証不能の初回候補を進行役確認へ渡す

  Scenario: SCN-UNIT-FINDVERIFY-006 遮断根拠のない却下を確定判定にしない
    Given "authz削除" の修正前後を持つ隔離Git repositoryがある
    When 検証者が遮断根拠なしで却下する
    Then 補助レビューは検証不能の初回候補を進行役確認へ渡す

  Scenario: SCN-UNIT-FINDVERIFY-007 削除済みfileの検証失敗をdegradedへ倒す
    Given "nullガード追加" の修正前後を持つ隔離Git repositoryがある
    When 差分内のfileがHEADで削除されて検証者が確認する
    Then 補助レビューはdegradedである
