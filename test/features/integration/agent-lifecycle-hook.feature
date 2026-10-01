@integration
Feature: agent lifecycleをhost hookで制限する
  repository stateから再開し、完了したcontextと上限に達したcontextを再利用しない。

  Scenario Outline: SCN-INT-AGENTLIFE-001 dispatchと実行寿命を制限する
    Given lifecycle hookを登録した新規sessionがある
    When lifecycleの"<操作>"を実行する
    Then lifecycle判定は"<結果>"である

    Examples:
      | 操作 | 結果 |
      | 完了後SendMessage | deny |
      | activeへの連絡 | allow |
      | 名前での迂回 | deny |
      | legacy resume | deny |
      | 完了後の直接tool | deny |
      | 同じIDの再起動 | deny |
      | fresh agent | allow |
      | fresh clear | allow |
      | 同じIDのclear | allow |
      | main上限とcompact | allow |
      | subagent上限 | deny |
      | handoff警告 | warning |
      | 上限後の結果返却 | allow |
      | 未登録agent | deny |
      | identityのない終了event | allow |
      | 終了session再開 | allow |
      | 破損記録 | deny |

  Scenario: SCN-INT-AGENTLIFE-002 本文を保存せず寿命を観測する
    Given lifecycle hookを登録した新規sessionがある
    When lifecycleの"session再開"を実行する
    Then lifecycle計測は本文を含まず終了と再利用試行を区別する
    And main再開は計測を保持しsubagentを復活させない

  Scenario: SCN-INT-AGENTLIFE-003 hookを配布し設定を保持する
    Given lifecycle hookを登録した新規sessionがある
    When lifecycleの"session再開"を実行する
    Then lifecycle hookの配布と削除は設定を変更しない

  Scenario: SCN-INT-AGENTLIFE-004 runtimeの境界を保持する
    Given lifecycle hookを登録した新規sessionがある
    When lifecycleの"session再開"を実行する
    Then lifecycle記録のsymlinkは境界外を書き換えない

  Scenario: SCN-INT-AGENTLIFE-005 上限でmodel loopを止め並行実行でも予算を保持する
    Given lifecycle hookを登録した新規sessionがある
    When lifecycleの"session再開"を実行する
    Then lifecycleの並行toolは上限を超えて許可されない
    And lifecycle上限はmodel loopの継続も停止する
    And lifecycleの既定とmode別budgetはmainを停止しない

  Scenario: SCN-INT-AGENTLIFE-006 設定だけを実機動作保証にしない
    Given lifecycle hookを登録した新規sessionがある
    When lifecycleの"session再開"を実行する
    Then lifecycle登録診断はevent不足と非同期登録を報告する

  Scenario: SCN-INT-AGENTLIFE-007 semantic boundaryでfresh contextへhandoffする
    Given semantic handoff検査用の隔離環境を用意する
    When fresh contextで実装と複数review roundを完走し反例を拒否する
    Then semantic handoffの正常系と拒否系が成立する
