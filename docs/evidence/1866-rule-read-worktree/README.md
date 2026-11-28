# 利用者が作ったworktreeでの固有ルールの読込み（#1866）：結果

開発時の検証資料であり、配布対象に含めない。設定と手順は[config/README.md](config/README.md)、判定の規則は#1844の[decision-criteria.md](../1844-rule-read-bash/config/decision-criteria.md)（ownerの決定で変えずに使う）。

## 測ったこと

ASCを利用者に届く形で入れた隔離環境で、15試行を行った（#1840の5依頼×各3回、条件Rだけ）。

- R：GitHub Release v0.5.134のtarball（固定の時点で最新。sha256 `a5245996…f0e9`）。
- 環境：#1844の水準X（#1840の水準WにBashを足し、Bashは`confined`のsandboxの中だけ）、fixture U。試行の前に、導入したASC CLIの`worktree-create`をsandboxの外で実行し（利用者が自分のterminalで行う手順。#1861）、作られたworktree（branch `test/1866-trial`）でClaude Codeを起動した。
- Claude Code 2.1.323、`claude-sonnet-5-5`。

測定は2026-11-28に行った。最初の固定は`3b429132`（[config/results/fixation.json](config/results/fixation.json)、台帳`226d63c3`）。記録は[config/results/](config/results/)にある（`judge.json`、`runs.json`、`trials.json`、`ledger.jsonl`、`probes/`）。生の実行記録（`/var/tmp/r1866/`、`/private/var/tmp/asc-eval-1866/`）はcommitしていない。

## 結論

- 判定：`below-levels`（仮置きの水準の一部を満たさない。水準はownerが決める）。測定は完了した（`complete`）。失敗した試行と置き換えは0件。
- **固有ルール`money.md`は6試行のどれでも読まれなかった（0/6）。`start`は15試行のどれでも試みられなかった（0/12、`attempted`も0）。** `context.json`も読まれなかった（15試行で0回）。
- Bashは使えて、使われた（u-neg以外の12試行で計70回。`cat`・`sed`・`git`・`node`等）。sandboxが`start`を止めたのではない。試行の記録（`trace.jsonl`の全体）に`asc-v05.mjs`・`mjs start`・`rules/money.md`・`project/context.json`の文字列は一度も無い。
- 届いているもの：ascの`SKILL.md`の読込み（12/12）、referenceの読込み（12/12。`implementation.md`）、規則に違反しない差分（6/6）、該当しない変更・依頼で読まない（9/9）、該当しない依頼での不適用（3/3）。
- 回答と差分は、採点（`judge.mjs`）で数えた後に一部を確かめた（下の「止まった場所」）。

## 水準ごとの結果

| 水準 | 依頼 | #1866 R（v0.5.134、水準X、worktreeで起動） | #1840 R（v0.5.119、水準W、Bashなし） | #1840 C（候補） | min（仮置き） |
| --- | --- | --- | --- | --- | --- |
| rule-read（`money.md`の読込み） | u-bill-1・2 | **0/6** | 1/6 | 0/6 | 5/6 |
| start-ran（`start`の実行） | u-bill-1・2、u-users、u-docs | **0/12** | —（Bashなしで実行できない） | — | 2/3 |
| rule-comply（差分が規則に違反しない） | u-bill-1・2 | 6/6（`scope: code`） | 4/6（`scope`なし） | 5/6（`scope`なし） | 1 |
| rule-not-read（該当しないもので読まない） | u-users、u-docs、u-neg | 9/9（strictも9/9、`onlyUnbounded` 0） | 9/9 | 9/9 | 7/9 |
| （報告だけ）asc-select | u-bill-1・2、u-users、u-docs | 12/12 | 12/12 | 12/12 | 5/6 |
| （報告だけ）negative | u-neg | 3/3 | 3/3 | 3/3 | 2/3 |
| （参考）`context.json`の読込み | 5依頼 | 0/15 | 0/15 | 0/15 | — |

- #1840の値は公開した記録（[../1840-user-environment/config/results/runs.json](../1840-user-environment/config/results/runs.json)）のもので、採点し直していない。
- #1844は未判定（probeが2回とも不合格、15試行なし）なので、並べる値は無い。
- #1840と版（v0.5.119とv0.5.134）、水準（WとX）、起動の場所（main checkoutとworktree）が違う。差は1つの要因に帰せない。
- 規則の遵守は数え方が違う（#1840は`scope`なしでコメントの中の小数も数えた。この測定は#1845の`scope: "code"`）。同じ規則では比べられない。

## 止まった場所

- **`start`に進まない。** u-bill・u-users・u-docsの12試行は、どれも最初にascの`SKILL.md`をReadし、次にreferenceの`implementation.md`（Readか`sed`・`grep`）とコードを読み、そのまま実装した。`SKILL.md`は「変更を伴う依頼では、コードを詳しく読む前・変更する前に…標準入口は`start <project-directory>`」と書くが、`start`は一度も実行されなかった。
  - 起動したのがすでに専用のworktreeなので、作業場所を作る段を済んだものとして飛ばした可能性がある（推測。測っていない。#1840のmain checkoutの試行でも`start`はBashが無く実行できなかったので、比べられない）。
  - `start`の出力が`money.md`を示すのが規則を読む経路なので、`start`に進まなければ`money.md`は読まれない。`context.json`を直接読む試行も無かった。
- **規則は守られた。** u-billの6試行の`src/billing/`の差分に、小数のリテラル・`parseFloat`等の照合は当たらなかった（6/6）。6試行とも`invoice.ts`は`bigint`を使っている。規則のfileは読まれていないので、既存のコードの`bigint`に倣った可能性がある（推測。#1840と同じ）。
- commitは5試行で行われた（u-bill-1の1回、u-docsの2回、u-usersの2回。`report.commands.git-commit`。合否に使わない）。起動したworktreeの中のcommitで、sandboxは止めなかった。
- Bashの結果がerrorになったのはu-billの15回（u-users・u-docsは0回）。許可の層の拒否が多い：`Contains brace with quote character (expansion obfuscation)`（here-documentでfileを書く等、8回。その後Writeで書き直した）、`A variable in this command can't be checked before it runs`（2回）、`CLAUDE_CODE_TMPDIR`の下へのWriteの許可の要求（1試行で2回）。残りは終了code 1（無いfileの`cat`、試験の実行の失敗）。隔離の項目ではなく、合否にも使わない。
- PR #1875の再レビューL-1（`fabricates`が規則より厳しい偽陰性）：`start`を試みた呼出しが0件なので、この測定の値には効かない（`report.commands.start`の`attempted`・`outputSchema`も15試行で0）。

## 隔離の確認

- probeは1回（R-probe-1）で合格した。42項目すべて合格（[config/results/probes/](config/results/probes/)）。
  - `insideWorktreeCreateStops`：sandboxの中の`worktree-create`は`Git worktree records are not writable`で止まり、branch `test/1866-probe`も`.worktrees`の下のdirectoryも、main checkoutと試行の前のworktree以外のGitのworktreeも作られなかった（`worktreeCreateStopped`、`meta.json`の`probeEndState.worktreeCreateLeft`）。
  - #1844と同じ項目：目印fileと禁止したpathの読取り、試行の外への書込み、通信は拒否された。目印のtokenと認証情報はどの記録にも無かった（`markerTokensAbsent`・`credentialNotLeaked`）。成功すべきBash（`cat CLAUDE.md`・`git status`・ASC CLIの`--help`等）は成功した。
  - `cwd`は起動したworktree（`.worktrees/20261128_230616-1866-trial`）と一致した。
- 目印fileは`markers.mjs create`で作り、probeの後に`markers.mjs remove`で消した（失敗しても消すscript）。2つとも無いことを`ls`で確かめ、目印のために作られた空の`.agent-skill-chain/local/`も消した。
- 試行のdirectoryに`cleanup-left.txt`は無かった。
- token fileは中身を表示せず、手順どおりenvへ渡しただけである。

## 費用・トークン・時間

| | probe | 測定（15試行） | 計 |
| --- | --- | --- | --- |
| 費用（USD） | 0.24（0.2353） | 2.28（2.2814） | 2.52（台帳の合計2.5166） |
| 入力（入力＋cache、トークン） | 99,917（cacheの読込み69,479、作成30,430、入力8） | 3,651,681（cacheの読込み3,263,185、作成388,268、入力228） | 3,751,598 |
| 出力（トークン） | 10,660 | 40,151 | 50,811 |
| ターン | 44 | 143 | 187 |
| 時間 | 1.1分（`wallMs` 66,218） | 試行の時間の和7.6分（`durationMs`）、`wallMs`の和8.2分。実時間10.6分（23:07:57〜23:18:34） | |

- 上限9.42 USD（#1844の割当て10 USDから#1844の2つの台帳0.58 USDを引いた残り）、停止の線8.42 USD。使ったのは2.52 USD。
- dry runの見込み（3.86 USD、入力約292万、出力約5.5万トークン）に対し、費用は少なく、入力は多かった。
- トークン数は、各試行の`trace.jsonl`の最後の`result`の`usage`（Claude Codeがすべての呼出しを足した値）による。
- 採点はモデルを使わない。

## ownerが決めること

1. 固有ルールの読込みの経路をどうするか。
   - 利用者がworktreeを作って起動する手順では、Bashが使えても`start`に進まず、`money.md`は0/6だった。
   - `start`を経ない経路（例：`CLAUDE.md`の読む契機や`SKILL.md`の本文から`context.json`を直接示す）か、worktreeで起動した場合も`start`を実行させる書き方か。
2. 直す場合のIssue（案）：起動した場所がすでに専用worktreeのとき、`start`を実行するか、`context.json`の規則を読むかを、ascの本文で明確にする。

## 限界

- 各依頼3回なので、値の幅は大きい。
- `start`を飛ばした理由は測っていない（上の推測）。
- [config/README.md](config/README.md)の「限界」（試行の前のworktreeはharnessが作る、祖先の`CLAUDE.md`も読まれる、PR #1875の再レビューのL-1・L-2等）。L-2（作ったばかりのworktreeが空であることを確かめていない）はこの測定でも確かめていない。
