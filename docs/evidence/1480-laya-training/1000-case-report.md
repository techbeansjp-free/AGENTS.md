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

問題集合SHA-256は`8a27d281028b5aea61fa5a1ae8e10548016b0d9cf4b994678216ec83d132622b`、教師label SHA-256は`a0cae0f3b5f4fa50a38e4d0a514b0d6633749ec7748aa44e308d632ee0442ba6`である。dataset本体は`docs/evidence/1480-laya-training/dataset/`へ保存した。

## 教師判定

CodexとOpusは、oracleを含まない同一のblind packetを別々に判定した。trainとvalidationの800 case、3 question、計2,400回答について、両teacherは2,400件すべて一致した。oracleは両teacher成果物の完成後に生成し、両者とも2,400件すべて一致した。

teacher labelはcanonical stateとquestionの`inputDigest`へ結合した。dataset digestだけを再計算してclaim、evidence、question、case IDを差し替える入力はTypeScript preflightとPython runnerの双方で拒否する。

## 学習実行

- base model: `convaiinnovations/laya-multilingual`
- train row/item: 700 / 2,100
- validation row/item: 100 / 300
- device: Apple MPS
- 学習時間: 734.04秒
- checkpoint SHA-256: `a7223b47cf005367c866381bdef6662da1d218fe285521d7429906f455d2ddb5`

model binaryは大きく、候補も不採用なのでGitへ保存しない。dataset、生成器、教師label、契約、評価結果を保存する。

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

初回reportのCritical recallは、finding validityが`no`のcaseにも仮定上のCritical severityを数えていた。修正版は実際に有効なCritical findingだけを分母とし、validity=`yes`またはaction=`fix`を検出として数える。この定義でも8/12件を見逃すため、candidateは`rejected`である。

## 情報保護

- 問題は合成値だけから生成し、許可されたprivate repositoryの本文を変換元にしていない。
- fixture検査はlocal path、repository名、URL、email、鍵・代表的credential形式を拒否する。
- private corpusを扱う既存境界は広げていない。
- training出力は`.agent-skill-chain/local/`配下に限定し、権威を持たない。

## 限界と次の判断

この1,000件は10規則familyを展開した基礎教材であり、件数だけを10,000件へ増やしても一般化を保証しない。次の実験を行う場合は、誤答から作る最小対例、複数証拠、権限・例外・guard、仕様とcodeの矛盾、教師間で判断が割れる境界例を追加し、独立holdoutで改善傾向を先に確認する。

現段階ではLayaをASCのreview判定へ採用せず、このPRは学習・評価基盤と再現可能な不採用Evidenceをレビュー可能にするところで停止する。
