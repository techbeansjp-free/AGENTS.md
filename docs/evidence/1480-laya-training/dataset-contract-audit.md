# Issue #1480 評価dataset契約監査

## 結論

現行1,000件は、packet内の明示規則を読み取るsynthetic conformance setとして成立している。一方、実repositoryにおけるfindingのReality truthを測るdatasetではない。model評価結果はこの適用範囲に限定して解釈する。

## 3種類のtruth

| 種類 | 現行datasetでの状態 |
| --- | --- |
| Reality truth | 対象外。実コード、実行経路、test、PR最終判断を入力に含まない |
| Packet truth | 検証済み。判断に必要な規則、after payloadまたはunobserved、encoding、impact、actionをpacket内に明示 |
| Oracle truth | 検証済み。packetから独立にparseした値と明示規則を適用して再計算 |

## 全件機械監査

2026-09-24にsealed problem setとaudit oracleを用いて全1,000件を再検証した。

| 項目 | 結果 |
| --- | ---: |
| case | 1,000 |
| group / archetype | 100 / 100 |
| rule family | 10、各100件 |
| artifact format | 10、各100件 |
| category | 10、各100件 |
| finding label | yes 400 / no 400 / insufficient 200 |
| severity label | 各tier 250 |
| semantic signature | 900 |
| cross-split semantic clone | 0 |
| cross-split adversarial cluster | 0 |
| artifact parser negative test | 10/10合格 |
| contradictory rationale negative test | 合格 |

semantic signatureが900なのは、各100 archetypeの2件のunobserved variantが同じsemantic materialを持つためである。重複は同一group内に閉じ、partitionをまたがない。

### Holdout 100件

| packet truth | 件数 | 監査結果 |
| --- | ---: | --- |
| yes | 40 | concrete after payloadが明示規則へ違反 |
| no | 40 | concrete after payloadが明示規則へ適合 |
| insufficient-evidence | 20 | after値がsource参照だけで、payloadが未観測 |

40件の`yes`は、packet外のcaller invariantやrepository知識を必要としない。現行contractはclosed-worldであり、packet内のgoverning ruleとafter payloadの比較がclaimの成立条件そのものである。したがって、この40件について「実際にはbugだがpacket内では立証不能」というずれはない。

## Proofの内容

audit oracleはlabelだけでなく、次をcaseごとに保持する。

- `decisiveFact`: decode後のafter値またはunobserved
- `semanticMaterial`: rule family、parameter、after値の関係
- `semanticSignature`: semantic materialのSHA-256
- `rationale.finding-validity`: after値とgoverning ruleからの結論
- `rationale.severity`: 明示impact ruleとの対応
- `rationale.required-action`: 明示action ruleとの対応

validatorは10種類のartifact表現をdecodeし、規則適合性、impact tier、action mappingを再計算してoracleと比較する。malformed artifactと矛盾rationaleをrejectするnegative testも含む。

## 残る限界

- generatorとoracle validatorは同じrule family定義を共有するため、独立したReality truthの証明ではない。
- 1,000件は100 archetype、10 rule familyからの規則的展開であり、実際のreview findingの意味空間を代表しない。
- partitionとartifact formatが完全に交絡している。validation 100件は全件shell、holdout 100件は全件trace、reserve 100件は全件XMLであり、train 700件は残り7形式である。各100件partitionを全形式の代表標本として扱えない。
- option reverse以外のparaphrase、irrelevant evidence、identifier rename、evidence shuffle不変性は固定datasetとして未評価である。
- 実コードの到達可能性、guard、型制約、仕様と実装の矛盾、修正前後、再現testを含まない。

したがって、現行datasetは学習pipeline、typed decision、class balance、option-order sensitivityの回帰試験へ使用する。実reviewerとしての採否には、学習へ使用しないreal-evidence holdoutを別に用意する。

## Jev全件評価での扱い

Jevは全1,000件を通常順・反転順で評価する。3 questionを1 requestへまとめるため、2,000 request・6,000 decisionとなる。全体値だけでなくtrain 700、validation 100、holdout 100、reserve 100を別々に集計する。

従来のholdout 100件はtrace形式だけなので比較の正本から外す。dataset全体の比較には全1,000件を使い、partition別・artifact format別・rule family別の値を併記する。Laya自身はtrain 700件で学習済みなので、全1,000件の値を未知データ性能として扱わず、未学習形式からなるvalidation・holdout・reserveを個別に扱う。結果はsynthetic conformance性能として報告し、実repositoryのreview性能とは表現しない。
