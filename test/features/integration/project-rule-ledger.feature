@integration
Feature: project固有rule台帳のrepository結合契約

  Scenario: SCN-INT-LEDGER-001 実repositoryの全project ruleがcoverage matrixを満たす
    Given 実repositoryのproject rule台帳がある
    When repository rule台帳conformanceを検証する
    Then 全ruleがcoverageを持ちorphanは0件になる

  Scenario: SCN-INT-LEDGER-002 品質CIがpull_request以外で重複発火する設定を拒否する
    Given pull requestとpushで重複発火する隔離品質CIがある
    When 隔離品質CIのtriggerを検証する
    Then pull request以外のtriggerが拒否される

  Scenario: SCN-INT-LEDGER-003 npm以外のlockfile混在を拒否する
    Given npmと別package managerのlockfileを持つ隔離repositoryがある
    When 隔離repositoryのpackage manager境界を検証する
    Then npm以外のlockfileが拒否される

  Scenario: SCN-INT-LEDGER-004 project policy・role log・metricsが配布物へ含まれない
    Given 配布外project資産をfilesへ含めた隔離packageがある
    When 隔離packageの配布境界を検証する
    Then project policyと実行記録の配布が拒否される

  Scenario: SCN-INT-LEDGER-005 宣言した個別検査がすべて公開入口のerrorsへ合成されている
    Given 適合性検査scriptの本体がある
    When 公開入口へ合成されている個別検査を読む
    Then 宣言した個別検査がすべて合成されている

  Scenario: SCN-INT-LEDGER-006 合成されている個別検査がすべて宣言へ登録されている
    Given 適合性検査scriptの本体がある
    When 公開入口へ合成されている個別検査を読む
    Then 合成されている個別検査がすべて宣言されている
  Scenario: SCN-INT-LEDGER-007 file migrationがtrusted sourceを配送し完全削除を受理する
    Given trusted fragmentとproject rule廃止提案がある
    When 隔離policy setのrule廃止migrationを計画する
    Then migrationで承認済みrule廃止を返し提案撤回時は拒否する

  Scenario: SCN-INT-LEDGER-008 fixed commitのtrusted提案だけをvalidateとdeliveryへ配送する
    Given trusted fragmentとproject rule廃止提案がある
    When 隔離Gitの固定commitからrule廃止を検証する
    Then trustedで先行登録した廃止だけが受理されcandidate自己承認は拒否される

  Scenario: SCN-INT-LEDGER-009 配布schemaと案内がproject rule廃止契約を持つ
    Given project rule廃止の配布契約がある
    When schemaとruntimeと利用案内を照合する
    Then 宣言形式と二段階手順と撤回とrollbackが一致する
