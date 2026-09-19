@unit
Feature: reviewer役割に依存しない補助レビュー

  Scenario: SCN-SUPPL-001 設定が無い場合はdisabledを返す
    Given 補助レビュー設定ファイルが存在しない
    When 補助レビューCLIを実行する
    Then 結果はdisabledである

  Scenario: SCN-SUPPL-002 modelMapping.roles.reviewerを変更しない
    Given modelMapping.roles.reviewerがcodexとして宣言されている
    When 補助レビューCLIを有効な設定で実行する
    Then 実行後もmodelMapping.roles.reviewerはcodexのままである

  Scenario: SCN-SUPPL-003 変更ファイルと関連する未変更ファイルの両方を収集する
    Given 対象HEADに、呼び出し元Aと呼び出し先Bのうち、Bだけを変更した差分がある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 収集結果にBの差分が含まれる
    And 収集結果に、変更していない呼び出し元Aも関連ファイルとして含まれる

  Scenario: SCN-SUPPL-008 関連ファイルが上限件数を超える場合は打ち切る
    Given 関連ファイル候補が上限件数を超えている
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 収集結果は上限件数までに打ち切られる
    And 打ち切った旨が結果に含まれる
