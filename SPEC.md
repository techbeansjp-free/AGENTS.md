# SPEC: 進行役がClaude Codeの場合、worker-launch.shが起動するsegment workerをこのセッションのサブエージェントツリー上で可視化する

- Issue: `ISSUE-448`
- 作成者: `spec_worker`
- 対象ブランチ: `feature/448-subagent-tree-visibility`

## 目的・背景

`.agent-skill-chain/scripts/worker-launch.sh` は `.agent-skill-chain/adapters/claude.sh` の `launch_worker()` を通じて、セグメント作業ワーカー（spec/design/implementation/validation）を、進行役プロセスとは完全に独立したサブプロセス（`bash -c "claude -p ..." <"$prompt_file" &`）として起動する。この起動方式は、進行役がClaude Code CLIセッションであり、かつそのセッション自身が `worker-launch.sh` を呼び出している場合であっても、Claude CodeのUIが提供する「このセッションのサブエージェントツリー」（実行中のサブエージェント一覧・所要時間・トークン消費量等の構造化された可視化ビュー）には一切登録されない。理由は、当該ツリーがそのセッションを駆動しているLLM自身が発行したAgent tool呼び出しに対してのみ構築される表示であり、`bash -c` で起動された独立の `claude` CLIプロセスは、呼び出し元セッションから見て完全に別個のプロセスだからである。

2026-08-05、Issue #439/#441/#442/#446の連続対応セッションにおいて、design workerの起動状況をユーザーから尋ねられた際にこの制約が判明した。進行役（Claude Code）自身がこの起動方式で複数のsegment workerを起動・監視しているにもかかわらず、ユーザーからは進行状況・所要時間・トークン消費量を追う構造化された手段が無く、`worker-launch.sh` の標準出力・標準エラー出力（バックグラウンドタスクのログ）を推測的に確認する以外に状況を把握する手段が無い。ユーザーは「可視性は担保されるべきです。このセッションのサブエージェントツリーに表示させて下さい」と明示的に要求しており、本Issueはこれを解決する。

## 要求 → 要件 → 受入条件

### 要求

進行役がClaude Code CLIセッションである場合、`worker-launch.sh <issue_id> <segment>` によって起動されるsegment workerが、そのセッションのサブエージェントツリー上に他のAgent tool委譲と同様に表示され、進行中の状態・所要時間・トークン消費量が確認できること。

### 要件

- 要件1: 進行役がClaude Code CLIセッションであり、かつ対象segmentの `worker.adapter` が `claude` である場合、`worker-launch.sh` の呼び出し結果として起動されるsegment workerは、進行役セッション自身が発行するAgent tool呼び出しとしてサブエージェントツリーに登録される形で起動されなければならない。
- 要件2: 進行役がClaude Code CLIセッションでない場合（human運用・CI・cron等、非対話の呼び出し元を含む）は、現行の headless subprocess 起動（またはhuman adapterの deferred 応答）へフォールバックし、既存の動作を変更してはならない（AGENTS.md「GitHub配布・マルチAI対応」のvendor中立性を維持する）。
- 要件3: 起動方式の変更後も、`launch_worker()` が既に備えるフェイルセーフの順序と規律——(a) writer lease取得→(b) `segment start` によるrole_contract取得→(c) worker起動→(d) 完了確認（`report status` がcompletedかつ `target_sha` がpush済みHEADと一致）→(e) lease解放、および起動失敗・timeout・完了未確認時に必ずblocked報告（`report_status ... blocked`）とlease解放を行い非0非3の終了コードで返す規律（AGENTS.md I8）——を、起動方式が変わっても同一の意味で維持しなければならない。
- 要件4: 起動方式の変更後も、segment workerへ渡されるプロンプトは `segment start` が返すrole_contract全文（AGENTS.md「役割・権限・writer lease」で定める唯一の正規契約伝達経路）のみとし、進行役はワーカーに渡す内容を加工・要約・追記してはならない（AGENTS.md I5 進行役の純粋性）。
- 要件5: 起動方式の変更後も、segment workerが作成するcommitは、既存のwriter lease取得・`checkpoint.sh`（agent-skill-chain CLI `checkpoint` サブコマンド）経由のcommit作成という正規経路をそのまま経由しなければならない。起動主体をシェルスクリプトの独立サブプロセスから進行役のAgent tool呼び出しへ切り替えたことを理由に、commitの作成者情報・attestationが変化してはならない。
- 要件6: 既存のCLIモックテスト境界（`WORKER_CMD` によるテスト用の起動コマンド差し替え）は、起動方式の変更後も引き続き機能しなければならない。

### 受入条件（Acceptance Criteria）

#### AC-1: Claude Codeセッションからの起動はサブエージェントツリーに表示される

- Given: 進行役がClaude Code CLIセッションであり、対象Issueの対象segmentの `worker.adapter` が `claude` に解決される。
- When: 進行役が `worker-launch.sh` をissue_id・segment引数付きで実行する。
- Then: 起動されるsegment workerは、進行役セッションのサブエージェントツリー上に他のAgent tool委譲と同様の1エントリとして表示され、実行中の状態・経過時間・トークン消費量がそのビュー上で確認できる。
- 検証方法見込み: `hybrid`

#### AC-2: Claude Codeセッション以外からの起動は既存動作を維持する

- Given: `worker-launch.sh` が、Claude Code CLIセッション以外（human運用のシェル・CI・cron等）から実行される、またはClaude Codeセッションからの実行であっても対象segmentの `worker.adapter` が `claude` 以外に解決される。
- When: `worker-launch.sh` をissue_id・segment引数付きで実行する。
- Then: 現行の headless subprocess 起動（`claude` adapterかつ非Claude Codeセッションの場合）、または既存adapter（`codex`・`human`）の既存動作がそのまま実行され、起動方式・終了コード・完了確認手順に変化が無い。
- 検証方法見込み: `automated`

#### AC-3: 既存のlease・フェイルセーフ規律が同一に保たれる

- Given: 起動方式（Claude Codeセッション上でのAgent tool経由起動、非Claude Codeセッションでのheadless subprocess起動のいずれか）を問わず、`worker-launch.sh` をissue_id・segment引数付きで実行する。
- When: (a) lease取得に失敗する、(b) `segment start` に失敗する、(c) worker起動が失敗またはtimeoutする、(d) worker完了後の `report status` がcompleted以外またはtarget_sha不一致である、のいずれかが発生する。
- Then: 各失敗パターンに対応する既存の規律——(a)(b)は起動前のためblocked報告なしでlease未取得/解放のみ、(c)(d)は必ずblocked報告（`report_status ... blocked`, `human_escalation_requested`相当）とlease解放を行い非0非3の終了コードで返す——が起動方式変更後も同一に成立し、既存の統合テスト（`launch_worker` のlease・report・終了コードを検証するテスト群）が引き続きパスする、または同等の新テストに置き換わってパスする。
- 検証方法見込み: `automated`

#### AC-4: role_contract全文の唯一の伝達経路が保たれる

- Given: `worker-launch.sh` が起動方式変更後の経路でsegment workerを起動する（issue_id・segment引数は既存と同一の受け取り方）。
- When: `segment start` が返すrole_contractがworkerへ渡される。
- Then: workerが受け取るプロンプトは `segment start` が返すrole_contract全文と完全に一致し、進行役による加工・要約・追記が無い（進行役はワーカーが読み書きする成果物の内容を著述・取り込みしない、AGENTS.md I5）。
- 検証方法見込み: `hybrid`

#### AC-5: commitのwriter lease/attestation正規経路が維持される

- Given: 起動方式変更後の経路でsegment workerが起動され、成果物へのcommitを作成する。
- When: workerが `checkpoint.sh`（agent-skill-chain CLI `checkpoint` サブコマンド）を呼び出してcommitを作成する。
- Then: 生成されるcommitは、起動方式変更前と同一のwriter lease credential・commit作成経路を経由しており、作成者欄・attestationが writer role の正規経路によるものとして検証可能である（過去に汎用Agent委譲でartifactを直接書かせた結果、commit作成者欄attestationが不正となりI5違反として検出された事例の再発が無いことを含む）。
- 検証方法見込み: `automated`

#### AC-6: 既存のCLIモックテスト境界が維持される

- Given: `WORKER_CMD` 環境変数でテスト用の起動コマンドへ差し替えている既存の自動テストが存在する。
- When: 起動方式変更後のコードに対して同じ既存テストを実行する。
- Then: `WORKER_CMD` によるモック差し替えが引き続き機能し、既存テストが変更前と同じ意味で成立する（テストの前提や境界そのものを変える場合は、同等の代替テストへ機械的に追跡可能な形で置き換える）。
- 検証方法見込み: `automated`

## スコープ外

- `codex` アダプタ（`implementation` セグメントの既定adapter）における同種の可視化。Codex CLI側のセッション表示の仕組みに依存するため、別Issueで扱う。
- `launch_gate_reviewer`（read-onlyゲートレビュア）の可視化。必要であれば別Issueで扱う。
- 可視化を実現する具体的な実装方式（Agent tool呼び出しへの切替方法、進行役側のスクリプト構成、判定ロジックの詳細等）の決定。これは `DESIGN.md` の責務であり、本SPECは「何を満たすべきか」のみを定める。
- Claude Code本体（CLIアプリケーション・サブエージェントツリーUIの描画ロジック自体）への変更。本Issueはagent-skill-chain側（`worker-launch.sh`・`.agent-skill-chain/adapters/claude.sh`）の起動方式のみを対象とする。
