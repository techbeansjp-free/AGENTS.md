# 機構3 規模依存process出力上限の故障注入証跡

## 対象製品fileのSHA-256

| path | SHA-256 |
|---|---|
| `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
| `scripts/check_package_contents.ts` | `798027a8cfb21f8fe22540919fae0e35d1226634d42bb10b625f115785d553d6` |
| `src/lib/process.ts` | `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2` |

この3件を記録するのは、consumer acceptanceの判定、package検査への接続、process出力上限という、この証跡が主張する振る舞いの実体だからである。**束縛対象は機構別に宣言する。** 本機構は`scripts/check_package_contents.ts`が`checkConsumerAcceptance`へ渡す`mechanisms`に含まれるため接続経路上にあり、同fileを含める（Issue #1221）。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。

## artifact_sha256

`8b5404934c42792fb1c7c0ef7d9e716dfad15eb3c14ee065d623f6145fe18948`

## distribution_digest

`d950cb6092e7d2244466bcbd709a9b0d7bedb7330212b8871a92c0c369c264ac`

## digestの区別

`artifact_sha256` は1MiBのprocess出力上限故障をbuildしてpackしたtarball byte列のSHA-256である。`distribution_digest` は同じ故障状態で `npm_config_cache=/tmp/asc-1024-seg12.kkZ231/mechanism-3/npm-cache node --import tsx scripts/compute_distribution_digest.ts` が返したTERM-ASC-024の配布内容digestであり、tarball byte列のSHA-256とは別である。比較用の注入前値はartifact SHA-256が `07345e957be38d14a6de58ff3e3f0533d2f0c7467fe5bf1cea05ef5571d9536e`、配布内容digestが `8742ef9ff7c8e0e7e8eb36bf9fd80718f71e3239888726a282f553f5a98d38a9` だった。

## 注入差分

```diff
--- a/src/lib/process.ts
+++ b/src/lib/process.ts
@@
-const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024 * 1024;
+const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;
```

要求どおり `MAX_PROCESS_OUTPUT_BYTES` を既定の `1024 * 1024` へ戻す故障だけを注入した。ほかの入力検証を壊さず、3MiBのignored出力に依存して初めて現れるprocess境界の欠陥を観測するためである。

## 実行command

source変異をtarballへ反映するためbuildを含め、注入前後とも次の同一commandを実行した。

```sh
npm run build --silent && npm_config_cache=/tmp/asc-1024-seg12.kkZ231/mechanism-3/npm-cache npm pack --silent --ignore-scripts --pack-destination=/tmp/asc-1024-seg12.kkZ231/mechanism-3 && node --import tsx scripts/check_consumer_acceptance.ts --tarball=/tmp/asc-1024-seg12.kkZ231/mechanism-3/agent-skill-chain-0.3.1-beta.44.tgz --mechanisms=scale-output
```

## 注入前の終了値

`0`。3MiBのignored出力fixtureに対して `scale-output: accepted` だった。

## 注入後の終了値

`1`。同じ3MiB fixtureでtarballから導入した公開入口が終了値1となり、consumer acceptance全体も非0になった。

## 機構別診断

機構識別子は `scale-output`、状態は `rejected`、理由は `公開入口が終了値1で失敗しました` である。

## 保存先

`docs/evidence/1024-consumer-acceptance/mechanism-3-scale-output.md`

## 復元確認

変異前copyを `cp` で `src/lib/process.ts` へ戻し、`cmp -s` の終了値0を確認した。復元fileとcopyのSHA-256は、**#1024実施時点の内容について**ともに `654dc62cad93de1e73e47a545bc46f38740cb759586d4f8d0f67434ae59f561d` でbyte単位一致した。復元sourceからのbuildも終了値0だった。故障状態の配布digestを再算出した2回目の注入後にも同じcopy復元、SHA-256一致、build成功を確認した。`git checkout` は使用していない。

## 2026-09-07の現行sourceへの再拘束

PR #1263の補正で`JsonlSessionOptions`と`runJsonlSession`だけを変更したため、対象製品fileの全体SHA-256を更新した。旧束縛`888c3467dec10e0f5b62c746fe7929e0391bf071039ea6d9fdd2b03b37f2742d`に一致するcommit `6ae197172c3f49dfe1524bf320f6d990302bd052`の`src/lib/process.ts`と現在fileを実読した。TypeScript ASTでこの2宣言だけを`getFullStart()`から`getEnd()`まで除き、残る宣言の元byte列と末尾を連結して比較した結果は完全一致であり、そのSHA-256は`fa1b2ec07ff06c7ab0f89d854c9231d2dfbdf4c178e540a89717f9ac1582748d`だった。同期`run`・`git`、出力上限、import、module初期化はこの一致範囲に含まれる。

`check_consumer_acceptance.ts`のprocess実装importは同期`run`と型`ProcessOptions`・`ProcessResult`だけであり、`runJsonlSession`への接続はない。同fileの全体SHA-256も上表から変化していない。現在sourceで`node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-INT-CONSUMER-00[1678]'`を実行し、packed-bin故障検出、fixture公開入口、git準備の制御seam故障、候補tarballの3MiB出力を4 scenario・20 stepすべて合格で観測した。

これは変更されていない同期consumer経路への再拘束と現行回帰の観測であり、既存の#1024時点の実npm・pnpm故障注入を今回再実行したという主張ではない。`artifact_sha256`、`distribution_digest`、旧注入差分・前後終了値・復元確認は保持した。束縛対象と検証器も保持し、検査をAST部分hashへ変更せず、上表のfile全体hashを引き続き照合する。過去の同種再拘束はcommit `ddf8e99a0bb0282b26edb408e046b5d9062c12af`（Issue #1027）にある。

## Issue #1265のstdin失敗処理変更への再拘束

2026-09-07、旧束縛`06013f66a9aaf57b2cb9efc261b812730beccfd65366431b4b71faf0d35caf85`に一致するcommit `2931acc5acf4164b25c5e59f2ef431ec081eff9f`の`src/lib/process.ts`と修正後sourceを実読した。変更は`runJsonlSession`のstdin errorを既存の失敗処理へ接続する部分だけである。前節と同じTypeScript ASTの2宣言除外手順で残余の元byte列を比較し、完全一致とSHA-256 `fa1b2ec07ff06c7ab0f89d854c9231d2dfbdf4c178e540a89717f9ac1582748d`を再計測した。同期`run`・`git`、定数、import、module初期化は未変更であり、consumerの接続先は同期`run`と型だけである。`check_consumer_acceptance.ts`の全体SHA-256 `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc`も未変更だった。

上表は修正後file全体のSHA-256 `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`へ再拘束する。これは非同期session変更から独立した同期consumer経路のbyte同一性による再拘束であり、既存の#1024時点の実npm・pnpm故障注入を再実行したという主張ではない。旧注入結果、artifact、distribution digest、束縛集合、検証器、SHA節からartifact節への解析境界を保持する。統合後sourceのconsumer全31 scenarioは別途coordinatorが検証し、その結果をIssue #1265のレビュー証拠へ記録する。
