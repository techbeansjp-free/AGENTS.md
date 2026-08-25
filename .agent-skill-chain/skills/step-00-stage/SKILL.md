---
name: step-00-stage
description: 変更要求を安全に一時ステージングし、根拠付き入力からfull、quickまたはpocを判定する。
---

# ステップ0: ステージング開始とモード判定

入力は制限済みタイトル、リポジトリパス、Q-01〜Q-08の回答と根拠、および`poc`要求時のPoC宣言とhigh risk確認。成果物は原子的に公開した一時`.agent-skill-chain/tmp/issues/<timestamp>_<title>/`、`local-active`の`staging-record.json`、説明可能なモード。記録はmode、成果物一覧とcontent digest、既知owner、生成時刻を持つ。`poc`は目的、期間、成功・中止条件、非対象、責任者がすべて記入済みで、公開API、個人情報、機密情報、外部公開、不可逆操作を含むhigh riskがすべて根拠付きで`なし`の場合だけ選ぶ。欠落、不明、high risk、変更fileのquick失格条件はfail-closedで`full`へ単調昇格するか停止し、`full`から降格しない。パストラバーサル、制御文字、衝突も拒否する。直下の`issues/`を作らず、耐久化済み・同期済みと報告しない。ステップ1へ合成する。

## テンプレート契約

直接使用するテンプレートはない。このステップは内容文書を起草せず、ステップ1が選択する`full / quick / poc`と安全な出力ディレクトリだけを確定する。
