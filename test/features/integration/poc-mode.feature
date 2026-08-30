@integration
Feature: PoCの最小成果物と停止点を統合する

  Background:
    Given PoC検証用の隔離repositoryと完全宣言がある

  Scenario: SCN-INT-POC-001 pocのstagingは最小成果物とPoC宣言を日本語で生成する
    Given PoCの最小stagingを生成する条件が揃っている
    When pocのissue stagingを作成する
    Then stagingのモードはpocである
    And stagingには00要求定義とstaging記録が存在する
    And 00要求定義に目的と隔離fixtureとuse caseとBDD scenarioとobservableが記録される
    And 00要求定義の管理情報はpocである

  Scenario: SCN-INT-POC-002 pocはrelease・自動merge・本番cleanupへ進めない
    Given pocのissue stagingを作成済みである
    When pocでreleaseと自動mergeと本番cleanupを検証する
    Then すべての禁止操作は拒否される
    And PoCの禁止操作一覧が返る

  Scenario: SCN-INT-POC-003 pocから正式開発へ移る際の不足成果物を列挙する
    Given pocのissue stagingを作成済みである
    When PoCの正式開発昇格計画を作る
    Then fullに不足する01と02と03の成果物が列挙される
    And 昇格根拠と補完理由が返る

  Scenario: SCN-INT-POC-004 PoC観測EvidenceなしではStep 9へ進めない
    Given pocのStep 4までを記録済みである
    When PoC観測EvidenceなしでStep 9を記録する
    Then Step 9は未記録のままである

  Scenario: SCN-INT-POC-005 観測EvidenceをHEAD世代へ固定して同一HEAD再実行を冪等にする
    Given pocのStep 4までを記録済みである
    When PoC観測Evidenceを固定してStep 9を記録する
    Then Evidenceは世代別inventoryとdigestへ入り同一HEAD再実行で変化しない

  Scenario: SCN-INT-POC-006 Step 11後は観測とjournal revisionを不変に拒否する
    Given pocのStep 4までを記録済みである
    When PoCをStep 11まで終端して再観測とStep 9追記を試みる
    Then 終端後のPoC stagingとEvidenceは変化しない

  Scenario: SCN-INT-POC-007 dirtyなlive fixtureを実行前に拒否する
    Given pocのStep 4までを記録済みである
    When exact HEAD後にrunnerのlive bytesを変更して観測する
    Then PoC観測はpublishせずfail-closedになる

  Scenario: SCN-INT-POC-008 fixture root外を含むactual Git差分を拒否する
    Given pocのStep 4までを記録済みである
    When fixture外のsource変更を同じHEADへcommitして観測する
    Then PoC観測はpublishせずfail-closedになる

  Scenario: SCN-INT-POC-009 stdoutが一致してもrunner非0終了を拒否する
    Given pocのStep 4までを記録済みである
    When stdout一致のままrunnerを非0終了へ変更して観測する
    Then PoC観測はpublishせずfail-closedになる

  Scenario: SCN-INT-POC-010 provider baseからの実差分でbaseline launderingを拒否する
    Given pocのStep 4までを記録済みである
    When provider baseからfixture-only差分と起票前fixture外commitを検査する
    Then provider baseのactual diffだけがPoC scopeのEvidenceになる

  Scenario: SCN-INT-POC-011 PoC自由入力のreplaceメタ構文を文字列として保持する
    Given PoCの自由入力にreplaceの全メタ構文がある
    When メタ構文を含むpocのissue stagingを作成する
    Then 00要求定義はreplaceメタ構文を展開せず各欄へ記録する
