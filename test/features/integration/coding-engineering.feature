@integration
Feature: Coding Engineeringを工程を増やさず配布する

  Scenario: SCN-INT-CODING-1552-001 内部skillを追加してもStepは12件で参照が解決する
    Given Coding Engineeringを含む隔離package資産がある
    When Coding Engineeringの配布参照を検証する
    Then 内部skillの参照とdirectory入口は有効でStepは12件である

  Scenario: SCN-INT-CODING-1552-002 選択されるLensが欠落した配布物を拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When 冪等性Lensを欠落させて配布参照を検証する
    Then 欠落したLensへの到達不能を報告する

  Scenario: SCN-INT-CODING-1552-003 未登録skillを内部skillとして暗黙に許可しない
    Given Coding Engineeringを含む隔離package資産がある
    When 未登録skillを追加して配布参照を検証する
    Then skillの正規集合違反を報告する

  Scenario: SCN-INT-CODING-1552-004 Lensからの境界外参照を拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When Lensにpackage境界外参照を追加して配布参照を検証する
    Then Lensの不正な参照先を報告する

  Scenario: SCN-INT-CODING-1552-005 タイトル付きLens参照も境界外なら拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When Lensにタイトル付き境界外参照を追加して配布参照を検証する
    Then Lensの不正な参照先を報告する

  Scenario Outline: SCN-INT-CODING-1552-006 Step 9から実装skillへの有効な接続が欠落すると拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When Step 9のCoding Engineering"<入口>"参照を"<状態>"にして配布参照を検証する
    Then Step 9からCoding Engineeringへの接続欠落を報告する

    Examples:
      | 入口 | 状態 |
      | 本文 | 削除 |
      | 本文 | コメント |
      | 本文 | コード例 |
      | 本文 | インラインコード |
      | 索引 | 削除 |
      | 索引 | コメント |
      | 索引 | コード例 |
      | 索引 | インラインコード |

  Scenario Outline: SCN-INT-CODING-1552-007 low-risk localではCoding Engineering追加読取を要求しない
    Given Coding Engineeringを含む隔離package資産がある
    When Step 9のrouting契約を"<変更>"に変更する
    Then 入口を維持していてもrouting契約違反を報告する

    Examples:
      | 変更 |
      | local本文必読 |
      | local索引必読 |
      | localLens必読 |
      | 全変更で本文必読 |

  Scenario: SCN-INT-CODING-1552-008 boundedでは本文を要求しない
    Given Coding Engineeringを含む隔離package資産がある
    When Step 9のrouting契約を"bounded本文必読"に変更する
    Then 入口を維持していてもrouting契約違反を報告する

  Scenario Outline: SCN-INT-CODING-1552-009 risk不明ではlow-risk経路へ入れない
    Given Coding Engineeringを含む隔離package資産がある
    When Step 9のrouting契約を"<変更>"に変更する
    Then 入口を維持していてもrouting契約違反を報告する

    Examples:
      | 変更 |
      | risk不明を軽量経路へ |
      | risky優先を削除 |

  Scenario Outline: SCN-INT-CODING-1552-010 soft budget超過だけを停止条件にしない
    Given Coding Engineeringを含む隔離package資産がある
    When Step 9のrouting契約を"<変更>"に変更する
    Then 入口を維持していてもrouting契約違反を報告する

    Examples:
      | 変更 |
      | hard limit化 |
      | soft budgetをコメント化 |
      | soft budgetをコード例化 |

  Scenario: SCN-INT-CODING-1552-011 routingの空白と改行だけの変更は許容する
    Given Coding Engineeringを含む隔離package資産がある
    When Step 9のroutingを空白とCRLFだけ変更する
    Then 内部skillの参照とdirectory入口は有効でStepは12件である

  Scenario Outline: SCN-INT-CODING-1552-012 routing節外のCoding Engineering読取指示を拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When routing節の"<位置>"に"<形式>"の"<入口>"読取指示を追加する
    Then routing節を維持していても読取指示の所有権違反を報告する

    Examples:
      | 位置 | 形式 | 入口 |
      | 前 | link | 本文 |
      | 前 | link | 索引 |
      | 後 | link | 本文 |
      | 後 | link | 索引 |
      | 前 | 平文 | 本文 |
      | 後 | 平文 | 索引 |
      | 前 | タイトル付きlink | 本文 |
      | 後 | 参照link | 索引 |
      | 前 | inline path | 本文 |
      | 後 | link | Lens |

  Scenario Outline: SCN-INT-CODING-1552-013 routing節外の非実行例は読取指示と扱わない
    Given Coding Engineeringを含む隔離package資産がある
    When routing節の"後"に"<形式>"の"本文"読取指示を追加する
    Then 内部skillの参照とdirectory入口は有効でStepは12件である

    Examples:
      | 形式 |
      | コメント |
      | fenced例 |

  Scenario Outline: SCN-INT-CODING-1552-014 Lensの参照形式linkも境界外なら拒否する
    Given Coding Engineeringを含む隔離package資産がある
    When Lensに"<形式>"の境界外参照定義を追加する
    Then Lensの不正な参照先を報告する

    Examples:
      | 形式 |
      | 通常 |
      | 山括弧とtitle |
      | destination改行 |

  Scenario: SCN-INT-CODING-1552-015 Lensのpackage内参照定義は許可する
    Given Coding Engineeringを含む隔離package資産がある
    When Lensにpackage内参照定義を追加する
    Then 内部skillの参照とdirectory入口は有効でStepは12件である
