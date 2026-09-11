@unit
Feature: SCN IDの文法を1箇所で定義し工程の入口と終端で同じ受理集合にする

  Scenario: SCN-UNIT-SCNID-001 小文字枝番のSCN IDをissue validateが名指しして拒否する
    Given 01に「Scenario: SCN-69-001a」の行を持つfull stagingがある
    When SCN ID検査のためIssueを検証する
    Then Issue検証はSCN-69-001aの文法が不正であるerrorで拒否する

  Scenario: SCN-UNIT-SCNID-002 正規IDだけのstagingは変更前と同じく合格する
    Given 01に「Scenario: SCN-69-001」の行を持つfull stagingがある
    When SCN ID検査のためIssueを検証する
    Then SCN ID検査つきのIssue検証は合格する

  Scenario: SCN-UNIT-SCNID-003 issue validateとdelivery証跡検査の受理集合が一致する
    Given 正規IDと文法外IDを混在させたSCN ID集合がある
    When 各IDをscenario行検査とdelivery証跡検査へ与える
    Then すべてのIDで両検査の受理・拒否が一致する

  Scenario: SCN-UNIT-SCNID-004 行末空白・CRLF・Outline・ja方言でも文法で閉じる
    Given 行末空白、CRLF、Scenario Outline、シナリオ:の各形で正規IDと文法外IDを置いたstagingがある
    When 各stagingをそれぞれの方言で検証する
    Then 正規IDのstagingは合格し文法外IDのstagingは当該IDを名指しして拒否する
