@unit
Feature: Planningの固定上流参照

  Scenario Outline: SCN-PRAT-015 参照候補の空白改行と引用で不正参照を通さない: <本文>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの"概要"本文を"<本文>"にする
    And Planning参照を検証する
    Then Planning参照は"拒否"になる

    Examples:
      | 本文 |
      | 概要を03_実装計画.md §9を参照 |
      | 概要を03_実装計画.md§9を参照 |
      | 概要を03_実装計画.md\n§9を参照 |
      | 概要を03_実装計画.md\t§9を参照 |
      | 概要\nを\n03_実装計画.md\n§9を参照 |
      | `概要を03_実装計画.md§9を参照` |
      | `概要を../未知.md\n§9を参照` |
      | 概要は00_要求定義.md§99を参照 |
      | 概要は00_要求定義.md\n§1・§2を参照 |
      | 概要を03_実装計画.mdを参照 |
      | 概要は§99を参照 |
      | 概要を03_実装計画.md\n§9を\n参照 |
      | 概要は未知資料を参照 |
      | 03_実装計画.md§9を参照 |
      | `03_実装計画.md§9を参照` |

  Scenario Outline: SCN-PRAT-016 source表の項目名を判断内容に数えない: <値>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningのsource表の値を"<値>"にする
    And Planning参照を検証する
    Then Planning参照は"<判定>"になる

    Examples:
      | 値 | 判定 |
      | | 拒否 |
      | - | 拒否 |
      | 01_要件定義.mdを参照 | 拒否 |
      | 01_要件定義.md§1を参照 | 拒否 |
      | 01_要件定義.md\t§1を参照 | 拒否 |
      | `コンテキストは00_要求定義.md §4.1を参照` | 拒否 |
      | `Planning` | 拒否 |
      | Planning | 合格 |
      | Planning参照の構造検査を対象とする。 | 合格 |
      | #1514 shardingは対象外。 | 合格 |
      | Planningが所有する。詳細は01_要件定義.mdを参照。 | 合格 |

  Scenario Outline: SCN-PRAT-017 生のtarget本文から余分な内容を消して参照を成立させない: <追記>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの概要markerに"<追記>"を付け足す
    And Planning参照を検証する
    Then Planning参照は"拒否"になる

    Examples:
      | 追記 |
      | \n\n```text\n同期権限を変更する。\n``` |
      | \n`同期権限を変更する。` |
      | \n<!-- 同期権限を変更する。 --> |
      | <!-- 同期権限を変更する。 --> |
      | `同期権限を変更する。` |
      | \n> 同期権限を変更する。 |
      | \n### 1.1 補足\n同期権限を変更する。 |

  Scenario Outline: SCN-PRAT-018 詳細本文の補足参照を改行の有無でmarkerにしない: <本文>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの"コンテキスト"本文を"<本文>"にする
    And Planning参照を検証する
    Then Planning参照は"合格"になる

    Examples:
      | 本文 |
      | コンテキストはPlanningでありownerはprojectである。詳細は00_要求定義.md §4.1を参照。 |
      | コンテキストはPlanningでありownerはprojectである。\n詳細は00_要求定義.md §4.1を参照。 |
      | コンテキストはPlanningでありownerはprojectである。詳細は00_要求定義.md\n§4.1を参照。 |
      | コンテキストはPlanning参照の構造を検証する。 |

  Scenario Outline: SCN-PRAT-019 sourceの具体文と参照だけの文を区別する: <本文>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの"source"本文を"<本文>"にする
    And Planning参照を検証する
    Then Planning参照は"<判定>"になる

    Examples:
      | 本文 | 判定 |
      | Planning参照の構造検査を対象とする。 | 合格 |
      | Planningの構造検査を対象とする。 | 合格 |
      | #1514 shardingは対象外。 | 合格 |
      | Issue #1514 shardingは対象外。 | 合格 |
      | Planningが所有する。詳細は01_要件定義.mdを参照。 | 合格 |
      | Planningが所有する。\n詳細は01_要件定義.mdを参照。 | 合格 |
      | 01_要件定義.md\n§1を参照 | 拒否 |
      | 01_要件定義.md§1を参照 | 拒否 |
      | 01_要件定義.mdを参照。 | 拒否 |
      | 詳細は01_要件定義.md §1を参照。 | 拒否 |
      | 01_要件定義.md\n§1を\n参照 | 拒否 |
      | 01_要件定義.md§1を参照\n03_実装計画.md§9を参照 | 拒否 |
      | 01_要件定義.md§1を参照\nPlanningを対象とする。 | 合格 |
      | ### 内容 | 拒否 |

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
      | 変更                |
      | source symlink      |
      | source欠落          |
      | source空            |
      | sourceラベルのみ    |
      | source表の値だけ空  |
      | source表が参照のみ  |
      | sourceplaceholder   |
      | source参照のみ      |
      | source重複          |
      | target重複          |
      | target欠落          |
      | 自己参照            |
      | 後方参照            |
      | を使う後方参照      |
      | を使う自己参照      |
      | を使う既知参照先    |
      | を使う対象外参照    |
      | を使うコンテキスト参照 |
      | を使う連鎖          |
      | 未知path            |
      | 未知節              |
      | Unicode類似         |
      | 連鎖                |
      | 余分な本文          |
      | 許可節外            |
      | code内              |
      | comment内           |
      | comment内の偽見出し |
      | code内の偽見出し    |
      | 引用内              |
      | DC空                |
      | SCNなし             |
      | source必須欄なし    |

  Scenario Outline: SCN-PRAT-010 既知固定文の説明用引用と実参照を区別する: <記法>/<形式>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planning参照に"<形式>"の変更を加える
    And Planningに"<記法>"の説明用引用を加える
    And Planning参照を検証する
    Then Planning参照は"合格"になる

    Examples:
      | 記法           | 形式     |
      | 概要           | 詳細形式 |
      | 対象外         | 詳細形式 |
      | コンテキスト   | 詳細形式 |
      | 概要           | 参照形式 |
      | 対象外         | 参照形式 |
      | コンテキスト   | 参照形式 |
      | 概要           | 詳細本文内で引用 |

  Scenario Outline: SCN-PRAT-011 引用だけではsourceの判断やtargetの参照が成立しない: <側>/<記法>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの"<側>"を"<記法>"の引用だけにする
    And Planning参照を検証する
    Then Planning参照は"拒否"になる

    Examples:
      | 側     | 記法         |
      | source | 概要         |
      | source | 対象外       |
      | source | コンテキスト |
      | target | 概要         |
      | target | 対象外       |
      | target | コンテキスト |

  Scenario Outline: SCN-PRAT-013 引用だけの節を不可視領域や詳細形式で通さない: <側>/<変更>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningの"<側>"を"概要"の引用だけにする
    And Planning参照に"<変更>"の変更を加える
    And Planning参照を検証する
    Then Planning参照は"拒否"になる

    Examples:
      | 側     | 変更           |
      | source | 詳細形式       |
      | source | 引用をfence化   |
      | target | 引用をfence化   |
      | source | 引用をcomment化 |
      | target | 引用をcomment化 |

  Scenario: SCN-PRAT-014 説明用引用を消してtargetの単独本文を作らない
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planning参照に"実参照と同じ節に引用"の変更を加える
    And Planning参照を検証する
    Then Planning参照は"拒否"になる

  Scenario Outline: SCN-PRAT-012 説明用引用の許可を未知形式や裸markerへ広げない: <変更>
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When Planningに"概要"の説明用引用を加える
    And Planningの説明に"<変更>"の不正markerを加える
    And Planning参照を検証する
    Then Planning参照は"拒否"になる

    Examples:
      | 変更                  |
      | 未知path引用          |
      | 未知節引用            |
      | 二重backtick          |
      | 開始二重backtick      |
      | 終了二重backtick      |
      | 閉じ引用なし          |
      | 余分な引用本文        |
      | 引用内改行            |
      | 裸marker              |
      | fence内の裸marker     |
      | comment内の裸marker   |
      | blockquote内の裸marker |
      | を使う後方参照の引用 |
      | を使う未知pathの引用 |
      | を使う後方参照のfence |
      | を使う後方参照のcomment |
      | を使う後方参照のblockquote |
