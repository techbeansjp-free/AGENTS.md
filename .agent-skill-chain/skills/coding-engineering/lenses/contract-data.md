# Contract・DataのLens

## 適用条件

API、event、CLI contract、DB/schema、migration、backfillを変えるとき。

## 判断する問い

- producerとconsumerの互換性を保てるか。
- 欠落・unknown field・version差異で何が起きるか。
- data invariantとtransaction境界はどこか。
- 途中失敗や再実行でdata loss・部分更新が起きないか。
- migration・rollback・reconciliationで元の整合状態へ戻せるか。

## 代表的な失敗

内部helperの変更を公開contract変更と混同する、移行途中の旧新dataを忘れる。

## scope内の修正

境界validation、互換性test、原子的更新や安全な復旧を既存patternで実装する。

## 既存手続きへの接続

公開/外部contract、invariantの変更や不可逆操作追加はStep 9の既存処理へ渡す。

## 通常は助言に留めること

内部API・命名修正は通常判断。共通部でDBやmigration方式を固定しない。
