@unit @provider-routing
Feature: routingの独立性とcandidate自己評価
  implementerの自己reviewとcandidateが持ち込んだ評価器による自己適用を拒否することを具体例で示す。

  Scenario: SCN-UNIT-ROUTING-006 Codex implementerは自己reviewできない
    Given Codexが対象scopeを実装した
    When 同じagent identityで最終reviewを承認しようとする
    Then role独立性違反として拒否する

  Scenario: SCN-UNIT-ROUTING-008 candidateが持ち込んだ資産を自己評価に使わせない
    Given candidateがmappingとproject choiceとresolverとvalidatorとconformance bindingを同一変更で変更した
    When そのcandidateのmodel選択とreview権限を評価する
    Then trusted base側の資産だけで評価する
    And candidate側の資産による自己評価を拒否する
    And evaluatorRefは評価結果に記録する

  Scenario: SCN-UNIT-ROUTING-013 implementerとreviewerが同一identityになるrole設定を拒否する
    Given implementerとreviewerが同一providerかつ同一論理tierへ解決するrole設定を与える
    When role設定を検証する
    Then role設定をrole独立性違反として拒否する
    And role設定の拒否結果はrule IDを持つ
