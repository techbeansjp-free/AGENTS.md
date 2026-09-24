# Jev 1.13.0 全1,000件評価

## 結論

Jev 1.13.0は現行synthetic conformance setの全1,000件に対し、通常順80.23%、選択肢反転順81.23%の総合accuracyだった。finding `yes` recallは84.50% / 84.00%、severityは両armで100%だった。

従来比較に使ったholdout 100件は全件が`trace`形式であり、全体を代表する標本ではなかった。validationは全件`shell`、reserveは全件`xml`である。したがって、過去のholdout 100件だけによるmodel順位は撤回し、全1,000件、形式別、rule family別の値を主Evidenceとする。

この結果はpacket内に規則と値を明示した合成判断契約への適合度であり、実repositoryのcode review精度ではない。

## 実行条件

- provider: TypeSafe公式API
- endpoint: `https://api.typesafe.ai/v1/systemone`
- model: `jev-1.13.0`へ固定
- case: 1,000
- question: finding validity、severity、required action
- arm: 通常順1,000 request、選択肢反転順1,000 request
- decision: 6,000
- 問題集合SHA-256: `8a27d281028b5aea61fa5a1ae8e10548016b0d9cf4b994678216ec83d132622b`
- oracle SHA-256: `34e0944d115934299d70a106c53ff1a5a2607cce6703bca6f7d56375fa9c8e5a`
- API key: macOS Keychainから実行時だけ取得し、出力・Git・logへ保存していない
- external payload: 合成caseだけ。private repository本文を送っていない
- input token: 1,696,050
- output token: 259,770
- list price換算: 約USD 0.0712

## 全体結果

| 指標 | 通常順 | 反転順 |
| --- | ---: | ---: |
| 総合accuracy | 80.23% | 81.23% |
| 3判断完全一致 | 63.70% | 66.50% |
| finding accuracy | 72.40% | 73.00% |
| finding balanced accuracy | 67.08% | 67.83% |
| finding `yes` precision | 64.50% | 65.24% |
| finding `yes` recall | 84.50% | 84.00% |
| finding `yes` F1 | 73.16% | 73.44% |
| severity accuracy | 100.00% | 100.00% |
| required action accuracy | 68.30% | 70.70% |
| latency中央値 | 525.0ms | 524.3ms |
| latency p95 | 696.3ms | 591.4ms |

## Partition別結果

### 通常順

| partition | 総合 | finding | finding balanced | precision | recall | severity | action |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| train 700 | 79.00% | 71.14% | 65.60% | 62.47% | 85.00% | 100.00% | 65.86% |
| validation 100 | 94.00% | 91.00% | 92.50% | 89.74% | 87.50% | 100.00% | 91.00% |
| holdout 100 | 83.33% | 73.00% | 67.50% | 70.21% | 82.50% | 100.00% | 77.00% |
| reserve 100 | 72.00% | 62.00% | 51.67% | 56.14% | 80.00% | 100.00% | 54.00% |

### 反転順

| partition | 総合 | finding | finding balanced | precision | recall | severity | action |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| train 700 | 79.90% | 71.29% | 65.71% | 62.60% | 84.29% | 100.00% | 68.43% |
| validation 100 | 94.00% | 91.00% | 92.50% | 89.74% | 87.50% | 100.00% | 91.00% |
| holdout 100 | 86.00% | 76.00% | 72.50% | 75.00% | 82.50% | 100.00% | 82.00% |
| reserve 100 | 73.00% | 64.00% | 53.33% | 58.18% | 80.00% | 100.00% | 55.00% |

## 選択肢順序

| question | flip | rate |
| --- | ---: | ---: |
| finding validity | 38/1,000 | 3.8% |
| severity | 0/1,000 | 0.0% |
| required action | 55/1,000 | 5.5% |

## Datasetで判明した交絡

| partition | artifact format |
| --- | --- |
| train | JSON、TOML、YAML、SQL、Python、TypeScript、Markdown |
| validation | shellだけ |
| holdout | traceだけ |
| reserve | XMLだけ |

各partitionのlabel比率とvariant indexは均衡しているが、artifact formatは完全に分離されている。Jevのfinding accuracyも形式別で59%から92%まで変動した。

| 形式 | finding accuracy |
| --- | ---: |
| YAML | 59% |
| JSON | 62% |
| XML | 62% |
| TOML | 64% |
| TypeScript | 66% |
| Markdown | 67% |
| trace | 73% |
| SQL | 88% |
| shell | 91% |
| Python | 92% |

rule family別でも`length` 49%、`suffix` 50%、`excludes` 92%と差がある。全体値は100 archetypeと10形式を均等に含むため現行dataset内の平均として使えるが、実reviewへの外挿はできない。

## 判定

Jevはこのsynthetic contractで比較した候補の中では有力である。ただしfinding balanced accuracy 67%台、insufficient-evidence recall 40.5% / 42.0%、required action 68.3% / 70.7%であり、単独のformal approvalや自動却下には使用しない。進行役がEvidenceを確認する補助decision signalとして評価する。
