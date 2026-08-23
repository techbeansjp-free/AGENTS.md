@unit
Feature: Review、policy、package境界を有限かつ説明可能にする

  Scenario: SCN-UNIT-REVIEW-001 両観点のrubricが完了してfindingなしなら承認する
    Given round 1の肯定・敵対rubric、test、specがすべてpassである
    And findingは0件である
    When review gateを評価する
    Then reviewはapprovedである

  Scenario Outline: SCN-UNIT-REVIEW-002 片方の観点が欠けたreviewは拒否する
    Given round 1の肯定・敵対rubric、test、specがすべてpassである
    And <観点>の<項目>が未評価である
    When review gateを評価する
    Then reviewはrejectedである

    Examples:
      | 観点 | 項目 |
      | affirmative | correctness |
      | adversarial | security |

  Scenario: SCN-UNIT-REVIEW-003 MediumとLowは記録するがblockingにしない
    Given 完全なreviewにMediumとLowのvalid findingがある
    When review gateを評価する
    Then reviewはapprovedである
    And blocking findingは0件である

  Scenario: SCN-UNIT-REVIEW-004 未解決Highはblockingにする
    Given 完全なreviewにHighのvalid finding "H1"がある
    When review gateを評価する
    Then blocking findingは"H1"である
    And reviewはrejectedである

  Scenario: SCN-UNIT-REVIEW-005 round 3のfindingは定義済み分類を要求する
    Given round 3のfinding分類が"mystery"である
    When review gateを評価する
    Then reviewはrejectedである

  Scenario: SCN-UNIT-REVIEW-006 同じscopeのreview budgetは3 roundを超えない
    Given review roundが4である
    When review gateを評価する
    Then review評価は例外で停止する

  Scenario: SCN-UNIT-REVIEW-007 未知のfinding状態や重大度をfail-closedで拒否する
    Given 完全なreviewに未知の状態と重大度を持つfindingがある
    When review gateを評価する
    Then reviewはrejectedである

  Scenario: SCN-UNIT-REVIEW-008 High riskは人間のownerと理由と再確認条件が揃う場合だけ受容できる
    Given 完全なreviewに人間が条件付き受容したHigh findingがある
    When review gateを評価する
    Then reviewはapprovedである

  Scenario: SCN-UNIT-REVIEW-009 round 2で既承認範囲を全再走査しない
    Given round 2のreviewが全範囲再走査を要求している
    When review gateを評価する
    Then reviewはrejectedである

  Scenario: SCN-UNIT-REVIEW-010 not-applicableは観点ごとの理由を要求する
    Given 完全なreviewに理由なしのnot-applicableがある
    When review gateを評価する
    Then reviewはrejectedである

  Scenario: SCN-UNIT-REVIEW-011 Phase A reviewはH_implとevidence-only H_finalを分離して外部証拠を拘束する
    Given H_implの後にreview artifactだけを追加したH_finalの完全なreviewがある
    When review gateを評価する
    Then reviewはapprovedである

  Scenario Outline: SCN-UNIT-REVIEW-012 Phase A review metadataの改竄を拒否する
    Given 有効なPhase A review evidenceの<属性>を改竄する
    When review gateを評価する
    Then reviewはrejectedであり<診断>を返す

    Examples:
      | 属性 | 診断 |
      | same-head | H_implとH_final |
      | ancestry | ancestor |
      | changed-path | evidence-only |
      | artifact-sha | sha256 |
      | blob-oid | blob OID |
      | source | trusted GitHub provider |
      | repository | repository |
      | implementation-sha | implementation commit SHA |
      | implementation-author | implementation commit author |
      | pr-id | PR number |
      | run-id | run ID |
      | review-id | review ID |
      | pr-head | PR head |
      | ci-head | CI head |
      | ci-event | pull_request event |
      | run-pr | Actions runのPR number |
      | empty-run-pr | Actions runのPR number |
      | ci-conclusion | CI conclusion |
      | reviewer-commit | review metadata commit |
      | reviewer-actor | stable actor |
      | pr-author-review | PR authorと独立 |
      | implementer-review | observed implementation commit authorと独立 |
      | submitted-at | submittedAt |
      | verdict | approved verdict |

  Scenario: SCN-UNIT-REVIEW-013 tracked Phase A artifactはH_final後に更新しない
    Given tracked Phase A review recordを読む
    When Phase A artifactのimmutable契約を検査する
    Then H_final後は更新せず外部attestationだけで完了すると明記されている

  Scenario: SCN-UNIT-POLICY-001 package defaultはPR停止かつmerge disabledである
    Given package default policyを読み込む
    When policyを検証する
    Then policyはvalidである
    And delivery stopはpull_requestである
    And merge modeはdisabledである

  Scenario Outline: SCN-UNIT-POLICY-002 merge policyへ別操作の権限を混入できない
    Given package default policyを読み込む
    And merge policyの<操作>をtrueにする
    When policyを検証する
    Then policyはinvalidである

    Examples:
      | 操作 |
      | deleteBranch |
      | closeIssue |
      | release |
      | finalize |
      | cleanup |

  Scenario: SCN-UNIT-POLICY-003 unknown merge modeを拒否する
    Given package default policyを読み込む
    And merge modeを"trust-me"にする
    When policyを検証する
    Then policyはinvalidである

  Scenario: SCN-UNIT-POLICY-004 schemaから逸脱する未知fieldと配列値を拒否する
    Given package default policyを読み込む
    And policyへ未知fieldと不正な配列値を混入する
    When policyを検証する
    Then policyはinvalidである
    And policy schema逸脱をすべて報告する

  Scenario: SCN-UNIT-POLICY-005 feature commitをPR base SHAとして自己申告できない
    Given remote default branchから分岐したfeature commitがある
    When feature commitをtrusted commitとexpected base SHAの両方へ指定する
    Then explicit trusted authorityはremote default branchへ拘束されて拒否される

  Scenario: SCN-UNIT-PACKAGE-001 Step 0〜11にそれぞれ1つのskill contractがある
    Given v0.3 package assetを走査する
    When skill contractを数える
    Then Step 0〜11が重複なくすべて存在する

  Scenario: SCN-UNIT-PACKAGE-002 gh process callはGitHub adapterだけに存在する
    Given runtime sourceを走査する
    When gh process callの所在を検査する
    Then GitHub adapter以外の違反fileは0件である

  Scenario: SCN-UNIT-PACKAGE-003 legacy非template assetへのruntime importがない
    Given runtime sourceを走査する
    When legacy runtime importを検査する
    Then legacy import違反fileは0件である

  Scenario: SCN-UNIT-PACKAGE-004 ADRは将来拡張点だけでsubsystemを持たない
    Given v0.3 package assetを走査する
    When ADR実装assetを検査する
    Then ADR domain、template、CLI、gateは存在しない

  Scenario: SCN-UNIT-PACKAGE-005 固定の人向け文書は連番付き日本語file名で統一する
    Given v0.3 package assetを走査する
    When 固定の人向けMarkdown file名を検査する
    Then 連番付き日本語file名の違反は0件である

  Scenario: SCN-UNIT-PACKAGE-006 repository直下は短いAGENTS入口だけにする
    Given v0.3 package assetを走査する
    When 規範文書の配置を検査する
    Then repository直下の規範文書はAGENTSだけである
    And namespace配下に連番付き規範文書が3件ある

  Scenario: SCN-UNIT-PACKAGE-007 英語だけの人向けMarkdownを形式検査で拒否する
    Given 英語だけの人向けMarkdownがある
    When 日本語文書形式検査を実行する
    Then 日本語文書形式検査は失敗する

  Scenario: SCN-UNIT-PACKAGE-008 project選択の全test layerとnon-override安全境界をtemplate・運用仕様で保持する
    Given v0.3 package assetを走査する
    When project選択層とfalse block対応の文書契約を検査する
    Then 全test layerは層ごとに追跡されnon-override denyは弱化されない

  Scenario: SCN-UNIT-PACKAGE-009 汎用runtimeとtemplateへrepository固有rule ID・固定表示値を混入しない
    Given package所有runtimeと変更済みtemplateを走査する
    When repository固有IDと固定表示labelを検査する
    Then 汎用packageの所有境界違反は0件である

  Scenario: SCN-UNIT-PACKAGE-010 review templateは全変更fileの個別監査を要求する
    Given review templateとPR事前確認を読む
    When 全変更file監査契約を検査する
    Then 1ファイル1行と差分path集合完全一致が必須である

  Scenario: SCN-UNIT-PACKAGE-011 個別監査gateはGit差分と1ファイル1行を完全照合する
    Given H_implの全変更pathと一致する個別監査artifactがある
    When 個別監査gateを正規表と余分なpathで検証する
    Then 正規表だけが合格し余分なpathと空差分基点は拒否される

  Scenario: SCN-UNIT-PACKAGE-012 製品versionはpackage.jsonを正本としpolicy patch移行と一致する
    Given package metadataとpolicy version artifactがある
    When version正本との一致を検証する
    Then 製品は0.3.1 betaでpolicyはv0.3.0からv0.3.1へ移行する

  Scenario: SCN-UNIT-PACKAGE-013 全Step skillは正確なtemplateと成果物へ拘束される
    Given packageのStep skillとtemplate契約がある
    When 正規契約とリンク切れ・対応漏れ・経路欠落契約を検証する
    Then 正規契約だけが合格しリンク切れ・対応漏れ・経路欠落は拒否される

  Scenario: SCN-UNIT-PACKAGE-014 全directoryはownerと使い方が分かる入口文書を持つ
    Given packageのdirectory利用案内契約がある
    When 正規契約と入口欠落・未知directory・リンク切れ契約を検証する
    Then 正規契約だけが合格し入口欠落・未知directory・リンク切れは拒否される
