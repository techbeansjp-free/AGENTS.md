@integration @host-observer
Feature: install・update・delete・doctorがhost observerをASC-owned entryとして扱う

  Scenario: SCN-INT-HOSTOBS-001 installがobserverを配置しSendMessageだけに登録する
    Given 空のproject一時directoryがある
    When install --applyを実行する
    Then .claude/hooks/asc-host-observer.mjsがmanaged assetとして配置される
    And settings.local.jsonのPreToolUseにmatcher SendMessage・command node・args・timeout 10のASC-owned entryが1件だけある
    And Bash・Edit・Agent等のmatcherへのobserver登録は無い

  Scenario: SCN-INT-HOSTOBS-002 install・updateが利用者のhookとpermissionsを保持し重複と旧lifecycle entryを収束する
    Given settings.local.jsonに利用者のhook、permissions、同group内の他command、envがある
    And ASC-owned observer entryの重複と旧asc-agent-lifecycle entryがある
    When install --applyとupdate --applyを実行する
    Then 利用者の項目は意味的に不変である
    And ASC-owned observer entryは1件であり旧lifecycle entryは除去されている

  Scenario: SCN-INT-HOSTOBS-003 deleteがASC-owned entryと資産だけを除去する
    Given install済みで利用者のhookとpermissionsがある
    When delete --applyを実行する
    Then observer entryと.claude/hooks/asc-host-observer.mjsは無く、利用者の項目は残る

  Scenario: SCN-INT-HOSTOBS-004 doctorは状態を報告し資産の欠落ではhealthyを変えず改変では不健全にする
    Given 登録済み、未登録、資産欠落、record記載済み資産欠落、資産改変の5状態のprojectがある
    When それぞれでdoctorを実行する
    Then hooks.hostObserverはregistered・assetPresent・diagnostics・verifiedHostVersion 2.1.282・authority advisoryを報告する
    And 未登録と資産欠落はdiagnosticsに名指しされ、新しいsessionで有効になる旨を示す
    And doctor全体のhealthyは資産改変を除く4状態で同じである
    And 資産改変ではdoctor全体がmanaged hashの不一致で不健全である

  Scenario: SCN-INT-HOSTOBS-005 observerが壊れてもworkflowは前進する
    Given observer資産が異常終了する内容に置き換えられた状態と欠落した状態がある
    When workflow advanceのpreviewを実行する
    Then targetStep、state、agentDispatchは正常な状態と同一である
