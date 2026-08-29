@unit @agile-verification
Feature: 実装中の発見を前向きに処理しrisk比例で検証する

  Scenario: SCN-UNIT-AGILE-001 実装詳細の発見は上流工程を再起動しない
    Given 契約を変更しない実装中の発見がある
    When 実装中発見の処理を判定する
    Then 実装を継続して事実と影響と対処と検証と仕様更新を記録する

  Scenario: SCN-UNIT-AGILE-002 受け入れ条件の変更は影響する契約だけを再確定する
    Given 受け入れ条件を変更する実装中の発見がある
    When 実装中発見の処理を判定する
    Then 要件と設計と実装計画だけを再確定する

  Scenario: SCN-UNIT-AGILE-003 目的変更は要求から影響する契約を再確定する
    Given 目的を変更する実装中の発見がある
    When 実装中発見の処理を判定する
    Then 要求から実装計画までを再確定する

  Scenario: SCN-UNIT-AGILE-010 fullのscope変更はscope正本を含めて再確定する
    Given fullでscopeを変更する実装中の発見がある
    When 実装中発見の処理を判定する
    Then 要求と要件と設計と実装計画を再確定する

  Scenario: SCN-UNIT-AGILE-011 quickの契約変更は集約成果物だけを再確定する
    Given quickで受け入れ条件を変更する実装中の発見がある
    When 実装中発見の処理を判定する
    Then quickの集約00だけを再確定する

  Scenario: SCN-UNIT-AGILE-012 quickのhigh risk化はfullへ昇格する
    Given quickでsecurity境界を拡大する実装中の発見がある
    When 実装中発見の処理を判定する
    Then fullへ昇格して00から03を確定する

  Scenario: SCN-UNIT-AGILE-013 PoCのhigh risk化は停止またはfull昇格にする
    Given pocで不可逆操作を導入する実装中の発見がある
    When 実装中発見の処理を判定する
    Then PoCを停止するかfullへ昇格する

  Scenario: SCN-UNIT-AGILE-021 quickの一般失格条件もEvidenceに基づきfullへ昇格する
    Given quickでpublic API変更を検出した実装中の発見がある
    When 実装中発見の処理を判定する
    Then fullへ昇格し失格Evidenceを保持して00から03を確定する

  Scenario: SCN-UNIT-AGILE-022 PoCの一般high risk条件も停止またはfull昇格にする
    Given pocでhigh risk条件を検出した実装中の発見がある
    When 実装中発見の処理を判定する
    Then PoCを停止するかfullへ昇格する

  Scenario: SCN-UNIT-AGILE-004 Bug Fixは再現と回帰をEvidenceにする
    Given 変更が単一domain境界に限定される
    When bug-fixのmedium risk検証集合を選ぶ
    Then bug reproductionとregressionとintegrationが選ばれる

  Scenario: SCN-UNIT-AGILE-005 Critical logicは強い検証を追加する
    Given 変更が単一domain境界に限定される
    When algorithmのcritical risk検証集合を選ぶ
    Then propertyとdifferentialとnegativeとsecurityが選ばれmutationは一律強制されない

  Scenario: SCN-UNIT-AGILE-006 複数境界変更はintegration検証を追加する
    Given 変更がworkflowとqualityの複数境界に及ぶ
    When documentationのlow riskで複数境界の検証集合を選ぶ
    Then integrationが追加されTDD反復は要求されない

  Scenario: SCN-UNIT-AGILE-007 fullのautomaticはPRで正常終了しない
    Given fullのautomatic deliveryがmerge-readyである
    When delivery継続先を判定する
    Then 独立したpr merge操作へ進む

  Scenario: SCN-UNIT-AGILE-008 PoCはautomatic設定でもPRで停止する
    Given pocのautomatic deliveryがmerge-readyである
    When delivery継続先を判定する
    Then PRを停止点にする

  Scenario: SCN-UNIT-AGILE-009 assistedは対象PR authorityなしでmergeしない
    Given quickのassisted deliveryに対象PR authorityがない
    When delivery継続先を判定する
    Then authorityと再開条件を待つ

  Scenario: SCN-UNIT-AGILE-014 RequirementとACとImpactをVerification Setへ反映する
    Given 変更が単一domain境界に限定される
    When 外部契約変更を伴うnew-featureの検証集合を選ぶ
    Then RequirementとACとImpactに対応するcontract検証が選ばれる

  Scenario: SCN-UNIT-AGILE-015 RequirementとACなしでVerification Setを決めない
    Given 変更が単一domain境界に限定される
    When RequirementとACがない検証集合を選ぶ
    Then 検証集合の選択を拒否する

  Scenario: SCN-UNIT-AGILE-016 PoC stagingからpr mergeできない
    Given PoC stagingのworkflow modeがある
    When PoC stagingでpr merge可否を判定する
    Then pr mergeを拒否する

  Scenario: SCN-UNIT-AGILE-017 Verification Set選定をproduction CLIから利用できる
    Given 有効なVerification Set入力JSONがrepository内にある
    When workflow verification-set CLIで選定する
    Then production CLIがVerification Setを機械可読に返す

  Scenario: SCN-UNIT-AGILE-018 実装中発見の評価をproduction CLIから利用できる
    Given 有効な実装中発見入力JSONがrepository内にある
    When workflow assess-discovery CLIで評価する
    Then production CLIがmode別の前向きな処理先を返す

  Scenario: SCN-UNIT-AGILE-019 Verification Set入力の未知fieldを受理しない
    Given 未知fieldを含むVerification Set入力JSONがrepository内にある
    When workflow verification-set CLIで選定する
    Then 未知fieldをfail-closedで拒否する

  Scenario: SCN-UNIT-AGILE-020 実装中発見入力の必須field欠損を受理しない
    Given 必須fieldが欠けた実装中発見入力JSONがrepository内にある
    When workflow assess-discovery CLIで評価する
    Then 欠損fieldをfail-closedで拒否する

  Scenario: SCN-UNIT-AGILE-023 実装中発見の失格ID重複を受理しない
    Given 重複した失格IDを含む実装中発見入力JSONがrepository内にある
    When workflow assess-discovery CLIで評価する
    Then 重複した失格IDをfail-closedで拒否する
