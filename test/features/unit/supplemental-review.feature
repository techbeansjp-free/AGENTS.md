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

  Scenario: SCN-SUPPL-009 差分外タスクの指摘を結果へ混ぜない
    Given 補助レビューの対象差分が1ファイルだけある
    When 補助reviewerが差分外ファイルの指摘を返す
    Then 補助レビュー結果から差分外の指摘が除外される

  Scenario: SCN-SUPPL-010 汎用stemが多数の無関係fileに現れたら関連候補にしない
    Given 変更fileのstemが多数の無関係fileに現れる
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 汎用stem由来の関連fileは収集されない

  Scenario: SCN-SUPPL-011 拡張子なしdotfileは関連file検索に使わない
    Given 拡張子なしdotfileだけを変更した差分がある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then dotfile名由来の関連fileは収集されない

  Scenario: SCN-SUPPL-012 連結worktreeは主worktreeの個人設定を使う
    Given 主worktreeのみに補助レビュー設定があり連結worktreeに差分がある
    When 補助レビューCLI(diff対象)を連結worktreeから実行する
    Then 連結worktreeの補助レビューがfindingsを返す
