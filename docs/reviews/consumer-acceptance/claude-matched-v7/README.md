# Claude固定比較 v7（開始前の条件）

契約を起動前に読めるようにした評価入力と、個別helpを持つ同一runtimeで比較する。対照はalpha.31（旧Skill）、候補はalpha.30（現行Skill）。runtimeのsourceFiles一致を確認済み。前回の条件とは混ぜず、v4–v6と複雑ケースの未達記録を保持する。

小規模greeting fixture/base c37e08e05abc46b5a26af131f134d42a3c8a3b80、Claude Sonnet・medium、同じ品質oracle、順番B,C,C,B,B,C,C,B,B,Cの5組。全Contextのusage照合、独立レビュー、対象HEADのDraft PR/CIを要求する。実装・修復・計画を評価者は代行しない。時間はモデル開始から評価Hostの提出・CI確認終了までで、モデル/API条件の変動も含む。

品質失敗・欠測・モデル等の条件不一致で停止し、失敗試行を交換しない。最初の2組がともに時間・tokens悪化なら無益性停止。受入は既存summarizeNativePairsを変更せず用いる（5組、品質成立、双方中央値削減、最大値悪化なし）。良い単発や別cohortを混ぜない。これは過去の探索後の限定比較であり、普遍的な改善や未試験の複雑Goalの保証ではない。

Runner SHA256: `55608fb89b0c6d704c6fd5dbbd78f39babecd8cacd0888122ba0cb5a37d0bcf8`。
Driver SHA256: `d2a084952125d44bea02da1d3ae2acecb31f990a896da4175c0a485472774ba8`。
## 結果

事前の無益性条件により4試行・2組で停止した。残り6試行は行っていない。全件で品質・usage照合・Draft PR/CI成功、手動実装修正なし。性能は不合格であり、5組完了とも扱わない。

| 指標 | 対照 | 候補 |
|---|---:|---:|
| 時間中央値（秒） | 80.855 | 101.929 |
| 処理tokens中央値 | 336,190 | 385,953 |
| 時間最大（秒） | 88.359 | 111.030 |
| 処理tokens最大 | 337,919 | 391,232 |

[集計](summary.json)とrun-1〜4の記録を参照。公開合成PRは#131〜#134。モデル実行の終了から提出・CIまでを含む条件は変更していない。旧cohortの有利な結果を追加しない。

### 既存ログからの原因確認

parent_tool_use_idのない親assistant messageをmessage.idで重複排除すると、親message数は対照9/9、候補10/11。親tool_use数は対照9/8、候補8/12だった。候補1件目ではtool数自体は減っているため、単純にtool往復だけが総tokens増加原因とは断定しない。

候補2件目では、Reviewerへ渡す手順を親も先読みし、既に読んだソースを再確認し、commit後に差分を再読込みしている。既存Skillには重複読取りを避ける指示があるが、指示の存在は実行保証ではない。追加の同種指示や再試行を重ねる前に、レビューの必要情報量と実際の親・子のContext費用を分けて判断する。レビューの必要な独立確認を削って数値を合わせない。

今回確認した契約の事前提供と個別helpの修正は利用性の改善であり、全体の性能改善が証明されたとは説明しない。

### 親・Reviewer別の照合済みusage

| 試行 | 親message数 | 親処理tokens | Reviewer message数 | Reviewer処理tokens |
|---|---:|---:|---:|---:|
| B1 | 9 | 284,272 | 3 | 50,189 |
| C1 | 10 | 306,816 | 4 | 73,858 |
| C2 | 11 | 339,480 | 3 | 51,752 |
| B2 | 9 | 287,642 | 3 | 50,277 |

全体の合計は各runの照合済みusageに一致する。Skill本文は対照18,106 bytes、候補10,859 bytes。文書量は減ったが往復回数が増え、処理tokens削減にはつながらなかった。

この結果を受け、Reviewerへ手順を「最初に読む」と指示する表現を修正。既知の手順・要求・Git状態・差分を同じtool呼出しで取得できるようにし、各取得の成否と結果依存の後続調査は維持した。独立read-onlyレビューで具体的欠陥なし。これは追加往復を避けるための仮説修正であり、v7の不合格を合格へ変更するものではない。

Skill quick_validateは環境にPyYAMLがなく未実行（ModuleNotFoundError）。新たな依存導入やHost設定変更は行っていない。配布物の既存検査と独立レビューを用い、validator成功とは記録しない。

変更後の実配布検査: `TMPDIR=/var/tmp node --test --test-name-pattern='packed Node distribution runs' test/test_package.mjs` が1件成功（5.53秒）。source checkout・Python・外部依存なしの導入先で確認。これはモデルの往復数や性能の試験ではない。

### 読取り案内修正後の限定確認

alpha.32の単発確認は[記録](../claude-review-batching-followup.json)を参照。77.965秒・356,932 tokens、独立レビュー・oracle・合成PR135/CIは成功した。しかし親のReviewer依頼からreview.md参照が欠落し、Reviewerも同手順を読まなかったため、behavioralAcceptanceはfalse。v7へ混ぜず、速度改善の証拠にしない。

前修正の「使う」は明示的な読取り指示より弱いため、依頼へ所在と読取り指示を必ず含める表現へ修正した。同一tool呼出しでの取得可は維持。独立レビューで具体的欠陥なし。前回の配布実走検査は配布構造について引き続き適用できるが、この文言のモデル遵守を証明するものではない。追加の同型cohortは開始していない。
