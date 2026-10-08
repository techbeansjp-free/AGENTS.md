@e2e
Feature: 同一PRでのreview session置換と外部merge取り込み

  Scenario: SCN-E2E-EXTMERGE-001 ASC外でmergeされたPRの結果を検証してStep 11へ追記する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-EXTMERGE-001"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario Outline: SCN-E2E-EXTMERGE-002 検証項目が1つでも不一致なら何も追記しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-EXTMERGE-002"の"<項目>"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

    Examples:
      | 項目 |
      | PRがMERGEDである（OPEN） |
      | PRがMERGEDである（CLOSEDで未merge） |
      | merge時headが実効headと一致する |
      | repositoryとPR番号が固定値と一致する |
      | base refが既定branchである |
      | merge commitが既定branch tipから到達可能である |
      | merge方式を判定できる |
      | merge方式を判定できる（1親でtrusted policyがsquashも許可） |
      | merge時baseのtrusted policyを解決できる |
      | delivery stateがpr-boundである（merge-prepared） |
      | Step 11が記録されていない |

  Scenario Outline: SCN-E2E-EXTMERGE-003 merge方式の許可は既定branchのtrusted policyから解決する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-EXTMERGE-003"の"<観測したmerge方式>"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

    Examples:
      | 観測したmerge方式 |
      | squash |
      | merge |
