# 別セッションの命名と結果保存

独立レビュー・設計相談を現在のHostの別セッションで実行するときは、開始名を `自動: <Issue・内容>`、正常終了後を `済: 自動: <Issue・内容>` とする。`済`は呼出しが完了した印であり、レビュー合格を意味しない。失敗・時間切れ・中断を済へ改名しない。Host内のサブエージェント機能で表示名を設定できない場合は、依頼名にこの接頭辞を使い、親の結果に実行ID・終了状態を残す。一覧の表示名が変更できたとは報告しない。

## 一括実行

配布パッケージのNode CLIで起動・結果保存・完了時改名を一度に行う。実行するHostを明示し、別Hostへ自動切替えしない。新規Contextを作り、既存セッションの履歴を独立レビューへ継承しない。モデルは[モデル選択](../../subagent-model-selection/SKILL.md)と利用者の許可範囲で明示する。

```sh
node /absolute/package/bin/asc-v05.mjs host-session claude /absolute/worktree \
  --name '1644 独立レビュー' --model opus --rename-model haiku \
  --prompt-file /absolute/review-request.txt --output-dir /absolute/new-review-result

node /absolute/package/bin/asc-v05.mjs host-session codex /absolute/worktree \
  --name '1644 独立レビュー' --model '<許可されたCodexモデル>' \
  --prompt-file /absolute/review-request.txt --output-dir /absolute/new-review-result
```

依頼ファイルに元要求・対象・契約・レビュー手順を含める。出力先の親directoryは事前に用意し、実行ごとに未作成のdirectoryを指定する。既存directoryは上書きしない。`--executable /absolute/host-binary`で導入済みのHostを選べる。依存の自動導入やHost設定の書換えはしない。

- Claude Code: `-p -n`で命名、事前に生成したUUIDを`--session-id`で指定。同一cwd・IDを`--resume`して`-n '済: …'`で改名する。改名は`--max-turns 1`、ツール無効で短い応答だけを行う。モデルは本体と同じものを使うが、許可された小さいモデルを`--rename-model haiku`等で明示できる。上限や権限拒否を別モデルで回避しない。モデル呼出しが一度増える。実行本体は`--tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config`で限定する。Bashが必要なレビューをこのコマンドだけで完了扱いしない。
- Codex: `codex app-server`の公式JSON-RPCで新規`thread/start`、開始前に`thread/name/set`、`turn/start`、成功した`turn/completed`後に同じIDへ`thread/name/set`を送る。命名だけではモデルを呼ばない。`sandbox: read-only`・`approvalPolicy: never`を指定し、サーバーからの承認要求は許可しない。MCP等の外部連携の権限は別途確認する。ローカルsandboxだけを外部書込み防止の保証にしない。

Hostの版・プロジェクトのhookや外部ツール設定は起動前に確認する。必須制限を満たせない場合は未完了。表示名のためにsandboxや承認を解除しない。セッションのjsonl・index・DBを直接編集しない。Claudeのworktree別の保存場所を探したり、Codexの最新セッションを推測して改名したりせず、この実行のIDだけを使う。

## 記録が不要・命名機能が使えないとき

使い捨ての読取りなら`--ephemeral`を追加する。Claudeの`--no-session-persistence`、Codexの`thread/start`の`ephemeral: true`を使い、保存セッションへの命名・改名を省く。これはHostのセッション記録を残さない選択であり、ASCの結果ファイルは残る。

Codexの`exec`には命名用フラグを仮定しない。App Serverの命名APIがない版では開始時に失敗し、無名のまま処理を続けない。必要なら利用者の許可範囲で明示的に非永続を選ぶ。`codex exec --ephemeral -s read-only`等を直接使う場合も、実行ID・結果・終了状態を親で管理する。非永続機能もないHostでは自動の一覧整理が未対応と明示し、対応済みとは報告しない。

## 結果・失敗・復旧

`status.json`にHost、cwd、ID、指定モデル、時刻、処理状態と命名状態を保存する。`result.txt`が応答、`events.jsonl`がHostの元出力、`stderr.txt`が診断。Claudeの改名出力は別ファイルで保存する。これらは依頼や応答を含むことがあるため、公開前に秘密情報を確認する。

応答は改名より先に保存する。改名だけ失敗しても`status: completed`と結果を保持し、`naming: failed`で報告する。終了コードは本体成功0、本体失敗2、引数・出力先等のエラー1。成功コードだけで改名成功やレビュー合格と判定せず、状態と本文を確認する。命名失敗時にレビューを再実行しない。保存したID・cwdを使って公式手段で改名を再試行できる。

`--timeout-ms`は本体の待機上限（既定15分）。Codexの個別RPCとClaudeの改名は最大60秒。強制停止・プロセス障害で`running`が残ることがあり、未完了として元出力とHostの状態を確認する。親の終了から子孫プロセスの終了を推定せず、[復旧手順](../../execution-recovery/SKILL.md)に従う。

対応手段の参照: [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)、[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Codex CLI](https://learn.chatgpt.com/docs/cli/reference)。対応版と実検証の対象は提出Evidenceに残す。
