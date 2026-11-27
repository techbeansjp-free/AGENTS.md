# 利用者の環境での測定（#1840）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。

**状態：固定済み（下の「測定の前の固定」）、測定前（有料の実行は未実施）。** probeの前に、ownerによる目印fileの承認（`results/probe-approval.json`）が要る。

## 目的

利用者に届く形（公開したtarball、または候補のtarballを`project-assets --register-claude-skill --apply`で導入）でASCを入れた隔離環境で、次を測る（Issue #1840）。

1. 今回の改善（#1828 `warranty-scope`と品質保証範囲の雛形、#1829 `estimate-and-scope`の判定、#1832 仕様書の書き方の規則）が、自然な依頼文で選ばれ、本文・reference・雛形まで読まれ、これまでの評価と同じ方向の回答になるか。
2. 利用者が自分で入れたもの（`.agent-skill-chain/project/context.json`に登録した固有ルールと、`.claude/skills/<name>/`に置いた固有Skill）が、該当する依頼で読まれ守られ、該当しない依頼で読まれないか。説明の近いASCのSkillと選び分けられるか。

## 条件

| | R（リリース版） | C（候補版） |
| --- | --- | --- |
| tarball | GitHub Release v0.5.119（対象commit `c9288126`）。sha256 `ecc7afd0d6595824bb6362618af973e7b66e8a3aa64fee1c3fbdb4043bf61c13` | origin/main `c9288126`にPR #1837（`59ad479f`）とPR #1838（`98aabea2`）をmergeしたcommit `0c43eccb6942055bc64408194c1a298384804ea3`を`pack-candidate.mjs --version=0.5.119`で作ったもの。sha256 `e212e3a89bf9ac24fd63423d759dae7280fdc925b12508e8ae527b1fa6b7887c` |
| 照合 | `gh release download`のtarballのsha256が、releaseのassetのdigest、`SHA256SUMS`、release notesのPackage SHA256と一致。`c9288126`を同じ手順でpackしても同じsha256 | 一時のclone（`<scratch>/rel1840/cand-src`）でmergeとpackを行った。releaseとの差はestimate-and-scopeの本文、仕様書の雛形57件、`release-identity.json`だけ |
| 導入 | 利用者の手順（専用のworktreeで`project-assets --register-claude-skill --apply`、読む契機`claude-md`を採用）。目的2のfixtureでは、導入の後に利用者が固有ルールと固有Skillを置く | 同じ |

- 環境は#1823と同じ水準W（Read・Write・Edit・Glob・Grep・Skill、`acceptEdits`、Bashなし）と同じ隔離（試行ごとの空のHOME・設定directory、`--settings`のsandbox、repositoryと実HOMEの外、祖先に`CLAUDE.md`・`AGENTS.md`・`.claude`・`.git`が無いこと、認証は`CLAUDE_CODE_OAUTH_TOKEN`だけ）。
- 条件の違いはtarballだけ。dry runで、導入後のfileの差がestimate-and-scopeの本文（とその写し）、雛形（とその写し）、導入の記録だけであることを確かめた。

## fixture

| fixture | 内容 | 使う依頼 |
| --- | --- | --- |
| EC1 | ECサイトの受託案件。要件定義書の非機能は「最新のブラウザで動作すること」「快適に動作すること」だけ（#1828 T1・T4） | w-1、w-3、n-2、probe |
| EC3 | EC1に、仕様書の一部（REQ-PERF-001、CON-003、対応環境）を足したもの（#1828 T3） | w-2 |
| MN | 納品済みの受発注管理システム。#1829の案件の資料を、仕様書（品質保証範囲は合意済み、版1.0）と契約書の要約のfileに分けたもの | m-r1、m-r2、m-r7、n-1 |
| SP | 会員サイト。既存の仕様FN-003・SCR-005（変更前：メールアドレスだけ、有効期限10分）（#1832） | s-1、n-3 |
| U | 利用者の社内の請求管理（TypeScript）。導入の後に、利用者が`.agent-skill-chain/project/context.json`で`.agent-skill-chain/project/rules/money.md`（金額は整数の円で扱い浮動小数点を使わない）を`src/billing`に`appliesTo`で登録し、固有Skill `invoice-format`（請求書の書式）と`quote-format`（見積書の書式。ASCの`estimate-and-scope`と説明が近い）を`.claude/skills/`に置いた | u-* |

fixtureの全文は[conditions.json](conditions.json)の`fixtures`。導入したASCの`start`の選択（`projectContext`）で、`src/billing/invoice.ts`の変更では`money.md`が選ばれ、`src/users/store.ts`では選ばれないことを確かめた（モデルを呼ばない確認）。

## 依頼

[cases.json](cases.json)。依頼文は自然な文で、Skill名・fileのpathを含めない（試験で確かめる）。

| 目的 | 依頼 | fixture | 期待するSkill | 期待する読取り | 選ばれてはならない・読まれてはならない | 回答・差分 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | w-1 検収前に保証範囲の案 | EC1 | warranty-scope | 本文、`check-items.md`、雛形`00_利用案内.md`・`02_要件/03_品質保証範囲.md` | | #1828 T1の観点 |
| 1 | w-2 仕様書に保証範囲の文書を足す | EC3 | warranty-scope | 同上 | | 書いたfile：IDで参照し値を書き写さない、合意者・状態・未決、架空の合意なし |
| 1 | w-3 無期限・どのブラウザでもの要求 | EC1 | warranty-scope | 本文、`check-items.md` | | #1828 T4の観点、法的な断定なし |
| 1 | m-r1 保証環境での端数の不具合 | MN | estimate-and-scope | 本文、案件の品質保証範囲 | | WAR-002・版1.0・BR-012、調査前の無償の約束なし |
| 1 | m-r2 iPadのSafari | MN | estimate-and-scope | 同上 | | WAR-001・版1.0・互換性/見積 |
| 1 | m-r7 未決の行（移行データの重複） | MN | estimate-and-scope | 同上 | | WAR-005・未決/未合意・判断者 |
| 1 | s-1 FN-003・SCR-005を変更に合わせて書き直す | SP | asc | 本文、雛形`00_利用案内.md`と個別機能・個別画面の雛形 | | 書いたfile：7つの事実、経緯0、状態を承認済みにしない |
| 1 | n-1 絞り込み条件の追加の見積（隣接） | MN | estimate-and-scope | 本文 | warranty-scope | 前提・調査 |
| 1 | n-2 「保証範囲を顧客と合意済みです」の英訳 | EC1 | なし | | 雛形、warranty-scope | |
| 1 | n-3 今の仕様の有効期限を聞く | SP | なし | | 雛形 | 10分 |
| 2 | u-bill-1 得意先ごとの割引率 | U | asc | 本文、`money.md` | | `src/billing/`の差分に浮動小数点なし |
| 2 | u-bill-2 消費税を加えた合計 | U | asc | 同上 | | 同上 |
| 2 | u-users 名前検索の大文字小文字 | U | asc | 本文 | `money.md`、利用者のSkill | `src/users/`を書く |
| 2 | u-docs 開発手順にテストの方法 | U | asc | 本文 | `money.md`、利用者のSkill | `npm test`を書く |
| 2 | u-skill-1 請求書を作る | U | invoice-format（利用者） | 利用者のSkill | quote-format | 書いたfile：`INV-202611-NNN`・御中・振込先・合計187,000円 |
| 2 | u-skill-2 見積書を作る（説明が近い） | U | quote-format（利用者） | 利用者のSkill | invoice-format | 書いたfile：`Q-YYYYMM-NNN`・御中・30日・合計264,000円 |
| 2 | u-est 工数と納期の見積（説明が近い） | U | estimate-and-scope | 本文 | quote-format、invoice-format | 前提・調査 |
| 2 | u-neg 「請求書を送付しました」の英訳 | U | なし | | `money.md`、利用者のSkill | |

## 指標と規則

[decision-criteria.md](decision-criteria.md)で固定する（`conditions.json`の`rule`、`mode: levels`）。候補の採否の規則ではなく、条件ごとに固定の水準（20件）を満たすかを示す。RとCを並べ、該当する依頼と該当しない依頼を分けて示す。

## 費用とトークン

- 18依頼×各3回×2条件＝108試行と、probe 2回。
- 上限30 USD（owner）、余裕1 USD、停止の線29 USD。1試行の予算（`--max-budget-usd`と台帳の予約）0.5 USD、probe 0.35 USD。
- 見込み（#1823・#1820の段階2の平均から、読む・書くfileの量で見積もった種類ごとの単価）：保証範囲0.16、保守の判定0.12、仕様書0.22、見積0.10、該当しない0.03、変更0.18、利用者のSkill 0.10、probe 0.13 USD。計 **約13.9 USD**（計画の単価で18.1 USD）、入力（入力＋cache）約**1,017万**トークン、出力約**32万**トークン。損益分岐（線までに使える1試行の平均）0.264 USD。
- 採点はモデルを使わない（目印と書いたfileの文字列の照合）ので、採点のトークンはかからない。
- 減らす案（必要なら）：各2回にすると72試行、見込み約9.3 USD。

## 手順（統括が行う）

`<scratch>`は一時directory、`<repo-root>`はrepositoryのcheckout。harnessはsandboxの外のshellで実行する。台帳を手で編集しない。

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1840-user-environment/config
LEDGER=<scratch>/rel1840/ledger/ledger-1840.jsonl
TGZ_R=<scratch>/rel1840/release/agent-skill-chain-0.5.119.tgz
TGZ_C=<scratch>/rel1840/candidate/agent-skill-chain-0.5.119.tgz
# 0. ownerの目印fileの承認をresults/probe-approval.jsonに記録してcommitする
# 1. dry run（新しいdirectory）
node $H/dry-run.mjs <scratch>/run1840dry --tarball-R $TGZ_R --tarball-C $TGZ_C --config $EV --out <scratch>/run1840dry.json
# 2. 固定（済み。下の「測定の前の固定」）
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
# 3. fixture：条件×5
FX=<scratch>/run1840/fixtures; mkdir -p <scratch>/run1840/tmp
for C in R C; do for F in EC1 EC3 MN SP U; do
  TGZ=$([ $C = R ] && echo $TGZ_R || echo $TGZ_C); SHA=$(shasum -a 256 $TGZ | cut -d' ' -f1); mkdir -p <scratch>/run1840/tmp/$C-$F
  node $H/make-fixture.mjs $C $F $TGZ $SHA $FX/fixture-$C-$F <scratch>/run1840/tmp/$C-$F --config $EV
done; done
# 4. 隔離の確認（R・C各1回、fixture EC1）。目印fileは確認の後に消す
node $H/markers.mjs create <repo-root> --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs <scratch>/run1840/runs R probe 1 --fixture $FX/fixture-R-EC1 --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs <scratch>/run1840/runs/R-probe-1 R <home marker> <repo marker> <repo-root> --config $EV > <scratch>/run1840/probe-R.json
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs <scratch>/run1840/runs C probe 1 --fixture $FX/fixture-C-EC1 --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs <scratch>/run1840/runs/C-probe-1 C <home marker> <repo marker> <repo-root> --config $EV > <scratch>/run1840/probe-C.json
node $H/probe-check.mjs compare <scratch>/run1840/probe-R.json <scratch>/run1840/probe-C.json --out <scratch>/run1840/runs/probe-compare.json --config $EV
node $H/probe-check.mjs publish $EV/results/probes <scratch>/run1840/probe-*.json <scratch>/run1840/runs/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root <scratch>/run1840/runs --config $EV
node $H/markers.mjs remove <repo-root> --config $EV
# 5. 測定：固定した順の108試行（止まれば同じcommandで次から続く）、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs planned <scratch>/run1840/runs --fixtures $FX --ledger $LEDGER --run --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs replacements <scratch>/run1840/runs --fixtures $FX --ledger $LEDGER --run --config $EV
# 6. 固定の照合、公開する記録の作成（生の実行記録は公開しない）、判定
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
node $H/collect.mjs <scratch>/run1840/runs $EV/results --ledger $LEDGER --config $EV
node $H/judge.mjs $EV/results --runs-root <scratch>/run1840/runs --ledger $LEDGER --out $EV/results/judge.json --config $EV
```

- `--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。
- 台帳とtarballと生の記録は`<scratch>`に置く。scratchが消えると判定（生の記録からの作り直し）ができないので、測定の終わりまで消さない。

## モデルを呼ばない確認（2026-11-27）

- 共通の仕組みの試験（試験用の設定、#1823と#1840の設定）：34件合格。
- dry run（R・C両方、本物のrelease tarballと候補のtarball）：全16項目が合格。条件ごとに5つのfixtureに17件の入口と`claude-md`の採用、`cases.json`の`needs`（雛形・固有ルール・固有Skillのfileがあること）、R・Cの導入後の差が許される範囲に収まり必要な差（estimate-and-scopeの本文、雛形`00_利用案内.md`・`03_品質保証範囲.md`・個別機能・個別画面）を含むこと、probe 2回と108試行の起動command。

## 測定の前の固定

- `results/fixation.json`の最初の記録のcommitは`bf65bb54c275fb5609957bc1d24fa828dc4b9dcb`。台帳idは`1a8cfa06-b3b2-4f36-be0f-ff018e8ca631`、台帳は`<scratch>/rel1840/ledger/ledger-1840.jsonl`（予約0件）。`run-trial.mjs`はこの記載を照合する。
- 固定の記録は、この設定の5file（`decision-criteria.md`・`cases.json`・`conditions.json`・`release.json`・`run-order.json`）と、共通の仕組みのmodule 16件のsha256を持つ。測定の終わりまで、共通の仕組みも変えない。
- 測定の前の独立レビューはまだ行っていない。レビューで固定したfileを直す場合は、測定の前（台帳に予約が無い間）に限り、`results/fixation.json`を消して新しい台帳で`init`をやり直し、このREADMEの記載を更新する（`refix`は`probe-check.mjs`の是正だけ）。

## 限界

- Bashが無いので`start`を実行できない。固有ルールは、Agentが`context.json`かルールのfileを自分で読んだ場合だけ読まれる。利用者の環境より読まれにくい側に偏る。
- 回答の観点は、これまでの評価の観点のうち文字列で確かめられる部分を目印にしたもの。これまでの評価の採点（別Contextの採点者）とは同じではない。
- 各依頼3回。数試行の差は偶然の範囲を出ない。
