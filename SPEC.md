<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: agent-skill-chain — launch_worker の権限モード不足解消・ローカルバックエンド issue 本文スキーマ拡張

- Issue: `ISSUE-183`
- 作成者: `claude`
- 対象ブランチ: `feature/183-worker-permission-mode`

## 目的・背景

このリポジトリ（`techbeansjp-free/AGENTS.md`）が目指す「完全自走（人間が介在しなくても、真に危険な場合以外は止まらない）」の end-to-end 実証は、先行 Issue #180 の独立検証（VALIDATION.md、AC-6/AC-7/AC-8）において **未達成** で確定した。本物の `claude` CLI（headless・認証あり・CLI 利用可という正常な前提）で `.agent-skill-chain/adapters/claude.sh` の `launch_worker` を人間介在なく 1 セグメント完走させる実機検証を複数回試みたが、認証や CLI 可用性ではなく以下の構造的な不足により達成できなかった。本 Issue はこの根本原因を恒久的に解消し、AC-6/AC-7/AC-8 相当を改めて実機で成立させることを目的とする。

根本原因（成果物の自己完結性の原則に従い、外部参照に意味を委譲せず本文に明記する）：

1. **既定 `WORKER_CMD` の権限モード不足**: `launch_worker` は `WORKER_CMD` 未指定時、`claude` CLI を `claude -p --output-format text --permission-mode acceptEdits` で起動する。`acceptEdits` はファイル編集ツール（Edit/Write 等）を非対話で自動承認するが、`git push` 等の Bash／ネットワーク操作は非対話ヘッドレス実行では自動承認しない。そのため spec worker は `SPEC.md` 作成・`git commit` までは人間介在なく進むが、`git push` で承認待ちのまま停止し、`launch_worker` が完了未検知としてフェイルセーフ（`report_status blocked` の `human_escalation_requested` 扱い、終了コード 2）へ倒れた。認証あり・CLI 利用可という正常経路でのこの発火は、AC-8（正常経路で `human_required` が誤発火しないこと）の観点で「誤発火」に該当し、完走（AC-6）・完走証跡（AC-7）も成立しない。なお、フェイルセーフ機構自体は「`git push` 続行不能」という実ブロッカーに対して正しく安全側へ倒れており、機構の欠陥ではない。

2. **ローカルバックエンドの状態スキーマに issue 本文を運ぶフィールドが無い**: ローカルモードの状態モデル `.agent-skill-chain/schemas/state.schema.yaml` には Issue のタイトル・要求内容に相当するフィールドが存在しない。`issue start` は `state.yaml` に `id`・`autonomy`・`risk`・`review_profile`・`segment`・`gate` のみを書き、Issue が「何を作るのか」という本文を保持しない。また `segment start` がワーカーへ渡すプロンプトはベンダー中立の汎用 role_contract（`spec_worker` の `inputs: [issue, ...]` 等）のみで、Issue 固有の本文を含まない。このため、使い捨て issue で実機検証を行う際に Issue 内容を人間（またはワーカーの前段）が別途作り込む必要があり、Issue #180 の DESIGN が推奨した「ローカルバックエンドでの使い捨て検証」という検証手順自体が想定通りに機能しなかった。

3. **権限モード緩和の検証と外側の安全分類器の衝突（副次的現象）**: 権限モードを緩める調整（`--permission-mode bypassPermissions` 等）の検証自体が、検証を行っていたエージェント自身のセッションの安全分類器にブロックされ、ネストした `claude` 呼び出しへ到達する前に拒否される、という副次的現象が観測された。本 Issue は対応方針の検討時にこの衝突可能性を考慮するが、安全分類器自体の変更は行わない（スコープ外）。

## 用語

- **`launch_worker`**: `.agent-skill-chain/adapters/claude.sh` のセグメント作業ワーカー起動関数。lease 取得 → `segment start`（role_contract 取得）→ ワーカー起動 → 完了確認（`report latest` 直近レコードの `status` と `target_sha` を push 済み HEAD と突合）→ lease 解放、の順で 1 セグメントを機械的に完走させる。
- **`WORKER_CMD`**: `launch_worker` がワーカーを起動する実行系コマンド。環境変数で完全上書き可能（テストではモックへ差し替え）。未指定時の既定は本文根本原因 1 の `claude -p --output-format text --permission-mode acceptEdits`。
- **権限モード（permission mode）**: `claude` CLI がツール実行時の承認をどう扱うかを定める起動時設定。`acceptEdits`（ファイル編集のみ自動承認）／`bypassPermissions`（全ツールを無制限に自動承認）／`--allowed-tools`（許可するツール名・Bash パターンを明示列挙し、それ以外は不許可）等が該当する。実際の受理値・挙動は `claude` CLI の公式仕様を一次情報とする。
- **ワーカーの正規責務範囲**: `.agent-skill-chain/config/roles.yaml` の `worker` role が持つ capability。具体的には自 worktree 内の read/write、テスト実行、writer lease の acquire/renew/release、**自 branch への commit/push**、Integration Record／Draft PR の更新（Draft PR 作成は spec セグメントのみ）、固定スキーマによる report。自 branch 以外への書込みは禁止（I5）。
- **ローカルバックエンド（local coordination backend）**: `coordination.backend: local` 時の調整状態の正本。Issue 毎に `issues/<number>/.agent-skill-chain/state.yaml`（正本）・lease・reports 等を Git 管理下に置く。GitHub モードと異なり、Issue 本文は GitHub API から取得できず状態ファイルにのみ存在しうる。
- **使い捨て検証（disposable verification）用 issue**: 実機検証専用に作成し、確認後にマージせず破棄する一回性の Issue／ブランチ。ローカルバックエンドではこの Issue に本文（何を作るか）を持たせる必要があるが、現状スキーマにはそのフィールドが無い。
- **human_required（誤発火）**: 認証あり・CLI 利用可という正常な前提のもとで、`launch_worker` のフェイルセーフ経路（`report_status blocked` の `human_escalation_requested` 扱い）が呼ばれてしまうこと。真の異常時（認証欠如・CLI 不在・timeout・完了偽装検知）以外での発火を指す。
- **人間介在なしの完了**: `launch_worker` が起動したワーカーが、人間の追加入力・手動代行なしに `report_status completed`（`target_sha` = push 済み HEAD 一致）を記録し、`launch_worker` が終了コード 0 で lease を解放した状態。
- **統合ブランチ**: 本 Issue 群の base である `chore/162-agent-skill-chain-bootstrap`。`main` への最終マージ前に各 Issue の PR を集約するブランチ。本 Issue の base branch でもある。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

Issue #183 本文（背景・対象範囲 1〜3・成功基準）に基づく要求：

- `launch_worker` が本物の `claude` CLI をヘッドレスで起動する際、少なくとも自ブランチへの `git push`（ワーカーの正規責務範囲内の操作）を人間の追加承認なく実行できるようにしたい。ただし無制限な `bypassPermissions` を安易に採用せず、ワーカーの責務範囲（自ブランチへの commit/push・Draft PR 作成）に限定した権限設計としたい。
- ローカルバックエンドの状態スキーマに Issue のタイトル・要求内容相当のフィールドを追加し、使い捨て issue での実機検証が Issue 本文の人間による作り込みなしに成立するようにしたい。
- 上記対応後、本物の `claude` CLI（headless・認証あり）で `launch_worker` が人間介在なく 1 セグメント以上完走し（`report status=completed`・`target_sha` 一致・lease 解放）、その正常経路で `human_required` が誤発火せず、かつ認証欠如・CLI 不在等の真の異常時には引き続き `human_required` が正しく発火する（regression なし）ことを実機で裏付けたい。
- 上記の全変更後も、既存テストスイート（`chore/162-agent-skill-chain-bootstrap` 統合ブランチ上の全件）が引き続き全て pass する状態を維持したい。

### 要件

- **要件1（ワーカー責務限定の権限モード設計・実装）**: `launch_worker` の既定起動系（既定 `WORKER_CMD` またはそれに代わる起動機構）が、ワーカーの正規責務範囲の操作——自 branch への `git commit`／`git push`、Draft PR 作成（`gh pr create` 等、spec セグメント）、テスト実行、`report-status`／`lease-*`／`checkpoint` スクリプト実行——を、非対話ヘッドレス実行で人間の追加承認なく実行できるようにする。**無制限な `bypassPermissions` を既定として安易に採用しない**責務限定設計とし、自 branch 以外への書込みを許容しない（I5）。以下の実現方式を要件レベルの候補として提示し、最終確定は DESIGN.md に委ねる：
  - 候補A（allowlist 明示）: `claude` CLI の `--allowed-tools` に責務範囲のツール・Bash パターンを明示列挙する（例: `Bash(git commit:*)`・`Bash(git push:*)`・`Bash(gh pr create:*)` および Edit/Write と本アダプタが結線する各スクリプト呼び出し）。責務外の操作は既定で不許可のまま残る。
  - 候補B（ラッパー／hook 仲介）: 許可操作のみを通す専用ラッパースクリプトまたは `PreToolUse` hook（`.agent-skill-chain/hooks/` 系）を介してワーカーの Bash 実行を仲介し、allowlist 外を拒否する。
  - 候補C（bypass + 外側スコープ限定）: `bypassPermissions` を用いるが、ワーカーが起動される環境側（credential/GitHub 権限分離・自 worktree 隔離）で責務範囲外への影響を外部から不能にする。この候補を採る場合、無制限承認に伴うリスク（本文根本原因 3 の安全分類器衝突を含む）と、それを外側でどう限定するかの根拠を DESIGN.md に明記することを条件とする。
  いずれの候補でも「自 branch 以外への書込み禁止（I5）」「無制限承認を安易に既定化しない」原則を満たすこと。`WORKER_CMD` による完全上書き余地は維持する。
- **要件2（安全分類器衝突への配慮）**: 権限モード緩和の検証がネストした `claude` 起動へ到達する前に外側セッションの安全分類器にブロックされる副次的現象（本文根本原因 3）を、権限設計・再検証手順の設計時に考慮する。回避策（例: 検証を外側セッションと分離した独立プロセス／環境で実行する手順）は検討・提示してよいが、安全分類器自体の変更は行わない（スコープ外）。
- **要件3（state スキーマへの issue 本文フィールド追加）**: `.agent-skill-chain/schemas/state.schema.yaml` に、Issue のタイトルおよび要求内容（本文）に相当するフィールドを追加する。追加は AGENTS.md §設定 が定めるスキーマ変更手順（`schema_version` の扱い・既定値・後方互換／migration の定義）に従う。既存の `state.yaml`（当該フィールドを持たないもの）が引き続き読める後方互換を保つこと（フィールドは任意、または migration により補完可能とする）。フィールドの具体名・必須性・`schema_version` を上げるか否かは DESIGN.md で確定してよいが、本 SPEC は「タイトル・要求内容を保持できる状態モデルにする」という振る舞い要件を定める。
- **要件4（issue start・関連スクリプトの対応）**: ローカルバックエンドで `issue start`（`src/commands/issue.ts` の `start` および `.agent-skill-chain/scripts/issue-start.sh`）が Issue のタイトル・要求内容を受け取り、`state.yaml` の要件3 で追加したフィールドへ永続化できるようにする。既存の引数体系との後方互換（新フィールド未指定でも従来通り動作する）を保つ。
- **要件5（ワーカーへの issue 本文供給経路）**: ローカルバックエンドで、要件3・4 で保持した Issue タイトル・要求内容が、ワーカー起動時のプロンプト（`segment start` が返す入力、または `launch_worker` が組み立てる起動コンテキスト）を通じてワーカーへ供給されるようにする。これにより、使い捨て issue が Issue 本文の人間による別途作り込みなしに、`issue start` へタイトル・要求内容を渡すだけで検証を開始できる状態にする。
- **要件6（launch_worker の実機完走）**: `worker.adapter: claude` 設定下・本物の `claude` CLI（headless・認証情報あり・CLI 利用可）・ローカルバックエンドの使い捨て issue（Issue 本文の人間作り込みなし）で `launch_worker <issue_id> <segment>` を 1 セグメント以上起動し、人間の追加入力・手動代行なしにワーカーが完了することを実測する。完了は、`launch_worker` が終了コード 0 で返り、`report latest` の直近レコードが `status=completed` かつ `target_sha` が push 済み HEAD と一致し、lease が解放された状態で判定する。実行ログ・report-status 記録を証跡として残す。
- **要件7（正常経路で human_required が誤発火しないこと／真の異常時は発火すること）**: 要件6 の正常経路の実行中、`launch_worker` のフェイルセーフ（`report_status blocked` の `human_escalation_requested` 扱い）が一度も発火しないことを実測する。あわせて、認証欠如または CLI 不在といった真の異常を注入した対照条件では `human_required` が引き続き正しく発火する（regression なし）ことを確認し、「正常経路では発火せず、真の異常時のみ発火する」ことを対照的に裏付ける。
- **要件8（既存テストスイートの維持）**: 本 Issue の全変更（権限モード設計の実装・state スキーマ拡張・issue start／ワーカー供給経路の変更・追加テスト）を反映した状態で、リポジトリのテストスイート全体（`npm test` 相当）が全て pass する（regression なし）。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える。

#### AC-1: launch_worker の既定起動系が自ブランチへの git push を非対話で人間介在なく実行できる

- Given: `worker.adapter: claude`・`WORKER_CMD` 未指定（既定起動系を用いる）状態
- When: `launch_worker` が起動したワーカーが自 branch への `git commit`／`git push` を非対話ヘッドレスで実行する
- Then: `git push` を含むワーカーの正規責務範囲の Bash 操作が人間の追加承認を要さずに完了し、`git push` 承認待ちに起因するフェイルセーフ（`report_status blocked`）が発火しないことを実測確認する（本 Issue 修正前は `acceptEdits` により `git push` で承認待ち停止していた）
- 検証方法見込み: `hybrid`（既定起動フラグ／権限機構の存在はコード・設定検査で自動化でき、非対話 `git push` の実挙動は本物の CLI 実行で確認するため）

#### AC-2: 権限設計が無制限 bypassPermissions の安易な既定化ではなく、ワーカー責務範囲に限定されている

- Given: 本 Issue で実装した `launch_worker` の権限モード設計（既定起動系および DESIGN.md で確定した実現方式）
- When: 既定起動系のフラグ・許可範囲・関連実装／設計文書を確認する
- Then: 既定が無制限な `--permission-mode bypassPermissions` を単純採用したものではなく、ワーカーの正規責務範囲（自 branch への commit/push・Draft PR 作成・テスト実行・report/lease 操作）へ限定する設計（allowlist・ラッパー／hook、または外側スコープ限定の根拠明記）になっており、自 branch 以外への書込みを許容しない（I5 整合）ことを確認する
- 検証方法見込み: `manual`（実現方式の限定性は設計判断とコードの照合による確認のため。DESIGN.md 確定内容と実装の整合を検証する）

#### AC-3: state.schema.yaml に issue タイトル・要求内容フィールドが追加されスキーマ検証を通る

- Given: 本 Issue で拡張した `.agent-skill-chain/schemas/state.schema.yaml`
- When: 当該スキーマと、タイトル・要求内容フィールドを含む `state.yaml` サンプルをスキーマバリデータ（`validateAgainstSchema('state', ...)` 相当）にかける
- Then: Issue のタイトル・要求内容に相当するフィールドがスキーマ上に定義され、当該フィールドを含む state が検証を通過することを実測確認する
- 検証方法見込み: `automated`（スキーマ定義・バリデーションの検査）

#### AC-4: issue start が issue タイトル・要求内容を state.yaml へ永続化する（後方互換あり）

- Given: `coordination.backend: local` の環境
- When: `issue start` にタイトル・要求内容を与えて Issue を起票し、生成された `state.yaml` を読む
- Then: 与えたタイトル・要求内容が `state.yaml` の要件3 で追加したフィールドへ永続化されていること、および当該フィールドを指定しない従来どおりの起票も引き続き成功する（後方互換）ことを実測確認する
- 検証方法見込み: `automated`（CLI 実行結果と生成ファイルの検査）

#### AC-5: 使い捨て issue が issue 本文の人間作り込みなしに検証を開始できる

- Given: ローカルバックエンドの使い捨て issue を、`issue start` へタイトル・要求内容を渡して起票した状態（人間が別途 Issue 本文を作り込んでいない）
- When: 当該 issue に対しワーカー起動プロンプト（`segment start` の返す入力、または `launch_worker` が組み立てる起動コンテキスト）を生成する
- Then: 起票時に渡したタイトル・要求内容がワーカーへ供給される入力に含まれ、ワーカーが「何を作るか」を Issue 本文の別途作り込みなしに把握できる状態であることを実測確認する
- 検証方法見込み: `hybrid`（供給経路の存在は自動テスト化でき、本物のワーカーが内容を受け取り着手できることは実機実行で確認するため）

#### AC-6: launch_worker が本物の claude CLI で 1 セグメントを人間介在なく完了させる

- Given: `worker.adapter: claude`・認証情報あり（`ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN`）・`claude` CLI 利用可・ローカルバックエンドの使い捨て issue（本文作り込みなし）という正常な前提
- When: `launch_worker <issue_id> <segment>` を 1 セグメント（spec/design/implementation/validation のいずれか）に対して起動し、人間の追加入力・手動代行を一切与えずに完了まで待つ
- Then: `launch_worker` が終了コード 0 で返り、`report latest <issue_id> <segment>` の直近レコードが `status=completed` かつ `target_sha` が push 済み HEAD と一致し、lease が解放されていることを実測確認する（本 Issue 修正前は `git push` 承認待ちにより未達であった）
- 検証方法見込み: `manual`（本物の `claude` CLI・認証情報を用いたライブ起動の一回性検証のため。手順・実行者・証跡は VALIDATION.md で確定する）

#### AC-7: launch_worker 完走の証跡（ログ・report-status 記録）が残る

- Given: AC-6 の実機起動
- When: `launch_worker` の実行ログと report-status の記録を採取する
- Then: 「人間介在なしに 1 セグメントが正常完了した（`report_status completed`・`target_sha` 一致）」ことを示す実行ログ・report-status 記録が VALIDATION.md に実測証跡として記載されることを確認する
- 検証方法見込み: `manual`（実機実行の証跡採取・記載のため）

#### AC-8: 正常経路で human_required が発生しない

- Given: AC-6 の正常経路（認証あり・CLI 利用可・issue 本文供給あり）の実機起動
- When: `launch_worker` の実行中および完了時の report-status 履歴を確認する
- Then: フェイルセーフ経路（`report_status blocked` の `human_escalation_requested` 扱い）が一度も発火していないこと（正常経路で `human_required` が誤発火していないこと）を実測確認する
- 検証方法見込み: `manual`（正常経路のライブ実行結果を確認するため）

#### AC-9: human_required は真の異常時のみ発火する（対照確認・regression なし）

- Given: 認証欠如（`ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` 未設定）または CLI 不在（`WORKER_CMD` 未設定かつ `claude` コマンド不在）を注入した対照条件
- When: 同条件で `launch_worker` を起動する
- Then: 当該異常条件では `report_status blocked`（`human_escalation_requested` 扱い）が発火し非ゼロ（≠3）で返ることを確認し、AC-8 の正常経路との対比により「正常経路では発火せず、真の異常時のみ発火する」ことが裏付けられること（権限モード変更による regression が無いこと）を実測確認する
- 検証方法見込み: `hybrid`（異常注入は `WORKER_CMD` モックや環境変数操作で自動テスト化でき、正常経路との対照は本物の CLI 実行を伴うため）

#### AC-10: 既存テストスイートが全て pass する（regression なし）

- Given: 本 Issue の全変更（権限モード設計の実装・state スキーマ拡張・issue start／ワーカー供給経路の変更・追加テスト）を反映した状態
- When: リポジトリのテストスイート全体（`npm test` 相当）を実行する
- Then: 既存テストが全て pass し、新規追加テスト（AC-3/AC-4/AC-9 の自動化部分等を追加した場合はそれも含む）も全て pass する（regression なし）ことを実測確認する
- 検証方法見込み: `automated`

## スコープ外

この Issue では対応しない事項を明記する。曖昧語・対象外欠落は仕様ゲートの反証観点で指摘される。

- **GitHub 側のライブ設定変更（ruleset／branch protection）**: `main`・統合ブランチの required check 機械強制は先行 Issue #180 で実施済み・完了済みであり、本 Issue では変更しない。
- **権限モード緩和と外側の安全分類器との衝突の根本解決**: 本文根本原因 3 の副次的現象について、権限設計・再検証手順の設計時に考慮し回避策の検討・提示はするが（要件2）、外側セッションの安全分類器自体の変更・無効化は行わない。
- **`worker.adapter` / `review.adapter` を本リポジトリの恒久的な既定値として `claude` へ確定する意思決定**: 本 Issue は再実機検証を成立させるための設定・実装と実測までを対象とし、恒久既定値化の判断は別途行う（先行 Issue #180 のスコープ外事項と整合）。
- **`codex` アダプタ（`.agent-skill-chain/adapters/codex.sh`）への同等の権限モード対応**: 本 Issue は `claude` アダプタ（`launch_worker`）の権限モード不足の解消を対象とする。他アダプタへの展開は対象外。
- **GitHub モードにおける Issue 本文取得経路の変更**: GitHub モードでは Issue 本文を GitHub API 経由で取得できるため、本 Issue が扱う「本文を運ぶフィールドの欠落」はローカルバックエンドの `state.schema.yaml` に固有の問題である。GitHub モードのワーカーへの本文供給経路の再設計は対象外。
- **`human_required` の 4 種の真の異常経路（認証欠如・CLI 不在・timeout・完了偽装検知）すべての網羅的な故障注入テストの新規整備**: 本 Issue は「正常経路で誤発火しない」ことの実測と、それを裏付けるための最小限の対照（認証欠如または CLI 不在の少なくとも 1 種）までを対象とする。
