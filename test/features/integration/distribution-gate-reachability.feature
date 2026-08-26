@integration
Feature: 配布準備工程の形とrelease workflowの呼び出し先を一致させる

  Scenario: SCN-INT-DISTGATE-001 現行形とprepack呼び出しの組を受理する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-001"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-002 軽量化した準備工程とprepack呼び出しの組を拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-002"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-003 軽量化した準備工程と配布前品質検証の呼び出しの組を受理する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-003"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-004 現行形へ戻したのに呼び出し先が残る組を拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-004"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-005 release workflowを読めない場合を拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-005"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-006 prepack scriptが無い場合を拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-006"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-007 コメント中の呼び出しを実行と誤判定しない
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-007"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-008 echoの引数を実行と誤判定しない
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-008"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-009 無効化されたstepを実行と誤判定しない
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-009"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-010 軽量化後に残る準備工程の呼び出しを拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-010"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-011 block scalar内の呼び出しを受理する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-011"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-012 末尾commentの呼び出しを実行と誤判定しない
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-012"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-013 foldedスカラー内の呼び出しを受理する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-013"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-014 block scalarの直後のstepを取りこぼさない
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-014"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-015 既知の形でない準備工程を拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-015"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-016 短絡を含む準備工程を拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-016"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-017 短絡で実行されない呼び出しを数えない
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-017"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-018 失敗を握り潰す呼び出しを数えない
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-018"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-019 公開より後でしか検証しない構成を拒否する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-019"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる

  Scenario: SCN-INT-DISTGATE-020 公開より前に検証する構成を受理する
    Given 配布gate到達性検査の準備がある
    When "SCN-INT-DISTGATE-020"の配布gate到達性検査を実行する
    Then 配布gate到達性検査は期待結果になる
