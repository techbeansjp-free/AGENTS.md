# #1852 良い案どうしの比較で、Pはownerと一致するか

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。

Issue：[#1852](https://github.com/techbeansjp-free/AGENTS.md/issues/1852)。計画は[EVAL_PLAN.md](EVAL_PLAN.md)にあり、ownerの比較とPの実行の前に`e8286908`で固定した。道具は[#1835](../1835-design-eval-layers/README.md)のものを、このdirectoryの`config/eval.json`で動かす。

## 結論

**不採用。** 一対比較（P）を、良い案どうしの比較の補助には使わない。ownerは結果を受けて「使わない」と決めた（2026-11-28、会話での回答。Issueに記録）。

| 評価者 | 一致（ownerが優劣を付けた組） | 片側の二項検定 | 結果 |
| --- | --- | --- | --- |
| Fable | 18/25（0.72） | p=0.022（必要な一致は18組） | 採用 |
| Codex | 16/25（0.64） | p=0.115 | 不採用 |

計画5節の規則では、両方の評価者が「採用」のときだけ採用になる。Codexが届かないので、結論は不採用である。Fableは、必要な一致の数にちょうど届いた。

## 指標

| 指標 | Fable | Codex |
| --- | --- | --- |
| ownerとの一致（25組） | 18 | 16 |
| 　逆を選んだ組 | 6 | 4 |
| 　2回の判断が割れた、または「同等」と答えた組 | 1 | 5 |
| ownerが「同等」とした11組で、Pが優劣を付けた組 | 10 | 9 |
| 再現性（2回の判断の一致、36組） | 34/36 | 29/36 |
| 欠測 | 0/72 | 0/72 |

- 評価者間の一致（組ごとの判断）：24/36。
- ケースごとの一致（Fable・Codex）：ui02 6/11・6/11、ui03 6/7・5/7、ui08 6/7・5/7。
- ownerの選択：36組のうち、優劣が25組、「同等」が11組だった（ui02 1組、ui03 5組、ui08 5組）。「判断しない」は0組。n=25は、未判定の下限である24組を超えた。
- 層1：36画面のうち35画面が合格した。不合格はui02のB-r1で、これを含む1組（A-r1〜B-r1）を除いても、一致は Fable 18/25・Codex 16/25 で変わらない（ownerはこの組を「同等」とした）。

## 言えることと言えないこと

- 言える：この3ケース・36組では、両方の評価者がそろってownerとの一致を偶然と区別できたわけではない。Fableは区別できる水準にちょうど届いたが、Codexは届かなかった。
- 観察（計画の副次の報告に無い記述）：この11組では、ownerが差を認めない組でも、Pはほとんどの場合にどちらかを選んだ（Fable 10/11・Codex 9/11）。この11組に限れば、Pの「優劣あり」はownerの「優劣あり」と対応しなかった。
- 言えない：Fableだけを使えば補助になること。規則は両評価者を求めると事前に決めており、Fableの結果だけを取り出すのは、結果を見た後の規則の変更にあたる。
- 言えない：一般の利用者や顧客の正解との一致。ownerの判断は「ASCとしての基準」の代わりである。
- 規模は3ケース・36組（優劣25組）である。

#1835の層2の結果（Pは既知の劣化をよく見分ける）は、この結果では変わらない。良い案どうしの比較では、この3ケースで両方の評価者がそろって偶然以上の一致を示すことはなかった（Fableは届き、Codexは届かなかった）。そのため、ownerはPを使わないと決めた。

## 費用・時間

| 評価者 | 呼出し | USD | 時間 | token（入力・cache書込み/読込み・出力） |
| --- | --- | --- | --- | --- |
| Fable | 72 | 16.10 | 23.3分 | 432・721,259/1,588,574・105,668 |
| Codex | 72 | — | 28.8分 | 入力5,215,645（うちcache読込み4,040,704）・出力32,261 |

- Fableは上限18 USDの内で、予算での停止は無い。見込み（約15 USD）より多かった。#1835の1回あたり0.21 USDに対し、今回は0.22 USDだった。
- 描画（層1、36画面）は約14分。

## 記録

`results/`：

- `result.json`：集計。組ごとのPの判断とownerの選択を含む。
- `owner-answers.json`：ownerの選択。2026-11-28T02:18:50Z。評価者の結果を見る前に記録した。
- `owner-key.json`：比較用のページの対応表。
- `key.json`：評価者に渡した束の対応表。

理由の文・screenshot・生の実行記録は公開しない。scratchの台帳`ledger.jsonl`のsha256は`f9e96351ff0334739e56cd5f70a00f9709d063a793cdd2a23fc7a79a45660734`である。

## 再現の手順

```sh
cd docs/evidence/1835-design-eval-layers
C=../1852-p-good-pairs/config/eval.json
# 描画（元の画面だけを置いたpagesで、ケースごと）
node harness/run-layer1.mjs layer1 <pages> <out>/l1-<case> --case <case>
node harness/make-packets.mjs --config $C --render-root <out> --out <out>/eval --seed 18520002
node harness/owner-page.mjs  --config $C --render-root <out> --out <out>/owner --seed 18520003
ASC1835_ALLOW_PAID=1 node harness/run-eval.mjs run --config $C --packets <out>/eval/packets --runs <out>/runs --evaluator fable --methods P --lock <out>/eval/key --lock <out>/owner
ASC1835_ALLOW_PAID=1 node harness/run-eval.mjs run --config $C --packets <out>/eval/packets --runs <out>/runs --evaluator codex --methods P --lock <out>/eval/key --lock <out>/owner
node ../1852-p-good-pairs/harness/decide.mjs --key <out>/eval/key/key.json --runs <out>/runs --owner ../1852-p-good-pairs/results/owner-answers.json \
  --owner-key <out>/owner/owner-key.json --out ../1852-p-good-pairs/results/result.json --layer1 <out>/l1-<case>/layer1.json ...
node --test ../1852-p-good-pairs/harness/
```

- `<pages>`は、#1835の`degrade.mjs`の出力から、各画面の`original`だけを写したものである。`manifest.json`のvariantも`original`だけにした。

## 対応表の閉じ方の不備（並行実行）

計画3節は「Codexの実行中は、keyとownerの対応表を`--lock`で閉じる」としていた。今回はFableとCodexを並行して動かしたため、これを守れなかった時間帯がある。

- `--lock`は、起動時のmodeを記録して000にし、終了時に記録したmodeへ戻す。Fableが先に起動して閉じ、5秒後に起動したCodexは000を元のmodeとして記録した。
- Fableが02:06:01Zに終わってmodeを開いた値に戻し、Codexは02:11:36Zまで動いた。約5.5分のあいだ、Codexの実行中に対応表が読める状態だった。Codexの終了で000に戻ったので、終了後は手で開いた。
- この時間帯に終わったCodexの呼出しは13回である。13回とも隔離の確認は`checked`（束の外のpathを読むcommandは無い）で、実行の記録に`key.json`・`owner-key`・ownerのdirectoryへの言及は無かった。72回全体でも隔離は全件`checked`である。
- ownerの対応表（`results/owner-key.json`）のsha256は、実行の前（ページの作り直しで得た値）と後で同じだった（`78b2e506e650efc9c43c7ee350f661f57241c66d7292ff5e6be4f7aa44d1c396`）。
- ownerの回答（02:18:50Z）は、対応表が開いていた時間帯（〜02:11:36Z）にはまだ無かった。開いていた対応表から読めたのは、条件名と画面のIDの対応だけで、ownerの選択は含まれない。
- 次に並行させるときは、評価者ごとに閉じるのではなく、両方の実行の外側で閉じて最後に開く。道具（#1835の`run-eval.mjs`）の直しは、このIssueの範囲に含めない。

## #1835の道具への変更

動作は変えずに、次を足した（#1835の試験はすべて通る）。どれも計画の固定（`e8286908`）に含まれ、ownerの比較とPの実行の前にcommitした。計画の冒頭の「設定だけを変える」は、この変更を含めて読む（計画は固定後なので本文を変えない）。

結果の記録の後に、判定の道具（`decide.mjs`）を次のとおり直した。本判定の数値は変わらない（直す前と後の`result.json`は、副次の報告の欄を除いて同じ）。

- 副次の報告から採否（`result`）を外した。計画5節は副次の報告を判定しないとしている。
- ownerが優劣を付けた組が0組のとき、p値が無いのに採用になり得たのを、未判定にした（今回は25組で該当しない）。
- ownerの回答に4つの選択肢以外の値があれば、集計を止める。
- `pJudgments`の向きの変換（回ごとにA・Bが入れ替わる場合）の試験を足した。

#1835の道具に足したもの：

- `eval-common.mjs`：`layer3.pairs`で組を明示できる。`layer2`が無い設定を受ける。
- `make-packets.mjs`：設定の`methods`にある方式の束だけを作る（設定に無ければ従来どおり全部）。
- `owner-page.mjs`：`--config`を受ける。
