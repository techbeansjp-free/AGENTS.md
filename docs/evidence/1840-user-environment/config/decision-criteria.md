# 判定の規則（#1840。モデル実行の前に固定）

対象：#1840の測定（利用者に届く形でASCを入れた隔離環境で、#1828・#1829・#1832の改善と、利用者の固有ルール・固有Skillが使われるか）。判定は共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の`judge.mjs`だけで行い、規則は[conditions.json](conditions.json)の`rule`（`mode: levels`、`score.mjs`の`levelsVerdict`）で与える。`judge.mjs`は、#1823と同じ照合（固定の照合、台帳、試行の記録の改変、公開した記録の作り直し）をしてから採点する。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmoduleを変えない。

## 決まっていること

| 項目 | 内容 |
| --- | --- |
| 条件 | R（リリース版：GitHub Releaseの最新v0.5.119）とC（候補版：origin/main `c9288126`にPR #1837・#1838をmergeした`0c43eccb`を`npm pack`）。どちらも`project-assets --register-claude-skill --apply`で導入し、読む契機`claude-md`を採用する。違いはtarballだけ |
| 環境 | #1823と同じ書込みのある環境（水準W：Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、Bashなし、同じ隔離の設定） |
| 依頼と回数 | 18依頼（目的1が10、目的2が8）、各条件各3回、計108試行と、probe 2回 |
| 費用 | 上限30 USD（owner、2026-11-27）。停止の線29 USD |
| 判定の性質 | 候補をリリースと比べて採否を出す規則ではない。条件ごとに、固定した水準を満たすかを示す。#1837・#1838のmergeと直す内容はownerが決める |

## 数え方

- 「選ばれた」`reach`：期待するSkillのSkill tool呼出し、Claude Codeの入口、本文の読込みのいずれか。
- 「本文」`bodyRead`：ASCのSkillは`.agent-skill-chain/skills/<skill>/SKILL.md`のRead。利用者のSkill（`userSkill`）は、そのSkill toolの呼出しか`.claude/skills/<name>/SKILL.md`のRead（Skill toolが本文を読み込むため）。
- 「reference」`referenceRead`：`references`に挙げたfile（`warranty-scope`の`check-items.md`）のRead。
- 「読まれた」`expectReads`：試行の記録にあるRead（tool呼出しで、結果がerrorでないもの）のpathが、固定した正規表現に合うこと。雛形（`.agent-skill-chain/templates/specs/00_利用案内.md`、`details/02_要件/03_品質保証範囲.md`、個別機能・個別画面の雛形）、案件の品質保証範囲（`docs/specs/details/02_要件/03_品質保証範囲.md`）、利用者の固有ルール（`.agent-skill-chain/project/rules/money.md`）。
- 「不要に読まない」`forbidReads`：該当しない依頼で、そのfileのReadが無いこと。
- 「選ばれてはならない」`forbidSkills`：そのSkillの呼出し・入口・本文のReadが無いこと（ASCのSkillも利用者のSkillも）。
- 「差分」`writes`：試行の中でWrite・Edit・MultiEditしたfile（結果がerrorでないもの）のうち`pathPattern`に合うものを、試行の終わりの`work/`の写しで読み、`require`がすべて合い、`forbid`がどれにも合わないこと。`mustWrite`なら1件以上書いたこと。目的2の金額の規則では、小数のリテラル・`parseFloat`・`toFixed`・`Math.round`等・`Number(`を違反とする。
- 「回答の目印」`markers`：`answerGroups`・`answerAny`がすべて合い、`answerNone`（これまでの評価の減点：法的な断定、調査の前の無償の約束等）がどれにも合わないこと。
- 「適用」`applied`：本文・reference・目印と、その依頼にある`expectReads`・`forbidReads`・`forbidSkills`・`writes`のすべて。
- 該当しない依頼`negativeOk`：ASCのSkillに触れず、その依頼の`forbidReads`・`forbidSkills`も満たすこと。

## 回答の観点（これまでの評価から選んだもの）

各依頼の`viewpoints`に、引き継いだ観点の番号を書いた。目印は観点の全部ではなく、文字列で確かめられる部分だけである。

| 依頼 | 出典 | 観点 |
| --- | --- | --- |
| w-1 | #1828 T1 | T1-1（ブラウザ・OS等を具体化し、値は未決として合意事項）、T1-2（応答時間と測定条件）、T1-3（決済代行の外部要因を保証の外・責任分界に）、T1-4（基準時点）、減点：法的な断定 |
| w-2 | #1828 T3 | T3-1（REQ-PERF-001・CON-003をIDで参照し、3秒・同時100・IE11を書き写さない）、T3-3（合意者・合意日・状態）、T3-4（未決）、減点：架空の合意（状態を合意済み・承認済みと書く） |
| w-3 | #1828 T4 | T4-1（無期限の可否を断定しない）、T4-2（期間と範囲を分ける）、T4-3（環境を列挙し対象外は互換性対応・見積）、T4-5（契約不適合）、減点：法的な断定 |
| m-r1・m-r2・m-r7 | #1829 R1・R2・R7（改訂版の観点） | 根拠のWAR IDと合意の版1.0、R1は差異の確認（BR-012）、R2は互換性対応・見積、R7は未決・未合意と判断者。減点：差異の確認前の無償の約束、未合意の行での無償・有償の確定、法的な断定 |
| s-1 | #1832 | 7つの事実（F1〜F7）がすべてある、経緯の文（変更前の値・変更の記述・理由）が0件、状態を「承認済み」と書かない |
| n-1 | #1828 N2 | 隣接：見積の依頼で`warranty-scope`を選ばない |

## 水準（`conditions.json`の`rule.levels`）

条件ごとに、各水準の率（その依頼の、数える有効な試行のうち合格の割合）が`min`以上なら合格。1件も有効な試行が無ければ不合格。

| 水準 | 依頼 | 指標 | min | 根拠 |
| --- | --- | --- | --- | --- |
| g1-select | 目的1の該当8件 | reach | 0.8 | #1823の本文の読込みの水準0.8 |
| g1-body | 同上 | bodyRead | 0.8 | 同上 |
| g1-warranty-reference | w-1〜3 | referenceRead | 0.8 | #1828の暗黙の選択で全件が`check-items.md`を読んだ |
| g1-warranty-templates | w-1・w-2 | expectReadsAll | 0.8 | Issueの完了の基準（Skillから雛形まで辿り着く） |
| g1-warranty-answer | w-1・w-3 | markers | 0.67 | #1828のSkillありは減点0、観点の約8割。各3回なので2/3 |
| g1-warranty-write | w-2 | writeOk | 0.67 | 同上 |
| g1-maintenance-reads | m-r1・r2・r7 | expectReadsAll | 0.8 | 品質保証範囲を正本として読む（#1829） |
| g1-maintenance-answer | m-r1・r2・r7 | markers | 0.85 | #1829の水準（7件中6件以上が合格、断定0） |
| g1-spec-templates | s-1 | expectReadsAll | 0.67 | Issueの完了の基準 |
| g1-spec-write | s-1 | writeOk | 1 | #1832の変更後2は2回とも事実がすべてあり経緯0、状態は提案 |
| g1-adjacent-skill | n-1 | forbidSkillsOk | 0.67 | #1828 N2 |
| g1-negative | n-2・n-3 | negativeOk | 0.8 | 該当しない依頼で読まない |
| g2-asc-select | u-bill-1・2、u-users、u-docs | reach | 0.8 | 変更の依頼でASCが選ばれる |
| g2-rule-read | u-bill-1・2 | expectReadsAll | 0.8 | 該当するpathの変更で固有ルールが読まれる |
| g2-rule-comply | u-bill-1・2 | writeOk | 1 | 差分が規則に違反しない（書かない試行も不合格） |
| g2-rule-not-read | u-users、u-docs、u-neg | forbidReadsOk | 0.8 | 該当しない変更で不要に読まない |
| g2-skill-select | u-skill-1・2 | bodyRead | 0.8 | 利用者のSkillが選ばれ読まれる |
| g2-skill-output | u-skill-1・2 | writeOk | 0.67 | Skillの書式で書く |
| g2-skill-distinguish | u-skill-1・2、u-est、u-users、u-docs、u-neg | forbidSkillsOk | 0.8 | 説明の近いSkillを選び分ける |
| g2-negative | u-neg | negativeOk | 0.67 | 該当しない依頼 |

## 規則

1. 条件ごとに、すべての水準が合格なら`meets-levels`、1つでも不合格なら`below-levels`。RとCの結果を並べて示す（Cの採用の判定ではない）。
2. 判定しない場合（「判定不能」。#1823と同じ）：測定が完了しておらず費用の線にも達していない、該当する依頼か該当しない依頼の有効な試行が0件の条件がある、有効な試行が1件も無い依頼がある、必須の置き換えが欠けている、置き換えた後の失敗が条件の数える試行の10%を超える。
3. 別の報告（合否には使わない）：目的1・目的2・該当しない依頼ごとの値、依頼ごとの記号（`A`適用・`B`本文まで・`E`入口だけ・`M`誤選択・`U`未選択、該当しない依頼は`O`過剰・`-`）、referenceの読込み、`expectReads`・`forbiddenReads`・`writeViolations`・`writeRequireMissing`の内訳、トークン・時間・費用。読まれなかった・守られなかった試行は、どこで止まったか（選択`reach`、本文`bodyRead`、reference・雛形`referenceRead`・`expectReads`、規則`writeViolations`）を`runs.json`の行から示す。
4. 失敗と置き換え（#1823と同じ）：process・APIのエラー、traceの欠落、init・result eventの無い記録、水準Wと違うinitは失敗として別に数え、同じ条件・依頼で次の番号（4、5、…）の試行で1回ずつ置き換える。1試行の予算による停止は失敗ではない。
5. 隔離の確認：測定の前に、R・Cそれぞれ1回のprobe（fixture EC1、水準W、6操作、`--debug-file`）を行い、`probe-check.mjs`のすべての項目と`compare`（ASCの17件のdescriptionがContextにあること、Skill一覧の予算の状態を含む）が合格した場合だけ測定する。不合格の条件に限り1回だけ再実行できる。目印fileの使用は、ownerの承認を`results/probe-approval.json`に記録してから行う。
6. 実行の順序と途中の停止：[run-order.json](run-order.json)（回を外側、各回の中は固定した18依頼の順、各依頼の中はR、Cの順）。判定してよいのは`complete`か`cap-reached`の場合だけ。
7. 費用：上限30 USD、停止の線29 USD（余裕1 USD）、1試行の予算0.5 USD、probe 0.35 USD。見込み約13.9 USD（計画の単価で18.1 USD）。
8. 解釈の限界：各依頼3回。目印は観点の一部を文字列で見るもので、これまでの評価の採点（別Contextの採点者）と同じではない。

## 限界（測定の前に分かっていること）

- Bashが無いので、Agentは`start`（`context.json`から該当する規約を選ぶCLI）を実行できない。固有ルールが読まれるのは、Agentが`context.json`かルールのfileを自分で読む場合だけである。利用者の環境（Bashあり）より読まれにくい側に偏る。水準X（Bashあり）は#1820の段階1で隔離の確認に通らなかった。
- 利用者のSkillはprobeのfixture（EC1）に無い。利用者のSkillがSkillの一覧に載るかは、probeでは確かめず、試行の記録（Skill tool呼出し・initのSkill一覧）で見る。
- 金額の規則の違反は文字列で見る。既存のコードが`bigint`で書かれているので、規則を読まずにコードに倣って守る場合もある（読込みと遵守は別に数える）。
- w-2・s-1・u-skillの書いたfileは、試行の終わりの`work/`の写しから読む（台帳の精算のsha256はtraceとmetaだけを持つ）。
