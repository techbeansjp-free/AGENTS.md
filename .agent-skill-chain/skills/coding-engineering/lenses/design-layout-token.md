# Design・Layout TokenのLens

## 適用条件

style変更で意味を共有するdesign decisionがあるとき。

## 判断する問い

- 既存semantic tokenが同じ意味を表すか。
- color・typography・spacing・radius・elevationは共有判断か。
- component stateとthemeで意味が保たれるか。
- breakpoint・container・grid・density・motionは局所詳細か共有判断か。
- token化が変更理由を明確にし、不要な間接参照を増やさないか。

## 代表的な失敗

raw value全面禁止、単なる1pxのためのtoken量産、意味が異なる値の共有。

## scope内の修正

既存tokenを検索して適合時に使う。複数箇所が同じ意味で変化する判断だけをtoken化候補にする。

## 既存手続きへの接続

要求やscopeの変更が必要ならStep 9の既存処理へ渡す。

## 通常は助言に留めること

raw 1pxや局所implementation detailはそのままでよい。projectのtoken慣習を優先する。
