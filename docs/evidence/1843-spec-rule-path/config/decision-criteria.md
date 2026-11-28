# 判定の規則（#1843。モデル実行の前に固定）

対象：#1843の測定。利用者に届く形でASCを入れた隔離環境で、ascの本文に足した1文（仕様書を書く・直す変更では、書く前に仕様書の書き方を読む）によって、既存の仕様書を直す依頼で書き方の規則（雛形の`00_利用案内.md`の「書き方」）が読まれ、書いた本文が規則に合うか。仕様書に関係しない依頼で、規則や雛形が読まれないか。

判定は共通の測定の仕組み（[../../shared-harness/](../../shared-harness/)）の`judge.mjs`だけで行い、規則は[conditions.json](conditions.json)の`rule`（`mode: levels`）で与える。評価結果を見た後に、この規則・[cases.json](cases.json)・[conditions.json](conditions.json)・[release.json](release.json)・[run-order.json](run-order.json)・共通の仕組みのmoduleを変えない。

## 決まっていること

| 項目 | 内容 |
| --- | --- |
| 条件 | C（候補版：PR #1838のhead。#1832の規則と#1843のascの1文）とB（基準：Cから#1843のcommitだけを`git revert`したもの）。どちらも`project-assets --register-claude-skill --apply`で導入し、読む契機`claude-md`を採用する。違いはascの本文（とその写し）と`src/project-assets.mjs`の写し（linkの書換え）だけ（dry runで確かめる） |
| 環境 | #1840と同じ（水準W：Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、Bashなし、同じ隔離の設定） |
| 依頼と回数 | #1840のs-1・n-2・n-3の3依頼、各条件各6回、計36試行と、probe 2回（fixture SP） |
| 費用 | ownerの上限20 USDは#1843・#1844・#1846の**合計**。各Issueへの割当て（2026-11-28、Issue #1843・#1844・#1846に記録）で守る：#1843は6 USD、#1844は10 USD、#1846は3 USD。`conditions.json`の`ownerCapUsd`はこのIssueの割当て6 USDで、この測定の上限`capUsd`も6 USD（停止の線5.5 USD） |
| 判定の性質 | 合否を見るのはC。Bは同じ時期・同じ環境の対照として並べて示す（Cの読込みが1文によるものかを見るため）。#1838のmerge・#1843のcloseはownerが決める |

## #1840からの違い

依頼文・fixture・書いたfileの照合（7つの事実、経緯の目印、状態）は#1840と同じ。違いは次のとおり。

- s-1の`expectReads`は、規則のある`00_利用案内.md`だけにした。#1840は個別機能・個別画面の雛形の読取りも求めたが、Issueの完了の基準は「書き方の規則のある文書が読まれること」で、1文もそこへ導くだけなので、雛形の読取りは`report.reads`で報告するだけにする。
- 雛形の照合は、導入した写し（`.agent-skill-chain/templates/specs/`）に加えて配布の写し（`.agent-skill-chain/managed-runtime/v05/templates/specs/`）も含める（PR #1842のレビュー、#1845）。
- s-1はFN-003とSCR-005の両方を書き直すことを求める（`writes.requireFiles`、#1845）。
- 水準の`min`は分数で書き、整数で比べる（#1845）。
- 試行ごとに、`references/workspace.md`の読取りを報告する（#1840のs-1の試行が辿った経路）。
- 回数は各条件6回（#1840は3回）。条件はB（Cから#1843の製品のcommitを戻したもの）とC（#1840はRとC）。
- 該当しない依頼が隣り合わない並びの検査（`nonAdjacentKinds`）は外した。3依頼のうち2件が該当しない依頼で、満たす並びが無いため。
- 水準`g1-negative-templates`（n-2・n-3で雛形・規則を読まない、1/1）を足した（ownerの決定、2026-11-28）。

## 数え方

#1840の[decision-criteria.md](../../1840-user-environment/config/decision-criteria.md)の「数え方」と同じ。次を加える。

- 「読まれた」`expectReads`（s-1）：`^\.agent-skill-chain/(managed-runtime/v05/)?templates/specs/00_利用案内\.md$`のRead（結果がerrorでないもの）。どの節を読んだか（「書き方」まで読んだか）は確かめない（Readの範囲の指定は記録しない）。
- 「不要に読まない」`forbidReads`（n-2・n-3）：`^\.agent-skill-chain/(managed-runtime/v05/)?templates/specs/`のReadが無いこと。`negativeOk`はこれとASCのSkillに触れないことの両方。
- 「書いたfile」`writes`（s-1）：#1840と同じ`require`・`forbid`に加え、`requireFiles`のFN-003とSCR-005の両方を書いたこと。

## 水準（`conditions.json`の`rule.levels`）

条件ごとに、各水準の合格した試行の数`ok`と有効な試行の数`n`が、分数`a/b`について`ok × b ≥ a × n`なら合格（#1845）。1件も有効な試行が無ければ不合格。

| 水準 | 依頼 | 指標 | min | 根拠 |
| --- | --- | --- | --- | --- |
| g1-select | s-1 | reach | 5/6 | #1840の0.8を6試行に当てた値（5/6） |
| g1-body | s-1 | bodyRead | 5/6 | 同上。本文を読まなければ1文に届かない |
| g1-spec-templates | s-1 | expectReadsAll | 2/3 | Issueの完了の基準（#1840のg1-spec-templatesの0.67）。6試行で4件 |
| g1-spec-write | s-1 | writeOk | 1/1 | Issueの完了の基準（#1840のg1-spec-writeの1）。6試行で6件 |
| g1-negative | n-2・n-3 | negativeOk | 5/6 | #1840の0.8を12試行に当てた値（10件）。#1840ではR・Cとも6/6 |
| g1-negative-templates | n-2・n-3 | forbidReadsOk | 1/1 | ownerの決定（2026-11-28、#1843のcomment）：n-2・n-3で雛形・規則を読む試行は0件でなければならない。12試行で12件 |

- s-1の書いたfileの照合は、#1840で校正した（[calibration-table.md](../../1840-user-environment/config/calibration-table.md)：s-1 6/6、FN-003とSCR-005の2fileに分けた形12/12）。2fileに分けた形は`requireFiles`も満たすので、校正をやり直さない。
- g1-negative-templatesの線（1/1）はownerの決定（2026-11-28、Issue #1843のcomment）。Issueの完了の基準「規則や雛形が不要に読まれない」に数が無かったので、独立レビュー（M2）を受けてownerに聞いた。g1-negativeは5/6のまま残す。negativeOkは雛形・規則の読取りに加えてASCのSkillに触れないことも数え、ownerの決定は雛形・規則の読取りについてだけなので、Skillに触れることの許容は#1840の0.8のままにする。雛形・規則を読んだ試行はg1-negative-templatesで不合格になる。
- Bの結果は合否に使わない。CがBより読まれたかは、試行の数で並べて示すだけで、検定はしない。

## 完了と費用

`maxFailureRate`（失敗した試行の率の上限）、必須の置き換え、停止の線は#1840と同じ規則（共通の仕組みの`order.mjs`）。停止の線に達したら、その時点の記録で判定し、足りない試行を報告する。
