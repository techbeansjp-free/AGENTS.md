@integration @risk-policy
Feature: policy拡張を段階移行して失敗から再実行する

  Scenario: SCN-INT-RISK-001 policy、schema、runtime、CI、templateを同一migrationで拡張する
    Given v0.3のtrusted policyとv0.4のcandidate policyがある
    When migrationをdry-runする
    Then staged planにschema、runtime、CI、templateの変更がある
    And 書き込みは行われない

  Scenario: SCN-INT-RISK-002 rollback後に同じmigrationを再実行できる
    Given 適用済みmigrationと適用前snapshotがある
    When migrationをrollbackしてretryする
    Then rollbackと再適用の状態遷移を記録する
    And 最終policyはcandidateと一致する

  Scenario: SCN-INT-RISK-003 新規staged ruleとtrusted ruleの自己緩和を区別する
    Given candidateに正当なstaged rule追加とtrusted rule緩和がある
    When migration compatibilityを検査する
    Then staged rule追加は許可される
    And trusted rule緩和だけが拒否される

  Scenario: SCN-INT-RISK-004 project設定と開発assetはnpm配布対象にならない
    Given dogfooding policy、role log、metrics、test fixture、秘密fixtureがある
    When package allowlistを評価する
    Then すべての開発assetが明示的に除外される

  Scenario: SCN-INT-RISK-005 実manifestをdry-runしてapply、read-after-write、rollbackする
    Given policy、schema、runtime、CI、templateの隔離fixtureと変更manifestがある
    When 実manifestをdry-run、apply、rollbackする
    Then path、順序、before after hashと状態revisionを記録する
    And apply後検証とrollback後復旧が実fileで一致する

  Scenario: SCN-INT-RISK-006 改竄またはTOCTOUのあるmigration retryを拒否する
    Given rollback済みmigration stateと変更済みcandidateまたはrevision改竄がある
    When trustedとcandidateを再検証してretryする
    Then immutable fingerprintとhash不一致をstructured拒否する

  Scenario: SCN-INT-RISK-007 schemaとruntimeはv0.3未知fieldとv0.4空rulesを同じく拒否する
    Given 未知fieldを持つv0.3 policyと空rulesのv0.4 policyがある
    When schema契約とruntime契約を検証する
    Then 両方が安全なmigration diagnostic付きでinvalidになる

  Scenario: SCN-INT-RISK-008 npm packは環境fileとmanifest外assetのabuseを拒否する
    Given 配布fixtureにenv派生fileとmanifest外assetがある
    When 実npm pack内容をpackage境界で検証する
    Then env派生fileとmanifest外assetをstructured拒否する

  Scenario: SCN-INT-RISK-009 無変更migrationは固定の5変更を報告しない
    Given 同一policyと空の実manifestがある
    When migrationをdry-runする
    Then changesとmanifestは空である

  Scenario: SCN-INT-RISK-010 manifestはkind所有path外とGit内部領域を拒否する
    Given Git内部、unrelated file、symlink、制御文字、Unicode case衝突を含むmanifestがある
    When authority付き実manifestをdry-runする
    Then 全てのnon-owned pathはnon-override diagnosticで拒否される

  Scenario: SCN-INT-RISK-011 同kindの複数owned fileをpath単位で移行できる
    Given runtime kindの異なるowned pathを2件持つmanifestがある
    When authority付き実manifestをdry-runする
    Then kind重複は許可しpath重複だけを拒否する

  Scenario: SCN-INT-RISK-012 policy artifactとkind別artifactはexpected sourceへ拘束される
    Given candidateと異なるpolicy afterと不正なschema runtime CI templateがある
    When authority付き実manifestをdry-runする
    Then kind別validatorが全ての不正artifactを拒否する

  Scenario: SCN-INT-RISK-013 migration transactionはpartial applyとrollback中断から回復する
    Given durable journalを持つ複数file migrationがある
    When state書込直後、partial apply、rollback途中のcrashを注入する
    Then 次回実行がbefore after hashから全fileを回復する

  Scenario: SCN-INT-RISK-014 credential名と実content秘密をallowlisted directory内でも拒否する
    Given allowlisted srcにcredential境界、oauth、reauth及びtoken内容がある
    When 実npm packの名前とcontentを検査する
    Then credential containerと秘密patternだけを拒否しoauthとreauthを許可する

  Scenario: SCN-INT-RISK-015 conformance CLIは実在するenforcementと成功SCN証拠を要求する
    Given unknown、duplicate、dead referenceを持つconformance bindingがある
    When repository conformance CLIを実行する
    Then exact I1からI12と実在export、SCN、成功証拠の不足を拒否する

  Scenario: SCN-INT-RISK-016 project policy setはorphan、missing、symlink、duplicate keyを拒否する
    Given valid project policy manifestと悪用fragment variantsがある
    When filesystem policy setを厳密にloadする
    Then inventory不一致、不正path、duplicate keyはすべて拒否される

  Scenario: SCN-INT-RISK-017 trusted project policy setは単一commitとset hashへ拘束される
    Given originにmanifestと全fragmentを持つtrusted commitがある
    When trusted project policy setをloadする
    Then provenance commit、set hash、semantic policy hashが固定される

  Scenario: SCN-INT-RISK-018 state内自己申告approvalではmigrationを変更できない
    Given self asserted approved hashを持つforged migration stateがある
    When 外部approvalまたはexpected revisionなしで全state changing APIを呼ぶ
    Then 全APIはauthority不足をstructured拒否しfileを変更しない

  Scenario: SCN-INT-RISK-019 fragmented policy migrationはraw inventoryとapply後set hashへ拘束される
    Given trustedとcandidateのfragmented project policy setがある
    When monolith afterとcandidate raw inventoryのmigrationを計画する
    Then monolithは拒否されreal inventoryはapply後set hashまで一致する

  Scenario: SCN-INT-RISK-020 trusted ref解決失敗時はpackage floorへfallbackしない
    Given project denyを持つtrusted commitと解決不能なorigin HEADがある
    When authority operation policyをloadする
    Then trusted ref不明をfail closedにする

  Scenario: SCN-INT-RISK-021 recovery失敗でdurable journalをdiagnosticで上書きしない
    Given recover可能journalとunknown hashのartifactがある
    When CLI recoveryが失敗する
    Then journalは保持され別reportへ失敗が記録される

  Scenario: SCN-INT-RISK-022 PR checkoutはorigin HEADがなくてもexplicit trusted base SHAを検証できる
    Given origin HEADのないPR checkoutとtrusted base commitとcandidate policy setがある
    When explicit trusted commitでpolicy validate CLIを実行する
    Then base SHA一致だけ成功し欠落・不正・不一致はfail closedになる

  Scenario: SCN-INT-RISK-023 review evidence CLIはGitとtrusted GitHub providerを実観測する
    Given H_impl後にPhase A review artifactだけをcommitした隔離repositoryがある
    And GitHub review providerのvalid観測がある
    When review evidence CLIでGitとGitHub providerを結合する
    Then 実tree、diff、artifact hash、blobとH_finalのtrusted review gateが一致する

  Scenario Outline: SCN-INT-RISK-024 review evidence CLIは自己申告と不一致GitHub観測を承認しない
    Given H_impl後にPhase A review artifactだけをcommitした隔離repositoryがある
    And GitHub review providerの<variant>観測がある
    When review evidence CLIでGitとGitHub providerを結合する
    Then review evidenceは承認不能でgh呼出境界も守られる

    Examples:
      | variant |
      | forged-file |
      | forged-review-file |
      | forged-implementer-option |
      | wrong-repository |
      | wrong-pr |
      | wrong-run |
      | wrong-run-pr |
      | empty-run-pr |
      | wrong-review |
      | wrong-head |
      | self-review |
      | bot-pr-implementation-self-review |
      | null-implementation-author |
      | commented |
