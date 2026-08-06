# PLAN: codex CLI: stdinへ渡すpromptが約64KB付近でUTF-8マルチバイト文字の境界破損を起こし起動失敗する

- Issue: `ISSUE-462`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `claude.sh: _worker_default_cmd 抽出` | `launch_worker` 内の「`WORKER_CMD` 未指定時の既定起動コマンド組み立て」（claude CLI を `--allowed-tools` 付きで起動する既存処理）を `_worker_default_cmd <segment> <contract>` という関数へ切り出す。呼び出しタイミング（role_contract取得後・認証チェック後）は変えない。`contract` 引数は claude 側の既定実装では未使用でよい。既存の `claude launch_worker` 系テスト（WORKER_CMD未指定時の既定起動・WORKER_ALLOWED_TOOLS上書き等）が無改修で通ることを確認する（純粋なリファクタであり出力コマンド文字列は不変） | DESIGN.md「決定1」、AC-2, AC-4 | なし |
| 2 | `codex.sh: _worker_default_cmd 上書き実装` | `claude.sh` の `_worker_default_cmd` を上書きする。role_contract のバイトサイズ（`printf '%s' "$contract" \| wc -c`）が `CODEX_STDIN_SAFE_THRESHOLD_BYTES`（既定 32768、正の整数以外はエラー扱い）を超えるかどうかで、`_codex_worker_model`/`_codex_worker_effort`/`_codex_worker_sandbox_opts` から組み立てた共通コマンド（`base`）の末尾を「stdin経由（`-`）」か「位置引数経由（`-- <%qエスケープ済みcontract>`）」に分岐させる。旧 `codex.sh: launch_worker` が持っていた `ASC_WORKER_MODEL_TIER`/`ASC_WORKER_MODEL` 防御チェックと `codex` コマンド不在時のフォールバックも、この関数内へ移設する（いずれも非0を返し、呼び出し元 `claude.sh` の `_fail_blocked` へ委ねる） | DESIGN.md「決定1〜3」、AC-1, AC-2, AC-3 | #1 |
| 3 | `codex.sh: launch_worker 簡素化` | `launch_worker` 本体を「`CODEX_WORKER_CMD` が明示されている場合のみ `WORKER_CMD` へ複写し、`_codex_worker_lifecycle "$@"` を呼ぶ」薄いラッパーへ縮小する。`WORKER_CMD`（`CODEX_WORKER_CMD` を伴わない裸の上書き）が既に設定されている場合は何もしない（既存の優先順位を変更しない） | DESIGN.md「決定1」、AC-4 | #2 |
| 4 | 自動テスト追加・改修（`test/integration/worker-adapters.test.ts`） | (a) `installCodexStub` を改修し、argv 捕捉に加えて stdin 内容も別ファイルへ捕捉できるようにする。(b) AC-1: `CODEX_STDIN_SAFE_THRESHOLD_BYTES` を小さい値へ上書きし、role_contract（日本語を含む）が閾値を超える状態で位置引数経由（stdinが空・argvにcontract相当の内容が含まれる）になることを確認する。(c) AC-2: 閾値以下では従来どおり stdin 経由（末尾 `-`、argvにcontract本文を含まない）のままであることを確認する（既存の model/effort/sandbox opts 検証テストが無改修で通ることも回帰確認とする）。(d) AC-3: 位置引数経由でも model・reasoning effort・sandbox opts（writable_roots・network_access）が stdin 経由と同一であることを確認する。(e) AC-4: `CODEX_WORKER_CMD`/`WORKER_CMD` 明示時は閾値判定・`_worker_default_cmd` 呼び出し自体を経由しないこと（既存の完全上書きテストが無改修で通ることを含む）を確認する | SPEC.md 要件5、AC-1〜AC-4 | #1, #2, #3 |
| 5 | 手動・実機検証（AC-5, hybrid） | `CODEX_STDIN_SAFE_THRESHOLD_BYTES` を既定値のまま、実際に64KB超の role_contract を要するセグメント（Issue #449 implementation segment 相当の規模）を、`CODEX_WORKER_CMD` 等の追加上書きを一切行わずに通常の `worker-launch.sh` 経路で起動し、「Failed to read prompt from stdin: input is not valid UTF-8」エラーが発生せず worker が起動することを進行役が確認する。実機での位置引数経由起動が DESIGN.md 決定3の想定どおり動作しない場合はここで判明し、design-gate の再通過を要する | DESIGN.md「障害・ロールバック考慮」失敗モード3、AC-5 | #1, #2, #3, #4 |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
