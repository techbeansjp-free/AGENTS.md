# UI・UX・AccessibilityのLens

## 適用条件

UI、component、利用者の操作状態を変えるときだけ読む。

## 判断する問い

- primary taskと情報の優先順位は明確か。
- loading・empty・error・success・disabledから次の行動が分かるか。
- 失敗から回復できるか。
- keyboard・focus・touchで操作できるか。
- screen readerと色以外の状態識別に対応するか。
- responsive時の順序・密度・認知負荷は妥当か。

## 代表的な失敗

見た目だけの成功状態、focus消失、色だけのerror、復旧操作の欠落。

## scope内の修正

既存componentとprojectのaccessibility targetを使い、対象状態・操作の回帰を修正する。

## 既存手続きへの接続

ACや公開contract、scopeの変更を要するときはStep 9の既存処理へ渡す。

## 通常は助言に留めること

共通部でUI frameworkやcheckerを固定しない。UIでない変更へ適用しない。
