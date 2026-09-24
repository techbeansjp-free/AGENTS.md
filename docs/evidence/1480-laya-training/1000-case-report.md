# Issue #1480 Laya 1,000件学習レポート

## 結論

1,000件の合成decision caseを作成し、CodexとOpusによる独立教師判定、Laya候補の学習、validation評価まで実行した。学習基盤は再現可能になったが、候補modelは品質基準を満たさないため採用しない。formal approval、merge authority、利用者向けreviewerには使用しない。

## Dataset

| 項目 | 結果 |
| --- | ---: |
| case | 1,000 |
| group | 100 |
| train | 700 |
| validation | 100 |
| holdout | 100 |
| reserve | 100 |
| category | 10 |
| artifact format | 10 |
| rule family | 10 |

問題集合SHA-256は`8a27d281028b5aea61fa5a1ae8e10548016b0d9cf4b994678216ec83d132622b`である。Codex回答は`6d1fed7950520941fede6a0b3c79ad702a8e98f92d809bde12185ffee6f451e5`、Opus回答は`3c015cd8fb708e834d4b564c673e3f863a5cf4f372147c91128e2890246864e6`、validation予測は`fd2a2f4ffc7fd020d00e2cabbcead8db2841d64bdc6ebdbcbf879b3af2f4db78`である。dataset本体は`docs/evidence/1480-laya-training/dataset/`へ保存した。

## 教師判定

CodexとOpusは、oracleを含まない同一のblind packetを別々に判定した。trainとvalidationの800 case、3 question、計2,400回答について、両teacherは2,400件すべて一致した。oracleは両teacher成果物の完成後に生成し、両者とも2,400件すべて一致した。

この教師実行は、回答に`inputDigest`を返させる新契約の導入前に行った。そのため教師が読んだ入力を暗号学的に証明する資料とは扱わず、回答を`legacy-unbound` Evidenceとして保存する。レビューで判明した不足を受け、新規実行のblind packetにはcanonical state、question、`inputDigest`を含め、回答側のdigest一致をimport時に必須とした。dataset digestだけを再計算してclaim、evidence、question、case IDを差し替える入力はTypeScript preflightとPython runnerの双方で拒否する。

## 学習実行

- base model: `convaiinnovations/laya-multilingual`
- train row/item: 700 / 2,100
- validation row/item: 100 / 300
- device: Apple MPS
- 学習時間: 734.04秒
- checkpoint SHA-256: `a7223b47cf005367c866381bdef6662da1d218fe285521d7429906f455d2ddb5`

model binaryは大きく、候補も不採用なのでGitへ保存しない。dataset、生成器、履歴教師回答、契約、validation予測を保存する。

## Validation結果

| 指標 | 結果 |
| --- | ---: |
| 全300回答 accuracy | 55.67% |
| finding validity accuracy | 66.00% |
| finding validity macro F1 | 0.7138 |
| required action accuracy | 64.00% |
| required action macro F1 | 0.6992 |
| severity accuracy | 37.00% |
| severity macro F1 | 0.3482 |
| false escalation rate | 57.50% |
| actual Critical finding recall | 33.33%（4/12） |

初回reportのCritical recallは、finding validityが`no`のcaseにも仮定上のCritical severityを数えていた。修正版は実際に有効なCritical findingだけを分母とし、validity=`yes`またはaction=`fix`を検出として数える。表の4/12は、Git管理した履歴validation予測を修正版evaluatorへ入力した事後再評価値であり、新契約による再学習値ではない。この定義でも8/12件を見逃すため、candidateは`rejected`である。

## 情報保護

- 問題は合成値だけから生成し、許可されたprivate repositoryの本文を変換元にしていない。
- fixture検査はlocal path、repository名、URL、email、鍵・代表的credential形式を拒否する。
- private corpusを扱う既存境界は広げていない。
- training出力は`.agent-skill-chain/local/`配下に限定し、権威を持たない。

## 限界と次の判断

この1,000件は10規則familyを展開した基礎教材であり、件数だけを10,000件へ増やしても一般化を保証しない。次の実験を行う場合は、誤答から作る最小対例、複数証拠、権限・例外・guard、仕様とcodeの矛盾、教師間で判断が割れる境界例を追加し、独立holdoutで改善傾向を先に確認する。

現段階ではLayaをASCのreview判定へ採用せず、このPRは学習・評価基盤と再現可能な不採用Evidenceをレビュー可能にするところで停止する。

### Datasetとしての適用範囲

このdatasetは実repositoryのreview品質を直接測るreal-evidence holdoutではない。packet内へ明示した規則、after payload、encoding、impact、actionの読解とdecision consistencyを測るsynthetic conformance setである。したがって本レポートの各model評価は「このsynthetic contract上の結果」であり、実コードreview全般のprecision・recallとは解釈しない。

全1,000件についてpacket truthとoracle truthの機械監査を再実行した。詳細は[評価dataset契約監査](dataset-contract-audit.md)に記録する。実コードに対するReality truthはこのdatasetでは定義せず、別のreal-evidence setが必要である。

## 追加比較: Kev-4B

同じholdout 100件を使い、公式Kev-4BのApple Silicon向けMLX backendでfinding validityだけを通常順・選択肢反転順の計200回評価した。通常順のfinding recallは90%だった一方、100件中90件を`yes`とし、balanced accuracyは36.7%、precisionは40.0%だった。反転順では100件すべてを`yes`とし、option-order flipは10.0%だった。

事前に定めた継続条件（recall 70%以上、balanced accuracy 70%以上、flip 5%以下）のうち2条件を満たさないため、severityとrequired actionは評価していない。中央値460.9msで速度要件は満たしたが、無差別にfindingを有効とする傾向が強く、このsynthetic contractの検証器には採用しない。実行条件、confusion matrix、pin、weight digestは[Kev-4B評価記録](kev-4b-finding-evaluation.md)に記録した。

## 追加比較: Jev 1.13.0

TypeSafe公式APIのJev 1.13.0へ合成データだけを送り、全1,000件を通常順・選択肢反転順で評価した。通常順の総合accuracyは80.23%、finding `yes` recallは84.50%、severityは100%、required actionは68.30%だった。反転順は総合81.23%、finding recall 84.00%、severity 100%、action 70.70%だった。

この全件評価により、従来比較に使ったholdout 100件が全件`trace`形式で、全体代表標本ではないことが判明した。validationは全件`shell`、reserveは全件`xml`、trainは残り7形式である。Jevのfinding accuracyも形式別59%〜92%だったため、100件holdoutだけによる候補順位を撤回する。

Jevのfinding balanced accuracyは67%台、required actionは68〜71%であり、単独authorityには使用しない。全結果とpartition・形式別の監査は[Jev 1.13.0全1,000件評価](jev-1.13.0-full-evaluation.md)に記録した。

## 追加比較: JevK5 4B Q8_0

JevK5も同じ全1,000件、3 question、通常順・反転順の6,000判断を実行した。通常順は総合76.63%、finding recall 35.00%、severity 93.30%、required action 71.40%だった。反転順は総合74.63%、finding recall 17.25%、severity 97.00%、action 67.70%だった。

findingの選択肢順序flipは14.5%、required actionは20.6%で、Jevの3.8% / 5.5%より大きい。従来のholdout 100件に限定したfinding recall 20%は全体値ではなかったが、全件でもfalse-negative biasは残った。Jevのローカル代替には採用しない。実行条件、partition別値、同一case比較は[JevK5 4B Q8_0全1,000件評価](jevk5-4b-full-evaluation.md)に記録した。

## 全件比較の最終判断

| model | 総合accuracy | finding recall | severity | action | finding flip | action flip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev 1.13.0 通常順 | 80.23% | 84.50% | 100.00% | 68.30% | 3.8% | 5.5% |
| Jev 1.13.0 反転順 | 81.23% | 84.00% | 100.00% | 70.70% | 3.8% | 5.5% |
| JevK5 4B 通常順 | 76.63% | 35.00% | 93.30% | 71.40% | 14.5% | 20.6% |
| JevK5 4B 反転順 | 74.63% | 17.25% | 97.00% | 67.70% | 14.5% | 20.6% |

現行synthetic contractではJev 1.13.0が最も安定した。ただしJevもfinding balanced accuracy 67%台、action 68〜71%に留まり、実repositoryのreview精度を測った結果でもない。Jevは進行役がEvidenceを再検証する補助decision signalに限定する。

JevK5・Kev・SemIfは、今回の実測値だけで一様に「不採用」と扱うべきではない。用途によって使用可否が分かれる。

| 用途 | JevK5 | Kev | SemIf |
| --- | --- | --- | --- |
| finding自動却下(rejector) | 禁止 | 禁止 | 禁止 |
| formal approval / merge authority | 禁止 | 禁止 | 禁止 |
| finding valid時の再検証優先度付け(advisory signal) | 使用候補 | 不可(ほぼ全件yes) | 本評価では未評価 |
| severity推定の補助 | 使用候補(93.30% / 97.00%) | 未評価 | 未評価 |
| required actionの候補提示 | 使用候補(71.40% / 67.70%) | 未評価 | 未評価 |
| high-recall候補生成(後段Evidence検証必須) | 未評価 | 本評価の対象外、別途評価が要る | 未評価 |

理由: JevK5はfinding `yes` recallが35.00% / 17.25%とfalse negativeが多く、findingを消す方向の判断(rejector)には使えない。一方severityは93.30% / 97.00%、required actionは71.40% / 67.70%であり、単独のformal gateではなく進行役へのadvisory signal(severity推定・優先順位付け・required action候補)としての価値は本評価で否定されていない。Kevはholdoutで通常順90%・反転順100%が`yes`となるalways-valid傾向のためverifierとして使えないが、precision40%を前提に後段でEvidence検証を必須とするhigh-recall候補生成という用途は本評価の対象外であり、採否は別途評価する。

したがって本評価で不採用と確定するのは「finding自動却下・formal approval・merge authorityへの使用」であり、「severity推定・優先順位付け・required action候補・high-recall候補生成としての利用可能性」は本評価では判定していない。採用を検討する場合は、出力を`{"value", "confidence", "authority": "advisory", "model"}`のように型で区別し、advisory用途ごとに個別の継続gateを設計したうえで再評価する。

Laya候補(本Issueで学習した候補model)は、##結論に記載の品質基準を満たさないため不採用のままとする。この判断はJevK5・Kev・SemIfの外部model評価とは独立である。
