@unit
Feature: session logのtoken集計
  Claude Code session logからsession・subagent・Step別のtoken指標を本文なしで出す。

  Scenario: SCN-UNIT-TOKENS-001 session logからtoken指標を集計する
    Given 本体とsubagentのfixture logとjournalがある
    When token集計scriptを実行する
    Then session・subagent・Step別合計とcache_read/callのmedian・p95・maxとskip行数を返し本文を出力しない
    And subagent logの明示指定・同じlogの二重指定・別名pathでも同じcallを一度だけ数えsubagentの親を保つ
    And Step別の稼働時間は異なるsessionのcall間隔を数えずsession内の間隔をStep区間で分ける
    And 追跡済みfileだけを出力しtoken様の名前や未追跡のpathを出さない
    And 重複tool記録を再読込と誤認せず孫workerのcacheを一度だけ集計する
