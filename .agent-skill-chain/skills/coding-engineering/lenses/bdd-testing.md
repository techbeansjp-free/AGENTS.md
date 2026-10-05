# BDD・TestingのLens

## 適用条件

AC、domain behavior、重要回帰の検証方法を選ぶとき。

## 判断する問い

- 観測すべきbusiness behavior・ACは何か。
- unitで要求を観測できるか、境界interactionやend-to-endが必要か。
- 正常系に加え、この変更の失敗・境界を再現できるか。
- Gherkinがbusiness ruleを明確にするか。
- project policyと既存Verification Setの要求を保持しているか。

## 代表的な失敗

低レベルunitを無条件にGherkin化する、実装の写経test、小修正ごとのfull suite。

## scope内の修正

failing targeted testを診断し、要求を表す最小testで修正・再実行する。projectがGherkin全面利用を選んでいれば従う。

## 既存手続きへの接続

AC変更やscope外変更を要する場合だけStep 9の既存処理へ渡す。

## 通常は助言に留めること

test構成とfixture調整は通常の実装判断。途中のtargeted合格は最終検証の代替ではない。
