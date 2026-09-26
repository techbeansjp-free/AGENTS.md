@integration @review-evidence
Feature: review exportとreview validateでreview証跡を生成・照合する
  証跡はH_implで収束済みsessionから生成し、Gitとsessionに照合できる。

  Scenario: SCN-INT-REVEVID-001 H_implで収束済みsessionから証跡を生成し照合できる
    Given review証跡用に収束済みsessionを持つrepositoryがある
    When H_implでreview exportを実行する
    Then docs/reviewsへIssue番号の証跡が生成されsessionとGitに照合できる

  Scenario: SCN-INT-REVEVID-002 自己review・検証なし・H_final・許可外の出力先を拒否する
    Given review証跡用に収束済みsessionを持つrepositoryがある
    When 不正な条件でreview exportを実行する
    Then 各条件を理由つきで拒否し証跡を書かない

  Scenario: SCN-INT-REVEVID-003 未収束sessionから証跡を生成しない
    Given review証跡用に未解決blockerを持つsessionのrepositoryがある
    When H_implでreview exportを実行する
    Then review exportは未収束として拒否する

  Scenario: SCN-INT-REVEVID-004 review validateは改竄・別session・安全でないpathを拒否しJSON入力互換を保つ
    Given review証跡用に収束済みsessionを持つrepositoryがある
    When H_implでreview exportを実行する
    And 改竄した証跡と安全でないpathにreview validateを実行する
    Then 改竄と安全でないpathを拒否しreview入力JSONは従来結果を返す

  Scenario: SCN-INT-REVEVID-005 内容等価なrebase後のH_implで比較基点を指定して再生成できる
    Given review証跡用に収束済みsessionを持つrepositoryがある
    When 既定branchを進めて実装を内容等価にrebaseしreview exportを実行する
    Then rebase後の比較基点とH_implを持つ証跡が生成されsessionに照合できる

  Scenario: SCN-INT-REVEVID-009 観測記録が無いか最新の実行が不合格ならreview exportは証跡を生成しない
    Given review証跡用に収束済みsessionを持つrepositoryがある
    When 観測記録の条件を変えてreview exportを実行する
    Then 各条件を観測記録の理由つきで拒否し証跡を書かない

  Scenario: SCN-INT-REVEVID-010 review validate --stagingは観測記録の欠落・改竄・後続の不合格を拒否する
    Given review証跡用に収束済みsessionを持つrepositoryがある
    When H_implでreview exportを実行する
    And 観測記録を消すか改竄してreview validateを実行する
    Then 記録の欠落・改竄・後続の不合格をそれぞれ拒否する
