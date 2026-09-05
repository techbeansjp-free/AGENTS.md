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

  Scenario: SCN-INT-DELIVERY-007 trusted policyなしでexternal PRを作成しない
    Given review、test、spec evidenceがすべてpassである
    And PR単位のexternal writeが承認済みである
    And trusted policyをPR inputから除く
    When PR createをapplyする
    Then PR createは失敗する
    And external operation callは0件である

  Scenario: SCN-INT-PRBODY-001 template構造を満たす本文を受理しH1をタイトルにする
    Given review、test、spec evidenceがすべてpassである
    When PR createをdry-runする
    Then PR previewのtitleは"bugfix: 824を是正する"である
    And PR previewのbodyはH1見出しを含まない
    And PR previewのbodyは必須見出しをすべて含む

  Scenario Outline: SCN-INT-PRBODY-002 template構造を満たさない本文を拒否する
    Given review、test、spec evidenceがすべてpassである
    And PR本文から"<heading>"の見出しを除く
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する
    And external operation callは0件である

    Examples:
      | heading |
      | 概要 |
      | テスト結果 |
      | 停止点 |

  Scenario: SCN-INT-PRBODY-003 未解決のplaceholderが残る本文を拒否する
    Given review、test、spec evidenceがすべてpassである
    And PR本文へ未解決のplaceholderを残す
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する
    And external operation callは0件である

  Scenario: SCN-INT-PRBODY-004 条件付き見出しの有無を問わない
    Given review、test、spec evidenceがすべてpassである
    And PR本文へ条件付き見出しを加える
    When PR createをdry-runする
    Then delivery stateはpreviewである

  Scenario: SCN-INT-PRBODY-005 canonical Issueを終端参照しない本文を拒否する
    Given review、test、spec evidenceがすべてpassである
    And PR本文からIssue参照を除く
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する
    And external operation callは0件である

  Scenario: SCN-INT-PRBODY-006 必須見出しの導出は条件付き見出しを除く
    Given PR本文templateに条件付き見出しがある
    When 必須見出しを導出する
    Then 必須見出しに条件付き見出しは含まれない
    And 必須見出しにtemplateの無条件見出しがすべて含まれる

  Scenario Outline: SCN-INT-PRBODY-007 見出しに見える文字列を必須見出しの充足にしない
    Given review、test、spec evidenceがすべてpassである
    And PR本文の"概要"見出しを"<substitute>"へ置き換える
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する
    And external operation callは0件である

    Examples:
      | substitute |
      | ### 概要 |
      | ## 概要（補足） |
      | ## 概要 extra |

  Scenario: SCN-INT-PRBODY-008 code block内の見出しを充足にしない
    Given review、test、spec evidenceがすべてpassである
    And PR本文の"概要"見出しをcode block内へ移す
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する
    And external operation callは0件である

  Scenario: SCN-INT-PRBODY-009 code内のIssue参照を終端参照にしない
    Given review、test、spec evidenceがすべてpassである
    And PR本文のIssue参照をcode spanで囲む
    When PR createをdry-runして失敗を確認する
    Then PR createは失敗する
    And external operation callは0件である

  Scenario: SCN-INT-GITHUB-001 Issue syncはrepositoryを確認してread-after-write一致を要求する
    Given exact repositoryと同じbodyを返すgh stubがある
    When Issue sync adapterを実行する
    Then Issue syncは成功する
    And gh操作順にauth、repo確認、edit、read-backが含まれる

  Scenario: SCN-INT-GITHUB-017 Issue read adapterが更新前本文とdigestを返す
    Given exact repositoryと同じbodyを返すgh stubがある
    When Issue read adapterを実行する
    Then Issue readは本文とsha256を返す
    And gh操作順にauth、repo確認、read-onlyのissue viewだけが含まれる

  Scenario: SCN-INT-GITHUB-018 Issue read adapterはread権限だけで成立する
    Given read権限だけを返すgh stubがある
    When Issue read adapterを実行する
    Then Issue readは成功する

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

  Scenario: SCN-INT-GITHUB-019 remote HEAD不一致でdispatch claimを消費しない
    Given 異なるremote HEADを返すgh stubがある
    When PR create adapterを実行する
    Then PR create adapterは失敗する
    And dispatch claimを消費していない

  Scenario: SCN-INT-GITHUB-020 認証観測に失敗したらdispatch claimを消費しない
    Given 認証観測に失敗するgh stubがある
    When PR create adapterを実行する
    Then PR create adapterは失敗する
    And dispatch claimを消費していない
    And PR create操作は呼ばれない

  Scenario: SCN-INT-GITHUB-021 dispatch claimの受け渡しがないPR作成を拒否する
    Given 一致するremote HEADとPR状態を返すgh stubがある
    When dispatch claimを渡さずPR create adapterを実行する
    Then PR create adapterは失敗する
    And PR create操作は呼ばれない

  Scenario: SCN-INT-GITHUB-007 read権限しかないrepositoryへIssueを書き込まない
    Given read権限だけを返すgh stubがある
    When Issue sync adapterを実行する
    Then Issue syncは失敗する
    And errorにwrite権限不足が含まれる
    And Issue edit操作は呼ばれない

  Scenario: SCN-INT-GITHUB-008 PR作成中のremote base OID変更は作成済みURL付きrollback要求にする
    Given 作成中にremote base OIDが変更されるgh stubがある
    When PR create adapterを実行する
    Then PR create adapterはrollback要求を返す
    And 作成済みPRのURLを失わない

  Scenario: SCN-INT-GITHUB-009 reviewを全page取得し時刻とstable IDを保持する
    Given 複数pageのreviewを返すexact repositoryのgh stubがある
    When PR reviews adapterを実行する
    Then 全pageのreviewと順序根拠を取得できる

  Scenario: SCN-INT-GITHUB-010 commit観測はfull OIDと一致する応答だけを受理する
    Given commit OID検証用のgh stubがある
    When 短縮OIDと応答不一致と完全一致をcommit inspectへ渡す
    Then 完全一致だけがcommit観測に成功する

  Scenario: SCN-INT-GITHUB-011 merge要求を再認可済みHEADへ拘束する
    Given merge操作を記録するwrite権限のgh stubがある
    When 再認可済みHEADを指定してPR merge adapterを実行する
    Then merge操作はmatch-head-commitで同じHEADへ拘束される

  Scenario: SCN-INT-GITHUB-016 未知のmerge方式をsquashへ倒さず例外にする
    Given merge操作を記録するwrite権限のgh stubがある
    When 未知のmerge方式を指定してPR merge adapterを実行する
    Then PR merge adapterは方式を解決できず例外になりghを呼ばない

  Scenario: SCN-INT-GITHUB-012 classic protectionが404でrulesetがあればprotectedと判定する
    Given classic protectionが404で有効なrulesetを返すgh stubがある
    When branch protection adapterを実行する
    Then branch protectionはrulesetによりprotectedと判定される
    And classic protection後にrulesetを確認する

  Scenario: SCN-INT-GITHUB-013 classic protectionが404でrulesetが空ならunprotectedと確定する
    Given classic protectionが404で空なrulesetを返すgh stubがある
    When branch protection adapterを実行する
    Then branch protectionはknownかつunprotectedである
    And classic protection後にrulesetを確認する

  Scenario: SCN-INT-GITHUB-014 classic protectionが404でrules APIも失敗したらunknownにする
    Given classic protectionが404でrules APIが失敗するgh stubがある
    When branch protection adapterを実行する
    Then branch protectionはrules API失敗をunknownにする
    And classic protection後にrulesetを確認する

  Scenario: SCN-INT-GITHUB-015 deletionだけのrulesetをbranch protectionと誤認しない
    Given classic protectionが404でdeletionだけのrulesetを返すgh stubがある
    When branch protection adapterを実行する
    Then deletionだけのrulesetはknownかつunprotectedである
    And classic protection後にrulesetを確認する

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

  Scenario: SCN-INT-MERGE-008 review時刻が不正なら配列順を信頼せずfail-closedにする
    Given 同一reviewerが承認後に変更要求へ更新している
    And reviewのsubmittedAtが不正である
    When merge authorizationを評価する
    Then mergeは許可されない

  Scenario: SCN-INT-MERGE-009 同一review IDを異なるactorや時刻へ再利用できない
    Given 同一review IDに異なるactorと時刻の観測がある
    When merge authorizationを評価する
    Then mergeは許可されない

  Scenario: SCN-INT-MERGE-010 staging trackerと同じrepository・IssueをcloseするPRだけを受理する
    Given staging trackerと同じcanonical IssueをcloseするPR観測がある
    When PRとstagingの同一性を検証する
    Then PRとstagingの同一性検証は成功する

  Scenario: SCN-INT-MERGE-011 別Issueの有効なstagingをpr mergeへ流用できない
    Given staging trackerと異なるIssueをcloseするPR観測がある
    When PRとstagingの同一性を検証する
    Then PRとstagingの同一性検証は失敗する

  Scenario: SCN-INT-MERGE-012 canonical以外のIssueを追加でcloseするPRを拒否する
    Given staging trackerとcanonical以外もcloseするPR観測がある
    When PRとstagingの同一性を検証する
    Then PRとstagingの同一性検証は失敗する

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

  Scenario: SCN-INT-FINALIZE-005 trusted policyなしではsafe reportもapplyしない
    Given merged、clean、pushed、recoveryありのworktree stateがある
    And safe finalize reportを作成済みである
    When trusted policyなしでfinalize applyを試みる
    Then finalize applyは失敗する
    And destructive operation callは0件である

  Scenario: SCN-INT-FINALIZE-006 既定branch到達が成立すればremote branch削除後もsafeになる
    Given merged、clean、pushed、recoveryありのworktree stateがある
    And finalize stateをmerged-remote-deletedにする
    When finalize reportを作成する
    Then finalize reportはsafeである

  Scenario: SCN-INT-FINALIZE-007 既定branch到達が不明ならremote branch削除後もsafeにしない
    Given merged、clean、pushed、recoveryありのworktree stateがある
    And finalize stateをmerged-remote-deleted-unknownにする
    When finalize reportを作成する
    Then finalize reportはsafeでない

  Scenario: SCN-INT-FINALIZE-008 復旧参照の不在は既定branch到達が不明なら免除しない
    Given merged、clean、pushed、recoveryありのworktree stateがある
    And finalize stateをrecovery-ref-missing-unknownにする
    When finalize reportを作成する
    Then finalize reportはsafeでない

