@unit
Feature: 実行entry判定をsymlink経由の起動でも成立させる

  # 全fileの構造的な担保はSCN-UNIT-ENTRY-002〜005が持つ。ここは実挙動の代表点だけを
  # 確認する。gate scriptを子processで起動する検査は高価で、conformanceは単体で約70秒
  # かかる。網羅を挙動側へ寄せると支援層の所要時間が成果物構築を上回る。
  Scenario Outline: SCN-UNIT-ENTRY-001 symlink経由で起動しても検査が走る
    Given "<script>"へのsymlinkを用意する
    When symlink経由でgate scriptを実行する
    Then gate scriptの出力は空でない

    Examples:
      | script |
      | check_japanese_docs.ts |
      | check_directory_guides.ts |

  Scenario: SCN-UNIT-ENTRY-002 実行entry判定の直接比較を拒否する
    Given 実行entry判定を直接比較するsourceがある
    When 実行entry判定の検査を実行する
    Then 実行entry判定の検査は直接比較を報告する

  Scenario: SCN-UNIT-ENTRY-003 実行entry判定の手書きを拒否する
    Given 実行entry判定を手書きするsourceがある
    When 実行entry判定の検査を実行する
    Then 実行entry判定の検査は手書きを報告する

  Scenario: SCN-UNIT-ENTRY-004 正本moduleは検査の対象外にする
    Given 正本moduleのsourceがある
    When 実行entry判定の検査を実行する
    Then 実行entry判定の検査は合格する

  Scenario: SCN-UNIT-ENTRY-005 共有helperを使うsourceを受理する
    Given 共有helperを使うsourceがある
    When 実行entry判定の検査を実行する
    Then 実行entry判定の検査は合格する

  Scenario: SCN-UNIT-ENTRY-006 test資産は判定の対象外にする
    Given 実行entry判定を直接比較するsourceがある
    When test資産として実行entry判定の検査を実行する
    Then 実行entry判定の検査は合格する
