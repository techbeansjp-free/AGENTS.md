# Claude固定比較 v7（開始前の条件）

契約を起動前に読めるようにした評価入力と、個別helpを持つ同一runtimeで比較する。対照はalpha.31（旧Skill）、候補はalpha.30（現行Skill）。runtimeのsourceFiles一致を確認済み。前回の条件とは混ぜず、v4–v6と複雑ケースの未達記録を保持する。

小規模greeting fixture/base c37e08e05abc46b5a26af131f134d42a3c8a3b80、Claude Sonnet・medium、同じ品質oracle、順番B,C,C,B,B,C,C,B,B,Cの5組。全Contextのusage照合、独立レビュー、対象HEADのDraft PR/CIを要求する。実装・修復・計画を評価者は代行しない。時間はモデル開始から評価Hostの提出・CI確認終了までで、モデル/API条件の変動も含む。

品質失敗・欠測・モデル等の条件不一致で停止し、失敗試行を交換しない。最初の2組がともに時間・tokens悪化なら無益性停止。受入は既存summarizeNativePairsを変更せず用いる（5組、品質成立、双方中央値削減、最大値悪化なし）。良い単発や別cohortを混ぜない。これは過去の探索後の限定比較であり、普遍的な改善や未試験の複雑Goalの保証ではない。

Runner SHA256: `55608fb89b0c6d704c6fd5dbbd78f39babecd8cacd0888122ba0cb5a37d0bcf8`。
Driver SHA256: `d2a084952125d44bea02da1d3ae2acecb31f990a896da4175c0a485472774ba8`。
結果は実行後に追記する。まだ合格判定はない。
