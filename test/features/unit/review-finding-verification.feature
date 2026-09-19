@unit
Feature: finding投稿前に確定HEADの内容で検証する

  Scenario Outline: SCN-UNIT-FINDVERIFY-001 健全な修正の誤検知を却下する
    Given "<case>" の修正前後を持つ隔離Git repositoryがある
    When 初回reviewerが修正前の欠陥を再掲し検証者が却下する
    Then 補助レビューのfindingは空で検証入力に修正後fileが含まれる

    Examples:
      | case |
      | SQLi修正 |
      | nullガード追加 |
      | resource leak修正 |

  Scenario Outline: SCN-UNIT-FINDVERIFY-002 欠陥を混入したdiffのfindingを維持する
    Given "<case>" の修正前後を持つ隔離Git repositoryがある
    When 初回reviewerが現在の欠陥を報告し検証者が確認する
    Then 補助レビューにHigh findingが残る

    Examples:
      | case |
      | SQLi混入 |
      | null未チェック |
      | resource leak混入 |
      | authz削除 |

  Scenario: SCN-UNIT-FINDVERIFY-003 検証応答が不正ならfindingを公開しない
    Given "SQLi混入" の修正前後を持つ隔離Git repositoryがある
    When 検証者が不正な応答を返す
    Then 補助レビューはdegradedである
