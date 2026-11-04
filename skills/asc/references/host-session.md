# 別セッションの命名と結果保存

独立レビュー・設計相談を現在のHostの別セッションで実行するときは、開始名を `自動: <Issue・内容>`、正常終了後を `済: 自動: <Issue・内容>` とする。`済`は呼出しが完了した印であり、レビュー合格を意味しない。失敗・時間切れ・中断を済へ改名しない。Host内のサブエージェント機能で表示名を設定できない場合は、依頼名にこの接頭辞を使い、親の結果に実行ID・終了状態を残す。一覧の表示名が変更できたとは報告しない。

## 一括実行

配布パッケージのNode CLIで起動・結果保存・完了時改名を一度に行う。実行するHostを明示し、別Hostへ自動切替えしない。位置引数は**レビュー対象のworktree**のまま指定する。Git管理済みなら、Gitのworktree一覧にある主要checkout（repository root）からHostを起動し、セッションの所属先とレビュー対象を分離する。rootからコマンドを呼んだだけでは不十分なため、CLIが起動cwdを解決する。非Gitでは指定directoryを起動先・対象の両方に使う。新規Contextを作り、既存セッションの履歴を独立レビューへ継承しない。モデルは[モデル選択](../../subagent-model-selection/SKILL.md)と利用者の許可範囲で明示する。

```sh
node /absolute/package/bin/asc-v05.mjs host-session claude /absolute/worktree \
  --name '1644 独立レビュー' --model opus --rename-model haiku \
  --prompt-file /absolute/review-request.txt --output-dir /absolute/new-review-result

node /absolute/package/bin/asc-v05.mjs host-session codex /absolute/worktree \
  --name '1644 独立レビュー' --model '<許可されたCodexモデル>' \
  --prompt-file /absolute/review-request.txt --output-dir /absolute/new-review-result
```

依頼ファイルに元要求・対象・契約・レビュー手順を含める。出力先の親directoryは事前に用意し、実行ごとに未作成のdirectoryを指定する。既存directoryは上書きしない。`--executable /absolute/host-binary`で導入済みのHostを選べる。依存の自動導入やHost設定の書換えはしない。

- Claude Code: `-p -n`で命名、事前に生成したUUIDを`--session-id`で指定。起動時と同じrepository root・IDを`--resume`して`-n '済: …'`で改名する。改名は`--max-turns 1`、ツール無効で短い応答だけを行う。モデルは本体と同じものを使うが、許可された小さいモデルを`--rename-model haiku`等で明示できる。上限や権限拒否を別モデルで回避しない。モデル呼出しが一度増える。対象がrootと異なるときは`--add-dir <worktree絶対path>`を付ける。実行本体は`--tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config`で限定する。本体・改名とも`--settings '{"disableAllHooks":true}'`で通常のhookを無効化する。managed policyのhookはこの設定で無効化できないため、管理hookのない環境または管理側で読取り専用契約を満たすことを確認した環境で実行する。Bashが必要なレビューをこのコマンドだけで完了扱いしない。
- Codex: `codex app-server`の公式JSON-RPCでrepository rootを`cwd`にした新規`thread/start`、開始前に`thread/name/set`、`turn/start`、成功した`turn/completed`後に同じIDへ`thread/name/set`を送る。`turn/start`でcwdをworktreeへ変えず、セッションのroot所属を保つ。命名だけではモデルを呼ばない。`sandbox: read-only`・`approvalPolicy: never`を指定し、サーバーからの承認要求は許可しない。MCP等の外部連携の権限は別途確認する。ローカルsandboxだけを外部書込み防止の保証にしない。

両Hostへ対象worktreeの絶対path・開始時HEADを追加指示し、rootは一覧用の場所であってレビュー対象ではないと明示する。対象側のAGENTS.md/CLAUDE.md・入れ子規約を読む。Claudeの追加指示とCodexのdeveloperInstructionsにこの境界を入れる。mainの同名fileや別worktreeで代用せず、必要なGit操作は対象pathを指定する。本体終了後の検査で対象HEADが変わっていれば失敗とし、完了改名しない。改名後も再検査し、変更を検出した場合は結果を保持して`status: failed`とする。改名済みの表示名は取り消さず、`naming`には実際の改名結果を残す。Gitの更新とHostの改名は原子的ではなく、検査後の変更まで防ぐものではない。未commit差分もレビュー対象に含める場合は、その内容と検証対象の一致を依頼側で維持する。

主要checkoutが消えている・bare構成で主要checkoutがない・Gitメタデータが壊れている場合は無名の別の場所へfallbackせず起動前に停止する。非Git判定のために壊れたGit状態を無視しない。

Hostの版・rootと対象worktree双方のhookや外部ツール設定は起動前に確認する。必須制限を満たせない場合は未完了。表示名のためにsandboxや承認を解除しない。セッションのjsonl・index・DBを直接編集しない。Claudeのworktree別の保存場所を探したり、Codexの最新セッションを推測して改名したりせず、この実行のIDだけを使う。

## 記録が不要・命名機能が使えないとき

使い捨ての読取りなら`--ephemeral`を追加する。Claudeの`--no-session-persistence`、Codexの`thread/start`の`ephemeral: true`を使い、保存セッションへの命名・改名を省く。これはHostのセッション記録を残さない選択であり、ASCの結果ファイルは残る。

Codexの`exec`には命名用フラグを仮定しない。App Serverの命名APIがない版では開始時に失敗し、無名のまま処理を続けない。必要なら利用者の許可範囲で明示的に非永続を選ぶ。`codex exec --ephemeral -s read-only`等を直接使う場合も、実行ID・結果・終了状態を親で管理する。非永続機能もないHostでは自動の一覧整理が未対応と明示し、対応済みとは報告しない。

## 結果・失敗・復旧

`status.json`にHost、実際の起動先`cwd`、対象`targetDirectory`・`targetHead`、ID、指定モデル、時刻、処理状態と命名状態を保存する。`result.txt`が応答、`events.jsonl`がHostの元出力、`stderr.txt`が診断。Claudeの改名出力は別ファイルで保存する。これらは依頼や応答を含むことがあるため、公開前に秘密情報を確認する。

応答は改名より先に保存する。改名だけ失敗しても`status: completed`と結果を保持し、`naming: failed`で報告する。終了コードは本体成功0、本体失敗2、引数・出力先等のエラー1。成功コードだけで改名成功やレビュー合格と判定せず、状態と本文を確認する。命名失敗時にレビューを再実行しない。保存したID・cwdを使って公式手段で改名を再試行できる。

`--timeout-ms`は本体の待機上限（既定15分）。Codexの個別RPCとClaudeの改名は最大60秒。強制停止・プロセス障害で`running`が残ることがあり、未完了として元出力とHostの状態を確認する。親の終了から子孫プロセスの終了を推定せず、[復旧手順](../../execution-recovery/SKILL.md)に従う。

対応手段の参照: [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)、[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Codex CLI](https://learn.chatgpt.com/docs/cli/reference)。対応版と実検証の対象は提出Evidenceに残す。

一覧の確認は、起動したrootと同じprojectを開き、この実行のIDと表示名で行う。Codexは公式`thread/list`のcwdフィルタでも確認できる。UI固有のフィルタや別rootを開いている場合まで「必ず今の一覧に出る」とは保証しない。Claude/Codexで主要checkoutとは別のproject一覧を意図する場合は未対応として明示する。

Host本体とClaude改名の子プロセスへ渡す環境から、継承した`GIT_*`を除外する。他の環境変数（認証、PATH等）は保持する。Gitの対象判定だけでなくHost内のGit操作も継承設定に誤誘導されないようにする。
