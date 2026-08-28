# 機構3 規模依存process出力上限の故障注入証跡

## 対象製品fileのSHA-256

| path | SHA-256 |
|---|---|
| `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
| `scripts/check_package_contents.ts` | `1e361ff34331fa9ec9236ca640b5e4e25fe09fdf4bd955345531e1c908af6483` |
| `src/lib/process.ts` | `654dc62cad93de1e73e47a545bc46f38740cb759586d4f8d0f67434ae59f561d` |

この3件を記録するのは、consumer acceptanceの判定、package検査への接続、process出力上限という、この証跡が主張する振る舞いの実体だからである。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。

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

変異前copyを `cp` で `src/lib/process.ts` へ戻し、`cmp -s` の終了値0を確認した。復元fileとcopyのSHA-256はともに `654dc62cad93de1e73e47a545bc46f38740cb759586d4f8d0f67434ae59f561d` でbyte単位一致した。復元sourceからのbuildも終了値0だった。故障状態の配布digestを再算出した2回目の注入後にも同じcopy復元、SHA-256一致、build成功を確認した。`git checkout` は使用していない。
