@unit @lifecycle-ignore
Feature: 一時ライフサイクル領域の分類正本
  領域一覧を唯一の正本とし、判定と各利用箇所の照合をそこから導出する。

  Scenario: SCN-UNIT-LIFEIGNORE-001 整合検査が領域も除外一覧も自前で書いていない
    Given 一時ライフサイクル検査を含む適合性検査scriptがある
    When 適合性検査scriptのsourceを読む
    Then 領域prefixも除外一覧も自前で列挙していない

  Scenario: SCN-UNIT-LIFEIGNORE-002 領域判定の真偽値が変更前と一致する
    Given 領域判定の代表入力がある
    When 領域判定を実行する
    Then 領域そのものと配下は真、境界の違うpathと無関係なpathは偽になる

  Scenario: SCN-UNIT-LIFEIGNORE-004 除外一覧から領域が欠けていると失敗する
    Given 除外一覧から1領域を落とした照合入力がある
    When 配布物除外の照合を実行する
    Then 欠けている領域を示して失敗する

  Scenario: SCN-UNIT-LIFEIGNORE-005 領域だけを増やして除外一覧へ足さないと失敗する
    Given 領域一覧にだけ新領域を足した照合入力がある
    When 配布物除外の照合を実行する
    Then 欠けている領域を示して失敗する

  Scenario: SCN-UNIT-LIFEIGNORE-006 全領域が除外一覧にあれば合格する
    Given 実際の領域一覧と除外一覧がある
    When 配布物除外の照合を実行する
    Then 照合は成功する

  Scenario: SCN-UNIT-LIFEIGNORE-007 配布物検査moduleのimportで外部commandが起動しない
    Given 外部command起動を記録する偽commandを先頭に置いた子processを用意する
    When 子processを実行する
    Then 外部commandの起動記録が1件も無い

  Scenario: SCN-UNIT-LIFEIGNORE-009 公開した一覧がruntimeで変更できない
    Given 公開された領域一覧と除外一覧がある
    When 凍結状態を確認する
    Then どちらも凍結されている

  Scenario: SCN-UNIT-LIFEIGNORE-010 package禁止entry一覧から領域が欠けていると失敗する
    Given package禁止entry一覧から1領域を落とした照合入力がある
    When package禁止entryの照合を実行する
    Then 欠けている領域をpackage禁止entryとして示して失敗する

  Scenario: SCN-UNIT-LIFEIGNORE-011 全領域がpackage禁止entry一覧にあれば合格する
    Given 実際の領域一覧とpackage禁止entry一覧がある
    When package禁止entryの照合を実行する
    Then 照合は成功する

  Scenario: SCN-UNIT-LIFEIGNORE-012 symlink経由で起動しても配布物検査が走る
    Given 配布物検査moduleへのsymlinkを用意する
    When symlink経由で子processを実行する
    Then 出力にパッケージ内容検査の結果が現れる
