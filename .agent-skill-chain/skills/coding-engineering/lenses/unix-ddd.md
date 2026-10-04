# UNIX・DDDのLens

## 適用条件

domain ruleや責務境界が変わるとき。単純utilityやCRUDへDDD layerを足す理由にしない。

## 判断する問い

- 入出力と副作用が明示され、ひとつの責務を合成・交換できるか。
- 共有状態を最小化できるか。
- 標準用語とBounded Context、model ownerは一致するか。
- invariantを誰が守り、aggregate・transaction境界はどこか。
- context間contractにbusiness ruleが漏れていないか。

## 代表的な失敗

300行classやmethod数だけによる分割、DDDのためだけのlayer追加。

## scope内の修正

既存境界でruleを明示し、変更・理解・testを実際に容易にする分割だけを行う。

## 既存手続きへの接続

用語・invariantの意味、AC、外部contract変更が必要ならStep 9の既存処理へ渡す。

## 通常は助言に留めること

単純helper、pure function、CRUDは現状の構造で成立できる。
