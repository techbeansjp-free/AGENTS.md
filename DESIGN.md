# DESIGN: 進行役がClaude Codeの場合、worker-launch.shが起動するsegment workerをこのセッションのサブエージェントツリー上で可視化する

- Issue: `ISSUE-448`
- 対応する SPEC: `SPEC.md`

## 技術検証の結論（未決事項1・2への回答）

design segmentでの検証結果を先に要約する。以降の設計要素はこの結論を前提とする。

**検証事実**: 進行役（Claude Code CLIセッション）のBashツール呼び出しは環境変数 `CLAUDECODE=1` を継承する（本design segment作業中に `env | grep CLAUDECODE` で実測確認済み）。この値は `worker-launch.sh` を実行するシェルプロセス自身の環境に存在するため、追加の外部プロセス起動や推測なしに参照できる。ただし本変数はClaude Code CLIが内部的に設定するものであり将来のバージョンで変更され得るため、要件7が要求する「判定不能時は安全側フォールバック」を必ず実装する（後述 §セッション判定）。

**未決事項1（AC-1とI5の両立）への回答**: 両立可能と判断する。ただし design-gate round1 で指摘された通り、当初案（Agent toolの`prompt`引数へcontract本文をそのまま埋め込む）は論拠不十分であり、輸送方式を修正した。

現行のheadless subprocess方式がI5と両立する構造上の理由は、著述主体・commit主体が変わらないことに加えて、より根本的には**role_contract本文の内容が進行役を駆動するLLM自身の生成コンテキストに一切入らない**ことにある。`launch_worker()`は`contract="$(_asc_cli segment start ...)"`でcontractを取得し`printf '%s' "$contract" >"$prompt_file"`で一時ファイルへ書き出したうえで`bash -c "$worker_cmd" <"$prompt_file"`とファイルリダイレクトで渡しており、これらは1回のBashツール呼び出し内でシェルプロセス自身が行う。進行役LLMが実際に発行するBashツールコマンド文字列にcontractの内容は一切現れず、進行役はcontractの中身を「読んで」いない。

当初案（`_dispatch_via_agent_tool()`が"contract本文"を標準出力へ書き、進行役がそれをAgent toolの`prompt`引数として再度送出する）はこの不変条件を破る。Bashツールの標準出力は進行役LLMの生成コンテキストへ読み込まれ、それを次のツールコール引数として再送出する行為は、たとえ「加工しない」指示であっても、進行役の生成過程にcontract全文を通過させることに変わりなく、shellが中継しLLMは中身を見ないという現行方式の中継とは構造的に異なる。

**修正した設計**: `_dispatch_via_agent_tool()`はcontract本文を標準出力へ一切書かない。代わりに、既存の`prompt_file`パターン（`launch_worker()`と同型）でシステム一時ディレクトリ（`mktemp -d`、worktree外・Git非追跡、`_run_reviewer_sanitized`と同型のパーミッション`chmod 700`）へcontractをファイルとして書き出し、進行役へは (1) 固定・短文のdispatch指示テンプレート（contractの内容に一切依存しない定型文）と (2) そのファイルパスのみを標準出力へ返す。進行役はAgent toolを`subagent_type: "agent-skill-chain-worker"`、`prompt`にこの定型文＋ファイルパスのみを渡して呼び出す。定型文は「指定ファイルをReadツールで全文読み込み、その内容全文を一切要約・改変せず自分の動作契約として厳密に実行せよ」という指示であり、実際のcontract本文はサブエージェント自身が自分のRead tool呼び出しでファイルから直接読み込む——進行役の生成コンテキストにcontract本文は一度も現れない。これはstdinファイルリダイレクトが果たしていた「シェルが中継しLLMは中身を見ない」という性質を、Agent tool呼び出しという新しい輸送経路上でも再現する設計である。

**AC-4のRead tool行数制限対策（design-gate round2指摘1への対応）**: Claude CodeのReadツールは既定で先頭2000行までしか読み込まない。`contract.md`がこれを超える行数を持つ場合、定型文が単に「Readツールで全文読み込め」とだけ指示すると、サブエージェントが黙って先頭2000行のみを読み込み後続部分が欠落しうる——これはAC-4（role_contract全文が加工・要約・追記なく伝わること）を静かに破る。このため定型文には以下の手順を明記する: (1) まず`contract.md`に対しBashツールで`wc -l`相当の行数確認を行う、(2) 2000行以下ならReadツールを引数無しで1回呼び出し全文を取得する、(3) 2000行を超える場合はReadツールの`offset`/`limit`を用いて先頭から末尾まで欠落なく分割読み込みを繰り返し、取得した内容を結合して全文として扱う、(4) 行数確認自体が失敗する等、安全に全文読み込みを完了できないと判断した場合は、要約や部分実行で代替せず`worker-launch-verify.sh`実行前に`report_status ... blocked`相当の報告を行う。この手順は定型文自体に含まれる固定文言であり、contractの内容には依存しないためAGENTS.md I5には抵触しない。

この修正により、進行役が生成する内容（Agent tool呼び出しの`prompt`引数）はcontractの内容に一切依存しない固定運用メタデータ（既存の起動コマンド文字列`bash -c "$worker_cmd" <"$prompt_file"`と同格の「調整状態操作」）のみとなり、AGENTS.md I5が禁じる「成果物の著述・内容の取り込み」——内容を理解・加工・判断し、それを踏まえて何かを行うこと——には該当しない。進行役はcontractの中身を一度も認識せず、ファイルパスという不透明なポインタを右から左へ渡すに過ぎない。

副次的な利点として、この設計はAC-4（role_contract全文が加工・要約・追記なく伝わること）についても当初案より頑健である。当初案では進行役LLMが長大なcontract本文をツールコール引数として再生成する必要があり、生成過程での省略・言い換えのリスクを理論上排除できなかったが、修正案ではサブエージェント自身がファイルをバイト単位で読み込むため、そのリスクが構造的に存在しない。詳細は下記 §コンポーネント構成 の`_dispatch_via_agent_tool()`と ADR（本Issue）参照。

**未決事項2（I3耐久性との関係）への回答**: 新方式はheadless subprocess方式が持つ「進行役プロセスからの完全独立」を持たない、という制約を受け入れたうえで運用する。ただし (a) Agent tool呼び出しは`run_in_background: false`（フォアグラウンド）で行うことを進行役への手順として必須化し、現行の`wait "$worker_pid"`と同じ「進行役のターンが終わるまでworkerも終わらない」というブロッキング的性質を保つ、(b) 進行役セッションがworker完了前に異常終了した場合の回復手段は、新方式固有の仕組みを追加するのではなく、既存のwriter lease TTL失効・ADR-0024（credentialなしreclaim）・`issue-resume.sh`という既存の耐久性の安全網にそのまま委ねる。これは新しい失敗経路の発生頻度は変える（進行役プロセスに紐づく分、発生し得る場面が増える）が、失敗からの回復手段の**種類**は増やさない。この受容はopt-in既定無効（要件8）という安全側の判断を裏付ける追加の理由でもある。詳細はADR参照。

**待機中のlease renewal（design-gate round1指摘2への対応）**: 現行方式では、サブプロセスの生存中`renewal_interval_seconds`（既定900秒）ごとに`renew_lease`を呼ぶ処理は、`launch_worker()`内で`wait "$worker_pid"`と並行するバックグラウンドサブシェル（同一Bashツール呼び出し内で起動・`kill "$renew_pid"`で同一呼び出し内で終了）として実装されている。新方式では`_dispatch_via_agent_tool()`自身がexit code 4で即座に復帰し、Agent tool呼び出し（進行役のターンをまたぐブロッキング待機）は別のBashツール呼び出しの外側で起きるため、同一Bashツール呼び出し内で完結するサブシェルでは待機中の期間をカバーできない。したがって`_dispatch_via_agent_tool()`は、既存のrenewサブシェルと同じrenewループ本体を、`setsid`で新しいセッションへ切り離し`disown`した**独立デーモンプロセス**として起動する（`_dispatch_lease_renew_daemon()`、`claude.sh`新設）。デーモンは (1) 起動元のBashツール呼び出しの終了後も生存し続け、`renewal_interval_seconds`ごとに`renew_lease`を呼び続ける、(2) 自身のPIDをcontractファイルと同じ一時ディレクトリ内の`renew.pid`へ書き出す、(3) 新規env `ASC_DISPATCH_MAX_WAIT_SEC`（既定7200秒、既存`WORKER_TIMEOUT_SEC`の既定1800秒よりも長い——Agent tool呼び出しは人間が観察する進行役のフォアグラウンドターンであり、非対話subprocessより長時間になり得るため）を超えて生存した場合は自ら終了しrenewを止める（無期限延命を防ぎ、進行役セッションが異常終了しverifyが実行されない場合にlease TTL失効による既存の安全網（ADR-0024）が最終的に機能することを保証する）。`worker-launch-verify.sh`は完了確認・lease解放の前段で、この一時ディレクトリの`renew.pid`を読み取れれば対応プロセスへ`kill`を送ってからcontractファイルごと一時ディレクトリを削除する（PIDファイルが無い場合はデーモンが未起動または既に自己終了しているとみなしスキップする、AC-3のblocked規律には影響しない）。

**PID再利用への対策（design-gate round4指摘、renew-pid-reuse-raceへの対応）**: `renew.pid`に記録したPIDは、デーモンが`ASC_DISPATCH_MAX_WAIT_SEC`超過等で自己終了した後、OSにより無関係な別プロセスへ再割当てされ得る。`worker-launch-verify.sh`が`renew.pid`読み取り後に無条件で`kill`を送ると、再利用されたPIDを持つ無関係なプロセスを誤って終了させるリスクがある。これを避けるため、`_dispatch_lease_renew_daemon()`は自身のコマンドライン引数に一時ディレクトリの絶対パス（`mktemp -d`が生成した固有パスであり、他プロセスと衝突しない識別子として機能する）をそのまま含めて起動する（例: `setsid bash -c '... "$dispatch_temp_dir" ...' & disown`のように、当該パスをそのプロセスの引数列自体に残す）。`worker-launch-verify.sh`は`renew.pid`のPIDへ`kill`を送る前に`ps -p <pid> -o args=`（プロセスが存在しなければ`ps`自体が失敗し「不在」と判定できる）で取得したコマンドライン文字列に当該一時ディレクトリの絶対パスが含まれることを確認し、含まれない場合はPID再利用とみなし`kill`を送らずスキップする（PIDファイルが無い場合と同じ扱い、AC-3のblocked規律には影響しない）。詳細は下記 §コンポーネント構成 参照。

**新規に判明したリスク（ツール許可範囲の粗さ）**: `--allowed-tools`によるBashコマンド単位の許可制御（`WORKER_ALLOWED_TOOLS_DEFAULT`）は、Claude CodeのAgent tool・カスタムsubagent種別の`tools:`定義がツール単位（Read/Edit/Bash等）でしか制御できないため、同じ粒度で再現できない。この差分は下記 §カスタムsubagent種別 で扱い、ADRのConsequencesに明記する。

**新規に判明したリスク（worker-identity-attestation-gap、design-gate round3指摘への対応）**: AGENTS.md「役割・権限・writer lease」節が列挙する`protected-base隔離launcher・one-time attempt token・固有run ID/slot・launcher digest`等のactor分離メカニズムは、Agent tool dispatch方式では進行役セッションと同一credential・同一プロセス内でworker subagentが動くため失われるのではないか、という懸念がある。`.agent-skill-chain/adapters/claude.sh`を確認した結果、これらの分離メカニズムは**read-onlyレビュア（`launch_gate_reviewer`が呼ぶ`_run_reviewer_sanitized()`、`claude.sh:84`「AI reviewerへはmodel providerのローカルlogin保存先だけを渡し、GitHub credential・gh/git設定・caller HOMEを渡さない」）専用**であり、writer役割（`launch_worker()`が起動するsegment worker）には現行のheadless subprocess方式でも同種の分離が実装されていない。`launch_worker()`は`WORKER_ALLOWED_TOOLS_DEFAULT`に`Bash(git push:*)`等のpush権限を含めて渡しており、workerが呼び出し元環境のgh/git credentialをそのまま継承する設計である——writerはpush等の書込み権限を必要とするため、read-onlyレビュアと異なりcredential隔離が構造的に成立しない。したがって、AGENTS.md「役割・権限・writer lease」節のactor分離メカニズムは**GitHub actorがwriterとrecorderで同一の場合に両者を別roleとみなすための手段**であり、writer（segment worker）と進行役の間のactor分離を保証するものではない。Agent tool dispatch方式は、read-onlyレビュアのcredential隔離（`_run_reviewer_sanitized()`）には一切変更を加えないため、この論点においては新方式固有の後退（regression）を生まない——既存モデルが元々持っていなかった分離を、新方式でも引き続き持たないというだけである。

**進行役セッションでの直接実地検証（design-gate round4指摘への対応）**: 上記の未決事項1・2の回答および各リスク論点は、いずれもClaude Code CLIの実行環境が持つ技術的特性を前提とする。design-gate round4の指摘を受け、進行役自身がこのセッション（Claude Code CLI、`CLAUDECODE=1`）で以下3点を直接実地検証した（design segment作業中の間接的な推測ではなく、実際に実行したコマンドと出力を伴う実測）。

1. **`setsid`+`disown`デーモンのBashツール呼び出し境界を越えた生存**: `setsid bash -c "sleep 5; echo alive >> marker" < /dev/null > /dev/null 2>&1 & disown` を1回のBashツール呼び出しで実行してその呼び出しを終了させた後、**別の（後続の）Bashツール呼び出し**で5秒後に`marker`ファイルが実際に作成されていることを確認した。`_dispatch_lease_renew_daemon()`が前提とする「起動元のBashツール呼び出しが終了した後もデーモンプロセスが生存し続ける」という性質は実機で成立する。
2. **worktree外一時ディレクトリのAgent tool経由サブエージェントからの読み取り可能性**: worktree外（`/tmp`直下）に`chmod 700`で作成したディレクトリへcontractファイルを配置し、Agent tool経由でgeneral-purpose subagentを起動して当該ファイルを`cat`させたところ、正しく内容（"test-contract-content-12345"）を読み取れることを確認した。`_dispatch_via_agent_tool()`が前提とする「`mktemp -d`一時ディレクトリ→サブエージェントがRead/Bashで直接読む」という輸送経路は実機で成立する。
3. **credential継承**: 同一のAgent tool呼び出し内で`gh auth status`・`git config user.name`・`git remote -v`をsubagentに実行させ、進行役自身と同一のgh認証（account: adachi-tatsuru、repo権限を含むtoken scopes）・同一のgit設定・同一のorigin remoteをsubagentが継承していることを確認した。これは上記「worker-identity-attestation-gap」の「writerは呼び出し元環境のcredentialをそのまま継承する」という判断の実機裏付けであり、Agent tool dispatch方式固有の新しい後退ではないことを補強する。

以上3点はいずれも進行役セッションでの直接実地検証（実行コマンドと出力を伴う）であり、design segment作業中の間接的な推測ではない。同一の検証結果はADR-0030 Decisionにも記録する。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1・AC-1 | セッション判定関数、`claude.sh` dispatch分岐、dispatch payload、カスタムsubagent種別 | 3条件すべて成立時のみdispatchへ分岐 |
| 要件2・AC-2 | `claude.sh` dispatch分岐のelse節（既存`launch_worker`本体、無変更） | 非対象ケースは既存コードパスを一切変更しない |
| 要件3・AC-3 | `worker-launch-verify.sh`（新規） | lease取得前失敗はdispatch分岐前の共通処理、起動後失敗はverifyスクリプトが同一の規律で処理 |
| 要件4・AC-4 | contractファイル（一時ディレクトリ`contract.md`）とdispatch payload（定型文＋ファイルパス）の分離 | contract本文は標準出力にもAgent toolのprompt引数にも一切現れず、workerが自らRead toolでファイルから直接読み込む（進行役による加工不可能） |
| 要件5・AC-5 | commit経路無変更の確認（`checkpoint.sh`・writer lease credential） | dispatch分岐でもcommit主体・経路は変わらない |
| 要件6・AC-6 | dispatch分岐専用のテスト境界（`ASC_AGENT_TOOL_DISPATCH`・`ASC_ORCHESTRATOR_SESSION_OVERRIDE`） | 既存`WORKER_CMD`境界は既定off時そのまま機能 |
| 要件7・AC-7 | `_orchestrator_is_claude_code_cli_session()`（`claude.sh`） | 判定不能・不定値はすべてfalse＝フォールバック |
| 要件8・AC-8 | `worker.agent_tool_dispatch.enabled`（config schema新規項目）、`worker-selection.ts`拡張 | 既定false、3条件の一つとして評価 |

## 責務・境界

### コンポーネント構成

- `config.schema.yaml` / `agent-skill-chain.yaml`: `worker.agent_tool_dispatch: {enabled: boolean}`（既定false）を新規追加する後方互換な任意項目。既存の`issue_sync`・`merge`・`human_confirmation`と同型。
- `src/lib/worker-selection.ts`: `WorkerSelection`に`agentToolDispatch: boolean`を追加。`resolveWorkerSelection`が`config.worker.agent_tool_dispatch?.enabled ?? false`を解決する（純粋関数、既存方針を継承）。
- `src/commands/worker.ts`（`context`サブコマンド）: 常に`agent_tool_dispatch=<true|false>`行を出力する（`adapter`と同じく常時出力。segment別上書きは持たない単一のグローバル設定のため）。
- `.agent-skill-chain/scripts/worker-launch.sh`: `WORKER_CONTEXT`から`agent_tool_dispatch=`行を読み取り、`ASC_AGENT_TOOL_DISPATCH`環境変数として常にexportする。それ以外の既存ロジック（worktree自己解決含むADR-0029の仕組み）は無変更。
- `.agent-skill-chain/adapters/claude.sh`:
  - 新規関数 `_orchestrator_is_claude_code_cli_session()`: `ASC_ORCHESTRATOR_SESSION_OVERRIDE`（テスト用モック境界、`CLAUDE_AUTH_PROBE_CMD`と同型）が設定されていればその値で判定し、無指定時は`${CLAUDECODE:-}` が厳密に `"1"` の場合のみ真を返す。それ以外（未設定・空・`"1"`以外の値）はすべて偽＝要件7のフォールバック対象とする。
  - `launch_worker()` 冒頭に分岐を追加: `ASC_AGENT_TOOL_DISPATCH == true` かつ `_orchestrator_is_claude_code_cli_session` が真の場合のみ新関数 `_dispatch_via_agent_tool()` を呼ぶ。それ以外は既存の`launch_worker()`本体（lease取得〜subprocess起動〜完了確認〜解放）を一切変更せず実行する（AC-2/AC-7/AC-8）。
  - `_dispatch_via_agent_tool()`（新規）: (1) `acquire_lease`（失敗時は現行と同じくblocked報告なしでreturn 1）、(2) `_asc_cli segment start`（失敗時はlease解放のみでreturn 1）、(3) `mktemp -d`でworktree外・Git非追跡の一時ディレクトリ（`chmod 700`）を作り、contract本文をその中の`contract.md`へ書き出す（**標準出力へcontract本文は一切書かない**）、(4) `_dispatch_lease_renew_daemon()`を`setsid ... & disown`で切り離して起動し、そのPIDを同ディレクトリの`renew.pid`へ書き出す、(5) 標準出力へ、contractの内容に一切依存しない固定・短文のdispatch指示テンプレート（`subagent_type: "agent-skill-chain-worker"`・`prompt`に含めるべき定型文言・`contract.md`の絶対パス・完了後に`worker-launch-verify.sh`を実行する旨）に加えて、**`(3)`で作った一時ディレクトリの絶対パスを独立した行（固定プレフィックス例: `DISPATCH_TEMP_DIR=<path>`）として明示的に出力し**、(6) exit code `4`（新規、"dispatch_required"）でreturn する。**workerサブプロセスは起動しない。leaseは解放しない**（現行のhuman adapter `deferred`と同様、非同期継続中を意味する）。lease renewal専用のデーモンプロセスは(4)の通り例外的に起動する。標準出力仕様（design-gate round2指摘2への対応）: 進行役はAgent tool呼び出し完了後、この`DISPATCH_TEMP_DIR=<path>`行から一時ディレクトリの絶対パスを読み取り、`worker-launch-verify.sh <一時ディレクトリの絶対パス>`という形で第1位置引数として渡す。この受け渡しは進行役がBashツール標準出力の中から固定プレフィックス行を機械的に転記するだけの調整状態操作であり、contractの内容には一切依存しないためI5に抵触しない。
  - `_dispatch_lease_renew_daemon()`（新規）: `_dispatch_via_agent_tool()`が`setsid`で起動する独立プロセス。`renewal_interval_seconds`（既定900秒）ごとに`renew_lease`を呼び続け、起動から`ASC_DISPATCH_MAX_WAIT_SEC`（既定7200秒）を超えたら自ら終了する。起動元のBashツール呼び出しが終了した後も生存し続ける点が、`launch_worker()`内の既存renewサブシェル（同一呼び出し内で起動・終了）との違い。PID再利用対策として、自身の起動コマンドライン引数に一時ディレクトリの絶対パスをそのまま含める（`ps -p <pid> -o args=`で`worker-launch-verify.sh`から照合可能にするため）。
- `.agent-skill-chain/scripts/worker-launch-verify.sh`（新規）: `worker-launch.sh`と同じworktree自己解決ロジック（ADR-0029のself-resolution、絶対パス直接呼び出しでmain扱いになる既知の罠を回避）を再利用する。**引数仕様**: 第1位置引数（必須）として`_dispatch_via_agent_tool()`が標準出力へ出した`DISPATCH_TEMP_DIR=<path>`の一時ディレクトリ絶対パスを受け取る。未指定・存在しないパスの場合は`_dispatch_via_agent_tool()`が呼ばれていない誤用とみなし、lease操作を一切行わずexit 1で即座に失敗する（AC-3のblocked規律とは別扱い——そもそもdispatchが成立していないケース）。引数が有効な場合、まず当該一時ディレクトリの`renew.pid`を読み取れれば、`ps -p <pid> -o args=`で取得したコマンドライン文字列に当該一時ディレクトリの絶対パスが含まれることを確認したうえで対応プロセスを`kill`してからディレクトリごと削除する（PIDファイルが無い場合、または`ps`結果が一時ディレクトリの絶対パスを含まない＝PID再利用とみなせる場合は、いずれもkillせずスキップする——後者が新規、design-gate round4指摘renew-pid-reuse-raceへの対応）。続けて`_asc_cli report latest`とHEADのSHA照合を行い、一致すれば`release_lease`してexit 0、不一致・未報告ならば`role="${segment}_worker"`で`report_status ... blocked`してから`release_lease`しexit 2（現行`_fail_blocked`と同一の規律、AC-3）で返す。
- カスタムsubagent種別 `.agent-skill-chain/templates/claude/agents/agent-skill-chain-worker.md`（新規配布資産）: `tools:` フロントマターに `Read, Grep, Glob, Edit, Write, MultiEdit, Bash` を許可し、`Agent`（無制限な再帰dispatch防止）・`ExitPlanMode`・`NotebookEdit`・`WebFetch`・`WebSearch`・`Artifact` を明示的に含めない。`init`/`upgrade`が`.claude/agents/agent-skill-chain-worker.md`へ同期する（既存`templates.github_source/github_target`と同型の新規config項目 `templates.claude_agents_source`/`templates.claude_agents_target`を追加し、`verify-template-sync.sh`の検査対象へ加える）。Bashコマンド単位の許可制御（`WORKER_ALLOWED_TOOLS_DEFAULT`と同等の粒度）はClaude Codeのsubagent種別定義では実現できないため完全な同等物ではない（後述の障害・ロールバック考慮を参照）。
- dispatch手順の文書化: `_dispatch_via_agent_tool()`が出力するorchestrator向け指示（Agent toolを`subagent_type: "agent-skill-chain-worker"`・`prompt`に定型文＋contractファイルの絶対パス（contract本文そのものではない）・`run_in_background: false`で呼び出し、完了後に標準出力の`DISPATCH_TEMP_DIR=<path>`行から一時ディレクトリの絶対パスを読み取り、`worker-launch-verify.sh <その絶対パス>`を第1位置引数付きで実行する手順）に加えて、`.agent-skill-chain/standards/`配下に手順の正本を1箇所置き、dispatch payloadはその正本への言及ではなく要旨を都度出力する（成果物の自己完結性原則を各ワーカーではなく進行役向け運用手順に適用したもの。禁止されている「詳細はXを参照」ではなく、都度必要な要旨をpayload自体に含める）。

### 依存関係

```text
agent-skill-chain.yaml(worker.agent_tool_dispatch)
  → worker-selection.ts(resolveWorkerSelection)
  → worker.ts(context)
  → worker-launch.sh(ASC_AGENT_TOOL_DISPATCH export)
  → claude.sh(_orchestrator_is_claude_code_cli_session, launch_worker分岐)
  → _dispatch_via_agent_tool()
      → contract.md（一時ディレクトリ、mktemp -d）
      → _dispatch_lease_renew_daemon()（setsid切り離し、renew.pidを同ディレクトリへ）
  → 進行役(Agent tool呼び出し, subagent_type=agent-skill-chain-worker, promptは定型文+contract.mdパスのみ / 標準出力のDISPATCH_TEMP_DIR=<path>行を保持)
  → agent-skill-chain-workerサブエージェント(contract.mdをRead tool経由で読み込み、2000行超はoffset/limitで分割読み込み)
  → worker-launch-verify.sh <DISPATCH_TEMP_DIRの絶対パス>(第1位置引数、renew.pidをkillし一時ディレクトリ削除 → report照合 → release_lease)
  → report-status.sh / lease-release.sh
```

循環依存なし。`worker-launch-verify.sh`は`worker-launch.sh`のworktree自己解決ロジックを再利用する（新規重複実装を避ける）。`_dispatch_lease_renew_daemon()`は`_dispatch_via_agent_tool()`が起動するが、以後は独立プロセスとして生存し双方向の依存を持たない（`worker-launch-verify.sh`がPIDファイル経由で一方向にkillするのみ）。

### 状態遷移

```mermaid
stateDiagram-v2
    [*] --> LeaseAcquiring
    LeaseAcquiring --> Return1_NoLease: lease取得失敗
    Return1_NoLease --> [*]
    LeaseAcquiring --> ContractFetching: lease取得成功
    ContractFetching --> Return1_ContractFailed: segment start失敗
    Return1_ContractFailed --> [*]: lease解放
    ContractFetching --> ModeBranch: role_contract取得成功
    ModeBranch --> SubprocessRunning: 非対象（AC-2/AC-7/AC-8、既存無変更）
    ModeBranch --> DispatchPending: 対象（opt-in有効 かつ claude_code_cli判定 かつ adapter=claude、AC-1）
    SubprocessRunning --> Completed: report completed かつ target_sha一致
    SubprocessRunning --> Blocked: 起動失敗/timeout/完了未確認
    DispatchPending --> AgentToolRunning: 進行役がAgent tool呼び出し（worker-launch.shはexit4で復帰）
    AgentToolRunning --> VerifyRunning: 進行役がworker-launch-verify.shを実行
    VerifyRunning --> Completed: report completed かつ target_sha一致
    VerifyRunning --> Blocked: 未報告/target_sha不一致
    Completed --> [*]: lease解放
    Blocked --> [*]: lease解放 + report blocked
```

`_dispatch_lease_renew_daemon()`は`DispatchPending`遷移時に起動し、`VerifyRunning`開始時（`worker-launch-verify.sh`冒頭）にkillされるまで、上記状態遷移と並行して独立に生存し続ける（`ASC_DISPATCH_MAX_WAIT_SEC`超過時は自己終了）。この並行プロセスの生死は、`worker-launch.sh`自身が返す終了コード（dispatch経路では`1`または`4`のみ）にも、`worker-launch-verify.sh`という別スクリプト呼び出しが返す終了コード（`0`/`1`/`2`）にも影響しない。終了コードの全体像は次の対応表を参照。

### 終了コード対応表（design-gate round4指摘、exit-code-doc-inconsistencyへの対応）

新方式が関わる終了コードは`worker-launch.sh`と新設`worker-launch-verify.sh`という2つの独立したスクリプト呼び出しに分散する。両者は別々のBashツール呼び出しで実行されるため混同しないよう対応関係を明記する。

| スクリプト | コード | 意味 | 新規/既存 |
|---|---|---|---|
| `worker-launch.sh`（`claude.sh`アダプタ経由） | `0` | worker完了（非dispatch経路のみ。dispatch経路では`worker-launch.sh`自体はこの値を返さない） | 既存 |
| 同上 | `1` | lease取得失敗、または`segment start`（role_contract取得）失敗（dispatch/非dispatch経路共通。状態遷移図の`Return1_NoLease`/`Return1_ContractFailed`に対応） | 既存 |
| 同上 | `2` | 起動後のBlocked（非dispatch経路のみ、既存`_fail_blocked`） | 既存 |
| 同上 | `3` | deferred（`human`アダプタ専用。本Issueの変更対象外であり、claude.sh dispatch経路では使用しない） | 既存（本Issue無関係） |
| 同上 | `4` | dispatch_required（dispatch経路のみ。leaseを解放せず復帰し、進行役がAgent tool呼び出し後に`worker-launch-verify.sh`を実行する） | 新規（本Issue） |
| `worker-launch-verify.sh`（新設。`worker-launch.sh`とは別のBashツール呼び出しで実行） | `0` | Completed（report照合一致、lease解放済み） | 新規（本Issue） |
| 同上 | `1` | 引数不正（dispatchが成立していない誤用。lease操作を一切行わない） | 新規（本Issue） |
| 同上 | `2` | Blocked（report未照合/不一致、既存`_fail_blocked`と同一規律） | 新規（本Issue） |

dispatch経路における状態遷移図の`Completed`/`Blocked`終端は`worker-launch-verify.sh`の終了コード（`0`/`2`）であり、`worker-launch.sh`自体の終了コードではない。`worker-launch.sh`冒頭コメントの終了コード一覧（PLAN.md #10）は、既存の`0`（非dispatch完了）・`3`（human専用deferred）・その他＝error（`1`・`2`を包括、dispatch/非dispatch双方で既存と同じ意味のため新たな区別は設けない）はそのまま維持し、新規`4`（dispatch_required）のみを追加する。新設`worker-launch-verify.sh`には別途独自の終了コードコメント（`0`＝Completed・`1`＝引数不正・`2`＝Blocked）を新規記載する。

### 図示要否の判断

- 判断: `要`
- 根拠: 依存関係が3つ以上（config→resolve→CLI→script→adapter→Agent tool→verify script）、状態遷移が2つ以上（DispatchPending/AgentToolRunning/VerifyRunningという新規分岐を含む）、責務境界（コンポーネント）も3つ以上該当する。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0015
    relation: references
  - id: ADR-0029
    relation: adopts
```

（本Issueで新規作成するADRは`docs/adr/`にproposedとして追加する。上記は既存accepted ADRへの参照。）

## 障害・ロールバック考慮

- 想定される失敗モード:
  1. `_orchestrator_is_claude_code_cli_session`の誤判定（`CLAUDECODE`が将来別の意味に変わる等）: 要件7により誤って真と判定するリスクはあるが、`ASC_ORCHESTRATOR_SESSION_OVERRIDE`によるテストでの明示検証と、既定off（要件8）により実害の露出範囲は限定される。
  2. dispatch後、進行役がAgent tool呼び出しを行わずに放置する（人間の操作ミス・進行役の判断ミス）: `_dispatch_lease_renew_daemon()`が最大`ASC_DISPATCH_MAX_WAIT_SEC`（既定7200秒）まではleaseを延命し続けるため、TTL失効による検知は既存の単純な放置（TTL既定3600秒で失効）より遅れうる。ただしデーモン自身が上限で自己終了するため無期限の延命にはならず、その後は既存のTTL失効（既定3600秒）と`ADR-0024`のcredentialなしreclaim、`issue-resume.sh`による再開が最終的に安全網として機能する。回復の**手段**は既存のもの1種類のままであり、新方式固有の追加復旧コードは持たない（発生しうる検知までの時間が延びるだけ）。
  3. Agent tool呼び出し中に進行役セッションが異常終了する: 未決事項2の回答のとおり、既存の耐久性安全網（lease TTL・reclaim・resume）に委ねる。`run_in_background: false`を必須化することで、少なくとも「進行役のターンが正常終了した時点でworkerも完了している」という現行同等の性質は保つ。この場合も`_dispatch_lease_renew_daemon()`は進行役プロセスから独立しているため（`setsid`切り離し）、進行役セッションの異常終了によって道連れで終了することはなく、失敗モード2と同じ上限付き延命→TTL失効という経路をたどる。
  4. カスタムsubagent種別のツール許可がBashコマンド単位で絞れない: 機械的な多重防御が1層減るリスクを受容し、既定off（opt-in）で露出を限定する。将来的な緩和（例: Bashコマンド単位のフックによる補完）は本Issueのスコープ外とし、必要なら別Issueで扱う。
  5. `_dispatch_lease_renew_daemon()`自体が異常終了・シグナル未達等でleaseを更新できなくなる、またはPIDファイルが読み取れず`worker-launch-verify.sh`がkillできない: いずれの場合も既存のTTL失効・reclaim・resumeの安全網でカバーされる範囲であり（デーモンが止まればより早くTTLが失効するだけ）、新たな未回復状態を生まない。一時ディレクトリ・contract本文がGit非追跡かつworktree外（`mktemp -d`、`chmod 700`）に留まるため、削除漏れが起きても成果物やcredentialの漏えいには繋がらない。
- ロールバック手順: `worker.agent_tool_dispatch.enabled`を`false`に戻す（または未設定のままにする）ことで即座に既存のheadless subprocess方式へ全面的に戻る。新規追加したスクリプト・関数はopt-in条件が成立しない限り呼ばれないため、コードの削除を伴わないロールバックが可能。
- 影響を受ける既存機能: `worker-launch.sh`・`claude.sh`の`launch_worker()`は分岐追加のみで既存コードパス自体は無変更（AC-2）。`codex.sh`・`human.sh`は`ASC_AGENT_TOOL_DISPATCH`を一切参照しないため無影響。
