# 機構1 git依存準備の故障注入証跡

## 対象製品fileのSHA-256

| path | SHA-256 |
|---|---|
| `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
| `src/lib/process.ts` | `888c3467dec10e0f5b62c746fe7929e0391bf071039ea6d9fdd2b03b37f2742d` |

この2件を記録するのは、consumer acceptanceの判定とprocess出力上限という、この証跡が主張する振る舞いの実体だからである。**`scripts/check_package_contents.ts`は含めない。** 同fileは`checkConsumerAcceptance`を`mechanisms: ["packed-bin", "scale-output"]`で呼んでおり、**この機構は接続経路に存在しない**（Issue #1221）。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。

## artifact_sha256

`07345e957be38d14a6de58ff3e3f0533d2f0c7467fe5bf1cea05ef5571d9536e`

## distribution_digest

`8742ef9ff7c8e0e7e8eb36bf9fd80718f71e3239888726a282f553f5a98d38a9`

## digestの区別

`artifact_sha256` は `npm pack --ignore-scripts` で作った `agent-skill-chain-0.3.1-beta.44.tgz` のbyte列に対するSHA-256である。`distribution_digest` は `npm_config_cache=/tmp/asc-1024-seg12.kkZ231/baseline/npm-cache node --import tsx scripts/compute_distribution_digest.ts` が返したTERM-ASC-024の配布内容digestであり、tarballの圧縮byte列をhashした値ではない。機構1はgit sourceをcloneするためtarball自体へ変異を入れず、同じrelease候補artifactの識別値を保持した。

## 注入差分

```diff
--- a/package.json
+++ b/package.json
@@
-    "prepare": "npm run build",
-    "prepack": "npm run build"
+    "prepare": "node --eval \"process.exit(0)\"",
+    "prepack": "node --eval \"process.exit(0)\""
```

実npmと実pnpmがcommitをcloneする必要があるため、観測用sourceを複製した `/tmp/asc-1024-seg12.kkZ231/mechanism-1/repository` だけに故障commit `6d25ae542cb620d0457b7f0258a83712640ea1ba` を作った。主worktreeにはcommitしていない。準備scriptを成功終了だけするno-opへ変えたのは、install自体の一般的な失敗ではなく、準備済み公開binの欠落を3条件の複合判定が検出するかを見るためである。

## 実行command

注入前後とも一時repository直下でrelease経路と同じ複合CLIを実行した。CLI内部で実npm、`corepack pnpm@11.24.0` のallowBuildsなし、同じpnpmのallowBuildsありを順に観測する。

```sh
node --import tsx scripts/check_consumer_acceptance.ts --tarball=/tmp/asc-1024-seg12.kkZ231/baseline/agent-skill-chain-0.3.1-beta.44.tgz --mechanisms=git-dependency
```

CLIの要約前に3条件それぞれの観測値も保存するため、同じ実装の `observeGitDependency` を3条件で呼び、`composeGitDependencyObservation` と `evaluateConsumerAcceptance` で1件の複合観測へ集約した。実行したcommandは次である。

```sh
node --import tsx --input-type=module --eval 'import path from "node:path"; import {execFileSync} from "node:child_process"; import {pathToFileURL} from "node:url"; import {composeGitDependencyObservation,evaluateConsumerAcceptance,observeGitDependency} from "./scripts/check_consumer_acceptance.ts"; const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(); const common={dependency:`git+${pathToFileURL(process.cwd()).href}#${sha}`,packageName:"agent-skill-chain",executableName:"agent-skill-chain",sourceRepositoryRoot:process.cwd(),temporaryStagingRoot:path.join(process.cwd(),".agent-skill-chain","tmp")}; const npm=observeGitDependency({...common,packageManager:"npm",allowBuilds:false}); const pnpmWithoutAllowBuilds=observeGitDependency({...common,packageManager:"pnpm",allowBuilds:false}); const pnpmWithAllowBuilds=observeGitDependency({...common,packageManager:"pnpm",allowBuilds:true}); const composite=composeGitDependencyObservation({npm,pnpmWithoutAllowBuilds,pnpmWithAllowBuilds}); const result=evaluateConsumerAcceptance([composite],["git-dependency"]); const value=(item)=>item.state==="observed"?item.value:`indeterminate: ${item.reason}`; const summary=(item)=>({variant:item.gitDependencyVariant,expectation:item.gitDependencyExpectation,preparationStatus:value(item.preparation.status),explicitDenial:`${item.preparation.stdout}\n${item.preparation.stderr}`.includes("ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED"),binExists:value(item.binExists),entrypointStatus:value(item.entrypoint.status)}); process.stdout.write(`${JSON.stringify({result,conditions:[summary(npm),summary(pnpmWithoutAllowBuilds),summary(pnpmWithAllowBuilds)]},null,2)}\n`); if(!result.accepted) process.exitCode=1;'
```

## 注入前の終了値

`0`。複合CLIと3条件展開commandはいずれも終了値0だった。

| 条件 | 準備終了値 | 明示停止 | bin | 公開入口終了値 | 条件の判定 |
|---|---:|---|---|---:|---|
| 実npm 11.17.0 | 0 | 対象外 | あり | 0 | accepted |
| `corepack pnpm@11.24.0`、allowBuildsなし | 1 | `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` を観測 | なし | 安全停止のため未起動 | accepted |
| `corepack pnpm@11.24.0`、allowBuildsあり | 0 | 対象外 | あり | 0 | accepted |

allowBuildsなしをacceptedとするのは、pnpmの安全機構が明示的に準備を拒否したこと自体がこの条件の期待値だからである。終了値0やerror欠落を合格へ倒してはいない。

## 注入後の終了値

`1`。複合CLIと3条件展開commandはいずれも終了値1だった。

| 条件 | 準備終了値 | 明示停止 | bin | 公開入口終了値 | 条件の判定 |
|---|---:|---|---|---|---|
| 実npm 11.17.0 | 0 | 対象外 | なし | bin欠落のため未起動 | rejected: `公開binが存在しません` |
| `corepack pnpm@11.24.0`、allowBuildsなし | 1 | `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` を観測 | なし | 安全停止のため未起動 | accepted |
| `corepack pnpm@11.24.0`、allowBuildsあり | 0 | 対象外 | なし | bin欠落のため未起動 | rejected: `公開binが存在しません` |

npmとallowBuildsありのpnpmがともに不合格であり、allowBuildsなしの安全停止だけでは複合全体を合格にしなかった。

## 機構別診断

機構識別子は `git-dependency`。注入前は `accepted`、注入後は `npm: 公開binが存在しません` および `pnpm（allowBuildsあり）: 公開binが存在しません` により `rejected` だった。

## 保存先

`docs/evidence/1024-consumer-acceptance/mechanism-1-git-dependency.md`

## 復元確認

変異前copyを `cp` で一時repositoryの `package.json` へ戻し、主worktreeの `package.json` も退避copyから `cp` で復元した。`cmp -s` は双方とも終了値0で、変異前copy、一時repository、主worktreeのSHA-256はすべて `1d1773b314faf375b14494aa286d56f4f1bf0540f898011de1427aaaabceebe9` と一致した。`git checkout` は使用していない。
