@unit @review-launch @routing-1425
Feature: reviewer役割へのローカルLLMプロバイダーdispatch決定
  implementer向けrouting（resolveRouting）とは独立に、reviewer役割のローカルLLM
  providerへのdispatch可否を決定する。

  Scenario: SCN-UNIT-REVIEW-1425-001 allowlist外modelのprovider選択を拒否する
    Given PROVIDER_AUTONOMOUS_CEILINGSにollamaが登録されている
    When allowlist外のmodel名でvalidateProviderSelectionを実行する
    Then providerの自律選択上限を超えるため人間overrideが必要として拒否される

  Scenario: SCN-UNIT-REVIEW-1425-016 allowlist内のmodelは選択を許可する
    Given PROVIDER_AUTONOMOUS_CEILINGSにollamaが登録されている
    When allowlist内のmodel名でvalidateProviderSelectionを実行する
    Then providerの自律選択は許可される

  Scenario: SCN-UNIT-REVIEW-1425-002 正しく構成されたtrusted policyからresolvedを返す
    Given ollamaを正しく構成したreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはresolved状態でprovider・model・modeを返す

  Scenario: SCN-UNIT-REVIEW-1425-003 implementerとreviewerの同一identityを拒否する
    Given implementerとreviewerに同一identityを割り当てたreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-017 implementerとreviewerの同一contextを拒否する
    Given implementerとreviewerに同一contextを割り当てたreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-009 未設定のmodelMappingをpendingとして扱う
    Given modelMappingが未設定のreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはpending状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-010 既存のCodex/Claude形状のreviewerを拒否する
    Given ローカルLLM未設定（既存Codex形状）のreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-011 allowlist外modelのreviewer routingを拒否する
    Given allowlist外のmodelを指定したreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-012 不正なmodeを拒否する
    Given 不正なmode文字列を指定したreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-013 loopback以外のendpointを拒否する
    Given loopback以外のendpointを指定したreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-014 loopback endpointを許可する
    Given localhostホストのendpointを指定したreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはresolved状態でprovider・model・modeを返す

  Scenario: SCN-UNIT-REVIEW-1425-015 mode field保有かつ未知providerのreviewer routingを拒否する
    Given mode fieldを保有するが未知providerのreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-018 coordinatorとreviewerの同一identityを拒否する
    Given coordinatorとreviewerに同一identityを割り当てたreviewer routing入力がある
    When resolveReviewRoutingを実行する
    Then reviewer routingはrejected状態を返す

  Scenario: SCN-UNIT-REVIEW-1425-019 allowlistの大文字を含むmodel名も正規化して許可する
    Given 大文字を含むallowlist内のmodel名の入力がある
    When この入力でvalidateProviderSelectionを実行する
    Then providerの自律選択は許可される

  Scenario: SCN-UNIT-REVIEW-1425-020 allowlist外のollama modelは有効なhuman overrideで許可される
    Given allowlist外のollama modelを有効なhuman override付きの入力がある
    When この入力でvalidateProviderSelectionを実行する
    Then providerの自律選択は許可される

  Scenario: SCN-UNIT-REVIEW-1425-021 allowlist外のollama modelへのAI発行overrideは拒否される
    Given allowlist外のollama modelをAI発行override付きの入力がある
    When この入力でvalidateProviderSelectionを実行する
    Then AI発行のoverrideとして拒否される
