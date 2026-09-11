@unit @issue-scaffolding
Feature: Issue工程の機械導出欄を安全に生成する

  Scenario: SCN-UNIT-ISSUEPREFILL-001 full成果物へ件名と管理情報を転記する
    Given issue scaffolding用のfull stagingを生成する
    When full stagingの転記結果を確認する
    Then 00から03の件名は同じ値である
    And 01から03の作成日は具体値である

  Scenario: SCN-UNIT-REVIEWARTIFACT-001 review artifactへGit観測欄を充填する
    Given review artifact templateとbase head変更pathがある
    When review artifact雛形を描画する
    Then 比較基点とH_implは厳密SHA書式である
    And 全変更pathが個別監査表にある
    And review判定とtest結果は未確定である

  Scenario: SCN-UNIT-REVIEWARTIFACT-002 削除pathも個別監査表から落とさない
    Given 削除を含むreview artifact入力がある
    When review artifact雛形を描画する
    Then 削除pathはDとして個別監査表にある

  Scenario Outline: SCN-UNIT-ISSUESYNC-001 modeとcheckpointから同期対象を決定する
    Given <mode> modeのcheckpoint <checkpoint>という同期条件がある
    When 同期対象を導出する
    Then 同期対象は<artifacts>である

    Examples:
      | mode  | checkpoint | artifacts                                                |
      | quick | 4          | 00_要求定義.md                                           |
      | poc   | 4          | 00_要求定義.md                                           |
      | full  | 4          | 00_要求定義.md,01_要件定義.md                            |
      | full  | 8          | 00_要求定義.md,01_要件定義.md,02_設計.md,03_実装計画.md |
