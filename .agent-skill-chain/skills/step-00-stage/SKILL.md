---
name: step-00-stage
description: 変更要求を安全に一時ステージングし、根拠付き入力からfull、quickまたはpocを判定する。
---

# ステップ0: ステージング開始とモード判定

入力は制限済みタイトル、リポジトリパス、Q-01〜Q-08の回答と根拠、および`poc`要求時のPoC宣言とhigh risk確認。成果物は原子的に公開したstaging directory（既定は一時`.agent-skill-chain/tmp/issues/<timestamp>_<title>/`。project policyの`staging.root`が版管理下のdirectoryを指す場合はそこへ直接作り（文書00〜03はcommitする計画の正本であり、機械記録はstagingの`.gitignore`が除外する）、`*`を含むrootでは`issue create --staging-root=<親directory> --name=<directory名>`で配置を明示する。配置の正本は[開発ワークフロー](../../docs/01_開発ワークフロー.md#ステップ011)）、`local-active`の`staging-record.json`、正準JSONの`00_モード判定.json`、Step 0を記録した`journal/steps.jsonl`、説明可能なモード。記録はmode、成果物一覧とcontent digest、既知owner、生成時刻を持つ。`poc`は目的、隔離fixture、runner ID・path、固定argv、use case、BDD scenario、機械observable、成功・中止条件、非対象、責任者がすべて記入済みで、公開API、個人情報、機密情報、外部公開、不可逆操作を含むhigh riskがすべて根拠付きで`なし`の場合だけ選ぶ。未実装fixture/runnerのdigestは要求時点で自己申告させず実装後にASCがexact HEADから計測する。欠落、不明、high risk、変更fileのquick失格条件はfail-closedで`full`へ単調昇格するか停止し、`full`から降格しない。パストラバーサル、制御文字、衝突も拒否する。直下の`issues/`を作らず、耐久化済み・同期済みと報告しない。ステップ1へ合成する。

Q-01〜Q-08へ答える前に[モード判定質問](../../docs/01_開発ワークフロー.md#モード判定質問)を読み、質問文と判定例に照らして回答と根拠を決める。分類名から質問文を推測しない。

このStepを始める前に[起票時点と計画単位](../../docs/01_開発ワークフロー.md#起票時点と計画単位)を読み、対象の作業をcanonical Issueにしてよい時点かを確認する。**規律の本文はその節が唯一所有し、ここへ複製しない。**

## 開始から終了までの読取

1. `asc-step`で確認済みのdoctor結果と正本の節を再利用する。同じcontextで読んだ質問文・同じ資料の範囲を読み直さず、doctorが診断した不足だけを調べる。初回の導入hash・trusted検証宣言・PR rule確認は省略しない。
2. Q回答の根拠に不足する事実だけ、対象code・直接caller・関係するproject choiceから確認する。file一覧・全Skill一覧・全仕様の探索を固定手順にしない。必要な証拠を調べても公開境界やconsumerを限定できないときは、不明を隠してquickを選ばず既存のfull判定へ進む。quickを選ぶために無関係な領域まで全探索せず、独立reviewが担う全体検分をこの時点で先取りしない。
3. CLI入力が不明な場合だけ`issue create --help`を一度確認し、根拠付き入力で`issue create`を実行する。成功結果のstaging・mode・Step 0記録を次工程へ渡して終了する。機械検証済みの入力を別commandや手作業で再判定せず、拒否時は理由が指す入力だけを是正する。tracker起票・内容文書の起草はこのStepへ持ち込まない。

## テンプレート契約

直接使用するテンプレートはない。このステップは内容文書を起草せず、ステップ1が選択する`full / quick / poc`と安全な出力ディレクトリだけを確定する。
