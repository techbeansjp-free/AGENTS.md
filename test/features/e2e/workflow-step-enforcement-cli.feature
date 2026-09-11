@e2e
Feature: 公開CLIでワークフローStepを強制する

  Scenario: SCN-E2E-WFSTEP-001 quickでstep 4を飛ばしたpr createを具体的な診断で拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-001"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-002 step 4と10を記録済みのpr createが従来どおり成功する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-002"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-003 workflow stepsのquick出力が機械可読な省略対象を返す
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-003"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-004 HumanOverrideでPRを作成してもautomaticはmerge待ちとしStep 11を完了しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-004"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-005 PoC stagingからのpr mergeをGitHub操作前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-005"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-006 PR作成後にrepository・Issue・PR・HEADをdelivery stateへ固定する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-006"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-007 merge要求後の再実行はproviderへ再送せずread-backとEvidence再検証だけを行う
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-007"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-008 merge-requestedではStep 11へ進まずmerged再観測後に完了する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-008"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-009 固定済みPR・project・closing契約の変更をmerge前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-009"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-010 local policyの由来がremote baseと異なるPR作成をprovider副作用前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-010"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-011 providerに対象PRがないcreate intentを同じidentityで安全に再試行する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-011"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-012 merge intentを安全に再試行し未対応ghをdispatch前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-012"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-013 step11-recordedの再実行は実journalと保存digestの欠落・改変を拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-013"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-014 GitHubの秒精度RFC3339 mergedAtをcanonical UTC時刻として保存する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-014"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-015 merge queue entryを永続化して再送せずmerged終端まで検証する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-015"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-016 auto-merge methodが固定intentと異なれば再送せず照合要求にする
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-016"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-017 stop-at-PRをdurable Step 11終端として一度だけ記録する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-017"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-053 merge disabledのPR停止終端はpr mergeを拒否しproviderへ送らない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-053"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-054 assistedのauthority未成立はStep 11を記録せず再開可能な待機になる
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-054"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-055 assistedは独立approvalがあればmerge終端へ到達し無ければ到達しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-055"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-052 fullのStep 0から11までを実CLI経路で通す
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-052"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-056 pocはautomatic宣言下でもPR停止終端になりpr mergeを拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-056"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-018 PR終端journal保存後の停止からprovider再送なしでstateを復旧する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-018"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-019 providerの既定branchが指定baseと違えばPR intent前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-019"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-020 merge直前のprovider authorityが変化したら外部mergeを拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-020"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-021 merged終端の再実行はproviderを呼ばず同じEvidenceを返す
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-021"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-022 merged終端journal保存後の停止からprovider再送なしでstateを復旧する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-022"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-023 PR create dispatch claim後の停止はprovider未反映でも再送しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-023"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-024 merge dispatch claim後の停止はprovider未反映でも再送しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-024"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-025 固定identityに一致するclosed PRがあれば重複PRを作成しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-025"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-026 PR作成後binding前にbaseが前進しても既存PRをread-only復旧する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-026"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-027 PR終端journal後の復旧は成果物改変を追認しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-027"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-028 merge終端journal後の復旧は成果物改変を追認しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-028"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-029 PR検索を全page走査し101件目のclosed一致を見落とさない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-029"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-030 OPENとCLOSEDの一致が混在したら一意なOPENとして復旧しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-030"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-031 PRまたは実装commitのauthor stable IDを観測できなければmergeしない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-031"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-032 同じreviewerの最新状態変更を採用しCOMMENTEDではAPPROVEDを失効させない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-032"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-033 merge commitのtree改変または既定branch非包含を終端化しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-033"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-034 不完全なPR検索または同じhead/baseの不一致PRをexact absenceとして扱わない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-034"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-035 即時squash mergeの現在request証拠を保持して終端化する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-035"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-036 fork由来またはcontent不一致のPRへ復旧bindingしない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-036"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-037 queue requestが初回read-back前に消えても即時squashとrebaseを終端化する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-037"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-038 request消失rebaseの親chainが固定sourceと違えば終端化しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-038"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-039 公開CLIのworkflow recordが編集済みstagingを受理する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-039"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-040 pr create後のpost-terminal intakeを公開CLIで記録できる
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-040"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-041 intake指定のないStep 11記録後の追記を拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-041"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-042 terminal delivery state後のintake指定のない追記を拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-042"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-043 dispatch gate前の失敗はclaimを消費せず再実行できる
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-043"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-044 merge後に関連PRが空でも固定run IDの照合でStep 11へ到達する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-044"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-050 provider mergedAtより後のmerge要求時刻を因果証拠にしない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-050"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-045 固定run照合が不一致ならStep 11を記録せず拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-045"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-046 merge前の選別は空と他PRの関連runを拒否しmergeを要求しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-046"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-047 merge後にreview状態が動いたら固定Evidenceとの不一致で拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-047"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-051 pr merge実経路で単独運用は既定で通りactor-independent宣言で止まる
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-051"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-048 索引の反映待ちを経て1回のpr createでbindする
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-048"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-049 binding失敗時の案内が実際に踏める手順を述べる
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-049"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-ADVANCE-001 workflow advanceのpreviewはjournalを変更しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-ADVANCE-001"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-ADVANCE-002 workflow advanceのapplyは次Stepを1件だけ記録する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-ADVANCE-002"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-ADVANCE-003 workflow advanceはStep 10をreviewへ委譲して変更しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-ADVANCE-003"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-ADVANCE-004 workflow advanceはStep 4の本文同期とjournal記録を合成する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-ADVANCE-004"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-ADVANCE-005 workflow advanceはStep 8でStep 4と異なるIssueへの同期を拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-ADVANCE-005"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-ADVANCE-006 workflow advanceはPoC Step 9を現在HEADの観測証拠へ拘束する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-ADVANCE-006"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる
