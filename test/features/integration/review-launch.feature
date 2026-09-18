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

  Scenario: SCN-INTEGRATION-REVIEW-1425-010 redirect応答はloopback限定の多層防御として拒否する
    Given redirect応答をするfake Ollamaサーバーがある
    When executeLocalLlmを実行する
    Then 実行結果はfailedである

  Scenario: SCN-INTEGRATION-REVIEW-1425-011 正常応答は指摘内容(output)を保持する
    Given 正常応答するfake Ollamaサーバーがある
    When executeLocalLlmを実行する
    Then 実行結果のoutputは応答本文を保持する

  Scenario: SCN-INTEGRATION-REVIEW-1425-012 応答途中で停止した場合はunknownとして扱う
    Given 応答途中で停止するfake Ollamaサーバーがある
    When executeLocalLlmを実行する
    Then 実行結果はunknownである

  Scenario: SCN-INTEGRATION-REVIEW-1425-013 dispatch中にtrusted policyが変化した場合はrejectedを返す
    Given ollamaを正しく構成したtrusted policy fixtureがある
    When trusted policyのcommit SHAを起動直前に変更してlaunchReviewを実行する
    Then launchReviewはrejected状態を返す

  Scenario: SCN-INTEGRATION-REVIEW-1425-014 replaceモードは合格判定のLLM出力でverdict approvedを返す
    Given ollamaをreplaceモードで正しく構成したtrusted policy fixtureがある
    When review合格のJSON出力を返すDIしたexecutorでlaunchReviewを実行する
    Then launchReviewのverdictはapproved trueを返す

  Scenario: SCN-INTEGRATION-REVIEW-1425-015 replaceモードはCritical指摘を含むLLM出力でverdict blockingを返す
    Given ollamaをreplaceモードで正しく構成したtrusted policy fixtureがある
    When Critical指摘を含むJSON出力を返すDIしたexecutorでlaunchReviewを実行する
    Then launchReviewのverdictはblocking指摘を返す

  Scenario: SCN-INTEGRATION-REVIEW-1425-016 replaceモードは不正なJSON出力でverdict approved falseを返す
    Given ollamaをreplaceモードで正しく構成したtrusted policy fixtureがある
    When 不正なJSON出力を返すDIしたexecutorでlaunchReviewを実行する
    Then launchReviewのverdictはapproved falseを返す

  Scenario: SCN-INTEGRATION-REVIEW-1425-017 supplementモードはLLM出力を判定に用いない
    Given ollamaを正しく構成したtrusted policy fixtureがある
    When review合格のJSON出力を返すDIしたexecutorでlaunchReviewを実行する
    Then launchReviewはverdictを含まない
