@unit @risk-policy
Feature: riskに比例したrule判定で安全性と開発速度を両立する

  Scenario: SCN-UNIT-RISK-001 safety criticalなruleはfail-closedになる
    Given secret保護のactive deny ruleがある
    When 違反を検出してruleを評価する
    Then 判定はblockedである
    And 日本語diagnosticにrule ID、根拠、解決経路、authority、rollbackがある

  Scenario: SCN-UNIT-RISK-002 表記上の軽微なruleは開発を停止せず修正案を返す
    Given 表記統一のactive assist ruleがある
    When 違反を検出してruleを評価する
    Then 判定はassistedである
    And 自動修正候補にdry-run差分がある

  Scenario: SCN-UNIT-RISK-003 denyを安全境界以外へ設定できない
    Given 任意最適化をdenyにしたpolicyがある
    When risk比例policyを検証する
    Then policyはinvalidである
    And 日本語diagnosticはstagedへの修正案を返す

  Scenario: SCN-UNIT-RISK-004 candidateはtrusted ruleを自己緩和できない
    Given trusted policyのactive deny ruleをcandidateがwarnへ緩和する
    When trusted policyとcandidate policyを比較する
    Then 自己緩和をnon-overrideで拒否する

  Scenario Outline: SCN-UNIT-RISK-005 overrideは全拘束条件が一致する場合だけ有効である
    Given override可能なruleと正しいoverrideがある
    And overrideの<属性>が一致しない
    When overrideを検証する
    Then overrideは拒否される

    Examples:
      | 属性 |
      | scope |
      | actor |
      | expiry |
      | sha |

  Scenario: SCN-UNIT-RISK-006 network障害でもlocal作業と外部必須保留を分離する
    Given local gateと外部service必須gateがある
    When offlineでgateを計画する
    Then local gateはreadyである
    And 外部service必須gateだけがpendingである

  Scenario: SCN-UNIT-RISK-007 同一証跡のtargeted検証は重複を抑止してfinal fullを維持する
    Given 同じ差分とriskと合格証跡がある
    When targeted gateとfinal gateを計画する
    Then targeted gateはdeduplicatedである
    And final gateはsecurity、受け入れ条件、独立reviewを含むfullである

  Scenario: SCN-UNIT-RISK-008 harness品質の6指標を秘密なしで記録する
    Given wait、duplicate、false block、override、rollback、missのeventがある
    When policy metricsを集計する
    Then 6指標とbudget超過を機械可読に返す
    And metricsに秘密値は含まれない

  Scenario: SCN-UNIT-RISK-009 require ruleは条件未達のoperationを許可しない
    Given delivery証拠をrequireするactive ruleがある
    When 条件未達のoperationをenforceする
    Then operationはrequiredとして非許可である
    And 有効なoverrideまたは証拠があれば許可される

  Scenario: SCN-UNIT-RISK-010 authority設定の一部でも弱化したcandidateを拒否する
    Given trusted policyのmerge、review、check、branch、method、scope、意味をcandidateが弱化する
    When trusted policyとcandidate policyを比較する
    Then すべてのauthority弱化理由を返す

  Scenario: SCN-UNIT-RISK-011 diagnostic serializerは秘密を伏字化してmachine正本と表示fallbackを分離する
    Given tokenとpasswordを含むblock diagnosticがある
    When diagnosticを安全にserializeする
    Then 秘密値は出力されずmachine正本と非authorityの日本語fallbackがある

  Scenario: SCN-UNIT-RISK-012 failed証拠はtargeted検証の重複抑止に使わない
    Given 同じfingerprintだがpassed falseの証拠がある
    When targeted検証を計画する
    Then targeted検証はreadyでありdeduplicatedではない

  Scenario: SCN-UNIT-RISK-013 未知metric kindを黙って無視しない
    Given 未知kindを含むpolicy metrics eventがある
    When policy metricsを集計する
    Then metricsはstructured diagnostic付きでinvalidになる

  Scenario: SCN-UNIT-RISK-014 package安全floorとtrusted project ruleからeffective policyを作る
    Given package defaultと初回導入前のproject policyがある
    When effective policyを解決する
    Then 安全floorを弱化せずproject ruleをstagedで追加する

  Scenario: SCN-UNIT-RISK-015 overrideのIssue、理由、non-override、自動失効を監査する
    Given bound ruleとnon-override ruleと期限付きoverrideがある
    When overrideの正常、Issue不一致、理由なし、期限切れ、non-overrideを検証する
    Then 正常overrideだけに監査recordがあり他は拒否される

  Scenario: SCN-UNIT-RISK-016 ownership boundaryはlocal支援、PR証拠要求、実配布拒否に段階化する
    Given ownerとtarget layerが誤配置されたasset分類がある
    When local、PR、packageのownership境界を評価する
    Then localは移動先とdry-run案を支援しPRは証拠を要求して実配布だけをdenyする

  Scenario Outline: SCN-UNIT-CONFORMANCE-001 全機能拡張不変条件を実行可能な反例へ結ぶ
    Given I1〜I12のconformance contractがある
    When invariant <ID>を検証する
    Then source、enforcement point、counterexample SCN、evidence、rollbackが揃う

    Examples:
      | ID |
      | I1 |
      | I2 |
      | I3 |
      | I4 |
      | I5 |
      | I6 |
      | I7 |
      | I8 |
      | I9 |
      | I10 |
      | I11 |
      | I12 |

  Scenario: SCN-UNIT-CONFORMANCE-002 canonical pathが同一のenforcement tupleを重複登録できない
    Given canonical化するとpathとexportが重複するproject conformance bindingがある
    When project conformance bindingを検証する
    Then runtimeとschemaは重複tupleを拒否する

  Scenario: SCN-UNIT-RISK-017 canonical fingerprintは全安全契約とauthority choiceを拘束する
    Given trusted ruleのevidence remediation rollbackとauthority choiceをcandidateが変更する
    When trusted policyとcandidate policyを比較する
    Then 同一rule IDの契約変更とauthority choice変更を拒否する

  Scenario: SCN-UNIT-RISK-018 failed current evidenceと成功cacheが矛盾したらdedupeしない
    Given current evidenceがpassed falseで同fingerprintの成功cacheがある
    When targeted検証を計画する
    Then targeted検証はreadyでありdeduplicatedではない

  Scenario: SCN-UNIT-RISK-019 safe serializerは全結果種別とstructured secretを一元処理する
    Given token key、Bearer、URL credential、PEMを含む全結果種別がある
    When 全結果をsafe serializerで出力する
    Then 秘密が残らず全結果に完全diagnosticがある

  Scenario: SCN-UNIT-RISK-020 legacy fingerprintだけでは成功証拠をdedupeしない
    Given passed current evidenceとlegacy fingerprint及び矛盾structured cacheがある
    When targeted検証を計画する
    Then 完全bindingの成功証拠がないためdedupeを拒否する

  Scenario: SCN-UNIT-RISK-021 overrideは別ruleの記録を横取りできない
    Given override対象と異なるrule IDの記録がある
    When overrideを検証する
    Then overrideは拒否される

  Scenario: SCN-UNIT-RISK-022 trusted boundaryは不正ruleと曖昧な判定をfail closedにする
    Given trusted boundaryに必須属性を欠くruleがある
    When trusted boundaryを評価する
    Then policy検証でoperationを拒否する

  Scenario: SCN-UNIT-RISK-023 failed証拠でfinal gateを操作可能にしない
    Given 同じfingerprintだがpassed falseの証拠がある
    When final検証を計画する
    Then final検証はstructured diagnostic付きでblockedになる
