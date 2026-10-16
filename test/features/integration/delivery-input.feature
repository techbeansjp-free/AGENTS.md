@integration
Feature: review済みGit要約からPR入力を決定論的に生成する

  Scenario: SCN-INT-DELIVERYINPUT-001 正式観測と固定Git要約でlegacyと同じpreview gateを通す
    Given review済みdelivery summaryと正式検証を持つ隔離projectがある
    When 要約入力と生成済みlegacy入力でPRをpreviewする
    Then 同じpreview結果となりGitとstagingとproviderに書き込まない

  Scenario Outline: SCN-INT-DELIVERYINPUT-002 未review入力や不整合な証拠は拒否する
    Given review済みdelivery summaryと正式検証を持つ隔離projectがある
    When delivery summaryに「<case>」を与えてPRをpreviewする
    Then summary previewは安全gateで拒否される

    Examples:
      | case                 |
      | uncommitted-path     |
      | head-changed         |
      | seal-changed         |
      | missing-review       |
      | latest-failed        |
      | exclusive-input      |
      | old-review           |
      | tampered-review      |
      | tampered-summary     |

  Scenario: SCN-INT-DELIVERYINPUT-003 worktree要約の改変を正式Git入力へ混ぜない
    Given review済みdelivery summaryと正式検証を持つ隔離projectがある
    When worktreeの要約だけを書き換えて機械入力を導出する
    Then review済みGit本文だけが出力される

  Scenario Outline: SCN-INT-DELIVERYINPUT-004 形式上review済みでも申告と固定成果物の矛盾を拒否する
    Given 「<case>」の仕様・検証申告を含む要約がreviewされた隔離projectがある
    When 不正申告の要約でPRをpreviewする
    Then summary previewは安全gateで拒否される

    Examples:
      | case                 |
      | spec-change-no-spec  |
      | nonexistent-scenario |
      | scenario-reference   |
      | feature-reference    |
      | generic-comment      |
      | backtick-docstring   |
      | quote-docstring      |
      | raw-backtick-docstring |
      | raw-background-docstring |
      | missing-test-source  |
      | self-reference       |
      | missing-requirement  |
      | unclassified-owner   |
      | invalid-owner-layer  |

  Scenario: SCN-INT-DELIVERYINPUT-005 正式仕様と実在testへ追跡するupdated申告を受理する
    Given 「valid-updated」の仕様・検証申告を含む要約がreviewされた隔離projectがある
    When 要約入力と生成済みlegacy入力でPRをpreviewする
    Then 同じpreview結果となりGitとstagingとproviderに書き込まない

  Scenario: SCN-INT-DELIVERYINPUT-006 native runnerでも正式計画のSCNと固定test根拠を利用できる
    Given 「valid-native」の仕様・検証申告を含む要約がreviewされた隔離projectがある
    When 要約入力と生成済みlegacy入力でPRをpreviewする
    Then 同じpreview結果となりGitとstagingとproviderに書き込まない
