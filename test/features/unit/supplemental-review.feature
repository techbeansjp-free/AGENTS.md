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
    Then 連結worktreeの補助レビューが進行役確認候補を返す

  Scenario: SCN-SUPPL-013 日本語pathの変更fileと関連fileを実pathで収集する
    Given 日本語pathの変更fileと呼び出し元fileがある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 収集結果の日本語pathが実際のpathと一致する
    And 補助レビュー結果に日本語pathの指摘が残る

  Scenario: SCN-SUPPL-014 汎用stemの検索結果が容量上限を超えてもレビューを続ける
    Given 汎用stemの検索結果が1MiBを超える差分がある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 汎用stem由来の関連fileは収集されない

  Scenario: SCN-SUPPL-015 末尾に空白を含む関連pathを壊さずに収集する
    Given 末尾に空白を含む関連fileがある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 収集結果に末尾空白付きの実pathがそのまま含まれる

  Scenario: SCN-SUPPL-016 汎用stemでも実際のimport元は閾値超過で除外しない
    Given 汎用stemを持つ変更fileを実際にimportする呼び出し元がある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then import由来の呼び出し元は収集され汎用stem由来の無関係fileは除外される

  Scenario: SCN-SUPPL-017 stemを部分文字列として含むだけのimportは関連fileにしない
    Given stemを部分文字列として含むだけのimportを持つ無関係fileが多数ある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 部分一致のみのimport元は収集されず実際の呼び出し元だけが残る

  Scenario: SCN-SUPPL-018 import参照検索が取得不能なら打ち切りを報告する
    Given import参照検索の結果が1MiBを超える差分がある
    When 補助レビューCLI(diff対象)で収集処理を行う
    Then 収集結果は打ち切りとして報告される
