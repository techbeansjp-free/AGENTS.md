# Kev-4B finding validity評価

## 結論

Kev-4Bはfinding-only継続gateを満たさなかった。severityとrequired actionは評価していない。

このmodelは当該環境で高速だったが、固定holdout上でvalid findingとinvalid findingを識別できなかった。通常順では100件中90件、反転順では100件すべてを`yes`とした。90%と100%のpositive recallは、安定したreview推論ではなくclass biasによる部分が大きい。

## 固定した評価契約

- holdout: JevK5・SemIf評価と同じblind 100件
- question: `finding-validity`だけ
- arm: 通常の選択肢順と完全な反転順
- 通常順入力SHA-256: `19c4973507c05d9f23e7307b438482395f51b9f156956f52deec0bdcd6810ec2`
- 反転順入力SHA-256: `d2816ddbcdb656fac05c3df24023087da03871bb6e02225ad752e0aa03b540a4`
- 正解labelはrequestへ含めず、推論完了後の採点だけに使用
- 継続gate:
  - finding `yes` recall 70%以上
  - 3-class balanced accuracy 70%以上
  - option-order flip 5%以下

## 実行系の再現情報

- Kev source commit: `62c91838b9a6adc5b386cbeae8ed73daa36ce220`
- Kev checkpoint: `jaredpalmer/kev-4b`
- Kev checkpoint revision: `1da696f7938f77c4cdf5471e92fd342baff41778`
- base: `Qwen/Qwen3.5-4B-Base`
- base revision: `1001bb4d826a52d1f399e183466143f4da7b741b`
- backend: 公式Kev MLX backend
- device: Apple MPS / Metal
- dtype: bfloat16
- LoRA rank: 16
- calibration temperature: `2.962195104573128`
- server: loopback `127.0.0.1:18082`
- base weight SHA-256:
  - shard 1: `df547074dce70532a0493e5433152bd17a65efb89088cfabc2e7e2371a93d712`
  - shard 2: `590fbaac095dd31db886c322d9d2f7df47777966391acf306ddddc3e4e3a15ef`

weightは上記digestを実ファイルから再計算し、pin済みHub metadataと一致することを確認した。model binaryはGitへ保存しない。

## 結果

| 指標 | 通常順 | 反転順 |
| --- | ---: | ---: |
| accuracy | 42.0% | 40.0% |
| balanced accuracy | 36.7% | 33.3% |
| finding `yes` precision | 40.0% | 40.0% |
| finding `yes` recall | 90.0% | 100.0% |
| `yes`予測 | 90/100 | 100/100 |
| model latency中央値 | 460.9ms | 480.0ms |
| wall time中央値 | 463.4ms | 482.1ms |
| input token中央値 | 317.5 | 317.5 |

通常順のconfusion matrix:

| actual | predicted yes | predicted no | predicted insufficient |
| --- | ---: | ---: | ---: |
| yes | 36 | 4 | 0 |
| no | 36 | 4 | 0 |
| insufficient | 18 | 0 | 2 |

反転順のconfusion matrix:

| actual | predicted yes | predicted no | predicted insufficient |
| --- | ---: | ---: | ---: |
| yes | 40 | 0 | 0 |
| no | 40 | 0 | 0 |
| insufficient | 20 | 0 | 0 |

選択肢を反転すると100件中10件が変わり、flip率は10.0%だった。

## Gate判定

| Gate | 閾値 | 結果 | 合否 |
| --- | ---: | ---: | --- |
| finding recall | 70%以上 | 90.0% | 合格 |
| balanced accuracy | 70%以上 | 36.7% | 不合格 |
| option flip | 5%以下 | 10.0% | 不合格 |

総合判定は**不合格**である。

Kev-4Bは速度課題を解消したが、このsynthetic conformance setに対するdecision品質を解消しなかった。negativeまたはinsufficientの60件中54件をfalse positiveとしたため、ほぼalways-valid classifierとして振る舞う。finding生成modelではなく当該contractの検証器として使う場合、この出力は候補の絞り込みに寄与しない。この結果だけから実repositoryに対するreview能力は判定しない。
