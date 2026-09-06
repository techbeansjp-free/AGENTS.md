@integration
Feature: Issue stagingとsystem specificationを安全に統合する

  Background:
    Given Q-01〜Q-08がすべてtrueで、それぞれに根拠がある

  Scenario: SCN-INT-ISSUE-001 GitHub remoteなしでもlocal planningを作成できる
    Given GitHub remoteを持たない一時repositoryがある
    When title "小さな修正"でissue stagingを作成する
    Then modeはquickである
    And stagingは".agent-skill-chain/tmp/issues"配下にある
    And durabilityとsyncedはfalseである
    And 00_要求定義.mdが存在する
    And staging記録がlocal-activeで存在する

  Scenario: SCN-INT-ISSUE-002 同時作成先のcollisionでも既存内容を保持する
    Given GitHub remoteを持たない一時repositoryがある
    And title "same"で同じ時刻のstagingを作成済みである
    And staging内に"keep"というsentinelがある
    When 同じtitleと時刻で再作成する
    Then atomic createは失敗する
    And sentinel内容は"keep"のままである
    And pending directoryは残らない

  Scenario: SCN-INT-ISSUE-003 quick stagingでdependency変更を検出したらfull補完を要求する
    Given GitHub remoteを持たない一時repositoryがある
    And quick stagingを作成済みである
    When changed file "package.json"でissueを検証する
    Then validation modeはfullである
    And validationはinvalidである
    And errorに単調昇格が含まれる

  Scenario: SCN-INT-ISSUE-004 unsafe titleの失敗時にpartial stagingを残さない
    Given GitHub remoteを持たない一時repositoryがある
    When unsafe title "../bad"でissue stagingを作成する
    Then atomic createは失敗する
    And staging rootにentryは0件である

  Scenario: SCN-INT-ISSUE-005 未解決placeholderが残る00は構造validにしない
    Given GitHub remoteを持たない一時repositoryがある
    And quick stagingを作成済みである
    When changed fileなしでissueを検証する
    Then validationはinvalidである
    And errorにplaceholderが含まれる

  Scenario: SCN-INT-ISSUE-006 staging prefixは実行環境によらず日本標準時を使う
    Given local time比較用の同一instantがある
    When UTC環境とAsia/Tokyo環境のissue stagingを作成する
    Then UTCのprefixは"20260823_003045"である
    And Asia/Tokyoのprefixは"20260823_003045"である

  Scenario: SCN-INT-SPEC-001 新規CLI projectはcodeより先に体系化したsystem specificationを生成する
    Given 空の新規project directoryがある
    When CLI project bootstrapをapplyする
    Then docs specsの必須16カテゴリと固定文書が存在する
    And 画面とdesignとlayoutのカテゴリは存在しない
    And spec validationはvalidである

  Scenario: SCN-INT-SPEC-002 UI projectは画面とtoken specificationも生成する
    Given 空の新規project directoryがある
    When UI project bootstrapをapplyする
    Then 画面とdesignとlayoutのカテゴリが存在する

  Scenario: SCN-INT-SPEC-003 既存projectへ明示onboardingなしでretrofitしない
    Given 既存project directoryがある
    When onboardingなしでbootstrapをapplyする
    Then bootstrapは失敗する
    And docs specsは存在しない

  Scenario: SCN-INT-SPEC-004 bootstrap dry-runはfileを書かない
    Given 空の新規project directoryがある
    When UI project bootstrapをdry-runする
    Then bootstrap resultはpreviewである
    And docs directoryは存在しない

  Scenario: SCN-INT-SPEC-005 architecture変更をno-spec-impactで通さない
    Given 必須specを持つCLI projectがある
    When architecture file変更をno-spec-impactで検証する
    Then spec validationはinvalidである

  Scenario: SCN-INT-SPEC-006 文言変更は根拠付きno-spec-impactで空更新せず通す
    Given 必須specを持つCLI projectがある
    And spec indexの更新時刻を記録する
    When README文言変更を根拠付きno-spec-impactで検証する
    Then spec validationはvalidである
    And spec indexの更新時刻は変わらない

  Scenario: SCN-INT-SPEC-007 既存内容があるprojectをnewと自己申告しても上書きしない
    Given 既存project directoryがある
    When new projectと申告してbootstrapをapplyする
    Then bootstrapは失敗する
    And docs specsは存在しない

  Scenario: SCN-INT-SPEC-008 bootstrapした仕様は連番付き日本語文書として読める
    Given 空のCLI project directoryがある
    When CLI project bootstrapをapplyする
    Then 生成した仕様file名は連番付き日本語である
    And 生成した仕様本文は日本語文書形式検査に合格する

  Scenario: SCN-INT-SPEC-009 system specification templateは大規模開発の主要観点と図を備える
    Given 空の新規project directoryがある
    When UI project bootstrapをapplyする
    Then 機能と画面とAPIとdataとbatchとnetworkの個別仕様templateが存在する
    And 画面遷移と処理sequenceとERとnetworkのMermaid記入欄が存在する

  Scenario: SCN-INT-SPEC-010 API projectは必須仕様を生成してUI専用カテゴリを生成しない
    Given 空の新規project directoryがある
    When API project bootstrapをapplyする
    Then docs specsの必須16カテゴリと固定文書が存在する
    And 画面とdesignとlayoutのカテゴリは存在しない

  Scenario Outline: SCN-INT-SPEC-011 振る舞い・安全・policy変更をno-spec-impactで通さない
    Given 必須specを持つCLI projectがある
    When <変更file>変更をno-spec-impactで検証する
    Then spec validationはinvalidである

    Examples:
      | 変更file |
      | "src/cli.ts" |
      | "src/lib/security.ts" |
      | ".agent-skill-chain/schemas/project-policy.schema.json" |
      | ".agent-skill-chain/skills/step-10-review/SKILL.md" |

  Scenario: SCN-INT-SPEC-012 ドメイン用語台帳は現在有効な一意のコンテキスト語彙だけを受理する
    Given 必須specを持つCLI projectがある
    When 有効行と重複IDと同一context重複とcandidateと置換先なし廃止を検証する
    Then 有効な用語行だけが合格し不正な用語台帳はすべて拒否される

  Scenario: SCN-INT-SPEC-013 変更履歴が名指しする未登録の用語IDを拒否する
    Given 必須specを持つCLI projectがある
    When 変更履歴の用語ID列と台帳の突合を検証する
    Then 未登録の名指しと範囲記法だけが拒否され逆方向は要求されない

  Scenario: SCN-INT-SPEC-014 用語ID列の範囲記法を拒否する
    Given 必須specを持つCLI projectがある
    When 変更履歴の用語ID列と台帳の突合を検証する
    Then 未登録の名指しと範囲記法だけが拒否され逆方向は要求されない

  Scenario: SCN-INT-SPEC-015 台帳にあり変更履歴に無い用語を拒否しない
    Given 必須specを持つCLI projectがある
    When 変更履歴の用語ID列と台帳の突合を検証する
    Then 未登録の名指しと範囲記法だけが拒否され逆方向は要求されない
