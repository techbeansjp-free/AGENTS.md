@integration @review-launch @routing-1425
Feature: reviewer役割のローカルLLM実行と信頼境界
  ローカルLLM実行の安全上限と、trusted policy固定・再検証を検証する。

  Scenario: SCN-INTEGRATION-REVIEW-1425-004 正しいtrusted policyではdispatchされる
    Given ollamaを正しく構成したtrusted policy fixtureがある
    When DIしたexecutorでlaunchReviewを実行する
    Then launchReviewはdispatched trueを返す

  Scenario: SCN-INTEGRATION-REVIEW-1425-005 正常応答は成功として扱う
    Given 正常応答するfake Ollamaサーバーがある
    When executeLocalLlmを実行する
    Then 実行結果はsucceededである

  Scenario: SCN-INTEGRATION-REVIEW-1425-006 timeoutはunknownとして扱う
    Given 応答しないfake Ollamaサーバーがある
    When executeLocalLlmを実行する
    Then 実行結果はunknownである

  Scenario: SCN-INTEGRATION-REVIEW-1425-007 容量上限超過はunknownとして扱う
    Given 容量上限を超える応答をするfake Ollamaサーバーがある
    When executeLocalLlmを実行する
    Then 実行結果はunknownである

  Scenario: SCN-INTEGRATION-REVIEW-1425-008 supplementモードはローカルLLM未設定でも既存レビューを妨げない
    Given ローカルLLM未設定のtrusted policy fixtureがある
    When DIしたexecutorでlaunchReviewを実行する
    Then launchReviewはrejected状態を返す

  Scenario: SCN-INTEGRATION-REVIEW-1425-009 replaceはgit管理下trusted policyで明示宣言した場合だけ成立する
    Given ollamaをreplaceモードで正しく構成したtrusted policy fixtureがある
    When DIしたexecutorでlaunchReviewを実行する
    Then launchReviewはdispatched trueを返す
