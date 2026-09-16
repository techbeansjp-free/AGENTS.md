@unit @staging-layout
Feature: stagingの配置をproject policyで版管理下へ置ける

  Scenario: SCN-UNIT-STGLAYOUT-001 staging節が無いprojectは既定配置である
    Given project policy manifestを持たないrepositoryがある
    When staging配置契約を読む
    Then rootは既定の一時領域でtrackedは偽でissueBodyはfullである

  Scenario: SCN-UNIT-STGLAYOUT-002 不正なstaging節を拒否する
    Given staging節の不正な候補がある
    When 各候補を検証する
    Then 末尾がアスタリスクのrootと絶対pathと親参照とroot無しのtrackedは拒否される

  Scenario: SCN-UNIT-STGLAYOUT-003 アスタリスクを含むrootではstaging-rootを明示させる
    Given sprint配下をrootにする版管理下のstaging policyがある
    When staging-rootを省略してissue createする
    Then staging-rootの明示を求めて拒否される
    When patternに一致しないstaging-rootでissue createする
    Then patternの不一致で拒否される

  Scenario: SCN-UNIT-STGLAYOUT-004 版管理下のstagingは文書だけを追跡する
    Given sprint配下をrootにする版管理下のstaging policyがある
    When staging-rootとnameを指定してissue createする
    Then stagingは指定したsprint配下に指定した名前で作られる
    And stagingには機械記録だけを除外するgitignoreがある
    And git statusは文書を未追跡として見せ機械記録を見せない

  Scenario: SCN-UNIT-STGLAYOUT-005 stagingからrepository rootを導く
    Given sprint配下をrootにする版管理下のstaging policyがある
    When staging-rootとnameを指定してissue createする
    Then 版管理下のstagingからrepository rootを導ける
    And workflow stagingの配置検査は版管理下のstagingを受理する
    And repository外のstagingは配置検査で拒否される

  Scenario: SCN-UNIT-STGLAYOUT-006 pointer形の同期本文は要点と配置だけを持つ
    Given sprint配下をrootにする版管理下のstaging policyがある
    When staging-rootとnameを指定してissue createする
    And 00を検証可能な内容に置き換えて同期本文を生成する
    Then 同期本文は成果物のpathとdigestと目的と受け入れ条件を含む
    And 同期本文は00の他の節を含まない

  Scenario: SCN-UNIT-STGLAYOUT-007 既定配置のstagingは従来どおり全文を同期する
    Given project policy manifestを持たないrepositoryがある
    When 既定配置にissue createして00を検証可能な内容に置き換え同期本文を生成する
    Then 同期本文は00の全文である

  Scenario: SCN-UNIT-STGLAYOUT-008 git除外pathspecはstaging配下を清浄判定から外す
    Given sprint配下をrootにする版管理下のstaging policyがある
    When staging-rootとnameを指定してissue createする
    Then 除外pathspecつきのgit statusはstaging配下の未追跡fileを見せない

  Scenario: SCN-UNIT-STGLAYOUT-009 review artifact雛形は種別から導ける監査列を事前充填する
    Given 種別の異なる変更pathがある
    When 監査行の雛形を描画する
    Then lockfileと文書とtestと設定は層と依存と安全の列が埋まり判定列は未確定のままである
    And product codeの行は全列が未確定のままである

  Scenario: SCN-UNIT-STGLAYOUT-010 review artifact雛形はauditと同じ差分集合と配布物影響の行を持つ
    Given 生成物を含む変更pathとpackage filesがある
    When review artifact雛形をpackage filesつきで描画する
    Then 個別監査表に生成物の行が無くsourceと文書の行がある
    And 配布物影響の表は生成物を境界単位にまとめ入る入らないを判定している
    And ラウンド数は整数で始まる
