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

- 要件1: 進行役がClaude Code CLIセッションであり、対象segmentの `worker.adapter` が `claude` であり、かつ新方式のopt-in設定（`.agent-skill-chain/config/agent-skill-chain.yaml` の新規項目、既定値は無効）が明示的に有効化されている場合に限り、`worker-launch.sh` の呼び出し結果として起動されるsegment workerは、進行役セッション自身が発行するAgent tool呼び出しとしてサブエージェントツリーに登録される形で起動されなければならない。
- 要件2: 進行役がClaude Code CLIセッションでない場合（human運用・CI・cron等、非対話の呼び出し元を含む）は、現行の headless subprocess 起動（またはhuman adapterの deferred 応答）へフォールバックし、既存の動作を変更してはならない（AGENTS.md「GitHub配布・マルチAI対応」のvendor中立性を維持する）。
- 要件3: 起動方式の変更後も、`launch_worker()` が既に備えるフェイルセーフの順序と規律——(a) writer lease取得→(b) `segment start` によるrole_contract取得→(c) worker起動→(d) 完了確認（`report status` がcompletedかつ `target_sha` がpush済みHEADと一致）→(e) lease解放、および起動失敗・timeout・完了未確認時に必ずblocked報告（`report_status ... blocked`）とlease解放を行い非0非3の終了コードで返す規律（AGENTS.md I8）——を、起動方式が変わっても同一の意味で維持しなければならない。
- 要件4: 起動方式の変更後も、segment workerへ渡されるプロンプトは `segment start` が返すrole_contract全文（AGENTS.md「役割・権限・writer lease」で定める唯一の正規契約伝達経路）のみとし、進行役はワーカーに渡す内容を加工・要約・追記してはならない（AGENTS.md I5 進行役の純粋性）。
- 要件5: 起動方式の変更後も、segment workerが作成するcommitは、既存のwriter lease取得・`checkpoint.sh`（agent-skill-chain CLI `checkpoint` サブコマンド）経由のcommit作成という正規経路をそのまま経由しなければならない。起動主体をシェルスクリプトの独立サブプロセスから進行役のAgent tool呼び出しへ切り替えたことを理由に、commitの作成者情報・attestationが変化してはならない。
- 要件6: 既存のCLIモックテスト境界（`WORKER_CMD` によるテスト用の起動コマンド差し替え）は、起動方式の変更後も引き続き機能しなければならない。
- 要件7: 進行役がClaude Code CLIセッションであるか否かを実行時に判定できない場合（判定手段自体が失敗する、判定結果が不定である等）、新方式（Agent tool経由起動）を有効にする条件が成立したとはみなさず、既存の headless subprocess 起動（要件2）へフォールバックしなければならない。判定不能を新方式の動作条件として扱ってはならない（AGENTS.md I8 安全側ラチェット：降格は自動、昇格は判定成功という明示的な確認が取れた場合のみ）。
- 要件8: 要件1が定める3条件（進行役がClaude Code CLIセッションである／対象segmentの `worker.adapter` が `claude` である／新方式のopt-in設定が有効化されている）のうち、いずれか一つでも満たされない場合は新方式を適用してはならず、要件2と同一の既存の headless subprocess 起動（またはhuman adapterの deferred 応答）へフォールバックしなければならない。新方式のopt-in設定の既定値は無効であり、進行役がClaude Code CLIセッションであり対象segmentのadapterが `claude` であっても、opt-inが明示的に有効化されていない限り新方式は適用されない（AGENTS.md冒頭「速度は人間の明示的なオプトイン、危険信号による降格は自動である」、I8「autonomyの降格は自動、昇格は人間の明示行為のみ」）。opt-in設定を有効化してよいのは、未決事項1（AC-1とAGENTS.md I5の両立可否）・未決事項2（AGENTS.md I3耐久性との関係）がdesign segmentでの技術検証により解消されたと人間が判断した場合に限る。

### 受入条件（Acceptance Criteria）

#### AC-1: Claude Codeセッションからの起動はサブエージェントツリーに表示される

- Given: 進行役がClaude Code CLIセッションであり、対象Issueの対象segmentの `worker.adapter` が `claude` に解決され、かつ新方式のopt-in設定（`.agent-skill-chain/config/agent-skill-chain.yaml` の新規項目）が明示的に有効化されている。
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

#### AC-7: セッション判定が不能な場合は既存動作へ安全側フォールバックする

- Given: 進行役がClaude Code CLIセッションであるか否かを実行時に判定する手段が失敗する、または判定結果が不定である。
- When: `worker-launch.sh` をissue_id・segment引数付きで実行する。
- Then: 新方式（Agent tool経由起動）は使用されず、要件2と同一の既存の headless subprocess 起動（またはhuman adapterの deferred 応答）が実行され、起動方式・終了コード・完了確認手順に変化が無い。
- 検証方法見込み: `automated`

#### AC-8: opt-in設定が既定値（無効）のままの場合は新方式を適用しない

- Given: 進行役がClaude Code CLIセッションであり、対象Issueの対象segmentの `worker.adapter` が `claude` に解決されるが、新方式のopt-in設定（`.agent-skill-chain/config/agent-skill-chain.yaml` の新規項目）が既定値（無効）のまま、明示的に有効化されていない。
- When: `worker-launch.sh` をissue_id・segment引数付きで実行する。
- Then: 進行役がClaude Code CLIセッションでありadapterが `claude` であるにもかかわらず新方式は適用されず、要件2と同一の既存の headless subprocess 起動がそのまま実行され、起動方式・終了コード・完了確認手順に変化が無い。
- 検証方法見込み: `automated`

## 未決事項

### 1. AC-1とAGENTS.md I5（進行役の純粋性）の両立方法

要件1は、進行役セッション自身が発行するAgent tool呼び出しとしてsegment workerを起動することを求める。一方、AGENTS.md I5は、進行役が読み書きするのは調整状態のみであり、成果物の著述・内容の取り込みを行わず、writer lease対象外であることを不変条件として定める。過去に汎用Agent委譲でartifactを直接書かせた結果、commit作成者欄attestationが不正となりI5違反として検出された実例がある（Issue #326）。

一案として、Agent tool経由で起動されるsegment workerを、進行役とは別の役割アイデンティティ（spec_worker/design_worker等）として動作するサブエージェントと位置づけ、実際のgit commit/pushは要件5の通り既存の `checkpoint.sh` 経由でwriter lease credentialを用いて行う——起動主体が独立シェルプロセスからAgent tool呼び出しへ変わっても、内容の著述・commit実行の主体はサブエージェント自身であり進行役自身ではない、という区別を維持する——という方向性が考えられる。この整理がClaude CodeのAgent tool実行モデル上で技術的に成立するか（サブエージェントの出力が進行役の文脈へ混入しないか、role capability分離がAgent tool呼び出し単位で維持できるか等）は本SPEC段階では未検証であり、design segmentでの技術検証・確定を要求する。この検証の帰結次第では、要件1・AC-1自体の実現可能性判断（設計不可の場合のフォールバック要否を含む）に影響しうる。この未検証リスクを抱えたまま新方式を既定で有効化しないよう、要件8・AC-8は新方式の適用条件にopt-in設定（既定値は無効）を追加し、当該opt-inは本未決事項の解消をdesign segmentで確認できた場合にのみ人間が有効化することを求めている。

### 2. 進行役セッションとworker生存期間の結合（AGENTS.md I3 耐久性との関係）

Agent tool経由の起動は、起動元である進行役セッションのプロセス/ターン生存期間に本質的に紐づく可能性が高い。現行のheadless subprocess起動（`bash -c "claude -p ..." &`）は進行役プロセスと完全に独立しており、進行役セッションが終了してもworkerプロセスは影響を受けない。新方式でこの独立性が失われる場合、進行役セッションがworker完了前にクラッシュ・終了・再起動した際にworkerがどうなるか（処理が継続するか、中断するか、中断した場合の再開手段があるか）という、現行方式には存在しない新しい失敗経路が生じる。AGENTS.md I3（耐久性：作業状態は常に完全復元可能で、頭の中にしか無い状態を作らない）との関係をdesign segmentで検証し、必要な要件・ACとして確定することを要求する。

### 3. AC-1とAC-6（`WORKER_CMD`モックテスト境界）の関係（参考）

`WORKER_CMD` 環境変数によるテスト用の起動コマンド差し替えの仕組みが、Agent tool呼び出しという起動方式に対しても同じ意味で機能するかは自明ではない。要件6・AC-6は「テストの前提や境界そのものを変える場合は、同等の代替テストへ機械的に追跡可能な形で置き換える」ことを許容しており、この緩和規定で対応可能と見込むが、置き換えが必要になるか否か、必要な場合の代替手段の設計はdesign segmentで確定する。

## スコープ外

- `codex` アダプタ（`implementation` セグメントの既定adapter）における同種の可視化。Codex CLI側のセッション表示の仕組みに依存するため、別Issueで扱う。
- `launch_gate_reviewer`（read-onlyゲートレビュア）の可視化。必要であれば別Issueで扱う。
- 可視化を実現する具体的な実装方式（Agent tool呼び出しへの切替方法、進行役側のスクリプト構成、判定ロジックの詳細等）の決定。これは `DESIGN.md` の責務であり、本SPECは「何を満たすべきか」のみを定める。
- Claude Code本体（CLIアプリケーション・サブエージェントツリーUIの描画ロジック自体）への変更。本Issueはagent-skill-chain側（`worker-launch.sh`・`.agent-skill-chain/adapters/claude.sh`）の起動方式のみを対象とする。
