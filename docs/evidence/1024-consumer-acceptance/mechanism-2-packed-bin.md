# 機構2 packed binの故障注入証跡

## 対象製品fileのSHA-256

| path | SHA-256 |
|---|---|
| `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
| `scripts/check_package_contents.ts` | `41d46c9b345df9e0cd4e6fd6f2f4ac72fa02ec4fec989560726fd10ee4084612` |
| `src/lib/process.ts` | `654dc62cad93de1e73e47a545bc46f38740cb759586d4f8d0f67434ae59f561d` |

この3件を記録するのは、consumer acceptanceの判定、package検査への接続、process出力上限という、この証跡が主張する振る舞いの実体だからである。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。

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
