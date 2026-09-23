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

  Scenario: SCN-UNIT-REVIEWARTIFACT-003 symlink親によるrepository外書き込みを拒否する
    Given repository内の出力親がrepository外へ解決される
    When review artifactの出力親包含を判定する
    Then review artifactの出力親は拒否される

  Scenario: SCN-UNIT-REVIEWARTIFACT-004 別rootのstagingを拒否する
    Given review artifactの対象rootと別rootのstagingがある
    When review artifactのstaging配置を判定する
    Then review artifactのstagingは拒否される

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

  Scenario: SCN-UNIT-ISSUESYNC-002 full Step 8の同期本文は00を先頭に置き01〜03を折りたたむ
    Given 00から03の内容が既知の同期本文入力がある
    When full checkpoint 8の同期本文を描画する
    Then 最初の折りたたみより前は00の全文と一致する
    And 折りたたみは3つあり見出しは01_要件定義.md、02_設計.md、03_実装計画.mdの順である
    And 各折りたたみの中身は対応する成果物の全文と一致する
    And 折りたたみの構造は本文中の閉じtagで壊れない
    And 折りたたみ境界の置き換えは形を変えた閉じtagも捕まえる
    And 検証済みfull stagingから生成した同期本文は同じ入力の描画結果と一致する

  Scenario Outline: SCN-UNIT-ISSUESYNC-003 checkpoint 4とquick・pocの同期本文は区切り線連結のまま変えない
    Given 00から03の内容が既知の同期本文入力がある
    And <mode> modeのcheckpoint <checkpoint>という同期条件がある
    When 同期条件で先頭<count>件の同期本文を描画する
    Then 同期本文は成果物を区切り線で連結した従来形式である

    Examples:
      | mode  | checkpoint | count |
      | quick | 4          | 1     |
      | poc   | 4          | 1     |
      | full  | 4          | 2     |

  @issue-1396
  Scenario: SCN-UNIT-ISSUESYNC-026 同期本文digestは末尾改行を含む本文byte列から計算する
    Given 00から03の内容が既知の同期本文入力がある
    When full checkpoint 8の同期本文を描画する
    Then 検証済みfull stagingから生成した同期本文は同じ入力の描画結果と一致する
