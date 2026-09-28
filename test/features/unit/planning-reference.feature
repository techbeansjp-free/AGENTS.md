@unit
Feature: Planningの固定上流参照

  Scenario: SCN-PRAT-020 実際の封印済みPlanningの3対象節だけを短縮しても互換性を保つ
    Given Issue1523の封印済みPlanningの固定snapshotがある
    When Planningの3対象節だけを正規の固定参照に置き換える
    And Planning参照を検証する
    Then Planning参照は"合格"になる

  Scenario: SCN-PRAT-001 同stagingの具体的な00へ3つの固定参照を使う
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planning参照を検証する
    Then Planning参照は"合格"になる

  Scenario Outline: SCN-PRAT-008 旧詳細形式とDC参照を維持する: <形式>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planning参照に"<形式>"の変更を加える
    And Planning参照を検証する
    Then Planning参照は"合格"になる

    Examples:
      | 形式               |
      | 詳細形式           |
      | 詳細形式の補足参照 |

  Scenario Outline: SCN-PRAT-009 上流参照の不正と既存必須検証の欠落を拒否する: <変更>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planning参照に"<変更>"の変更を加える
    And Planning参照を検証する
    Then Planning参照は"拒否"になる

    Examples:
      | 変更 |
      | source symlink |
      | source file欠落 |
      | source欠落 |
      | source空 |
      | 概要source空 |
      | コンテキストsource欠落 |
      | source見出しのみ |
      | source code/commentのみ |
      | sourceplaceholder |
      | source重複 |
      | target重複 |
      | DC空 |
      | SCNなし |
      | source必須欄なし |

  Scenario: SCN-PRAT-022 正規3形の外側空白だけをtrimする
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planning参照に"外側空白"の変更を加える
    And Planning参照を検証する
    Then Planning参照は"合格"になる

  Scenario Outline: SCN-PRAT-023 非正規形は参照解決せず既存の成功失敗を保つ: <形式>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの非正規形"<形式>"はsourceを解決せずlegacy判定を保つ
    Then Planningの比較検証が完了する

    Examples:
      | 形式 |
      | 引用 |
      | fence |
      | comment |
      | 強調 |
      | list |
      | 表 |
      | blockquote |
      | 未知path |
      | 未知節 |
      | 内部改行 |
      | comment追記 |
      | 本文追記 |
      | 子見出し |
      | 自然言語 |
      | 別節 |
      | 別file |
      | target欠落 |
      | fence内見出し |
      | comment内見出し |

  Scenario Outline: SCN-PRAT-024 sourceの意味的十分性を新しい文法で判定しない: <本文>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningのsource最小本文を"<本文>"にする
    And Planning参照を検証する
    Then Planning参照は"合格"になる

    Examples:
      | 本文 |
      | 担当: |
      | 他文書を参照 |
      | - |
      | > 担当: |
      | \| 項目 \| 内容 \|\n\|---\|---\|\n\| 担当 \| \| |
      | **担当:** |
      | 設計対象外は00_要求定義.md §2.2を参照 |
      | 設計対象外は03_実装計画.md §9を参照 |

  Scenario Outline: SCN-PRAT-025 quickとpocは正規文でもD1を適用しない: <mode>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの"<mode>"判定を詳細形式と比較する
    Then Planningの比較検証が完了する

    Examples:
      | mode |
      | quick |
      | poc |
