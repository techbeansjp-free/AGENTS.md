# デザイン作成Skillの生成の測定（#1867）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。#1843の設定（[../../1843-spec-rule-path/config/](../../1843-spec-rule-path/config/)）と同じ形である。

**状態：準備済み、固定の前。** dry runは合格した（下の「確認」）。計画（[../EVAL_PLAN.md](../EVAL_PLAN.md)）の固定、独立レビュー、ownerの目印fileの承認（`results/probe-approval.json`は仮の値）、固定の記録（`results/fixation.json`）がまだ。有料の実行はしていない。

## 目的

評価の計画のうち、**生成**（B・Sの24試行とprobe 2回）を、共通の仕組みで行う。共通の仕組みが数えるのは機械で数えられる部分だけである：Sで`design-creation`の`SKILL.md`とreferenceが読まれたか、依頼の成果物と記録（`out/DESIGN-NOTES.md`）が書かれたか。記録の中身（利用者の像と根拠・仮説の区別、判断と利用者の対応）は、`collect.mjs`の後に人（統括または親）が数える。層1・層2・層3は共通の仕組みの外で、#1835・#1852の道具で行う。判定の規則は[decision-criteria.md](decision-criteria.md)。

## 条件

| | B（基準） | S（候補） |
| --- | --- | --- |
| 中身 | release v0.5.131（現在のmain `221283eb`。17 Skill） | Bに`design-creation`（[../candidate/design-creation/](../candidate/design-creation/)の`SKILL.md`とreferences 2件）を足したもの |
| tarball | `gh release download v0.5.131`。sha256 `e8135f4a07735c07d90fec266a491c639ef9539041d64580b4db518244f57113`（assetのdigest・`SHA256SUMS`と一致。このbranchの`0a029231`で`pack-candidate.mjs --version=0.5.131`しても同じ） | このbranchの`995f41de`（候補と配布の登録を足したcommit）で`node scripts/pack-candidate.mjs <dir> --version=0.5.131`。sha256 `d1bccb5c771017952ca85a1662a38e18b3724b593e9bcbab607ae5bd060dee88`（別のdirectoryへの2回目のpackも同じ）。次のcommit `0a029231`で取り消した（#1815と同じやり方）ので、branchの配布物はmainと同じ |
| 導入 | 利用者の手順（専用のworktreeで`project-assets --register-claude-skill --apply`、読む契機`claude-md`を採用） | 同じ |

- 両tarballを展開した差（`diff -rq`）：Sは`skills/design-creation/`を足し、`package.json`（files）・`src/runtime-files.json`（3件）・`skills/README.md`（表の1行）・`src/project-assets.mjs`（`maxAssets` 313→321）・`release-identity.json`だけが違う（[release.json](release.json)の`S.differsOnly`）。
- `995f41de`の配布の登録は、`warranty-scope`を足したcommit `b8cfec86`に倣った（`test/helpers/distributed-skills.mjs`と`test/test_project_assets.mjs`の数も同じcommitで変え、`0a029231`で戻した）。`qualityContractVersion`は上げていない（評価のためのpackで、配布しないため）。

## fixtureと依頼

| ケース | fixture | 種類 | file（sha256で固定。[conditions.json](conditions.json)の`fixtures`） |
| --- | --- | --- | --- |
| ui02-exhibition | UI02 | 公開ページ | #1804の`BRIEF.md`、`FONTS.md` |
| lp-new | LP | 公開ページ | [../cases/lp-new/](../cases/lp-new/)の`BRIEF.md`と`inquiries.md`、#1804の`FONTS.md` |
| ui03-dashboard | UI03 | 業務の画面 | #1804の`BRIEF.md`、`data.json`、`FONTS.md` |
| ui08-existing-ds | UI08 | 業務の画面 | #1804の`BRIEF.md`、`app/`の既存のfile 4件、`FONTS.md` |

- 依頼文は#1804の生成の指示（`../../1804-design-judgment/harness/gen-prompt.txt`）のまま。fixtureのfileは#1804の生成（`run-gen.mjs`）が置いたものと同じ。違いは、ASCを利用者に届く形で導入すること（`CLAUDE.md`は読む契機の案内文だけ）と、空の`out/`を置くこと（#1815・#1820の段階2と同じ）。
- **lp-new**：架空の出張のスマートフォン相談サービスのLP。依頼文の「利用者」節はui02より薄く（「困っている人とその家族」と、資料の場所だけ）、問合せの記録（12件と代表のメモ）を読むと分かることがある：問合せの半数は家族（多くは遠方）から、本人は電話だけを使う、料金の総額・出張費と、訪問する人の身元・暗証番号を気にする、家族は夜にスマートフォンで見る、2人で受ける料金は未定。依頼文の「必ず載せる内容」には無い。実在の企業・個人の名前は使っていない。
- 書いたfileの照合（[cases.json](cases.json)の`writes.requireFiles`）：ui02・lp-new・ui03は`out/index.html`と`out/DESIGN-NOTES.md`、ui08は`app/billing.html`と`out/DESIGN-NOTES.md`。

## 共通の仕組みに加えたもの（#1867）

どれも設定のfieldで働き、fieldの無い設定（試験用、#1823・#1840・#1843・#1846）の動きは変えない。試験（`harness.test.mjs`の`#1867`の4件）で確かめた。

- `conditions.json`の`ascSkillsByCondition`：条件ごとの配布Skillの一覧（Sは`design-creation`を含む18件）。採点（`score.mjs`の`ascSkillsOf`）、probeの期待するdescriptionの件数と利用者のSkillの分け方（`probe-check.mjs`）、dry runの入口の数・referenceの所在・入口の比較（両条件が配布するSkillだけを比べる）が使う。
- fixture`design`の`files`にsubdirectoryのpath（ui08の`app/tokens.css`等）を書ける（`make-fixture.mjs`の`writeSources`）。
- `rule.negativesRequired: false`：該当しない依頼の無い設定で、「該当しない依頼の有効な試行が無い」ことを未判定の理由にしない（`score.mjs`の`verdictOf`）。

## 費用とトークン

- 2条件×4ケース×3回＝24試行と、probe 2回（fixture LP）。
- ownerの上限20 USDは生成と層2の合計。生成の割当ては12 USD（`ownerCapUsd`・`capUsd`、余裕0.5、停止の線11.5 USD）、層2に8 USDを残す（見込み約5 USD）。
- 1試行の予算（`--max-budget-usd`）1.5 USD（#1804の生成と同じ）。probeは0.6 USD。
- 見込み：#1804のsonnetの生成（ui02・ui03・ui08、1試行0.15〜0.28 USD）に、ASCとSの本文・reference（約7 KB）の読込みを足して1試行0.32 USD、計 **約8.0 USD**（計画の単価0.45で約11.2 USD）。入力（入力＋cache）約980万、出力約29万トークン（#1804は試行ごとのトークンを記録していないので粗い）。完了できる1試行の平均の上限は0.417 USD（`breakEvenPerTrialUsd`）。これを超えると停止の線で止まり、その時点の記録で判定する。

## 確認（2026-11-28、モデルを呼ばない）

```text
node --test docs/evidence/shared-harness/test/      # 56件すべて合格（#1867で足した4件を含む）
node docs/evidence/shared-harness/dry-run.mjs <scratch>/rel1867/run1867dry \
  --tarball-B <scratch>/rel1867/release/agent-skill-chain-0.5.131.tgz \
  --tarball-S <scratch>/rel1867/candidate/agent-skill-chain-0.5.131.tgz \
  --config docs/evidence/1867-design-persona/config --out <scratch>/rel1867/run1867dry.json
```

dry run：`pass: true`（16の照合すべて）。入口はBが17件、Sが18件。Sのfixtureに`design-creation`の本文とreferences 2件があり、候補とbyte単位で一致する。導入後の差は`design-creation`のfile（本文・reference・その写し・Claude Codeの入口）、`skills/README.md`とその写し、`distribution.json`、`managed-runtime/`の`package.json`・`src/runtime-files.json`・`src/project-assets.mjs`だけで、他の17件の入口は同じ。計画24試行、`--max-turns`なし、`--max-budget-usd 1.5`。

## 測定の前に残っていること

1. 計画（[../EVAL_PLAN.md](../EVAL_PLAN.md)）と、この設定の独立レビュー。指摘を直してから固定する。
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
# この後、Sの試行のout/DESIGN-NOTES.md（<scratch>/run1867/runs/S-*/work/）を人が数え（decision-criteria.mdの門）、層1・層2・層3へ進む
```

- `--run`を付けない`run-trial.mjs`・`run-all.mjs`は、起動するcommandや試行の一覧を出すだけでモデルを呼ばない。
- 台帳とtarballと生の記録は`<scratch>`に置く。scratchが消えると判定（生の記録からの作り直し）ができないので、評価の終わりまで消さない。層1〜3は生の記録の`work/`の画面を使う。

## 限界

- Bashが無いのでASCの`start`を実行できない（#1840と同じ）。
- browserとnetworkが無いので、Skillの6節の「描画して確かめる」と、公開情報の調査は動かない（計画の「この評価で確かめられないこと」）。
- 読取りはfileの単位で数え、どの節まで読んだかは確かめない。
- 各条件・各ケース3回。
