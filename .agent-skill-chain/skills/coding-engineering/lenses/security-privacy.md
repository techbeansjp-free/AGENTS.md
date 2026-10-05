# Security・PrivacyのLens

## 適用条件

auth、permission、role、PII、secret、tenant境界、untrusted input、file/path、process、破壊操作、dependency/build/releaseを扱うとき優先する。

## 判断する問い

- 入力と権限の信頼境界はどこか。
- object・tenant単位の認可を保つか。
- path traversal・symlink・command injectionを許さないか。
- secretやPIIがlog、error、fixtureへ漏れないか。
- 失敗時に権限やdataを安全に保つか。
- 依存・build・releaseの取得元と実行権限は妥当か。

## 代表的な失敗

入力validationだけで認可を済ませる、shell文字列への未信頼入力展開、不要な個人情報logging。

## scope内の修正

scope内のvalidation・認可漏れ・伏字・安全なAPI利用を修正し、該当境界の失敗を検証する。

## 既存手続きへの接続

security境界拡大、不可逆操作追加、authority不足はStep 9の既存処理へ渡す。

## 通常は助言に留めること

通常変更で全security checklistを読み込まない。無関係なsecurity検査を追加しない。
