@unit
Feature: ASC公開履歴を使うLaya契約

  Scenario: SCN-UNIT-LAYA-002 AIレビュー単独を強い正解にしない
    Given Layaのレビュー証拠だけを持つdecision caseがある
    When そのcaseを強い正解として検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-003 修正前失敗と修正後成功を強い証拠にする
    Given Layaの再現済みdecision caseがある
    When decision caseを検証する
    Then Laya操作は成功する

  Scenario: SCN-UNIT-LAYA-005 teacherの目的をpartition間で流用しない
    Given seal済みのLaya splitがある
    When 学習用teacher assessmentをholdoutへ指定する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-006 同じ原因groupを複数partitionへ置かない
    Given 300件のgroup化したLaya caseがある
    When Laya splitをsealする
    Then 全caseが1つのpartitionだけに属する

  Scenario: SCN-UNIT-LAYA-010 critical findingの見逃しでcandidateを拒否する
    Given criticalなLaya findingをinvalidと予測している
    When Laya評価を計算する
    Then Laya candidateは拒否される

  Scenario: SCN-UNIT-LAYA-013 teacher viewのtoken境界を強制する
    Given teacher token上限を超えるLaya caseがある
    When teacher viewを作る
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-016 変更したsplitで旧assessmentを再利用しない
    Given seal済みのLaya splitがある
    When assessmentへ異なるsplit digestを指定する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-030 review status由来の弱ラベルを学習しない
    Given 弱いreview status由来のLaya training rowがある
    When Laya training dataset契約を検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-031 trainとvalidationで同じcaseを共有しない
    Given 同じcaseを含むLaya trainとvalidationがある
    When Laya training dataset契約を検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-032 gold確率と許可classを厳密に検証する
    Given one-hotでないLaya training goldがある
    When Laya training dataset契約を検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-033 validation予測のquestionとclass不一致を拒否する
    Given questionとclassが一致しないLaya validation予測がある
    When Laya validation予測契約を検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-035 row内で自己申告したgoldを教師artifactなしで採用しない
    Given teacher artifactと異なるgoldを自己申告したLaya training rowがある
    When Laya training dataset契約を検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-037 teacher label後に変更した合成problemを拒否する
    Given label作成後に内容を変えた合成problemがある
    When 合成problemをLaya training入力へ変換する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-039 同じ合成groupをpartition間で分割しない
    Given 同じgroupをtrainとvalidationへ分割した合成problemがある
    When 合成problemをLaya training入力へ変換する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-041 oracle fieldを含むteacher回答を受理しない
    Given oracle fieldを含む合成teacher回答がある
    When 合成teacher回答をassessmentへ変換する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-048 blind packetと異なるinput digestのteacher回答を受理しない
    Given blind packetと異なるinput digestの合成teacher回答がある
    When 合成teacher回答をassessmentへ変換する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-043 invalid criticalをrecall分母から除外し未検出をmissにする
    Given 無効criticalと未検出criticalを含むLaya validation予測がある
    When Laya validation予測を共通契約で評価する
    Then 実criticalだけの検出recallが記録される

  Scenario: SCN-UNIT-LAYA-046 fabricated row idをsource caseとして受理しない
    Given sourceCaseIdと異なるfabricated row idがある
    When Laya training dataset契約を検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-047 同じsource caseの重複重み付けを受理しない
    Given 同じsource caseを重み付けした重複rowがある
    When Laya training dataset契約を検証する
    Then Laya操作は拒否される

  Scenario: SCN-UNIT-LAYA-025 private固有情報の代表形式を全て拒否する
    Given private固有情報の攻撃fixtureがある
    When 全fixtureをprivate構造caseへ変換する
    Then 全てのprivate固有情報fixtureが拒否される

  Scenario: SCN-UNIT-LAYA-029 output directory差替え時もGitへ書かない
    Given private corpus用にGit worktreeの差替え先がある
    When 固定済みoutput directoryをsymlinkへ差し替える
    Then corpusはGit worktreeへ書かれない
