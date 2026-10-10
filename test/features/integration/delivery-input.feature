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

  Scenario: SCN-INT-DELIVERYINPUT-003 worktree要約の改変を正式Git入力へ混ぜない
    Given review済みdelivery summaryと正式検証を持つ隔離projectがある
    When worktreeの要約だけを書き換えて機械入力を導出する
    Then review済みGit本文だけが出力される
