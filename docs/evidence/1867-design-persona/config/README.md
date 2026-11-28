# デザイン作成Skillの生成の測定（#1867）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。#1843の設定（[../../1843-spec-rule-path/config/](../../1843-spec-rule-path/config/)）と同じ形である。

**状態：準備済み、固定の前。** dry runは合格した（下の「確認」）。計画（[../EVAL_PLAN.md](../EVAL_PLAN.md)）の固定、独立レビュー（1回目の指摘は反映済み）、ownerの目印fileの承認（`results/probe-approval.json`は仮の値）、固定の記録（`results/fixation.json`）がまだ。有料の実行はしていない。

## 目的

評価の計画のうち、**生成**（B・Sの24試行とprobe 2回）を、共通の仕組みで行う。共通の仕組みが数えるのは機械で数えられる部分だけである：Sで`design-creation`の`SKILL.md`とreferenceが読まれたか、依頼の成果物と記録（`out/DESIGN-NOTES.md`）が書かれたか。記録の中身（利用者の像と根拠・仮説の区別、判断と利用者の対応）は、`collect.mjs`の後に、条件名を伏せた新しいcontextが数える。層1・層2・層3は共通の仕組みの外で、#1835・#1852の道具で行う。判定の規則は[decision-criteria.md](decision-criteria.md)。

## 条件

| | B（基準） | S（候補） |
| --- | --- | --- |
| 中身 | release v0.5.131（現在のmain `221283eb`。17 Skill） | Bに`design-creation`（[../candidate/design-creation/](../candidate/design-creation/)の`SKILL.md`とreferences 2件）を足したもの |
| tarball | `gh release download v0.5.131`。sha256 `e8135f4a07735c07d90fec266a491c639ef9539041d64580b4db518244f57113`（assetのdigest・`SHA256SUMS`と一致。このbranchの`0a029231`で`pack-candidate.mjs --version=0.5.131`しても同じ） | このbranchの`3e4c7caf`（候補と配布の登録を足したcommit。レビューのL4で4節を書き分けた候補）で`node scripts/pack-candidate.mjs <dir> --version=0.5.131`。sha256 `a37e90c073cca0359a1447578e3ecf6fdca2d33630a29d02f34ccb43d9ee7626`（別のdirectoryへの2回目のpackも同じ）。次のcommit `1e7b2736`で取り消した（#1815と同じやり方）ので、branchの配布物はmainと同じ。前の版（`995f41de`でpack、`d1bccb5c…`）は使わない（`release.json`の`S.superseded`） |
| 導入 | 利用者の手順（専用のworktreeで`project-assets --register-claude-skill --apply`、読む契機`claude-md`を採用） | 同じ |

- 両tarballを展開した差（`diff -rq`）：Sは`skills/design-creation/`を足し、`package.json`（files）・`src/runtime-files.json`（3件）・`skills/README.md`（表の1行）・`src/project-assets.mjs`（`maxAssets` 313→321）・`release-identity.json`だけが違う（[release.json](release.json)の`S.differsOnly`）。
- 配布の登録（`995f41de`と、それを写した`3e4c7caf`）は、`warranty-scope`を足したcommit `b8cfec86`に倣った（`test/helpers/distributed-skills.mjs`と`test/test_project_assets.mjs`の数も同じcommitで変え、`0a029231`・`1e7b2736`で戻した）。`qualityContractVersion`は上げていない（評価のためのpackで、配布しないため）。

## fixtureと依頼

| ケース | fixture | 種類 | file（sha256で固定。[conditions.json](conditions.json)の`fixtures`） |
| --- | --- | --- | --- |
| ui02-exhibition | UI02 | 公開ページ | #1804の`BRIEF.md`、`FONTS.md` |
| lp-new | LP | 公開ページ | [../cases/lp-new/](../cases/lp-new/)の`BRIEF.md`と`inquiries.md`、#1804の`FONTS.md` |
| ui03-dashboard | UI03 | 業務の画面 | #1804の`BRIEF.md`、`data.json`、`FONTS.md` |
| ui08-existing-ds | UI08 | 業務の画面 | #1804の`BRIEF.md`、`app/`の既存のfile 4件、`FONTS.md` |

- 依頼文は#1804の生成の指示（`../../1804-design-judgment/harness/gen-prompt.txt`）のまま。fixtureのfileは#1804の生成（`run-gen.mjs`）が置いたものと同じ。違いは、ASCを利用者に届く形で導入すること（`CLAUDE.md`は読む契機の案内文だけ）と、空の`out/`を置くこと（#1815・#1820の段階2と同じ）。
- **lp-new**：架空の出張のスマートフォン相談サービスのLP。依頼文の「利用者」節はui02より薄く（「困っている人とその家族」と、資料の場所だけ）、問合せの記録（12件と代表のメモ）を読むと分かることがある：問合せの半数は家族から（うち2件は対応地域の外の遠方）、本人は電話だけを使う、料金の総額・出張費と、訪問する人の身元・暗証番号を気にする、家族は夜にスマートフォンで見る、2人で受ける料金は未定。依頼文の「必ず載せる内容」には無い。実在の企業・個人の名前は使っていない。
- 書いたfileの照合（[cases.json](cases.json)の`writes.requireFiles`）：ui02・lp-new・ui03は`out/index.html`と`out/DESIGN-NOTES.md`、ui08は`app/billing.html`と`out/DESIGN-NOTES.md`。

## 共通の仕組みに加えたもの（#1867）

どれも設定のfieldで働き、fieldの無い設定（試験用、#1823・#1840・#1843・#1846）の動きは変えない。試験（`harness.test.mjs`の`#1867`の7件。下の最後の項目の3件を含む）で確かめた。

- `conditions.json`の`ascSkillsByCondition`：条件ごとの配布Skillの一覧（Sは`design-creation`を含む18件）。採点（`score.mjs`の`ascSkillsOf`）、probeの期待するdescriptionの件数と利用者のSkillの分け方（`probe-check.mjs`）、dry runの入口の数・referenceの所在・入口の比較（両条件が配布するSkillだけを比べる）が使う。
- fixture`design`の`files`にsubdirectoryのpath（ui08の`app/tokens.css`等）を書ける（`make-fixture.mjs`の`writeSources`）。
- `rule.negativesRequired: false`：該当しない依頼の無い設定で、「該当しない依頼の有効な試行が無い」ことを未判定の理由にしない（`score.mjs`の`verdictOf`）。
- `conditions.json`の`fixedExtra`（レビューのH2）：設定directoryの中のfileを、固定するものに足す（`config.mjs`の`configFixed`、`fixation.mjs`の`fixedOf`）。#1867は`layers/`の6件。設定directoryの外・`results/`・重複・無いfileは拒否する。fieldの無い設定は従来と同じ一覧。
- `dry-run.mjs`の入口の比較を関数にした（`otherEntriesDiffer`。動きは同じ）。
- 試験（レビューのL5ほか）：`ascSkills`の無い設定の`fixtureReferences`、入口の比較、`fixedExtra`の3件を足した。

## 費用とトークン

- 2条件×4ケース×3回＝24試行と、probe 2回（fixture LP）。
- ownerの上限20 USD＝生成の台帳＋門の数え＋層2のFable（計画の「費用」）。生成の割当ては12 USD（`ownerCapUsd`・`capUsd`、余裕0.5、停止の線11.5 USD）、門の数えは見込み約1.8 USD（各回`--max-budget-usd 1.5`）、層2のFableの上限はmin(8, 20 −（生成の台帳＋門の数えの実費）)で見込み約5.3 USD（6 USD未満なら層2を始めない）。Codexは費用を報告しないので、呼出しの回数（24回。各呼出しの再試行は1回までなので最大48回）で抑える。
- 1試行の予算（`--max-budget-usd`）1.5 USD（#1804の生成と同じ）。probeは0.6 USD。
- 見込み：#1804のsonnetの生成（ui02・ui03・ui08、1試行0.15〜0.28 USD）に、ASCとSの本文・reference（約7 KB）の読込みを足して1試行0.32 USD、計 **約8.0 USD**（計画の単価0.45で約11.2 USD）。入力（入力＋cache）約980万、出力約29万トークン（#1804は試行ごとのトークンを記録していないので粗い）。完了できる1試行の平均の上限は0.417 USD（`breakEvenPerTrialUsd`）。これを超えると停止の線で止まり、結論は「未判定」になる（計画の結論の0）。

## 確認（2026-11-28、モデルを呼ばない）

```text
node --test docs/evidence/shared-harness/test/              # 59件すべて合格（#1867で足した7件を含む）
node --test docs/evidence/1835-design-eval-layers/harness/   # 41件合格、1件skip（描画の差の試験。Dockerの結果が要る。#1867のowner-page --allow-missingと有料の--cap-usd（capFromArgでは必須。第3回のL-6）の2件を含む）
node --test docs/evidence/1852-p-good-pairs/harness/         # 9件すべて合格
node --test docs/evidence/1867-design-persona/harness/       # 27件すべて合格（decide.test.mjsの14件、harness.test.mjsの13件。第3回レビューの対応で7件を足した）
node docs/evidence/shared-harness/dry-run.mjs <scratch>/rel1867/run1867dry4 \
  --tarball-B <scratch>/rel1867/release/agent-skill-chain-0.5.131.tgz \
  --tarball-S <scratch>/rel1867/candidate/agent-skill-chain-0.5.131.tgz \
  --config docs/evidence/1867-design-persona/config --out <scratch>/rel1867/run1867dry4.json
```

dry run（3回目のレビューの指摘を直した後にも`run1867dry4`で`pass: true`（16の照合すべて）。以下は2回目のレビューの指摘を直した後の記録で、同じ結果。`inquiries.md`を直したのでfixtureを作り直した。fixtureの`inquiries.md`は`b463bdf5…`。tarballはB `e8135f4a…`・S `a37e90c0…`のまま（ケースはtarballに入らない。Sのtarballに`docs/evidence`のentryは0件））：`pass: true`（16の照合すべて）。入口はBが17件、Sが18件。Sのfixtureに`design-creation`の本文とreferences 2件があり、候補とbyte単位で一致する。導入後の差は`design-creation`のfile（本文・reference・その写し・Claude Codeの入口）、`skills/README.md`とその写し、`distribution.json`、`managed-runtime/`の`package.json`・`src/runtime-files.json`・`src/project-assets.mjs`だけで、他の17件の入口は同じ（2回目のdry runも同じ13件）。tarballでは`release-identity.json`も違う（上の「条件」）が、導入後の`managed-runtime/`には`release-identity.json`が置かれない（両条件とも）。`conditions.json`の`dryRun.installedDiffExpected`は、違ってもよいものとしてそれを含む（違うことは求めない）。計画24試行、`--max-turns`なし、`--max-budget-usd 1.5`。

層2・層3と集計の道具のdry run（第3回レビューの指摘を直した後。モデルを呼ばない。`eval.json`で、合成の生の記録（24試行と、失敗した`S-lp-new-2`を置き換えた`S-lp-new-4`）と`runs.json`、合成の画面を置き、`ui08-existing-ds/S-r1`の画面を欠いた。`judge.json`は完了かつ`capReached: true`（台帳10.2 USD）にした）：`gate-packet.mjs pack --runs-json --replace S-lp-new-2=S-lp-new-4`は各回24件（`absent`なし）、`check`は両回とも合格、`combine`は門`judged`（4ケース）・費用1.8 USD。`decide.mjs cap`は上限8 USD（20−10.2−1.8）。`owner-page.mjs --allow-missing`は36組（`missingScreens`が1）、`make-packets.mjs --allow-missing`は各回11束、`run-eval.mjs run --dry-run --retries 1 --cap-usd 8 --dry-invalid-every 7`はFable・Codexとも22回すべて有効（再試行3回）。`decide.mjs decide`は結論「採用」（4段、n 36・k 29）で、完了した生成を停止の線とみなさず（High-1）、欠けた画面の3組をB側として数え（`forcedPairs`）、業務の画面の害の数えではその3組を1組とした（ui08：B 2・S 5。M-2）。Pの台帳のheaderの`capUsd`（8）と上限、keyのseedと回の照合も通った（L-2）。

## 層1〜3と門の数えの設定（`layers/`）

レビューのH2・M1で、生成の後に使う設定も、固定の前に置いた（計画の「判定」、[decision-criteria.md](decision-criteria.md)の冒頭）。

| file | 内容 | 使う道具 |
| --- | --- | --- |
| `layers/gate-count.json`・`gate-count-prompt.md` | 門の記録の中身の数え方（`opus`、host-sessionと同じ制限の`claude -p --max-budget-usd 1.5`、読取りのみ、2回、seed、基準、出力の形、やり直し、まとめ方、費用） | [../harness/gate-packet.mjs](../harness/gate-packet.mjs) |
| `layers/layer1-cases.json`・`layer1-gold.json` | 層1のケースの設定（ui02・ui03・ui08は#1835と同じ値、lp-newは#1867で決めた）と、lp-newの必須項目 | #1835の`run-layer1.mjs layer1 --cases --gold-add`、[../harness/layer-pages.mjs](../harness/layer-pages.mjs) |
| `layers/eval.json`・`lp-new-brief-for-evaluation.md` | 層2（`pPairs`：同じ回の12組）と層3（`layer3.pairs`：36組）、幅、seed、Pの依頼文のsha256、上限、ownerの選択肢、判定の数値（`decision`）。lp-newの評価用の依頼文（`BRIEF.md`＋`inquiries.md`） | #1835の`make-packets.mjs`・`run-eval.mjs`・`owner-page.mjs`、[../harness/decide.mjs](../harness/decide.mjs) |

#1835の道具に足したもの（どれもfieldか引数で働き、無ければ従来どおり。#1835・#1852の試験はすべて通る）：`run-layer1.mjs`の`--cases`（`config/cases.json`の代わり）と`--gold-add`（#1804の`gold.json`にケースを足す。同じkeyは拒否）、`make-packets.mjs`の`pPairs`（Pの束を、層3の組のうち挙げた組だけにする。層3に無い組は拒否）、`owner-page.mjs`の`--allow-missing`（欠けた画面を「画面なし」の札で示し、`owner-key.json`の`missingScreens`と組の`missing`に書く。無ければ従来どおり止まる。レビュー2回目のH-1）、`run-eval.mjs`の有料の`--cap-usd`（`budget.capFromArg`があるときだけ、0より大きく`budget.capUsd`以下を受ける。M-5）。試験は`eval.test.mjs`の`#1867`と[../harness/harness.test.mjs](../harness/harness.test.mjs)・[../harness/decide.test.mjs](../harness/decide.test.mjs)。

[../harness/](../harness/)に足したもの（レビュー2回目。3回目で`power-sim.mjs`（計画の率の表を`decide.mjs`そのもので再現するMonte Carlo）を足した）：`decide.mjs`（`cap`：層2の上限と始めてよいか。`decide`：結論の0〜4と各数値。M-4・M-5）、`stage-check.mjs`（各段階の前の照合と記録。M-3）、`gate-packet.mjs check`（やり直しの要否。L-2）、`combine`・`layer-pages.mjs`の`runs.json`との照合（L-3）。

## 測定の前に残っていること

1. 計画（[../EVAL_PLAN.md](../EVAL_PLAN.md)）と、この設定の独立レビュー。1回目の指摘（H1〜H4・M1〜M6・L1〜L6）、2回目の指摘（H-1・H-2・M-1〜M-5・L-1〜L-8）、3回目の指摘（High-1・M-1・M-2・L-1〜L-7）は直した。1回目のL7（「下書き」の表記）は固定のcommitで直す。
2. ownerの目印fileの承認を`results/probe-approval.json`に記録してcommitする。
3. 固定：`node docs/evidence/shared-harness/fixation.mjs init $EV/results/fixation.json --ledger $LEDGER --config $EV`（#1843の手順と同じ）。最初の固定の記録のcommitを、この節の下に書く（`run-trial.mjs`が照合する）。

## 手順（統括が行う）

#1840の[README](../../1840-user-environment/config/README.md)の「手順」と同じ。`EV=docs/evidence/1867-design-persona/config`、条件は`B`・`S`、fixtureは`UI02`・`LP`・`UI03`・`UI08`、probeのfixtureは`LP`。

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1867-design-persona/config
TGZ_B=<scratch>/rel1867/release/agent-skill-chain-0.5.131.tgz
TGZ_S=<scratch>/rel1867/candidate/agent-skill-chain-0.5.131.tgz
LEDGER=<scratch>/rel1867/ledger/ledger-1867.jsonl
FX=<scratch>/run1867/fixtures; mkdir -p <scratch>/run1867/tmp
for C in B S; do for F in UI02 LP UI03 UI08; do
  TGZ=$([ $C = B ] && echo $TGZ_B || echo $TGZ_S); SHA=$(shasum -a 256 $TGZ | cut -d' ' -f1); mkdir -p <scratch>/run1867/tmp/$C-$F
  node $H/make-fixture.mjs $C $F $TGZ $SHA $FX/fixture-$C-$F <scratch>/run1867/tmp/$C-$F --config $EV
done; done
# probe（B・S各1回、fixture LP）。目印fileは確認の後に消す
node $H/markers.mjs create <repo-root> --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs <scratch>/run1867/runs B probe 1 --fixture $FX/fixture-B-LP --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs <scratch>/run1867/runs/B-probe-1 B <home marker> <repo marker> <repo-root> --config $EV > <scratch>/run1867/probe-B.json
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-trial.mjs <scratch>/run1867/runs S probe 1 --fixture $FX/fixture-S-LP --ledger $LEDGER --home-marker <home marker> --repo-marker <repo marker> --run --config $EV
node $H/probe-check.mjs <scratch>/run1867/runs/S-probe-1 S <home marker> <repo marker> <repo-root> --config $EV > <scratch>/run1867/probe-S.json
node $H/probe-check.mjs compare <scratch>/run1867/probe-B.json <scratch>/run1867/probe-S.json --out <scratch>/run1867/runs/probe-compare.json --config $EV
node $H/probe-check.mjs publish $EV/results/probes <scratch>/run1867/probe-*.json <scratch>/run1867/runs/probe-compare.json --home-marker <home marker> --repo-marker <repo marker> --repo-root <repo-root> --runs-root <scratch>/run1867/runs --config $EV
node $H/markers.mjs remove <repo-root> --config $EV
# 測定：固定した順の24試行、その後に必須の置き換え
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs planned <scratch>/run1867/runs --fixtures $FX --ledger $LEDGER --run --config $EV
CLAUDE_CODE_OAUTH_TOKEN="$(cat <ownerのfile>)" ASC_EVAL_ALLOW_PAID=1 node $H/run-all.mjs replacements <scratch>/run1867/runs --fixtures $FX --ledger $LEDGER --run --config $EV
# 固定の照合、公開する記録、機械の判定
node $H/fixation.mjs check $EV/results/fixation.json --config $EV
node $H/collect.mjs <scratch>/run1867/runs $EV/results --ledger $LEDGER --config $EV
node $H/judge.mjs $EV/results --runs-root <scratch>/run1867/runs --ledger $LEDGER --out $EV/results/judge.json --config $EV
# ここから各段階の前に照合する（FIX=固定のcommit。結果は$EV/results/stage-checks.jsonlに1行ずつ。1で終われば、その段階を行わない）
P67=docs/evidence/1867-design-persona/harness; G=<scratch>/run1867/gate; FIX=<固定のcommit>
# 門の数え（2回、別のseed）。置き換えた試行があれば、judge.jsonの置き換え（runs.jsonのreplaces）どおりに --replace <失敗>=<置き換え> を付ける
node $P67/stage-check.mjs gate --fixed-commit $FIX --log $EV/results/stage-checks.jsonl
node $P67/gate-packet.mjs pack <scratch>/run1867/runs $G/r1 --seed 18670011 --runs-json $EV/results/runs.json [--replace ...]
node $P67/gate-packet.mjs pack <scratch>/run1867/runs $G/r2 --seed 18670012 --runs-json $EV/results/runs.json [--replace ...]
mkdir $G/out1 $G/out2
(cd $G/r1/packet && claude -p --model opus --output-format json --restricted --permission-mode dontAsk --tools Read,Glob,Grep --strict-mcp-config --settings '{"disableAllHooks":true}' --no-session-persistence --max-budget-usd 1.5 < TASK.md > $G/out1/answer.json)
(cd $G/r2/packet && claude -p --model opus --output-format json --restricted --permission-mode dontAsk --tools Read,Glob,Grep --strict-mcp-config --settings '{"disableAllHooks":true}' --no-session-persistence --max-budget-usd 1.5 < TASK.md > $G/out2/answer.json)
# やり直しの要否（keyを読まない）。1で終わった回は、必ず同じ束で1回だけやり直し、$G/out<回>/redo.json に書く
node $P67/gate-packet.mjs check $G/r1/packet $G/out1/answer.json
node $P67/gate-packet.mjs check $G/r2/packet $G/out2/answer.json
# 回答のfile（やり直しを含む）を $EV/results/gate/ に写してcommitする（keyはまだ開かない）
# 層2の上限（6 USD未満なら exit 4：層2を始めずに未判定）
node $P67/decide.mjs cap --judge $EV/results/judge.json --gate-answers $G/out1/answer.json --gate-answers $G/out2/answer.json [--gate-answers <redo.json>]
# 層1（ケースごと）
node $P67/stage-check.mjs layer1 --fixed-commit $FIX --log $EV/results/stage-checks.jsonl
node $P67/layer-pages.mjs <scratch>/run1867/runs <scratch>/run1867/pages --runs-json $EV/results/runs.json [--replace ...]
cd docs/evidence/1835-design-eval-layers
node harness/run-layer1.mjs layer1 <scratch>/run1867/pages <scratch>/run1867/r/l1-<case> --case <case> --cases ../1867-design-persona/config/layers/layer1-cases.json --gold-add ../1867-design-persona/config/layers/layer1-gold.json
cd -
# 層3のページ（ownerの回答をcommitするまで、owner-key.jsonとPの結果とgateのkeyを開かない）
node $P67/stage-check.mjs owner-page --fixed-commit $FIX --log $EV/results/stage-checks.jsonl
C=docs/evidence/1867-design-persona/config/layers/eval.json; X=docs/evidence/1835-design-eval-layers/harness
node $X/owner-page.mjs --config $C --render-root <scratch>/run1867/r --out <scratch>/run1867/owner --seed 18670003 --allow-missing
# 層2の束と実行（CAP=上のdecide.mjs capのcapUsd）
node $P67/stage-check.mjs layer2 --fixed-commit $FIX --log $EV/results/stage-checks.jsonl
node $X/make-packets.mjs --config $C --render-root <scratch>/run1867/r --out <scratch>/run1867/eval --seed 18670002 --allow-missing
ASC1835_ALLOW_PAID=1 node $X/run-eval.mjs run --config $C --packets <scratch>/run1867/eval/packets --runs <scratch>/run1867/pruns --evaluator fable --methods P --retries 1 --cap-usd $CAP --lock <scratch>/run1867/eval/key --lock <scratch>/run1867/owner --lock $G/r1/key --lock $G/r2/key
ASC1835_ALLOW_PAID=1 node $X/run-eval.mjs run --config $C --packets <scratch>/run1867/eval/packets --runs <scratch>/run1867/pruns --evaluator codex --methods P --retries 1 --cap-usd $CAP --lock <scratch>/run1867/eval/key --lock <scratch>/run1867/owner --lock $G/r1/key --lock $G/r2/key
# ownerの回答（owner-answers.json）を $EV/results/ にcommitする。その後に、門のkey・owner-key・Pの結果を開く
# 集計
node $P67/stage-check.mjs decide --fixed-commit $FIX --log $EV/results/stage-checks.jsonl
node $P67/gate-packet.mjs combine --round $G/r1/key/key.json=$G/out1/answer.json[+$G/out1/redo.json] --round $G/r2/key/key.json=$G/out2/answer.json[+$G/out2/redo.json] --runs-json $EV/results/runs.json --out $EV/results/gate.json
node $P67/decide.mjs decide --judge $EV/results/judge.json --gate $EV/results/gate.json --owner $EV/results/owner-answers.json --owner-key <scratch>/run1867/owner/owner-key.json \
  --p-key <scratch>/run1867/eval/key/key.json --p-runs <scratch>/run1867/pruns --layer1 <scratch>/run1867/r/l1-ui02-exhibition/layer1.json --layer1 <scratch>/run1867/r/l1-lp-new/layer1.json \
  --layer1 <scratch>/run1867/r/l1-ui03-dashboard/layer1.json --layer1 <scratch>/run1867/r/l1-ui08-existing-ds/layer1.json --out $EV/results/decision.json
```

- 層2を始める前に`decide.mjs cap`で上限＝min(8, 20 −（生成の台帳の実費＋門の数えの実費）)を求め、6 USD未満なら止めて未判定（計画の「費用」）。FableとCodexには`--cap-usd`でその値を渡す（`eval.json`の`budget.capFromArg`。付けなければ有料の実行は止まる）。
- 層2の警報・確かめられた害、層3の効果・害、層1の害、結論の0〜4は`decide.mjs decide`が出す（画面の無い組、欠けた判断、nの下限を含む。規則は計画と`eval.json`の`decision`）。
- `stage-check.mjs`は`fixation.mjs check`、`--fixed-commit`が`results/fixation.json`の`fixedAtCommit`（この節の下に書く固定のcommit）であること、固定のcommitとの`git diff --exit-code`（`1867-design-persona/harness`・#1835の`harness`と`prompts`・#1852の`harness`・#1804の`cases`と`gold.json`・#1815の`cases.json`。未追跡のfileも見る。[decision-criteria.md](decision-criteria.md)の冒頭の「道具」と同じ）、#1835の`prompts/`のsha256と`eval.json`の照合を行う。
- `gate-packet.mjs pack`は`--runs-json`が必須で、置き換えを`runs.json`と照合する。置き換えも失敗したslotは束に入れず（keyの`absent`）、門の数えでは「無い」とする。
- `run-eval.mjs`の有料の実行には、`capFromArg`のある`eval.json`では`--cap-usd`が必須（FableとCodexの両方に`decide.mjs cap`の値を渡す）。

- `--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。
- 台帳とtarballと生の記録は`<scratch>`に置く。scratchが消えると判定（生の記録からの作り直し）ができないので、評価の終わりまで消さない。層1〜3は生の記録の`work/`の画面を使う。

## 限界

- Bashが無いのでASCの`start`を実行できない（#1840と同じ）。
- browserとnetworkが無いので、Skillの6節の「描画して確かめる」と、公開情報の調査は動かない（計画の「この評価で確かめられないこと」）。
- 読取りはfileの単位で数え、どの節まで読んだかは確かめない。
- 各条件・各ケース3回。
