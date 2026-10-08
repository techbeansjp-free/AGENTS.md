@e2e
Feature: 同一PRでのreview session置換と外部merge取り込み

  Scenario: SCN-E2E-REVREPLACE-001 暫定guardに拒否された収束済みPRを同一PRのままreview session置換で配送する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-REVREPLACE-001"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario Outline: SCN-E2E-REVREPLACE-002 前提を満たさないreview session置換を無変更で拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-REVREPLACE-002"の"<条件>"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

    Examples:
      | 条件 |
      | review sessionが存在する |
      | review sessionがconvergedである |
      | latest roundのcandidate HEADがcurrent H_implと一致する |
      | delivery stateがpr-boundである |
      | merge intentが無い |
      | Step 11が無い |
      | 置換記録のsequenceが連番である |
      | 置換記録のhash chainが一致する |
      | 置換済みsessionの保存fileが置換記録のdigestと一致する |
      | 置換記録の末尾が完全な行である |
      | 中断した置換の旧sessionがconvergedである |
      | 中断した置換記録の値が旧sessionと一致する |

  Scenario: SCN-E2E-REVREPLACE-003 置換を組み合わせても暫定guardの攻撃面を開かない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-REVREPLACE-003"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-REVREPLACE-004 Step 11記録後の置換後証跡はsession-replacementのR7だけを名指しして拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-REVREPLACE-004"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario Outline: SCN-E2E-REVREPLACE-005 中断した置換の再applyはprogress journalの配置をapplyの段の順序へ照合する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-REVREPLACE-005"の"<中断状態>"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

    Examples:
      | 中断状態 |
      | 許可: 記録追記後・session rename前・savedProgressPath=null |
      | 許可: 記録追記後・session rename前・savedProgressPath非null・元名あり |
      | 許可: session rename後・savedProgressPath=null |
      | 許可: session rename後・progress rename前 |
      | 許可: progress rename後・digest再固定前 |
      | 拒否: session rename前・savedProgressPath=null・元名あり |
      | 拒否: session rename後・savedProgressPath=null・元名あり |
      | 拒否: session rename前・savedProgressPath非null・元名も保存名もなし |
      | 拒否: session rename前・savedProgressPath非null・元名と保存名の両方あり |
      | 拒否: session rename後・savedProgressPath非null・元名と保存名の両方あり |
      | 拒否: session rename前・savedProgressPath非null・保存名だけ |
      | 既存診断: session rename後・savedProgressPath非null・元名も保存名もなし |

  Scenario: SCN-E2E-REVREPLACE-006 置換記録の崩れはpendingLastの最終記録2形だけを中断復旧で許す
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-REVREPLACE-006"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

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
      | merge時headが実効headと一致する（pr reanchor後） |
      | merge時headが実効headと一致する（観測中にpr reanchor） |
      | repositoryとPR番号が固定値と一致する |
      | repositoryが固定値と一致する |
      | base refが既定branchである |
      | merge commitが既定branch tipから到達可能である |
      | merge方式を判定できる |
      | merge方式を判定できる（1親でtrusted policyがsquashも許可） |
      | merge時baseのtrusted policyを解決できる |
      | delivery stateがpr-boundである（merge-prepared） |
      | delivery stateがpr-boundである（観測中にmerge-prepared） |
      | Step 11が記録されていない |

  Scenario Outline: SCN-E2E-EXTMERGE-003 merge方式の許可は既定branchのtrusted policyから解決する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-EXTMERGE-003"の"<観測したmerge方式>"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

    Examples:
      | 観測したmerge方式 |
      | squash |
      | merge |

  Scenario: SCN-E2E-EXTMERGE-004 外部merge取り込みはproviderへ読取り操作だけを発行する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-EXTMERGE-004"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる
