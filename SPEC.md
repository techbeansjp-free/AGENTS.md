# SPEC: bash_direct ディスパッチが提示する起動コマンドを常に実行可能にする

- Issue: `ISSUE-721`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/721-dispatch-command-shell-quoting`

## 目的・背景

`worker-launch.sh` は、解決済み adapter が `codex` かつ `worker.agent_tool_dispatch.enabled: true` の場合、ワーカープロセスを自分では起動せず、終了コード `4` と `dispatch_mode: bash_direct` を返して「進行役が自分で Bash ツールから実行すべき起動コマンド」を標準出力へ提示する。提示は `prompt:` 行（散文の指示文の途中にコマンド文字列を埋め込んだもの）と `CODEX_CMD=` 行（同一コマンドを単独で保持するもの）の2箇所で行われる。role contract 本文は、閾値（既定 32768 バイト）以下なら標準入力経由、超過時はコマンドの位置引数へ埋め込まれる。

2026-08-17 に ISSUE-692 の implementation セグメント再投入で、提示された文字列を進行役がそのまま実行できない事象が発生した。`prompt:` 行はコマンドの終端を示す機械可読な区切りを持たず、コマンドの後ろに `<issue_id>`・`<push済みHEAD>`・`''` などシェルのメタ文字を含む散文が続く。このため進行役が `prompt:` 行から取り出した文字列は `bash -n` を通らず（`<` 周辺の構文エラー）、起動が失敗する。contract 本文には Issue/PR コメント（自動レビューコメント本文、差し戻し指示、レビュア evidence 原文）が取り込まれるため本文長・含有文字は制御できず、差し戻しラウンドが増えるほど遭遇確率が上がる。

害は2点である。第一に、進行役が提示どおりに実行するとワーカーを起動できない。第二に、現状の回避（一時ディレクトリの `contract.md` を自力で探して起動コマンドを書き換える）は規定されておらず、進行役ごと・セッションごとに挙動が変わり再現性がない。

本 Issue は、提示される起動コマンドを contract 本文の内容によらず常にシェル構文として妥当かつ一意に抽出可能にし、妥当でない場合は安全側（ワーカー未起動・明示失敗）へ倒すことを目的とする。

## 前提・用語

- 進行役: Issue・worktree・lease・PR の調整のみを行う役割。成果物は書かない。
- dispatch: `worker-launch.sh` がワーカープロセスを直接起動せず、起動に必要な固定メタデータを返す状態。
- `bash_direct`: 進行役自身が Bash ツールで起動コマンドを直接実行する dispatch 方式。
- dispatch 一時ディレクトリ: `contract.md`・`contract.sha256`・`renew.pid` を保持する worktree 外の `chmod 700` ディレクトリ。`contract.sha256` は contract の SHA256・行数・`DISPATCH_STARTED_AT`・`DISPATCH_TOKEN`・`STARTED_SHA` を保持する。
- 起動コマンド: 対象 worktree への `cd` から始まり、Codex CLI を model・reasoning effort・sandbox 設定つきで起動する1行の文字列。

前提として、本 Issue は `risk:normal`・`size:quick` であり、対象は GitHub モードの調整状態である。`size:quick` は成果物作成義務の免除であって禁止ではないため、追跡可能性（I1）と仕様⇔検証の追跡（I7）を確保する目的で本 SPEC を作成する。

## 要求 → 要件 → 受入条件

### 要求

進行役が、提示された起動コマンドを推測や自力の書き換えなしにそのまま実行してセグメント作業ワーカーを起動できること。取り込まれる Issue/PR コメントの内容が何であっても起動が壊れないこと。壊れる場合は黙って壊れるのではなく、ワーカーを起動せずに検出・停止すること。

### 要件

- 提示される起動コマンドは、contract 本文に含まれる文字の種類・長さによらず、単体でシェル構文として妥当である。
- 起動コマンドの範囲が機械的に一意に決まる。指示文の散文とコマンドを、抽出規則を推測しなければ分離できない形で混在させない。
- 起動コマンドを実行した結果ワーカーへ渡る contract 本文は、dispatch 一時ディレクトリの `contract.md` と完全に一致する（内容の欠落・切り詰め・再エスケープによる差異がない）。
- 生成側が、提示しようとしている起動コマンドの構文妥当性を機械的に検査する。検査に失敗した場合はワーカーを起動せず、日本語の診断を出力し、writer lease を解放し、dispatch 要求（`4`）でも human deferred（`3`）でもない失敗として終了する。
- 既存の claude adapter 経路（`subagent_type: agent-skill-chain-worker`）、非 dispatch 経路、`worker-launch-verify.sh` の完了判定契約は変更しない。
- 運用手順書の codex 手順の記述が、変更後の実出力と一致する。

### 受入条件（Acceptance Criteria）

#### AC-1: 任意の contract 本文でも起動コマンドが構文として妥当

- Given: 単一引用符・バックスラッシュ・改行・`<`・`$(`・バッククォートを含む本文が role contract へ取り込まれ、adapter が `codex`、`worker.agent_tool_dispatch.enabled: true` である。
- When: `worker-launch.sh <issue_id> <segment>` を実行し、終了コード `4` の出力から起動コマンドを取り出す。
- Then: 取り出した文字列を単体で `bash -n` に掛けて構文エラーが発生しない。contract 本文が標準入力経由・位置引数埋め込みのいずれの場合でも成立する。
- 検証方法見込み: `automated`

#### AC-2: 起動コマンドの範囲が一意に抽出できる

- Given: AC-1 と同じ dispatch 出力が得られている。
- When: 進行役が、運用手順書に規定された唯一の抽出規則で起動コマンドを取り出す。
- Then: 取り出した文字列は実行対象の起動コマンドと完全一致し、指示文の散文（`<issue_id>` 等のメタ文字を含む文言）を一切含まない。
- 検証方法見込み: `automated`

#### AC-3: 起動時に渡る contract が監査値と一致する

- Given: AC-1 と同じ dispatch 出力と、dispatch 一時ディレクトリの `contract.md`・`contract.sha256` がある。
- When: 提示された起動コマンドを実行し、Codex CLI が受け取った本文（標準入力または位置引数）を捕捉する。
- Then: 捕捉した本文の SHA256 が `CONTRACT_SHA256` と一致し、行数が `CONTRACT_LINES` と一致する。
- 検証方法見込み: `automated`

#### AC-4: 妥当性検査失敗時は安全側へ倒す

- Given: 起動コマンドの構文妥当性検査が失敗する状況を強制的に発生させている。
- When: `worker-launch.sh <issue_id> <segment>` を実行する。
- Then: ワーカーを起動せず、日本語の診断メッセージを標準エラーへ出力し、writer lease を解放し、`0`・`3`・`4` のいずれでもない終了コードで終了する。起動コマンドは提示しない。
- 検証方法見込み: `automated`

#### AC-5: 既存経路が回帰しない

- Given: 解決済み adapter が `claude` の dispatch 経路、および `worker.agent_tool_dispatch.enabled: false` の非 dispatch 経路がある。
- When: それぞれで `worker-launch.sh <issue_id> <segment>` を実行する。
- Then: 出力の固定プレフィックス行・終了コード・`worker-launch-verify.sh` による完了判定の契約が本 Issue 以前と同一である。
- 検証方法見込み: `automated`

#### AC-6: 運用手順書が実出力と一致する

- Given: 変更後の codex 経路の dispatch 出力がある。
- When: `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md` の codex 手順の記述と実出力を突き合わせる。
- Then: 起動コマンドの提示位置・抽出規則・失敗時の扱いの記述が実出力と矛盾せず、進行役が推測せずに実行できる。
- 検証方法見込み: `manual`

## 未決事項

なし。

## スコープ外

- `dispatch_mode` の設計そのものの見直し（進行役へコマンド文字列を提示する方式を採るか否か）。
- Agent tool 経由ディスパッチ（`agent_tool_dispatch`）の生存期間結合など、既知の別制約。
- claude adapter 経路のプロンプト整形の再設計。
- Codex CLI 側の引数長上限・標準入力安全閾値（`CODEX_STDIN_SAFE_THRESHOLD_BYTES`）の値そのものの見直し。
- ゲートレビュア起動（`launch_gate_reviewer`）の起動コマンド提示。
