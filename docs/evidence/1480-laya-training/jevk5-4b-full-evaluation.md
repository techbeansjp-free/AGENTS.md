# JevK5 4B Q8_0 全1,000件評価

## 結論

JevK5 4B Q8_0は現行synthetic conformance setの全1,000件に対し、通常順76.63%、選択肢反転順74.63%の総合accuracyだった。severityは93.30% / 97.00%、required actionは71.40% / 67.70%だった。一方、finding `yes` recallは35.00% / 17.25%に留まり、findingの選択肢順序flipも14.5%だった。

従来のholdout 100件だけで観測したfinding recall 20%は全体値ではなかったが、全件でも欠陥側を多数見逃す傾向は解消しなかった。反転順ではさらに悪化するため、現行3判断を一括して担うJev互換decision backendとして直接置換せず、findingの自動却下、formal approval、merge authorityには使用しない。severity推定とrequired action候補提示はadvisory用途の個別評価対象として残す。

この結果はpacket内に規則と値を明示した合成判断契約への適合度であり、実repositoryのcode review精度ではない。

## 実行条件

- model: `alibiserikbay/JevK5-GGUF/jevk5-4b-v0.2-Q8_0.gguf`
- runtime: llama.cpp revision `957538960`
- device: Apple Metalへ全layer offload
- server: loopback `127.0.0.1`、single slot、flash attention有効
- context: 8,192 token
- temperature: 1.532
- prompt cache: 有効
- case: 1,000
- question: finding validity、severity、required action
- arm: 通常順1,000 case、選択肢反転順1,000 case
- decision: 6,000
- 問題集合SHA-256: `8a27d281028b5aea61fa5a1ae8e10548016b0d9cf4b994678216ec83d132622b`
- 通常順結果SHA-256: `cab68d9d050ffe58cd17143456afe352bcb0621d233f78d10bc30e189d06f1a6`
- 反転順結果SHA-256: `f59bf50793f935c580f6d961b6aa0a86ddc25da2dfe60e926a7f893ad5139452`
- 通常順実時間: 1,967.36秒
- 反転順実時間: 1,912.06秒

100件を用いた事前確認ではprompt cacheの有無で300判断の回答と確率が完全一致し、実時間は195.19秒から184.32秒へ5.6%短縮した。共有Metal GPU上でparallel slotを増やす方式とprompt array batchは遅くなったため採用していない。

## 全体結果

| 指標 | 通常順 | 反転順 |
| --- | ---: | ---: |
| 総合accuracy | 76.63% | 74.63% |
| 3判断完全一致 | 51.10% | 37.80% |
| finding accuracy | 65.20% | 59.20% |
| finding balanced accuracy | 68.42% | 64.17% |
| finding `yes` precision | 76.50% | 74.19% |
| finding `yes` recall | 35.00% | 17.25% |
| finding `yes` F1 | 48.03% | 27.99% |
| severity accuracy | 93.30% | 97.00% |
| required action accuracy | 71.40% | 67.70% |
| finding/action整合率 | 69.10% | 46.60% |
| latency中央値 | 1,929.4ms | 1,889.4ms |
| latency p95 | 2,264.0ms | 2,013.5ms |

## Partition別結果

### 通常順

| partition | 総合 | finding | finding recall | severity | action |
| --- | ---: | ---: | ---: | ---: | ---: |
| train 700 | 74.90% | 64.29% | 36.43% | 93.00% | 67.43% |
| validation 100 | 84.67% | 70.00% | 45.00% | 100.00% | 84.00% |
| holdout 100 | 82.33% | 64.00% | 20.00% | 98.00% | 85.00% |
| reserve 100 | 75.00% | 68.00% | 30.00% | 84.00% | 73.00% |

### 反転順

| partition | 総合 | finding | finding recall | severity | action |
| --- | ---: | ---: | ---: | ---: | ---: |
| train 700 | 73.14% | 57.29% | 17.50% | 97.00% | 65.14% |
| validation 100 | 80.33% | 63.00% | 17.50% | 100.00% | 78.00% |
| holdout 100 | 81.00% | 64.00% | 20.00% | 100.00% | 79.00% |
| reserve 100 | 73.00% | 64.00% | 12.50% | 91.00% | 64.00% |

## 選択肢順序

| question | flip | rate |
| --- | ---: | ---: |
| finding validity | 145/1,000 | 14.5% |
| severity | 37/1,000 | 3.7% |
| required action | 206/1,000 | 20.6% |

## Jevとの同一case比較

### 通常順

| question | 両方正解 | Jevだけ正解 | JevK5だけ正解 | 両方誤り |
| --- | ---: | ---: | ---: | ---: |
| finding validity | 502 | 222 | 150 | 126 |
| severity | 933 | 67 | 0 | 0 |
| required action | 552 | 131 | 162 | 155 |

### 反転順

| question | 両方正解 | Jevだけ正解 | JevK5だけ正解 | 両方誤り |
| --- | ---: | ---: | ---: | ---: |
| finding validity | 434 | 296 | 158 | 112 |
| severity | 970 | 30 | 0 | 0 |
| required action | 584 | 123 | 93 | 200 |

JevK5だけが正しいcaseも存在するため、出力を補助signalとして進行役が再検証する用途まで否定しない。ただしfinding recall、順序耐性、cross-question consistencyの差から、Jevと同じ判断器として置換できる結果ではない。

## 判定

JevK5はseverity判定では高精度だが、finding validityのfalse-negative biasとrequired actionの順序依存が大きい。現行dataset上では、finding validity・severity・required actionの現行3判断を一括して担うJev互換decision backendとしての直接置換には採用しない。findingのfalse-negative biasが大きいためfinding rejector・formal gateにも使用しない。一方、severityとrequired actionの精度は本評価で否定していない。severity推定・required action候補提示・advisory routingなど、誤判定が直接findingの採否へ結びつかない用途は個別に評価する。判断種別をseverityだけに限定した別契約、または選択肢順序を固定したうえでのabstention境界の設計は、その個別評価の一部として行う。
