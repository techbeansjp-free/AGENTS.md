# 合格の水準と判定の規則（モデル実行の前に固定）

対象：#1814。水準はownerの判断（2026-11-25、Issueのコメント）による。判定の手順は[harness/score.mjs](harness/score.mjs)の`judge`と`shortfall`で実装し、合成の記録で試験した（[harness/score.test.mjs](harness/score.test.mjs)）。評価結果を見た後に、この基準・[cases.json](cases.json)・[conditions.json](conditions.json)・採点の処理を変えない。

## ownerの決定

| 項目 | 決定 |
| --- | --- |
| 費用の上限 | 30 USD（Hostの計算値。`claude -p`の`total_cost_usd`の合計） |
| 測定するHost | Claude Codeだけ。Codexは対象外とし、必要なら別Issueにする |
| 改善の合格の水準 | 該当する依頼で、ASCのSkillの本文が読まれる割合が80%以上、かつ手順の適用が現状より多い。該当しない依頼での過剰な読込みは、現状＋1試行まで |
| 改善で標準にする仕組みの採否 | 測定の後にownerが決める |

## 測定の条件（統括の決定、2026-11-25。実行の前に固定し、結果を見た後に変えない）

| 項目 | 決定 |
| --- | --- |
| model | `sonnet`の別名（#1807の生成と同じ。現象が観測された条件）。試行ごとに、init eventの解決後のmodel idを記録する。`run-trial.mjs`は`conditions.json`の`model`だけを使い、別の指定を受け付けない |
| tool | `Read`・`Glob`・`Grep`・`Skill`だけ。安全のための、利用者の環境との意図した違いとして記録する（影響は[EVAL_PLAN.md](EVAL_PLAN.md#利用者の環境との意図した違い)）。ownerが了承した（2026-11-25） |
| 認証 | `claude setup-token`のtokenを、測定を動かすprocessの環境変数だけで子processへ渡し、file・ログに値を残さない（ownerの決定、2026-11-25） |
| 試行のcommit | どの条件でも同じ中立の件名のcommitを1件入れる（Rは空のcommit）。段階0で、条件の間で違うのが`CLAUDE.md`とhookの出力だけであることを確かめる |
| 費用の数え方 | 全段階で1つの台帳を使い、試行は1つずつ順に実行する。精算されなかった試行は予算額で数える。予約は一意なidで数え、同じ試行名は1回だけ。累計と次の試行の予算の和が29 USD（上限30 USDから余裕1 USD）を超えるなら起動しない。上限・余裕・1試行の予算は`conditions.json`の`budget`で固定し、引数では変えられない |
| 反復 | 各条件2回（`conditions.json`の`runs`）。採点は反復の番号1〜2だけ。再実行は規則5のとおり |
| 固定 | 測定の前のHEADと、条件・gold・判定・起動に関わるfileのsha256を`results/fixation.json`に追記だけで記録する。`run-trial.mjs`は、最後の記録と違うfileがあれば起動しない。段階0の後の是正（refix）は、段階1・2の試行が台帳に無い間だけ、独立レビューを通して足せる。段階3で足せる記録は、`conditions.I`の追加（`conditionISchema`を満たすもの）、`release.json`の`phase3`の記入、`harness/condition-i.mjs`の変更（fileごとに理由と独立レビューの参照を記録）だけを含むもの。採点・gold・判定の規則・R/P/Hの経路はbytesで同じ（`fixation.mjs stage3`が確かめる。[EVAL_PLAN.md](EVAL_PLAN.md)「固定の記録と変えてよい範囲」） |

## 判定に使う数え方

- 「該当する依頼」は`cases.json`の`kind`が`asc`または`purpose`の11件、「該当しない依頼」は`negative`の3件。
- 「本文が読まれる」は`bodyRead`（期待するSkillの`.agent-skill-chain/skills/<name>/SKILL.md`を、エラーなしでReadした）。Skill toolの呼出しや入口（`.claude/skills/<name>/SKILL.md`）だけの読込みは`entryHop`として別に数え、本文の読込みに含めない。
- 「手順の適用」は`applied`（本文・必要なreference・回答の目印のすべて）。
- 「過剰な読込み」は`overapplication`（該当しない依頼で、ASCのSkill toolの呼出し、入口または本文のRead）。
- 「現状」は条件R（登録だけ）。比べる相手は、候補の条件P・H（段階2）と、改善の後の条件I（段階3）。

## 規則

1. 不足の有無：Rの`bodyRead`が該当する試行の80%未満なら「不足あり」。80%以上なら「不足なし」とし、製品を変更しない根拠として記録する。ただし、Rで手順の適用が少ない場合は、その数字を添えてownerへ報告する（Issueの完了の基準「不足が無ければ、変更しないことと根拠を記録する」）。
2. 候補の評価（段階2）：PとHのそれぞれについて、`bodyRead`の割合が80%以上、`applied`の割合がRより大きい、`overapplication`がRの件数＋1以下、の3つをすべて満たせば「水準を満たす候補」とする。どれを標準にするかはownerが決める。両方が満たさない場合、PH（両方）・S（強い文面のhook）の追加測定は費用の上限を超えるため、実行せずに報告する。
3. 改善の後（段階3）：ownerが採用した仕組みを`project-assets`の提案から適用した条件Iで、2と同じ3つを、Rを現状として判定する。
4. 割合で比べる：失敗を分母から除くため、試行数が条件で異なり得る。`applied`はRとの割合で比べる。`overapplication`は件数で比べる（該当しない依頼の試行数は各条件6）。
5. 失敗・欠測：process・APIのエラー、traceの欠落、init eventの無い記録、hookのある条件でhookが発火しなかった試行（条件を受け取っていない）は失敗として別に数え、未選択や合格に変換しない。失敗した試行に限り、同じ条件・ケースで次の番号の試行を1回だけ実行でき、採点では失敗の代わりに数える（その試行も失敗なら失敗のまま）。それ以外の追加の試行は採点に含めず、別に報告する。置き換えた後も1条件の失敗が試行の10%を超えた場合、その条件は「判定不能」とし、ownerに報告する。1試行ごとの予算上限による停止は、停止までの記録で採点し、件数を報告する。
6. 隔離の確認（段階0・段階3の最初）：[harness/probe-check.mjs](harness/probe-check.mjs)のすべての項目が合格した条件だけを測定する。不合格の条件の結果は使わない。
