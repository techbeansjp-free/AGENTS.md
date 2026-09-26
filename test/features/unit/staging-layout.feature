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

  Scenario: SCN-UNIT-STGLAYOUT-011 schemaとruntimeが危険なroot segmentを同じく拒否する
    Given staging rootの正常例と反例がある
    When runtimeと2つのpolicy schemaでrootを検証する
    Then 正常なrepository相対pathだけを受理しdot segmentと制御文字と既存の境界違反を拒否する

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
