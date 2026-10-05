# 冪等性・ConcurrencyのLens

## 適用条件

write、double-submit、retry、timeout、queue、webhook、job、migration、外部createを扱うとき。

## 判断する問い

- 同じ入力を再送したとき副作用は一度に収まるか。
- 同時実行と順序逆転でどのinvariantが破れるか。
- 成功後に応答を失ったとき結果を照合できるか。
- deduplicationのscope・期限・key衝突は妥当か。
- transactionと外部副作用の隙間をどう復旧するか。
- retryは有限で、再実行可能な失敗だけに限定されるか。

## 代表的な失敗

check-then-insertの競合、retryで二重insert、無限retry、記録前の外部副作用。

## scope内の修正

既存patternに沿ってunique constraint、idempotency key、deduplication、transaction、CAS、state machine、単調revision、reconciliation、bounded retryから選ぶ。scope内で修正し、可能なら反復・競合実行を検証する。

## 既存手続きへの接続

invariant・security境界・不可逆操作・authority変更が必要ならStep 9の既存処理へ渡す。

## 通常は助言に留めること

pure functionに冪等性基盤を足さない。特定方式を一律強制しない。
