@e2e @risk-policy
Feature: repository自身がpolicy CLIの成功、拒否、復旧をdogfoodする

  Scenario: SCN-E2E-RISK-001 staged通常拡張をCLI dry-runで成功させる
    Given dogfooding用のtrusted policyと通常拡張candidateがある
    When policy migrate CLIをdry-runする
    Then CLIは書き込まずstaged migrationを表示する

  Scenario: SCN-E2E-RISK-002 自己緩和candidateをCLIで安全拒否する
    Given dogfooding用のtrusted policyと自己緩和candidateがある
    When policy evaluate CLIを実行する
    Then CLIは非0で終了する
    And stdoutにASC-TRUST-001と日本語解決経路がある

  Scenario: SCN-E2E-RISK-003 migration apply、rollback、retryをCLIで再現する
    Given 一時projectにmigration入力とsnapshotがある
    When policy migrate CLIをapply、rollback、retryする
    Then すべての状態遷移が成功する
    And 実repositoryとremoteは変更されない

  Scenario: SCN-E2E-RISK-004 tracked dogfood policyを隔離Git repositoryから実binで評価する
    Given tracked dogfood policyを持つ隔離Git repositoryがある
    When 実binで通常拡張と自己緩和を評価する
    Then 通常拡張は成功し自己緩和はASC-TRUST-001で拒否される

  Scenario Outline: SCN-E2E-RISK-005 operation enforcement pointは未達requireを非許可にする
    Given <境界>境界のrequire ruleと未達条件がある
    When 実binでoperationをenforceする
    Then operationは日本語diagnostic付きで非許可になる

    Examples:
      | 境界 |
      | policy |
      | delivery |
      | package |

  Scenario: SCN-E2E-RISK-006 実manifest migrationをCLIで復旧し改竄retryを拒否する
    Given policy、schema、runtime、CI、templateのCLI migration fixtureがある
    When 実binでdry-run、apply、rollback、retry、改竄retryを実行する
    Then 実fileは復旧再適用され改竄retryだけがstructured拒否される

  Scenario: SCN-E2E-RISK-007 actual operationは自己申告preflightでtrusted境界を迂回できない
    Given trusted origin policyを持つ隔離repositoryと不正なactual operationがある
    When preflight省略、別rule、violated falseを指定してactual CLIを実行する
    Then actual stateから導出したtrusted enforcementが全てを拒否する

  Scenario: SCN-E2E-RISK-008 例外も完全なredacted diagnosticとして出力する
    Given secretを含む存在しないpath入力がある
    When actual binでpath例外を発生させる
    Then stdoutは秘密なしの完全structured diagnosticになる
