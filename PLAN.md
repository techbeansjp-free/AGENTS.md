# PLAN: agent-skill-chain — launch_worker の権限モード不足解消・ローカルバックエンド issue 本文スキーマ拡張

- Issue: `ISSUE-183`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素 A〜F を、実装セグメントが迷わず実行できる粒度（具体ファイル・手順・完了判定）へ分解する。コード変更（`#1`〜`#8`）は本 Issue のスコープ内で完結し、GitHub 側共有インフラ（ruleset/branch protection）の変更は**含まない**（先行 Issue #180 で実施済み）。実機 live 検証（`#9`〜`#11`）は独立検証セグメント（VALIDATION.md）の責務であり、本 PLAN は着手可能な形まで分解する。

| # | 変更単位 | 内容・具体手順 | 完了判定 | 対応 AC-ID | 依存 |
|---|---|---|---|---|---|
| 1 | 既定 WORKER_CMD を allowlist 起動へ変更 | `.agent-skill-chain/adapters/claude.sh` の `launch_worker` で、既定 `worker_cmd` を DESIGN「採用する既定 allowlist」の `--allowed-tools` 起動へ変更する。allowlist は grep 可能な名前付き変数 `WORKER_ALLOWED_TOOLS`（env 上書き可、既定は DESIGN 記載の列挙）として定義し、`claude -p --output-format text --allowed-tools "$WORKER_ALLOWED_TOOLS"` を組み立てる。`bash -c "$worker_cmd"` 経由のため allowlist 値は空白込みで単一引数となるようクォートを保つ。`bypassPermissions`／`acceptEdits` を既定に用いない | 既定分岐が `--allowed-tools` を用い `bypassPermissions`/`acceptEdits` を含まない。`WORKER_ALLOWED_TOOLS` が env 上書き可 | `AC-1`,`AC-2` | なし |
| 2 | state.schema.yaml へ title・request 追加 | `.agent-skill-chain/schemas/state.schema.yaml` の `properties` に `title: {type: string}`・`request: {type: string}` を追加（`required` には加えない＝任意）。`schema_version` は据え置き。`examples` に本フィールドを含む例を任意で1件追記 | 本フィールドを含む state サンプルが `validateAgainstSchema('state', ...)` を通過し、本フィールドを持たない既存 state も引き続き通過する | `AC-3` | なし |
| 3 | issue start の title・request 受理・永続化 | `src/commands/issue.ts` の `start` に任意フラグ `--title <str>`・`--request-file <path>`（および `--request <str>`）の解析を追加。4 positional（`issue_id type slug issue_created_at`）は不変。local backend 分岐で、与えられた title/request を初期 `state` オブジェクトへ含めて `writeYamlFileAtomic` する。`issue-start.sh` は `"$@"` 透過のため無改修 | local backend で `issue start ... --title --request-file` 実行後、`state.yaml` に title/request が永続化される。フラグ無しの従来起票も成功し state に本フィールドが無い | `AC-4` | `#2` |
| 4 | segment start の issue 本文供給 | `src/commands/segment.ts` の `start` で、local backend のとき `state.yaml` を読み、`title`/`request` が存在すれば出力（`role: ...\n<contract>`）へ Issue 本文ブロック（`issue:` に `id`/`title`/`request`）を同梱する。本文が無い state では従来どおり同梱しない。GitHub モードは無変更 | local backend で本文入り state に対し `segment start` の出力に title/request が含まれる。本文なし state では従来出力のまま | `AC-5` | `#2`,`#3` |
| 5 | AC-3 自動テスト追加 | state スキーマに title/request を含む state が検証通過し、含まない state も通過することを検証する自動テスト（`validateAgainstSchema('state', ...)` 相当）を追加 | 追加テストが pass | `AC-3` | `#2` |
| 6 | AC-4 自動テスト追加 | `issue start`（local backend）に title/request を渡すと state.yaml へ永続化されること、フラグ無しの従来起票が引き続き成功し本フィールドを持たないことを検証する自動テストを追加（`test/integration/issue-lifecycle.test.ts` 近傍） | 追加テストが pass | `AC-4` | `#3` |
| 7 | AC-5 自動テスト追加 | `segment start`（local backend）が本文入り state から title/request を出力へ同梱すること、本文なし state で従来出力になることを検証する自動テストを追加 | 追加テストが pass | `AC-5` | `#4` |
| 8 | AC-1/AC-2 コード検査テスト追加 | 既定 WORKER_CMD 分岐が `--allowed-tools` を用い `bypassPermissions` を既定に含まないことを検査する自動テスト（アダプタ文字列のコード検査、または `WORKER_ALLOWED_TOOLS` 既定と組み立てコマンドの検証）を追加 | 追加テストが pass | `AC-1`,`AC-2` | `#1` |
| 9 | 全体回帰確認 | `npm run build && npm test` を実行し、既存テスト（`worker-adapters.test.ts` の認証欠如・起動失敗・完了偽装・target_sha 不一致の各フェイルセーフ含む）と `#5`〜`#8` の追加テストが全 pass することを確認 | `npm test` 全 pass（regression なし） | `AC-10` | `#1`〜`#8` |
| 10 | [live 検証] launch_worker 実機完走・不発火 | DESIGN「launch_worker 実機再検証手順」に従い、local backend の使い捨て issue を `issue start ... --title --request-file` で起票し、本物 `claude` CLI・認証あり下で `launch_worker <id> spec` を**外側セッションから分離した独立プロセス**（`setsid`/`nohup`/CI）で起動、stdout/stderr をログ採取。exit 0・`report latest` が `status=completed` かつ `target_sha`=HEAD・lease 解放を確認し、report 履歴に blocked/human_escalation_requested が無いことを確認 | 完走証跡・不発火が VALIDATION.md へ記録可能な形で採取される | `AC-6`,`AC-7`,`AC-8` | `#1`,`#3`,`#4`,`#9` |
| 11 | [live 検証] human_required 対照（真の異常時のみ発火） | `env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN launch_worker <id> spec` を起動し、`report_status blocked`（`human_escalation_requested=true`・`blocked_reason` に「認証」）が発火し非0非3で返ることを確認、`#10` の正常経路と対比。使い捨て issue/worktree/lease を後始末（cleanup 経由・マージしない・main/統合ブランチへ非混入） | 異常条件で発火・非0非3、`#10` との対比成立。検証物が残らない | `AC-9` | `#10` |

## AC → タスク対応の自己点検

SPEC.md の全 AC が本 PLAN のいずれかのタスクで実現されることを確認する。

| AC-ID | 実現タスク | 検証方法（SPEC 見込み） |
|---|---|---|
| AC-1（既定が非対話で git push 完走） | `#1`（実装）＋`#8`（コード検査 automated）＋`#10`（live） | hybrid |
| AC-2（bypassPermissions 既定化でなく責務限定） | `#1`（実装）＋`#8`（コード検査） | manual |
| AC-3（state に title/request、検証通過） | `#2`（実装）＋`#5`（automated） | automated |
| AC-4（issue start が永続化・後方互換） | `#3`（実装）＋`#6`（automated） | automated |
| AC-5（使い捨て issue が本文供給で着手可） | `#4`（実装）＋`#7`（automated）＋`#10`（live 着手確認） | hybrid |
| AC-6（launch_worker 実機完走） | `#10` | manual |
| AC-7（完走の証跡） | `#10` | manual |
| AC-8（正常経路で human_required 不発火） | `#10` | manual |
| AC-9（真の異常時のみ発火＝対照） | `#11`（＋既存 `worker-adapters.test.ts` の automated 部分は `#9` で pass 確認） | hybrid |
| AC-10（既存テスト全 pass） | `#9` | automated |

全 AC が対応タスクを持つ（対応漏れなし）。

## 実装順序の見直しについて

`#1`（権限方式）と `#2`→`#3`→`#4`（本文経路）は独立に着手できる。テスト（`#5`〜`#8`）は各対応実装の直後に書いてよい。`#9`（回帰）は全コード変更反映後。`#10`/`#11`（live 検証）は `#1`・`#3`・`#4`・`#9` が揃った後に独立検証セグメントで実施する。作業順序のみの見直しは本ファイルの更新のみでよく、DESIGN.md の更新は不要。

## 注意事項

- **本 Issue は共有インフラ変更を含まない**: 先行 Issue #180 と異なり、GitHub 側 ruleset／branch protection の変更は本 Issue に含まれない。したがって「要ユーザー確認」の共有インフラ操作は基本的に無い。
- **進行役の実行環境（settings.json 等）への影響は無い**: 本変更（既定 `WORKER_CMD` の `--allowed-tools` 化）は、`launch_worker` がネスト起動する `claude` プロセスへ渡す**起動フラグのみ**を変える。進行役セッションの `.claude/settings.json`・権限設定・PreToolUse hook 配線（`enforce on/off`）は一切変更しない。よって本セッション自身の実行環境に影響する変更は無い。
- **live 検証は分離プロセスで実行し、使い捨て物は必ず後始末する**: `#10`/`#11` の実機起動は外側セッションの安全分類器を呼び出し経路から外すため `setsid`/`nohup`/CI 等で分離実行する（DESIGN「安全分類器衝突への配慮」）。使い捨て issue／worktree／lease は cleanup 経由で除去し、マージせず、`main`・統合ブランチ・WIP 枠へ痕跡を残さない。
- **認証実値の非出力**: live 検証時、`ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN` の実値をログ・PR・Issue・証跡へ出力しない（アダプタのフェイルセーフ設計と同じ非開示原則）。
