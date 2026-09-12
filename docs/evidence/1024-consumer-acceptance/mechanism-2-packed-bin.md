# 機構2 packed binの故障注入証跡

## 対象製品fileのSHA-256

| path | SHA-256 |
|---|---|
| `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
| `scripts/check_package_contents.ts` | `798027a8cfb21f8fe22540919fae0e35d1226634d42bb10b625f115785d553d6` |
| `src/lib/process.ts` | `2d0c9dcb6a84a4eae4007d1bbc9327740b8e81f2faec1b82ec07cf197023f4e9` |

この3件を記録するのは、consumer acceptanceの判定、package検査への接続、process出力上限という、この証跡が主張する振る舞いの実体だからである。**束縛対象は機構別に宣言する。** 本機構は`scripts/check_package_contents.ts`が`checkConsumerAcceptance`へ渡す`mechanisms`に含まれるため接続経路上にあり、同fileを含める（Issue #1221）。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。

## artifact_sha256

`fd400d2975289e6861b9c526b52edac8ad33be8246e330293076d6580e7eaaec`

## distribution_digest

`e55895f9af1428363bfc483f0f899d4194072e48d422b40619694d634e854aca`

## digestの区別

`artifact_sha256` はbin target故障を含めてpackしたtarball byte列のSHA-256である。`distribution_digest` は同じ故障状態で `npm_config_cache=/tmp/asc-1024-seg12.kkZ231/mechanism-2/npm-cache node --import tsx scripts/compute_distribution_digest.ts` が返したTERM-ASC-024の配布内容digestであり、圧縮形式等も含むtarball byte列のSHA-256とは別である。比較用の注入前値はartifact SHA-256が `07345e957be38d14a6de58ff3e3f0533d2f0c7467fe5bf1cea05ef5571d9536e`、配布内容digestが `8742ef9ff7c8e0e7e8eb36bf9fd80718f71e3239888726a282f553f5a98d38a9` だった。

## 注入差分

```diff
--- a/package.json
+++ b/package.json
@@
   "bin": {
-    "agent-skill-chain": "./dist/bin/agent-skill-chain.js"
+    "agent-skill-chain": "./dist/bin/does-not-exist.js"
   },
```

`files` から `dist` は外していない。必須file検査の先行失敗ではなく、packed artifactが宣言した公開bin targetの実在検査そのものに検出力があるかを見るためである。

## 実行command

注入前後とも、tarballを同じpathへpackし直してから次の同一commandを実行した。

```sh
npm_config_cache=/tmp/asc-1024-seg12.kkZ231/mechanism-2/npm-cache npm pack --silent --ignore-scripts --pack-destination=/tmp/asc-1024-seg12.kkZ231/mechanism-2 && node --import tsx scripts/check_consumer_acceptance.ts --tarball=/tmp/asc-1024-seg12.kkZ231/mechanism-2/agent-skill-chain-0.3.1-beta.44.tgz --mechanisms=packed-bin
```

## 注入前の終了値

`0`。診断は `packed-bin: accepted` で、公開binの実在と起動を観測した。

## 注入後の終了値

`1`。npm pack自体は成功したが、存在しないbin targetを宣言したtarballのconsumer acceptanceが非0になった。

## 機構別診断

機構識別子は `packed-bin`、状態は `rejected`、理由は `公開binが存在しません` である。

## 保存先

`docs/evidence/1024-consumer-acceptance/mechanism-2-packed-bin.md`

## 復元確認

変異前copyを `cp` で `package.json` へ戻し、`cmp -s` の終了値0を確認した。復元fileとcopyのSHA-256はともに `1d1773b314faf375b14494aa286d56f4f1bf0540f898011de1427aaaabceebe9` でbyte単位一致した。故障状態の配布digestを再算出した2回目の注入後にも同じcopy復元とSHA-256一致を確認した。`git checkout` は使用していない。

## 2026-09-07の現行sourceへの再拘束

PR #1263の補正で`JsonlSessionOptions`と`runJsonlSession`だけを変更したため、対象製品fileの全体SHA-256を更新した。旧束縛`888c3467dec10e0f5b62c746fe7929e0391bf071039ea6d9fdd2b03b37f2742d`に一致するcommit `6ae197172c3f49dfe1524bf320f6d990302bd052`の`src/lib/process.ts`と現在fileを実読した。TypeScript ASTでこの2宣言だけを`getFullStart()`から`getEnd()`まで除き、残る宣言の元byte列と末尾を連結して比較した結果は完全一致であり、そのSHA-256は`fa1b2ec07ff06c7ab0f89d854c9231d2dfbdf4c178e540a89717f9ac1582748d`だった。同期`run`・`git`、出力上限、import、module初期化はこの一致範囲に含まれる。

`check_consumer_acceptance.ts`のprocess実装importは同期`run`と型`ProcessOptions`・`ProcessResult`だけであり、`runJsonlSession`への接続はない。同fileの全体SHA-256も上表から変化していない。現在sourceで`node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-INT-CONSUMER-00[1678]'`を実行し、packed-bin故障検出、fixture公開入口、git準備の制御seam故障、候補tarballの3MiB出力を4 scenario・20 stepすべて合格で観測した。

これは変更されていない同期consumer経路への再拘束と現行回帰の観測であり、既存の#1024時点の実npm・pnpm故障注入を今回再実行したという主張ではない。`artifact_sha256`、`distribution_digest`、旧注入差分・前後終了値・復元確認は保持した。束縛対象と検証器も保持し、検査をAST部分hashへ変更せず、上表のfile全体hashを引き続き照合する。過去の同種再拘束はcommit `ddf8e99a0bb0282b26edb408e046b5d9062c12af`（Issue #1027）にある。

## Issue #1265のstdin失敗処理変更への再拘束

2026-09-07、旧束縛`06013f66a9aaf57b2cb9efc261b812730beccfd65366431b4b71faf0d35caf85`に一致するcommit `2931acc5acf4164b25c5e59f2ef431ec081eff9f`の`src/lib/process.ts`と修正後sourceを実読した。変更は`runJsonlSession`のstdin errorを既存の失敗処理へ接続する部分だけである。前節と同じTypeScript ASTの2宣言除外手順で残余の元byte列を比較し、完全一致とSHA-256 `fa1b2ec07ff06c7ab0f89d854c9231d2dfbdf4c178e540a89717f9ac1582748d`を再計測した。同期`run`・`git`、定数、import、module初期化は未変更であり、consumerの接続先は同期`run`と型だけである。`check_consumer_acceptance.ts`の全体SHA-256 `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc`も未変更だった。

上表は修正後file全体のSHA-256 `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`へ再拘束する。これは非同期session変更から独立した同期consumer経路のbyte同一性による再拘束であり、既存の#1024時点の実npm・pnpm故障注入を再実行したという主張ではない。旧注入結果、artifact、distribution digest、束縛集合、検証器、SHA節からartifact節への解析境界を保持する。統合後sourceのconsumer全31 scenarioは別途coordinatorが検証し、その結果をIssue #1265のレビュー証拠へ記録する。

## 2026-09-12 `src/lib/process.ts`の束縛更新（Issue #1341）

Issue #1341が`ProcessResult`へoptionalな`launchFailure`を追加し、`run`が`result.error`を観測したときだけ立てるようにしたため、対象製品fileの全体SHA-256を`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`から`99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614`へ更新した。

**主張する振る舞いは変わっていない。** 追加は次の2箇所だけである。

1. `ProcessResult`interfaceへ`launchFailure?: true`とそのTSDoc
2. `run`の戻り値objectへ`...(failure === undefined ? {} : { launchFailure: true as const }),`の1行

現在fileからこの2箇所を除いた残余byte列は、旧束縛`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`に一致するcommit（`origin/main` = `8e7405b9`）の`src/lib/process.ts`と**完全一致**し、その残余のSHA-256は`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`だった。`maxBuffer`既定、`MAX_PROCESS_OUTPUT_BYTES`、`failure`の算出、`status`・`stdout`・`stderr`の写像、`allowFailure`のthrow条件、import、module初期化はこの一致範囲に含まれる。**この証跡が主張するprocess出力上限の振る舞いは1 byteも変わっていない。** 追加fieldは既に算出済みの`failure`から導く旗であり、既存の呼び出しはこのoptional fieldを読まない。

### 2026-09-12 追補（独立review round 1のREV-01・REV-03是正）

`launchFailure`の判定を「`result.error`が存在する」から「子processにpidが割り当てられなかった」へ狭め、`runJsonlSession`にも同じ旗を通したため、束縛SHA-256を`99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614`から`2d0c9dcb6a84a4eae4007d1bbc9327740b8e81f2faec1b82ec07cf197023f4e9`へ再度更新した。

**主張する振る舞いは依然として変わっていない。** 現在fileから今回の追加・変更（`launchFailure`のinterface宣言とTSDoc、`run`戻り値の1行、`runJsonlSession`の`failWithReason`・`finish`の引数追加と`error` handlerのpid判定）をすべて除いた残余byte列は、`origin/main` = `3b6dcb88`時点の`src/lib/process.ts`と**完全一致**し、その残余のSHA-256は旧束縛`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`だった。`maxBuffer`既定、`MAX_PROCESS_OUTPUT_BYTES`、`failure`の算出、`status`・`stdout`・`stderr`の写像、`allowFailure`のthrow条件、出力上限超過時の打ち切りとその理由文言はこの一致範囲に含まれる。
