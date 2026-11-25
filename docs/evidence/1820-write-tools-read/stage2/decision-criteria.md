# 判定の規則（段階2。モデル実行の前に固定）

対象：#1820の段階2（改善の効果）。規則はownerの判断（2026-11-26、[Issueのコメント](https://github.com/techbeansjp-free/AGENTS.md/issues/1820)「ownerの判断」）による。判定の手順は[harness/score.mjs](harness/score.mjs)の`judge1820s2`・`ruleChecks`で実装し、合成の記録で試験した（[harness/harness.test.mjs](harness/harness.test.mjs)）。判定は[harness/judge.mjs](harness/judge.mjs)だけで行う。judge.mjsは、#1817・段階1と同じ照合（固定の照合、試行ごとの固定の記録と台帳、台帳の予約・`trials.json`・traceが同じ試行の集まりであること、精算済みの試行の記録の改変、公開した記録と台帳が試行の元の記録から作り直したものとbyteで同じこと）をしてから採点する。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・採点の処理を変えない。

## ownerの決定

| 項目 | 決定 |
| --- | --- |
| 比べる条件 | B（現状：release v0.5.111）とS（改善版：`CLAUDE.md`の案内文と`asc`の説明を直した候補のtarball）。どちらも`project-assets`の提案から`CLAUDE.md`へ読む契機を採用する（採用される塊は、それぞれのtarballの文面） |
| 環境 | 書込みのある環境（段階1の水準W：Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、段階1と同じ隔離の設定） |
| 依頼と回数 | #1814・#1817の14依頼に、#1815の形の依頼（画面の依頼のフォルダ）を加え、各4回 |
| 費用 | 段階1・2の合計で上限25 USD。段階2は約15 USDの見込み |
| 採用の候補とする基準 | 書込みのある環境で、次の3つをすべて満たすこと。該当する依頼でのASC本文の読込みが8割以上で、現状より多い。手順の適用が現状以上。該当しない依頼での余計な読込みが、現状＋1回以内 |
| 隔離の確認の目印file | #1820での使用を承認済み（[../results/probe-approval.json](../results/probe-approval.json)） |

## 数え方

- 「該当する依頼」は、fixture Aの`kind`が`asc`・`purpose`の11件と、画面の依頼のフォルダの3件（`kind` `design`：`d-ui03`・`d-ui04`・`d-ui07`）、計14件（各条件56試行）。「該当しない依頼」は`negative`の3件（各条件12試行）。
- 「ASC本文の読込み」は`bodyRead`：期待するASCのSkill（`asc`、または目的別Skill）の本文`.agent-skill-chain/skills/<skill>/SKILL.md`の読込み（#1817と同じ定義）。ownerの基準の「ASC本文」を、ASCが配布する期待のSkillの本文と読む（#1817の数え方）。`asc`を期待する依頼だけの値も別に示す（`perCase`）。
- 「手順の適用」は`applied`。
  - fixture A：#1817と同じ。期待するSkillの本文・必要なreferenceのどれか（無い依頼は真）・回答の目印のすべて。目印は#1817の緩めた形（`relaxed`）。
  - 画面の依頼（`design`）：`asc`の本文と、`asc`のreferenceの`implementation.md`か`workspace.md`のどちらかを、最初の3つのmessageの中で読むこと。
    - 理由：この依頼は新しい画面を作る変更を伴う依頼で、ascの手順のうち該当するのは、変更を伴う依頼の作業場所の決定（`workspace.md`）と、UIの変更・新規作成の規則（`implementation.md`）である。#1817のasc-3（同じく依頼の中身がBRIEFにある依頼）と同じreferenceと、同じ「どれか1つ」の規則にした。
    - 回答の目印は使わない。試行を3つのmessageで打ち切る（`conditions.json` `maxTurnsByKind`）ため、最終の回答が無い。画面の出来の評価は#1815で行っており、段階2の目的（読むかどうかと、読んだ後に手順のreferenceへ進むか）には要らない。
- 「余計な読込み」は`overapplication`：該当しない依頼で、ASCのSkill tool・入口・本文のいずれか（#1817と同じ）。
- 読込みの数え方：fixture Aの依頼は、結果がerrorでないRead（#1817）。画面の依頼は、打ち切りの後に結果が無いReadも、呼び出したものとして数える（段階1と同じ）。
- 定義の詳細は[cases.json](cases.json)の`scoring`。

## 規則

1. 採用の候補：該当する依頼の全体（fixture Aの11件と画面の依頼の3件を合わせたもの）で、次の3つをすべて満たせば、Sを「採用の候補」とする。どれかを満たさなければ「候補ではない」。
   - (a) `bodyRead`(S)／有効な試行 ≧ 0.8、かつ `bodyRead`(S)の率 ＞ `bodyRead`(B)の率
   - (b) `applied`(S)の率 ≧ `applied`(B)の率
   - (c) `overapplication`(S) ≦ `overapplication`(B) ＋ 1（件数）
   - (a)(b)は有効な試行の割合で比べる（失敗が無ければ両条件とも分母56）。
   - 判定しない場合（「判定不能」）：次のどれかに当たれば判定しない（#1817と同じ）。
     - 測定が完了しておらず、費用の線にも達していない（規則6）。
     - 該当する依頼か該当しない依頼の有効な試行が0件の条件がある。
     - 計画した依頼のうち、有効な試行が1件も無い依頼がある。
     - 規則4の置き換えが欠けている。
     - 置き換えた後の失敗が、条件の数える試行の10%を超える。
2. 別の報告：fixture Aの依頼（14件。該当しない依頼を含む）と画面の依頼（3件）のそれぞれで、同じ(a)(b)(c)（画面の依頼は(a)(b)だけ）の値を示す（`separate`）。合否には使わない。画面の依頼では、本文を最初に読んだmessageの番号、`Skill(asc)`、本文より前のWrite・Editの有無も示す。依頼ごとの試行の記号（`A`適用・`B`本文まで・`E`入口だけ・`M`誤選択・`U`未選択、該当しない依頼は`O`過剰・`-`）も示す。
3. 解釈の限界：各依頼4回では、数試行の差は偶然の範囲を出ない。判定は「採用の候補」かどうかの目安であり、採否はownerが決める。
4. 失敗と置き換え（#1817と同じ）：process・APIのエラー、traceの欠落、init・result eventの無い記録、水準Wと違うtool・permission mode・MCP serverのinit（条件を受け取っていない）は失敗として別に数え、未選択や合格に変換しない。
   - **置き換えは必須**：計画した試行（回1〜4）のうち失敗したものは、同じ条件・依頼で、失敗した数だけ次の番号（5、6、…）の試行で1回ずつ置き換える。置き換えの失敗はもう置き換えない。
   - この番号以外の追加の試行は採点に含めず、別に報告する。
   - 1試行ごとの予算上限による停止と、画面の依頼の`--max-turns`による停止は失敗ではない。停止までの記録で採点し、件数を報告する。
   - 台帳に予約があり精算の行が無い試行は、失敗として数える。精算済みの試行の`trace.jsonl`・`meta.json`が無い、または精算の行のsha256と違う場合は、記録の改変として扱い、採点を拒否する。
   - 実装：[harness/order.mjs](harness/order.mjs)の`replacementPlan`と[harness/score.mjs](harness/score.mjs)の`selectCounted`。
5. 隔離の確認：測定の前に、B・Sそれぞれ1回のprobe（fixture A、水準W、段階1と同じ6操作）を行い、[harness/probe-check.mjs](harness/probe-check.mjs)のすべての項目が合格し、`compare`が合格した場合だけ測定する。`run-trial.mjs`は、記録された`pass`を信用せず、各probeを試行の記録から計算し直して照合する（段階1と同じ）。
   - 失敗・不合格の条件に限り、1回だけ再実行できる（回2）。それでも合格しなければ、測定せずにownerへ報告する。
   - probeは、計画した試行が1件でも台帳に予約された後は実行しない。
6. 実行の順序と途中の停止（#1817と同じ）：
   - 順序は[run-order.json](run-order.json)：回を外側、各回の中は固定した17依頼の順（該当しない依頼と画面の依頼は間に挟み、同じ種類を隣にせず、最後にしない）、各依頼の中はB、Sの順。`run-all.mjs`はこの順だけを実行し、`run-trial.mjs`は次に予約されるべき試行以外を拒否する。
   - 判定してよいのは、`complete`（計画した136試行と必要な置き換えのすべてが台帳に予約されている）か、`cap-reached`（段階2の台帳の累計＋1試行の予算0.6 USDが、段階2の線21.97 USDを超える。最初の計画した試行より後のprobeが無いこと）の場合だけである。どちらでもない停止（結果を見た後の打切りを含む）は判定しない。
   - `cap-reached`の場合は、測れた試行で規則1を割合として判定し、測れなかった試行の数を条件ごとに報告する。
7. 費用：ownerの上限は段階1・2の合計で25 USD。段階1の費用（公開した台帳`../results/ledger.jsonl`の累計2.0281387 USD、sha256を`conditions.json`で固定）を引いた残りを1セント単位で切り捨てた22.97 USDを段階2の上限とし、余裕1 USDを引いた21.97 USDを停止の線とする。`run-trial.mjs`は、段階1の台帳のsha256と累計を照合し、段階2の台帳の累計＋その試行の予算がこの線を超えるなら起動しない。2段階の合計は最大で約24.0 USDである。
