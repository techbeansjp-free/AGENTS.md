---
name: step-00-stage
description: 変更要求を安全に一時ステージングし、根拠付き入力からfull、quickまたはpocを判定する。
---

# ステップ0: ステージング開始とモード判定

入力は制限済みタイトル、リポジトリパス、Q-01〜Q-08の回答と根拠、および`poc`要求時のPoC宣言とhigh risk確認。成果物は原子的に公開したstaging directory（既定は一時`.agent-skill-chain/tmp/issues/<timestamp>_<title>/`。project policyの`staging.root`が版管理下のdirectoryを指す場合はそこへ直接作り（文書00〜03はcommitする計画の正本であり、機械記録はstagingの`.gitignore`が除外する）、`*`を含むrootでは`issue create --staging-root=<親directory> --name=<directory名>`で配置を明示する。配置の正本は[開発ワークフロー](../../docs/01_開発ワークフロー.md#ステップ011)）、`local-active`の`staging-record.json`、正準JSONの`00_モード判定.json`、Step 0を記録した`journal/steps.jsonl`、説明可能なモード。記録はmode、成果物一覧とcontent digest、既知owner、生成時刻を持つ。`poc`は目的、隔離fixture、runner ID・path、固定argv、use case、BDD scenario、機械observable、成功・中止条件、非対象、責任者がすべて記入済みで、公開API、個人情報、機密情報、外部公開、不可逆操作を含むhigh riskがすべて根拠付きで`なし`の場合だけ選ぶ。未実装fixture/runnerのdigestは要求時点で自己申告させず実装後にASCがexact HEADから計測する。欠落、不明、high risk、変更fileのquick失格条件はfail-closedで`full`へ単調昇格するか停止し、`full`から降格しない。パストラバーサル、制御文字、衝突も拒否する。直下の`issues/`を作らず、耐久化済み・同期済みと報告しない。ステップ1へ合成する。

Q-01〜Q-08へ答える前に[モード判定質問](../../docs/01_開発ワークフロー.md#モード判定質問)を読み、質問文と判定例に照らして回答と根拠を決める。分類名から質問文を推測しない。

このStepを始める前に[起票時点と計画単位](../../docs/01_開発ワークフロー.md#起票時点と計画単位)を読み、対象の作業をcanonical Issueにしてよい時点かを確認する。**規律の本文はその節が唯一所有し、ここへ複製しない。**

## テンプレート契約

直接使用するテンプレートはない。このステップは内容文書を起草せず、ステップ1が選択する`full / quick / poc`と安全な出力ディレクトリだけを確定する。
