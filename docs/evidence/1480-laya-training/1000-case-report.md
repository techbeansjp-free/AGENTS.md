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
