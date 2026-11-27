# 判定の規則（#1840。モデル実行の前に固定）

対象：#1840の測定（利用者に届く形でASCを入れた隔離環境で、#1828・#1829・#1832の改善と、利用者の固有ルール・固有Skillが使われるか）。判定は共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の`judge.mjs`だけで行い、規則は[conditions.json](conditions.json)の`rule`（`mode: levels`、`score.mjs`の`levelsVerdict`）で与える。`judge.mjs`は、#1823と同じ照合（固定の照合、台帳、試行の記録の改変、公開した記録の作り直し）をしてから採点する。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmoduleを変えない。

## 決まっていること

| 項目 | 内容 |
| --- | --- |
| 条件 | R（リリース版：GitHub Releaseの最新v0.5.119）とC（候補版：origin/main `c9288126`にPR #1837・#1838をmergeした`0c43eccb`を`npm pack`）。どちらも`project-assets --register-claude-skill --apply`で導入し、読む契機`claude-md`を採用する。違いはtarballだけ |
| 環境 | #1823と同じ書込みのある環境（水準W：Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、Bashなし、同じ隔離の設定） |
| 依頼と回数 | 19依頼（目的1が10、目的2が9）、各条件各3回、計114試行と、probe 2回（fixture U） |
| 費用 | 上限30 USD（owner、2026-11-27）。停止の線29 USD |
| 判定の性質 | 候補をリリースと比べて採否を出す規則ではない。条件ごとに、固定した水準を満たすかを示す。#1837・#1838のmergeと直す内容はownerが決める |

## 数え方

- 「選ばれた」`reach`：期待するSkillのSkill tool呼出し、Claude Codeの入口、本文の読込みのいずれか。
- 「本文」`bodyRead`：ASCのSkillは`.agent-skill-chain/skills/<skill>/SKILL.md`のRead。利用者のSkill（`userSkill`）は、そのSkill toolの呼出しか`.claude/skills/<name>/SKILL.md`のRead（Skill toolが本文を読み込むため）。
- 「reference」`referenceRead`：`references`に挙げたfile（`warranty-scope`の`check-items.md`）のRead。
- 「読まれた」`expectReads`：試行の記録にあるRead（tool呼出しで、結果がerrorでないもの）のpathが、固定した正規表現に合うこと。雛形（`.agent-skill-chain/templates/specs/00_利用案内.md`、`details/02_要件/03_品質保証範囲.md`、個別機能・個別画面の雛形）、案件の品質保証範囲（`docs/specs/details/02_要件/03_品質保証範囲.md`）、利用者の固有ルール（`.agent-skill-chain/project/rules/money.md`）。
- 「不要に読まない」`forbidReads`：該当しない依頼で、そのfileのReadが無いこと。
- 「選ばれてはならない」`forbidSkills`：そのSkillの呼出し・入口・本文のReadが無いこと（ASCのSkillも利用者のSkillも）。
- 「差分」`writes`：試行の中でWrite・Edit・MultiEditしたfile（結果がerrorでないもの）のうち`pathPattern`に合うものを、試行の終わりの`work/`の写しで読み、`require`がすべて合い、`forbid`がどれにも合わないこと。`mustWrite`なら1件以上書いたこと。`pathPattern`は先頭に`.worktrees/<名前>/`が付いたpathも合う（Bashが無いので、ASCの作業場所の手順に倣ってAgentが`.worktrees/`の下に書く場合がある）。目的2の金額の規則では、小数のリテラル・`parseFloat`・`toFixed`・`Math.round`等・`Number(`を違反とする。
  - s-1は本文（`docs/specs/details/04_機能/`・`05_画面/`）だけを採点する。本文の外（変更履歴`15_要件追跡/`等）に経緯を書いたかは`writesReport`で別に報告し、合否に使わない。既存のfileの「状態：承認済み」を書き換えずに残した場合は、従来どおり不合格。落ちた理由は`writeFailedGroups`（`facts`：事実の欠け、`history`：経緯、`status`：状態）で分けて報告する。
  - w-2の合意者・合意日・状態（#1828 T3-3）は、Skillありの回答6件中5件が0点だったので必須から外し、`writesReport`で報告する。
  - u-skillは`docs/invoices/`・`docs/quotes/`（利用者のSkillが指定する置き場）だけを見る。書かなかった試行は、回答の文に`require`の目印があるかを`writeRequireInAnswer`で別に報告する。
- 「回答の目印」`markers`：回答の文と、試行の中で書いたfileの文（`work/`の写し）の和に当てる（`cases.json`の`markerText`）。書いたfileの文からは、試行の前からあるfileと同じ行（前後の空白を除いて行単位で比べる）を除いてから当てる（`cases.json`の`markerBase`）。試行の前からあるfileは、導入した雛形（`.agent-skill-chain/templates/`とその`managed-runtime/`の写しの、fixtureのHEADの版）と、書いたfile自身の試行の前の版である。雛形を写しただけ、見出しと表だけ、1行だけ埋めた雛形は、試行が書いた行しか目印の対象にならない。除いた行の数を`markerBaseExcludedLines`に記録する。w-2は`writes.requireWithoutBase`で、`require`の照合にも同じ除き方を使う（`forbid`は全文に当てる）。`answerGroups`・`answerAny`がすべて合い、`answerQuota`の観点ごとの目印が`min`件以上合い、`answerNone`（これまでの評価の減点：法的な断定、調査の前の無償の約束等）がどれにも合わないこと。`report: true`の目印（w-3のT4-5「契約不適合」：Skillありの回答6件中5件が0点）は数えず、`markerGroups`で報告する。合意の版の目印は「版」「合意の版」の近くの`1.0`に限り、`v1.0.0`には当てない。
- 目印と書いたfileの照合は、これまでの評価で採点した回答に当てて校正した（[calibration-table.md](calibration-table.md)、入力は[calibration.json](calibration.json)）。
- 「適用」`applied`：本文・reference・目印と、その依頼にある`expectReads`・`forbidReads`・`forbidSkills`・`writes`のすべて。
- 該当しない依頼`negativeOk`：ASCのSkillに触れず、その依頼の`forbidReads`・`forbidSkills`も満たすこと。

## 回答の観点（これまでの評価から選んだもの）

各依頼の`viewpoints`に、引き継いだ観点の番号を書いた。目印は観点の全部ではなく、文字列で確かめられる部分だけである。

| 依頼 | 出典 | 観点 |
| --- | --- | --- |
| w-1 | #1828 T1 | T1-1（ブラウザ・OS・端末の版や画面サイズまで具体化）とT1-4（検収時のリリース・環境、基準の版）の2件とも。T1-2（応答時間・閾値・測定）とT1-3（決済代行の障害・仕様変更）は、Skillなしの回答でも9件中9件が1点でSkillの有無を分けないので報告だけ。目印には雛形の語（「基準時点」「閾値」「測定」「ブラウザ・OS・端末」等）を使わない。減点：法的な断定 |
| w-2 | #1828 T3 | T3-1（REQ-PERF-001・CON-003をIDで参照し、3秒・同時100・IE11を書き写さない）、T3-4（未決と判断者）。T3-3（合意者・合意日・状態）は報告だけ。減点：架空の合意（状態を合意済み・承認済みと書く） |
| w-3 | #1828 T4 | T4-1（無期限の可否を断定せず法務へ。無期限を「受けない」と言い切る回答は合わない。雛形の語「法務・契約」は目印にしない）とT4-2（期間と範囲を分ける）の2件とも。T4-3（環境と版を明記し対象外は互換性対応・見積）は雛形の語で、雛形だけの回答でも6件中6件が1点なので報告だけ。T4-5（契約不適合）は報告だけ。減点：法的な断定 |
| m-r1・m-r2・m-r7 | #1829 R1・R2・R7（改訂版の観点） | 根拠のWAR IDと合意の版1.0、R1は差異の確認（BR-012、明細ごとの切捨て、端数）、R2は互換性対応・見積、R7は未決・未合意と判断者（すべて）。減点：差異の確認前の無償の約束、無償修補の「方向」の約束（#1829の境界例）、未合意の行での無償・有償の確定、法的な断定 |
| s-1 | #1832 | 本文（個別機能・個別画面）に7つの事実（F1〜F7）がすべてある、本文の経緯の文（変更前の値・変更の記述・理由）が0件、状態を「承認済み」と書かない |
| n-1 | #1828 N2 | 隣接：見積の依頼で`warranty-scope`を選ばない |
| u-skill-3 | 新規（#1840 review L4） | 利用者のSkillどうしの選び分け：「見積」の語を含む請求書の依頼で、`quote-format`でなく`invoice-format`を選び、その書式（`INV-202612-NNN`・御中・振込先・合計264,000円）で書く |

## 水準（`conditions.json`の`rule.levels`）

条件ごとに、各水準の率（その依頼の、数える有効な試行のうち合格の割合）が`min`以上なら合格。1件も有効な試行が無ければ不合格。「報告だけ」の水準（`use: report`）は計算して`perCondition.reported`に示すが、合否（`meets-levels`）に使わない。

| 水準 | 依頼 | 指標 | min | 根拠 |
| --- | --- | --- | --- | --- |
| g1-select | 目的1の該当8件 | reach | 0.8 | #1823の本文の読込みの水準0.8 |
| g1-body | 同上 | bodyRead | 0.8 | 同上 |
| g1-warranty-reference | w-1〜3 | referenceRead | 0.8 | #1828の暗黙の選択で全件が`check-items.md`を読んだ |
| g1-warranty-templates | w-1・w-2 | expectReadsAll | 0.8 | Issueの完了の基準（Skillから雛形まで辿り着く） |
| g1-warranty-answer | w-1・w-3 | markers | 0.67 | 照合の表：Skillありの回答で目印の合格はw-1 5/6、w-3 6/6、Skillなし（雛形だけ・なし）の回答はw-1 0/9、w-3 0/9。落ちるべき回答（雛形そのまま、見出しと表だけ、利用案内だけ、1行だけ埋めた雛形。R・Cの雛形）は16件すべて不合格。各3回・計6試行で、ばらつきの余地を残して4/6 |
| g1-warranty-write | w-2 | writeOk | 0.67 | 照合の表：Skillありの回答で、これまでの採点の合格は4/6、目印の合格は5/6。2/3 |
| g1-maintenance-reads | m-r1・r2・r7 | expectReadsAll | 0.8 | 品質保証範囲を正本として読む（#1829） |
| g1-maintenance-answer | m-r1・r2・r7 | markers | 0.78 | #1829で`2a3ad6fe`の本文を2回生成した回答（R1・R2・R7の6件）で、これまでの採点の合格と目印の合格はともに5/6（0.83。R1の「無償修補の方向」1件が不合格）。9試行で0.83以上は8/9になり表の率より厳しいので、7/9（0.78）とする。#1829の水準は7件中6件（0.86）だったが、この3件はR1を含むので低い。**候補版の本文は`2a3ad6fe`ではなく`622deeb2`で、#1829はこの版を測り直していない**（下の「m-r系の水準の根拠と候補版の本文」）。0.78は`2a3ad6fe`の記録から決めた水準であり、候補版の本文で確かめた率ではない |
| g1-spec-templates | s-1 | expectReadsAll | 0.67 | Issueの完了の基準 |
| g1-spec-write | s-1 | writeOk | 1 | 照合の表：#1832の変更後2（`f080c937`）は2/2が合格、変更前と変更後1は4/4が不合格で、これまでの結果と6/6一致。min 1の扱いは下の「min 1の水準」 |
| g1-adjacent-skill | n-1 | forbidSkillsOk | 0.67 | #1828 N2 |
| g1-negative | n-2・n-3 | negativeOk | 0.8 | 該当しない依頼で読まない |
| g2-asc-select | u-bill-1・2、u-users、u-docs | reach | 0.8 | 変更の依頼でASCが選ばれる |
| g2-rule-read | u-bill-1・2 | expectReadsAll | 0.8（報告だけ） | **仮置き**：合否に使わず「`start`を使えない環境での下限」として報告する（下の「ownerの決定までの仮置き」） |
| g2-rule-comply | u-bill-1・2 | writeCleanWhenWritten | 1 | `src/billing/`に書いた試行のうち、規則の違反が0件。書かなかった試行は率に入れず、`notEligible`として別に数える。書いた試行が0件なら率の分母が0で不合格（`value`は`0/0`、`notEligible`は有効な試行の全数）。違反による不合格とは`notEligible`で区別する。min 1の扱いは下 |
| g2-rule-not-read | u-users、u-docs、u-neg | forbidReadsOk | 0.8（報告だけ） | 合否に使わない。Bashが無い環境では`start`の選択を経ずにAgentがfileを読むので、読まないことを`start`の選び分けの結果として扱えない |
| g2-skill-select | u-skill-1・2・3 | bodyRead | 0.8 | 利用者のSkillが選ばれ読まれる |
| g2-skill-output | u-skill-1・2・3 | writeOk | 0.67 | Skillの書式で、Skillが指定する置き場に書く |
| g2-skill-distinguish | u-skill-1・2・3、u-est、u-users、u-docs、u-neg | forbidSkillsOk | 0.8 | 説明の近いSkillを選び分ける（u-skill-3は利用者のSkillどうし） |
| g2-negative | u-neg | negativeOk | 0.67 | 該当しない依頼 |

## m-r系の水準の根拠と候補版の本文（re-review Medium-2）

- 候補版（C）のtarballは、PR #1837のhead `59ad479f`をmergeした`0c43eccb`から作った。`skills/estimate-and-scope/SKILL.md`は`59ad479f`と`622deeb2`で同じ（sha256 `3a3caa400731edef059a7f9021f9c9dd832272a1970954b1ab6a2343158f2eb6`。候補のtarballの元のcloneでも同じ値）で、`622deeb2`が最後の本文の変更である（`622deeb2`から`59ad479f`までの変更は、origin/mainのmergeによる他のSkillだけ）。
- 水準の根拠にした`2a3ad6fe`の本文（sha256 `332039322dbb3b6245403bb3b5669489c2c44db0b0de837c6ceec2b3fe684936`）とは、1段落（1行）が違う。`622deeb2`は、合意した扱いを書ける条件（該当行が合意済みで扱いも合意されている場合）と、契約不適合の疑いがある場合も無償で直すかを権限者に残すことを、ownerの決定の文言にそろえた変更である。
- #1829の評価（`59ad479f`の`docs/evidence/1829-estimate-warranty/00_評価.md`）は`2a3ad6fe`までを測っており、`622deeb2`は測り直していない。照合の表のm-r1・m-r2・m-r7の行も`2a3ad6fe`までの回答である。
- このため、g1-maintenance-answerの0.78は「`2a3ad6fe`の記録から決めた水準を、測っていない`622deeb2`の本文にも当てる」ものとして扱う。この測定のCの結果は、`622deeb2`の本文で初めて測った値であり、#1829の結果の再現とは書かない。Rの本文は#1829の前（`c9288126`）で、照合の表の変更前の回答（`before.md`）はR1・R2・R7とも不合格である。
- 試験（`harness.test.mjs`の「re-review Medium-2」）が、`59ad479f`と`622deeb2`の本文が同じで`2a3ad6fe`と違うこと、差が1行であることを確かめる。

## min 1の水準（review M4）

g1-spec-write（s-1）とg2-rule-comply（u-bill-1・2のうち書いた試行）はmin 1とする。各3回のままで、1回でも落ちれば不合格になる。

- g1-spec-write：#1832で直した欠陥（経緯の文、状態の「承認済み」）は1回でも出れば利用者に届く誤りなので、全回の合格を水準とする。照合の表で、提出した版の2回とも合格、直す前の4回とも不合格と一致した。結果には、落ちた試行ごとに`writeFailedGroups`（事実の欠け・経緯・状態）と、`writeRequireMissing`・`writeViolations`の要素を並べる。
- g2-rule-comply：金額に浮動小数点を使う差分は1回でも規則の違反なので、書いた試行の全部で違反0を水準とする。結果には違反の要素（`decimal-literal`・`float-function`・`number-conversion`）と、書かなかった試行の数（`notEligible`）を並べる。書いた試行が1件も無い条件では不合格になる（`0/0`）。違反があった不合格とは、`notEligible`が有効な試行の全数であることで区別して報告する。
- 3回では、真の合格率が0.9でも3回とも合格する確率は約0.73である。不合格の場合は、要素ごとの内訳を見てownerが扱いを決める（測定の後に水準を変えない）。

## ownerの決定までの仮置き（review H3）

- **仮置き**：g2-rule-read（該当するpathの変更で固有ルールが読まれる）を、合否に使わない報告（`use: report`、表記「`start`を使えない環境での下限」）にした。理由：水準WにはBashが無く、ASCの`start`（`context.json`から該当する規約を選ぶCLI）を実行できない。利用者の環境（Bashあり）では`start`が`money.md`を選ぶことを、モデルを呼ばずに確かめた（[start-selection.json](start-selection.json)）。この測定の値は、Agentが`context.json`かルールのfileを自分で読んだ場合だけを数える下限であり、利用者の環境での読込みの率ではない。
- **戻し方**：ownerが「合否に使う」と決めたら、測定の前（台帳に予約が無い間）に限り、`conditions.json`の`g2-rule-read`から`use`と`label`を消し、この節とREADMEの記載を直して、`results/fixation.json`を消し新しい台帳で`fixation.mjs init`をやり直す。測定の後には戻さない（報告のまま）。
- g2-rule-not-readも合否に使わない報告とした（読まないことが`start`の選び分けの結果ではないため）。
- 試行ごとに、合否に使わない報告として次を記録する（`cases.json`の`report`）：`context.json`とルールのfileを読んだか（`report.reads`）、回答で`start`やBashに触れたか（`report.answer`）、書いたfileとその場所（`report.writtenFiles`）。

## 規則

1. 条件ごとに、すべての水準が合格なら`meets-levels`、1つでも不合格なら`below-levels`。RとCの結果を並べて示す（Cの採用の判定ではない）。
2. 判定しない場合（「判定不能」。#1823と同じ）：測定が完了しておらず費用の線にも達していない、該当する依頼か該当しない依頼の有効な試行が0件の条件がある、有効な試行が1件も無い依頼がある、必須の置き換えが欠けている、置き換えた後の失敗が条件の数える試行の10%を超える。
3. 別の報告（合否には使わない）：報告だけの水準（g2-rule-read・g2-rule-not-read）、試行ごとの`report`、`writesReport`、`markerGroups`・`markerDeductions`、`writeFailedGroups`、`writeRequireInAnswer`、`userSkillsListed`（試行のSkill一覧に利用者のSkillが載ったか）、目的1・目的2・該当しない依頼ごとの値、依頼ごとの記号（`A`適用・`B`本文まで・`E`入口だけ・`M`誤選択・`U`未選択、該当しない依頼は`O`過剰・`-`）、referenceの読込み、`expectReads`・`forbiddenReads`・`writeViolations`・`writeRequireMissing`の内訳、トークン・時間・費用。読まれなかった・守られなかった試行は、どこで止まったか（選択`reach`、本文`bodyRead`、reference・雛形`referenceRead`・`expectReads`、規則`writeViolations`）を`runs.json`の行から示す。
4. 失敗と置き換え（#1823と同じ）：process・APIのエラー、traceの欠落、init・result eventの無い記録、水準Wと違うinitは失敗として別に数え、同じ条件・依頼で次の番号（4、5、…）の試行で1回ずつ置き換える。1試行の予算による停止は失敗ではない。
5. 隔離の確認：測定の前に、R・Cそれぞれ1回のprobe（fixture U、水準W、6操作、`--debug-file`）を行い、`probe-check.mjs`のすべての項目と`compare`（ASCの17件のdescriptionがContextにあること、利用者のSkill2件がSkill一覧に載りdescriptionが原文で示されること`userSkillsListed`、Skill一覧の予算の状態を含む）が合格した場合だけ測定する。不合格の条件に限り1回だけ再実行できる。目印fileの使用は、ownerの承認を`results/probe-approval.json`に記録してから行う。
6. 実行の順序と途中の停止：[run-order.json](run-order.json)（回を外側、各回の中は固定した19依頼の順、各依頼の中はR、Cの順）。判定してよいのは`complete`か`cap-reached`の場合だけ。
7. 費用：上限30 USD、停止の線29 USD（余裕1 USD）、1試行の予算0.5 USD、probe 0.35 USD。見込み約14.5 USD（計画の単価で18.9 USD）。
8. 解釈の限界：各依頼3回。目印は観点の一部を文字列で見るもので、これまでの評価の採点（別Contextの採点者）と同じではない。照合の表で合否の一致はw-1 14/15、w-2 14/15、w-3 15/15、m-r1 6/6、m-r2 5/5、m-r7 5/5、s-1 6/6（記録のある回答。回答を書いたfileとして当てた形でも同じ、s-1を2fileに分けた形は12/12）。#1828の「これまでの採点」の合否は、目印と同じ観点の選び方と同じ`min`を#1828の0/1の点に当てて作ったもので、#1828の判定ではない。#1828には同じ文の回答に採点者が別の点を付けた例がある（T1-1）。

## 限界（測定の前に分かっていること）

- Bashが無いので、Agentは`start`（`context.json`から該当する規約を選ぶCLI）を実行できない。固有ルールが読まれるのは、Agentが`context.json`かルールのfileを自分で読む場合だけである。利用者の環境（Bashあり）より読まれにくい側に偏る。水準X（Bashあり）は#1820の段階1で隔離の確認に通らなかった。このため固有ルールの読込みは「`start`を使えない環境での下限」として報告し、利用者の環境での結果とは書かない。
- probeはfixture Uで行い、利用者のSkillがSkillの一覧に載るかを確かめる。試行ごとにも、initのSkill一覧に利用者のSkillが載ったか（`userSkillsListed`）を記録する。
- 金額の規則の違反は文字列で見る。既存のコードが`bigint`で書かれているので、規則を読まずにコードに倣って守る場合もある（読込みと遵守は別に数える）。
- w-2・s-1・u-skillの書いたfileは、試行の終わりの`work/`の写しから読む。`run-trial.mjs`が試行の終わりに変更・作成したfileのsha256を`meta.json`の`workFiles`に記録し（`meta.json`のsha256は台帳の精算にある）、`collect.mjs`・`judge.mjs`は`work/`の内容がそれと一致しなければ拒否する。
- 利用者のSkillどうしの選び分けはu-skill-3の1件（各3回）だけである。
