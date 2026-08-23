@integration
Feature: PR停止、条件付きmerge、safe finalizeを操作単位で分離する

  Scenario: SCN-INT-DELIVERY-001 PR dry-runはexternal callを行わない
    Given review、test、spec evidenceがすべてpassである
    When PR createをdry-runする
    Then delivery stateはpreviewである
    And external operation callは0件である

  Scenario: SCN-INT-DELIVERY-002 PR applyはcreateだけを呼んでhuman review待ちで止まる
    Given review、test、spec evidenceがすべてpassである
    And PR単位のexternal writeが承認済みである
    When PR createをapplyする
    Then delivery stateはwaiting_for_human_reviewである
    And external operationは"pr.create"だけである

  Scenario Outline: SCN-INT-DELIVERY-003 必須evidenceが欠けたPRを拒否する
    Given review、test、spec evidenceがすべてpassである
    And <evidence> evidenceをfailにする
    When PR createをapplyする
    Then PR createは失敗する
    And external operation callは0件である

    Examples:
      | evidence |
      | review |
      | tests |
      | spec |

  Scenario Outline: SCN-INT-DELIVERY-004 repositoryまたはbranchのoption注入を拒否する
    Given review、test、spec evidenceがすべてpassである
    And PR inputの<項目>を<値>にする
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する
    And external operation callは0件である

    Examples:
      | 項目 | 値 |
      | repository | "../.." |
      | head | "--delete-branch" |
      | base | "../main" |

  Scenario: SCN-INT-DELIVERY-005 PR evidenceのHEADが対象HEADと違えば拒否する
    Given review、test、spec evidenceがすべてpassである
    And test evidenceのHEADだけが異なる
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する

  Scenario: SCN-INT-DELIVERY-006 updated spec evidenceのtraceが欠けていれば拒否する
    Given review、test、spec evidenceがすべてpassである
    And spec evidenceからscenario traceを除く
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する

  Scenario: SCN-INT-GITHUB-001 Issue syncはrepositoryを確認してread-after-write一致を要求する
    Given exact repositoryと同じbodyを返すgh stubがある
    When Issue sync adapterを実行する
    Then Issue syncは成功する
    And gh操作順にauth、repo確認、edit、read-backが含まれる

  Scenario: SCN-INT-GITHUB-002 Issue syncのread-after-write不一致を拒否する
    Given exact repositoryだが異なるbodyを返すgh stubがある
    When Issue sync adapterを実行する
    Then Issue syncは失敗する

  Scenario: SCN-INT-GITHUB-003 PR状態の読取前にrepository完全一致を確認する
    Given PR状態を返すexact repositoryのgh stubがある
    When PR inspect adapterを実行する
    Then PR状態を取得できる
    And PR読取前にauthとrepository確認が行われる

  Scenario: SCN-INT-GITHUB-004 branch protection読取前にrepository完全一致を確認する
    Given branch protectionを返すexact repositoryのgh stubがある
    When branch protection adapterを実行する
    Then branch protection状態を取得できる
    And protection読取前にauthとrepository確認が行われる

  Scenario: SCN-INT-GITHUB-005 PR作成はremote HEADを確認し作成後のPRを再読取する
    Given 一致するremote HEADとPR状態を返すgh stubがある
    When PR create adapterを実行する
    Then PR create adapterは成功する
    And PR作成順にauth、repository、remote HEAD、create、read-backが含まれる

  Scenario: SCN-INT-GITHUB-006 remote HEADが証拠SHAと違えばPRを作成しない
    Given 異なるremote HEADを返すgh stubがある
    When PR create adapterを実行する
    Then PR create adapterは失敗する
    And PR create操作は呼ばれない

  Scenario: SCN-INT-GITHUB-007 read権限しかないrepositoryへIssueを書き込まない
    Given read権限だけを返すgh stubがある
    When Issue sync adapterを実行する
    Then Issue syncは失敗する
    And errorにwrite権限不足が含まれる
    And Issue edit操作は呼ばれない

  Scenario: SCN-INT-GITHUB-008 PR作成中のremote base OID変更をread-after-writeで拒否する
    Given 作成中にremote base OIDが変更されるgh stubがある
    When PR create adapterを実行する
    Then PR create adapterは失敗する

  Scenario: SCN-INT-MERGE-001 candidate PR自身のautomatic policyで自己承認できない
    Given trusted policyはdisabledでcandidate policyはautomaticである
    When candidate branchのmerge authorizationを評価する
    Then mergeは許可されない

  Scenario: SCN-INT-MERGE-002 trusted automatic policyはmerge操作だけを許可する
    Given trusted policyがautomaticでcheck "ci"とreview 1件を要求する
    And branch、method、check、reviewがすべて条件を満たす
    When merge authorizationを評価する
    Then mergeは許可される
    And 許可operationは"pr.merge"だけである

  Scenario: SCN-INT-MERGE-003 assisted policyはPR単位のhuman approvalを要求する
    Given trusted policyがassistedである
    When human approvalなしとありでmerge authorizationを評価する
    Then approvalなしは拒否され、approvalありだけ許可される

  Scenario: SCN-INT-MERGE-004 check stateがunknownならfail-closedにする
    Given trusted automatic policyがrequired check "ci"を持つ
    When check state unknownでmerge authorizationを評価する
    Then mergeは許可されない

  Scenario: SCN-INT-MERGE-005 旧HEADまたは実装者自身のreviewを承認数へ含めない
    Given reviewが旧HEADまたは実装者自身による承認である
    When merge authorizationを評価する
    Then mergeは許可されない

  Scenario: SCN-INT-MERGE-006 trusted観測が欠けたmerge認可はfail-closedにする
    Given repository、SHA、保護設定のtrusted観測が欠けている
    When merge authorizationを評価する
    Then mergeは許可されない

  Scenario: SCN-INT-MERGE-007 同一reviewerの最新状態が変更要求なら旧承認を数えない
    Given 同一reviewerが承認後に変更要求へ更新している
    When merge authorizationを評価する
    Then mergeは許可されない

  Scenario: SCN-INT-FINALIZE-001 safeなdry-run reportはhashを返して何も削除しない
    Given merged、clean、pushed、recoveryありのworktree stateがある
    When finalize reportを作成する
    Then reportはsafeで64桁hashを持つ
    And destructive operation callは0件である

  Scenario Outline: SCN-INT-FINALIZE-002 unsafeまたはunknown stateではcleanupしない
    Given merged、clean、pushed、recoveryありのworktree stateがある
    And finalize stateを<状態>にする
    When report hashを承認してfinalize applyを試みる
    Then finalize applyは失敗する
    And destructive operation callは0件である

    Examples:
      | 状態 |
      | dirty |
      | untracked |
      | unpushed |
      | unmerged |
      | recovery-unknown |
      | spec-unknown |
      | ignored-artifact |

  Scenario: SCN-INT-FINALIZE-003 dry-run後にHEADが変わったらTOCTOUとして拒否する
    Given merged、clean、pushed、recoveryありのworktree stateがある
    And safe finalize reportを作成済みである
    When current HEADを変更してfinalize applyする
    Then finalize applyは失敗する
    And destructive operation callは0件である

  Scenario: SCN-INT-FINALIZE-004 safeかつ同一hashのapplyだけ公式worktree removalを呼ぶ
    Given merged、clean、pushed、recoveryありのworktree stateがある
    And safe finalize reportを作成済みである
    When 同一stateと承認hashでfinalize applyする
    Then lifecycle stateはfinalizedである
    And destructive operationは"worktree.remove"だけである
