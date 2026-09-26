@unit
Feature: Jev guided setup（provider設定生成とshell-rc追記）

  Scenario: SCN-UNIT-JEVSETUP-001 dry-runはfileを書き込まず予測したresolutionを返す
    Given 空のrootとenv var未設定のconfigure入力がある
    When configureJevProviderConfigをdry-runで実行する
    Then configPathにfileが存在せずresolutionはinvalidである

  Scenario: SCN-UNIT-JEVSETUP-002 applyで正しいschemaのjev-provider.jsonが生成される
    Given 空のrootとconfigure入力がある
    When configureJevProviderConfigをapplyで実行する
    Then configPathに正しい内容のfileが生成される

  Scenario: SCN-UNIT-JEVSETUP-003 endpointがhttps以外の場合は書き込まれない
    Given httpのendpointを持つconfigure入力がある
    When configureJevProviderConfigをapplyで実行する
    Then 書き込まれずvalidationErrorsが空でない

  Scenario: SCN-UNIT-JEVSETUP-004 apiKeyEnvVarの形式が不正な場合は書き込まれない
    Given 小文字のapiKeyEnvVarを持つconfigure入力がある
    When configureJevProviderConfigをapplyで実行する
    Then 書き込まれずvalidationErrorsが空でない

  Scenario: SCN-UNIT-JEVSETUP-005 対応外shellではshell rc検出が失敗する
    Given SHELLがfishを指す環境がある
    When shell rc検出を実行する
    Then shell rc検出はokがfalseである

  Scenario: SCN-UNIT-JEVSETUP-006 bashは~/.bashrcを検出する
    Given SHELLがbashを指す環境がある
    When shell rc検出を実行する
    Then shell rc検出は.bashrcを指す

  Scenario: SCN-UNIT-JEVSETUP-007 現在のshellでenv var未設定なら追記できない
    Given env var未設定でrc fileが存在しない
    When appendJevApiKeyToShellRcをapplyで実行する
    Then 追記は行われずenvVarSetInCurrentShellはfalseである

  Scenario: SCN-UNIT-JEVSETUP-008 dry-runは書き込まず値を出力に含めない
    Given env var設定済みでrc fileが存在しない
    When appendJevApiKeyToShellRcをdry-runで実行する
    Then 追記は行われず戻り値に秘密値が含まれない

  Scenario: SCN-UNIT-JEVSETUP-009 applyでもconfirmが一致しなければ例外になる
    Given env var設定済みでrc fileが存在しない
    When confirmを指定せずappendJevApiKeyToShellRcをapplyで実行する
    Then 呼び出しは例外を投げる

  Scenario: SCN-UNIT-JEVSETUP-010 applyかつconfirm一致でrc fileへ追記され値は戻り値に含まれない
    Given env var設定済みでrc fileが存在しない
    When confirmを指定してappendJevApiKeyToShellRcをapplyで実行する
    Then rc fileに秘密値を含むexport行が書き込まれ戻り値に秘密値が含まれない

  Scenario: SCN-UNIT-JEVSETUP-011 既にexport行がある場合は値を読まず無変更で返す
    Given 既に対象env varのexport行を含むrc fileがある
    When confirmを指定してappendJevApiKeyToShellRcをapplyで実行する
    Then 追記は行われずalreadyPresentがtrueである
