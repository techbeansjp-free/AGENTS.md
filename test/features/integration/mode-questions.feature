@integration @mode-questions
Feature: モード判定質問の規範文書との相互一致
  人が読む規範文書と機械可読な定義が一致し、第3の箇所への複製を拒否する。

  Scenario: SCN-INT-MODEQ-002 製品repositoryで整合検査が合格する
    Given 製品repositoryがある
    When モード判定質問の整合を検査する
    Then モード判定質問の整合検査は合格する

  Scenario: SCN-INT-MODEQ-009 規範文書の質問文を書き換えると失敗する
    Given 規範文書の質問文を1文字書き換えた隔離repository
    When 隔離repositoryのモード判定質問の整合を検査する
    Then 整合検査は規範文書との不一致を示して失敗する

  Scenario: SCN-INT-MODEQ-010 規範文書の分類を付け替えると失敗する
    Given 規範文書の分類を2つ入れ替えた隔離repository
    When 隔離repositoryのモード判定質問の整合を検査する
    Then 整合検査は規範文書との不一致を示して失敗する

  Scenario: SCN-INT-MODEQ-001 質問文を第3のfileへ書くと失敗する
    Given 質問文を別の追跡fileへ書いた隔離repository
    When 隔離repositoryのモード判定質問の整合を検査する
    Then 整合検査は許可外のfileを示して失敗する

  Scenario: SCN-INT-MODEQ-008 追跡fileの列挙が失敗すると拒否する
    Given 規範文書をそのまま持つ隔離repository
    When 追跡fileの列挙が失敗する状態でモード判定質問の整合を検査する
    Then 整合検査は追跡fileを列挙できないことを示して失敗する

  Scenario: SCN-INT-MODEQ-004 適合性検査の戻り値のkey集合が変わらない
    Given 製品repositoryがある
    When 適合性検査の公開関数の戻り値を確認する
    Then 戻り値のkey集合が従来と一致する

  Scenario: SCN-INT-MODEQ-011 整合検査が公開入口のerrors収集へ合成されている
    Given 適合性検査scriptがある
    When 適合性検査scriptの合成箇所を読む
    Then モード判定質問の整合検査が公開入口のerrorsへ合成されている
