# DESIGN: agent-skill-chain Tier 1 — adapters launch_worker（spec/design/implementation/validationワーカー起動）の設計

- Issue: `ISSUE-166`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `launch_worker`共通シグネチャ（`<issue_id> <segment>`、CWD=対象worktree） | 3 adapter（claude/codex/human）同一 |
| `AC-2` | `launch_worker`内のlease取得→segment start→起動→解放/blocked報告の一連処理 | 失敗時は必ず`release_lease`または`report_status blocked` |
| `AC-3` | `_asc_cli segment start`の標準出力（`role: <role>\n<role_contract yaml>`）をそのままworker起動系（プロンプト/通知本文）へ引き渡す | 新規CLIサブコマンド不要 |
| `AC-4` | claude.sh `launch_worker`: `WORKER_CMD`（既定`claude -p ...`）をworktree内で起動、認証未設定はfail-safe | 起動系はテスト時`WORKER_CMD`で完全にモック可能 |
| `AC-5` | codex.sh `launch_worker`: lease取得を試みず即fail-safe（`report_status blocked`＋exit 2） | 将来の実結線ポイントをコメントで明記 |
| `AC-6` | human.sh `launch_worker`: lease取得→`segment start`→通知発行（`gh issue comment`/ローカルmarker）→exit 3（deferred） | 人間自身が`lease renew`/`report_status`/（spec限定）`pr create`を実行する手順を通知本文に明記 |
| `AC-7` | claude.sh: 起動失敗・timeout・認証未設定はすべて`release_lease`＋`report_status blocked(human_escalation_requested=true)`＋非0非3で返す | worker-report.schema.yamlの`status=blocked`語彙へ写像 |
| `AC-8` | `lease acquire`（`src/commands/lease.ts`）への`wip.limit`事前チェック追加（GitHubモード=`writer-lease:active`ラベル数、ローカルモード=`issues/*/.agent-skill-chain/lease.yaml`件数） | `launch_worker`はacquire失敗をそのままblocked報告として扱うのみで独自のWIP判定を持たない |
| `AC-9` | segment分岐なし。`segment start`が返すrole_contract自体（`roles.yaml`の`role_contracts.spec_worker`）がDraft PR作成をspecのみの完了条件として既に記述しているため、`launch_worker`は全segment共通処理のまま成立する | 詳細は「Draft PR非対称性の扱い」節 |
| `AC-10` | 既存`launch_gate_reviewer`のシグネチャ・終了コード契約は無変更。新規関数`launch_worker`を追加するのみ | 既存237件超＋#164/#165テストを無破壊に保つ |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/adapters/{claude,codex,human}.sh`の`launch_worker`関数: 本Issueの主成果物。役割・権限を実行系へ変換する薄い層。lease取得・`segment start`呼び出し・worker実行系起動・lease解放・完了報告の一連を担う。
- `.agent-skill-chain/scripts/worker-launch.sh`（新設、`gate-launch-reviewer.sh`と対称の起動ラッパー）: `.agent-skill-chain/config/agent-skill-chain.yaml`の`worker.adapter`からadapterを解決し、該当`launch_worker`を起動する。adapter未解決・関数未定義時のフェイルセーフ書込みを担う（`gate-launch-reviewer.sh`と同型）。
- `src/commands/lease.ts`（既存拡張）: `acquire()`へ (a) GitHubモードのissue横断コンフリクト検査、(b) `wip.limit`事前チェックを追加する。`launch_worker`自体はこの2点を独自に判定しない（既存のacquire失敗経路にそのまま乗る）。
- `.agent-skill-chain/config/agent-skill-chain.yaml` / `config.schema.yaml`: `worker.adapter`（`claude|codex|human`、既定`human`）を新設する。
- `segment-start.sh`（既存・無変更）: `launch_worker`が唯一のrole_contract取得手段として呼び出す。

### 依存関係

```text
launch_worker(issue_id, segment)
  → acquire_lease(issue_id, segment)            [lease-acquire.sh: wip.limit検査 + 同issue内他segmentコンフリクト検査]
  → _asc_cli segment start <issue_id> <segment>  [role_contract取得。lease有効性の再検証を兼ねる]
  → (claude) WORKER_CMD 起動 + renew_lease 定期実行ループ
  → (human)  gh issue comment / ローカルmarker 通知
  → (codex)  何もしない（fail-safe）
  → release_lease + report_status(completed|blocked)
```

循環依存は無い。`launch_worker`は`segment start`・`lease-*.sh`・`checkpoint.sh`・`report-status.sh`・`pr-create.sh`という既存の薄いCLIラッパーのみに依存し、これらの内部実装（TypeScript側）には触れない。

## `launch_worker`共通シグネチャ（3 adapter同一）

```
launch_worker <issue_id> <segment>
```

- 引数: `issue_id`（`ISSUE-<番号>`）、`segment`（`spec|design|implementation|validation`）の2つのみ。
- 前提: カレントディレクトリが対象Issueのworktree内であること（`checkpoint.sh`/`gate-review.sh`と同じ規約。`worktree_path`を引数化しない）。
- 終了コード契約（`launch_gate_reviewer`の0/3/errorと対称）:
  - `0`: worker完了（`report_status completed`済み、lease解放済み）
  - `3`: deferred（human adapterのみ。正常系。lease は保持継続、人間の非同期作業待ち）
  - それ以外（`!=0,!=3`）: error（`report_status blocked`・lease解放済み、`human_escalation_requested=true`）
- env（3 adapter共通）: `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`（claude認証、実値は非ログ出力）、`WORKER_CMD`（起動系の上書き・テスト用モック境界）、`WORKER_TIMEOUT_SEC`（既定値は実装フェーズで`lease.ttl_seconds`との整合を見て確定。テストでは短時間値を注入）。

`launch_worker`はrole（`spec_worker`等）を引数に取らない。`segment`→`role`の対応は`SEGMENT_TO_ROLE`（`src/commands/segment.ts`）が既に唯一の正本であり、`launch_worker`はこれを`_asc_cli segment start`経由で間接的にのみ利用する（bashコード側に対応表を複製しない＝DRY）。

## lease取得→起動→解放の順序（AC-2）

1. **取得**: `acquire_lease "$issue_id" "$segment"`（`lease-acquire.sh`）。失敗（`wip.limit`超過・同issue内他segmentのlease競合・同一segmentの競合のいずれか）はここで即`return 1`。この時点ではまだ何のプロセスも起動しておらず解放すべきleaseも存在しないため、blocked報告は行わない（呼び出し側=`worker-launch.sh`が非0終了コードをそのまま人間可視化する）。
2. **役割取得**: `_asc_cli segment start "$issue_id" "$segment"`でrole_contractを取得する。取得後にlease有効性が再検証される（`segment-start.sh`が内部でlease確認する既存動作）。失敗時は`release_lease`してから`return`する（起動前のためworker-report無し）。
3. **起動**（adapter別。次節）。
4. **終了処理**:
   - 成功（claude完了 / human通知成功）: claudeは`release_lease`＋`report_status completed`まで実行してから`return 0`。humanは**releaseしない**（作業継続中のため）まま`return 3`。
   - 失敗・timeout: `release_lease`（失敗しても`|| true`で握り潰さず、少なくとも1回は試行しログに残す）＋`report_status blocked, human_escalation_requested=true`の後、非0非3で`return`する。

この順序により、起動失敗時にleaseが保持されたまま放置される経路が存在しない（AC-2充足）。「保持継続」はSPEC本文の想定どおり、claude起動中〜完了確認までの区間でrenewループにより維持される状態を指し、完了・失敗いずれの終端でも明示的な解放（またはhuman deferred時の意図的保持）に必ず帰結する。

## `segment-start.sh`との統合方法（AC-3）

`segment start`の標準出力（`role: <role_name>\n<role_contractのYAML>`）を**唯一のrole_contract受け渡し経路**として再利用する。新規CLIサブコマンドは追加しない。

- claude adapter: この出力をそのままworkerプロンプトの本文として（前後に短い定型の指示文を付けて）標準入力経由でworker実行系へ渡す（`launch_gate_reviewer`が`gate reviewer-prompt`の出力をstdin経由でレビュアへ渡す既存パターンと同型）。
- human adapter: この出力を通知本文（`gh issue comment`本文 / ローカルmarkerファイル）へそのまま埋め込む。
- codex adapter: 未構成のため出力を取得・使用しない（lease未取得のまま即fail-safeするため）。

## adapter別の実装方針

### claude adapter（実起動・AC-4/AC-7）

既存`launch_gate_reviewer`の「認証チェック→実行系解決→timeout付き起動→結果を trusted CLI へ結線」という骨格を踏襲しつつ、以下の3点が異なる。

| 観点 | `launch_gate_reviewer`（read-only） | `launch_worker`（writer） |
|---|---|---|
| 起動系の権限 | `--allowed-tools ''`（無ツール） | 書込みツール（Edit/Write/Bash）を許可する非対話フラグ |
| リトライ | 一時障害を`retries`回リトライ | **リトライしない**（後述の理由） |
| 完了後の書込み | 呼び出し側（adapter）が`record-verdict`で結線 | worker自身が`checkpoint.sh`（＋specのみ`pr-create.sh`）で自ら書込む |
| lease | 対象外（`lease: none`） | 取得・renewループ・解放を`launch_worker`が管理 |

- **起動**: `WORKER_CMD`（既定は`claude -p --output-format text`＋書込み許可のための非対話フラグ）を`timeout "$WORKER_TIMEOUT_SEC" bash -c "$WORKER_CMD"`でバックグラウンド起動し、PIDを保持する。書込み許可フラグの正確な値（`--permission-mode`系か`--dangerously-skip-permissions`系か）は実装フェーズでインストール済みCLIバージョンに対し実機検証のうえ確定する——`WORKER_CMD`による完全上書きが可能なため、この確定の遅延は`launch_worker`関数自体の契約（引数・終了コード・lease連携）に影響しない。
- **renewループ**: サブプロセスPIDに対し`kill -0`で生存確認しつつ`renewal_interval_seconds`ごとに`renew_lease`を呼ぶバックグラウンドループを子プロセス実行中のみ動かし、`wait`でサブプロセス終了を待つ。
- **リトライしない理由**: ゲート判定は状態を変更しない冪等な操作なので一時障害のリトライが安全だが、workerは実際にファイルを書き換える非冪等な操作を行う。失敗直後に無条件リトライすると、部分的に書き換わった状態の上に二重に作業させる・二重commitを生む等の実害があるため、1回の起動失敗は即座に`blocked`として人間判断へ委ねる（I8: 迷ったら安全側）。
- **完了確認**: サブプロセスの終了コードが0のみでは「本当にcheckpointまで終えたか」を保証しないため、`launch_worker`は終了後に`report-status.sh`が生成した直近レポート（`worker-report.schema.yaml`準拠）の`status`を確認し、`completed`かつ`target_sha`がpush済みHEADと一致する場合のみ`return 0`とする。一致しない場合は「完了を騙る」ケースも安全側でblocked扱いにする（I8）。
- **認証未設定・CLI不在**: `launch_gate_reviewer`と同じフェイルセーフ（`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`いずれも無ければ起動せず即blocked）。

### codex adapter（I/Fパリティ・fail-safe deferral・AC-5）

`launch_gate_reviewer`のcodex実装と同型。**lease取得を一切試みない**——Codex実行系は未構成で必ず失敗するとわかっているため、WIP枠を消費させないことを優先する（lease取得済みで即失敗すると解放処理が余計に発生し、かつその間WIP上限を無駄に消費する）。

```
launch_worker() {
  # 引数検証のみ行い、lease取得前に「codex未構成」を明示してreport_status blockedを1回書き、exit 2で返す。
  # 将来の拡張ポイント: Codex実行系（CLI/API・認証OPENAI_API_KEY・書込み許可）が確定したら、
  # claude.shのlaunch_workerと同じ「lease取得→起動→renewループ→完了確認→解放」構造へ置き換える。
}
```

### human adapter（通知＋非同期・AC-6）

lease取得と`segment start`まではclaudeと共通（役割・入力を人間へ正確に伝達するため）。その後はサブプロセスを起動せず、`launch_gate_reviewer`のhuman実装と同じ通知経路（GitHubモード=`gh issue comment`＋`worker:<segment>:awaiting-human`ラベル、ローカルモード=marker file）で以下を明記した通知を送り、`return 3`で即座に返す。

- 実施すべき作業内容（`segment start`が返したrole_contract全文）。
- 作業が長時間に及ぶ場合は`lease renew <issue_id> <token>`を`renewal_interval_seconds`間隔で自ら呼び出すこと（怠るとTTL切れで`reconcile.sh`が回収し人間判断へ再エスカレーションされる＝安全側だが二度手間になる）。
- 完了時は`checkpoint.sh`→（spec segmentのみ）`pr-create.sh`→`report-status.sh`→`lease-release.sh`の順に自ら実行すること。

renewループは`launch_worker`側では起動しない（サブプロセスが存在せず生存監視の対象が無いため）。TTL切れによる自然な回収が安全側のフォールバックになる。

## WIP上限との整合（AC-8）

`wip.limit`（既定3、`count_by: active_writer_lease`）は`launch_worker`ではなく`lease acquire`（`src/commands/lease.ts`）が判定する唯一の関所とする。

- **ローカルモード**: `issues/*/.agent-skill-chain/lease.yaml`を走査し`expires_at > now`の件数を数える。
- **GitHubモード**: 全Issueのコメントを毎回スキャンするのはコスト過大なため、`lease acquire`成功時に`writer-lease:active`ラベルをIssueへ付与し（`human.sh`の`gate:${gate_id}:awaiting-human`ラベル運用と同型）、`lease release`時に外す。WIP判定は`gh issue list --label writer-lease:active --state open`の件数のみで完結させる。
- `launch_worker`はこの判定結果を独自に持たず、`acquire_lease`の失敗をそのまま「起動前のerror」として扱う。

## Draft PR作成の非対称性の扱い（AC-9）

`launch_worker`にsegment分岐は追加しない。`roles.yaml`の`role_contracts.spec_worker.completion`には元々「Draft PRを作成済み（Closes #<issue-id>）※このセグメントのみ」が記述済みであり、`design_worker`/`implementation_worker`/`validation_worker`の`completion`にはこの項目が無い。`segment start`はこの差分をそのまま返すため、`launch_worker`（起動する側）はrole_contractを不透明なテキストとして一律に扱うだけで、spec/非specの分岐ロジックを一切持つ必要がない。実際にDraft PR作成（`pr-create.sh`）を呼び出すのはworker自身（AI／人間）であり、これは`checkpoint.sh`呼び出しと同じ「roleが自分の完了条件に従って行う作業」として扱う。

## I8安全側ラチェットの踏襲

`launch_gate_reviewer`のI8実装（起動失敗・timeout・未構成→常に`human_required`相当へ）を、worker-report.schema.yamlの語彙（`status: blocked` + `human_escalation_requested: true`）に写像して踏襲する。silent passする経路（起動失敗を`completed`として報告する、leaseを取得したまま何も報告しない等）が存在しないことを、後述のテストで直接確認する。

## 責務・境界の要約

- `launch_worker`は「起動」と「lease生死管理」のみを担い、成果物の内容判断・完了可否のビジネス判定は行わない（role_contractの`completion`充足判定はworker自身の責務）。
- `worker-launch.sh`はadapter解決とフェイルセーフの安全網のみを担う（`gate-launch-reviewer.sh`と対称）。
- `lease acquire`はWIP上限・issue内排他の唯一の関所であり、`launch_worker`はこれを信頼して二重実装しない。

## 関連ADR

新規の`docs/adr/`配下ADRは作成しない。本Issueは (1) 既存`launch_gate_reviewer`の起動骨格の横展開（claude=実起動/codex=fail-safe/human=通知、`launch_gate_reviewer`実装時に確立済みの型）、(2) `review.adapter`と対称な`worker.adapter`設定項目の追加（AGENTS.md §設定の6手順のうち②③④を満たす横展開、①は`review.adapter`で既に承認済みの理由の再適用）、(3) 既存`lease acquire`への追加検査（新規の状態遷移や`segments.yaml`の構成変更を伴わない）のみで完結し、`docs/system-spec/`にも影響しない。先行するIssue #164/#165（`launch_gate_reviewer`実装）・#171（本規約対応実地確認）も同種の判断で新規ADRを作成しておらず、本Issueもこの先例に従う。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - workerサブプロセスがtimeout・クラッシュ・認証エラーで異常終了→lease放置。対策: `launch_worker`の終端処理で常に`release_lease`（`|| true`で失敗を握り潰さずログに残しつつ処理継続）を試みる。
  - workerが`report_status`を呼ばずに終了コード0で終わる（完了を騙る）→「完了確認」ステップ（`report-status`の直近レコードと`target_sha`突合）が無いと誤ってsuccess扱いになる。対策: 前述の完了確認ステップで安全側blockedへ倒す。
  - GitHubモードの`lease acquire`が同issue内の他segmentの既存leaseを見逃す（現行`activeLeaseFor`はsegment一致のみ判定）→ 本Issueで`acquire()`へ追加するissue横断コンフリクト検査で解消する（既存`activeLeaseFor`のsegmentスコープ判定自体は`segment start`の正当な用途があるため変更しない）。
  - `writer-lease:active`ラベル付与・除去が`gh`エラーで失敗する→ best-effort（`|| true`）とし、WIP判定は現状より安全側（過大にカウントされることはあってもゼロ件見逃しにはならない設計）に倒す。ラベル操作自体の失敗はWIP判定の可用性を下げるのみで、既存の同issue内lease競合検査（コメント本体照合）は独立して機能し続ける。
- ロールバック手順: 本Issueの変更は (1) 3 adapterへの`launch_worker`関数追加、(2) `worker-launch.sh`新設、(3) `config.schema.yaml`/`agent-skill-chain.yaml`への`worker`セクション追加、(4) `lease.ts`への追加検査、のいずれも既存関数・既存フィールドの削除や置換を伴わない追加のみであるため、当該commitを`git revert`すれば個別に切り戻せる。`launch_gate_reviewer`のシグネチャ・挙動には一切触れない。
- 影響を受ける既存機能: `lease acquire`（GitHubモードの検査追加により、既存の同一segment再入コンフリクトの検査結果自体は変更しない＝既存テスト無破壊）。`launch_gate_reviewer`・`checkpoint`・`report status`・`pr create`は無変更（`launch_worker`から呼び出されるのみ）。
