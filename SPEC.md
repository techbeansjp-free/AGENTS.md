<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: agent-skill-chain — 完全自走の実効化: ruleset実適用・worker/review adapterのclaude切替実機検証

- Issue: `ISSUE-180`
- 作成者: `claude`
- 対象ブランチ: `feature/180-autonomous-execution`

## 目的・背景

このリポジトリ（`techbeansjp-free/AGENTS.md`）が目指す「完全自走（人間が介在しなくても、真に危険な場合以外は止まらない）」は、機構としては実装済みだが、ライブ環境で有効化・機械強制されていないため未達である。Issue #178 の独立検証（VALIDATION.md finding-3、AC-10）で以下 2 点が実測により判明した。

1. **ライブの GitHub 側でゲートが機械的に強制されていない**: ruleset が実リポジトリへ未適用（`gh api repos/techbeansjp-free/AGENTS.md/rulesets` が `[]`）で、`main` の branch protection の `required_status_checks.contexts` は `["self-enforce"]` のみ、統合ブランチ `chore/162-agent-skill-chain-bootstrap` は protection 未設定（404）。その結果、PR #179 では `verify` Check Run が FAILURE でも `mergeable: MERGEABLE` となり、failing check がマージをブロックしないことを実測確認済みである。正本 `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` は `spec/design/implementation/validation-gate` と `verify` を required に定めているが、実リポジトリへ適用されていない。

2. **自走アダプタ自体が有効化されていない**: `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.adapter` / `review.adapter` はいずれも `human` のままである。`.agent-skill-chain/adapters/claude.sh` の `launch_worker` / `launch_gate_reviewer` は `claude` headless 起動・lease 自動更新・timeout・完了検知・失敗時 `human_required` フェイルセーフまで Issue #166 で実装済みだが、このリポジトリ自身は Issue #164〜#178 まで一貫して人間（またはこのセッションの手動サブエージェント委譲）が各セグメントを代行しており、自走アダプタが本物の `claude` CLI に対して一度も実機検証されていない。

本 Issue は、既存機構を新規実装せず、（a）ライブの GitHub 側でゲートを機械強制する状態にし、（b）自走アダプタを本物の `claude` CLI で 1 セグメント以上人間介在なく完走させ、（c）その正常経路で `human_required` が誤発火しないことを、いずれも実機で実測確認することを目的とする。

## 用語

- **required check**: GitHub の branch protection / ruleset でマージ条件として必須指定された Check Run。未達の PR はマージ不可になる。本 Issue が実適用対象とするのは `agent-skill-chain/{spec,design,implementation,validation}-gate` と `verify`（`.agent-skill-chain/config/agent-skill-chain.yaml` の `checks` および CI job 名 `verify`）。
- **使い捨て検証（disposable verification）**: 検証専用に作成し、確認後にマージせず close・ブランチ削除する一回性のブランチ／PR。ライブの機械強制やダミー失敗の挙動を実測するために用い、成果物・履歴を `main`・統合ブランチへ混入させない。
- **launch_worker**: `.agent-skill-chain/adapters/claude.sh` のセグメント作業ワーカー起動関数。lease 取得 → `segment start`（role_contract 取得）→ ワーカー起動 → 完了確認（report-status 直近レコードの `status` と `target_sha` を push 済み HEAD と突合）→ lease 解放、の順で 1 セグメントを機械的に完走させる。
- **人間介在なしの完了**: launch_worker が起動したワーカーが、人間の追加入力・手動代行なしに `report_status completed`（`target_sha` = push 済み HEAD 一致）を記録し、launch_worker が終了コード 0 で lease を解放した状態。
- **human_required（誤発火）**: 認証あり・CLI 利用可という正常な前提のもとで、launch_worker のフェイルセーフ経路（`report_status blocked` の `human_escalation_requested` 扱い）や launch_gate_reviewer の `gate mark-human-required` が呼ばれてしまうこと。真の異常時（認証欠如・CLI 不在・timeout・完了偽装検知）以外での発火を指す。
- **統合ブランチ**: 本 Issue 群の base である `chore/162-agent-skill-chain-bootstrap`。`main` への最終マージ前に各 Issue の PR を集約するブランチ。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

Issue #180 本文（対象範囲 1〜3・成功基準）に基づく要求：

- ライブの GitHub 側で、`verify` および各 `agent-skill-chain/*-gate` Check Run が `main` および統合ブランチ双方で required check として機能し、failing check が実際にマージをブロックする状態にしたい。
- `worker.adapter` / `review.adapter` を `claude` へ切り替え、本物の `claude` CLI（headless・認証あり）で `launch_worker` を 1 セグメント以上、人間介在なく完走させ、証跡を残したい。
- 上記の正常経路の実行中に `human_required` が誤発火しないこと、および `human_required` が真の異常時のみ発火することを実測で裏付けたい。
- 上記の設定変更・検証後も、既存テストスイート（`chore/162-agent-skill-chain-bootstrap` 統合ブランチ上の全件）が引き続き全て pass する状態を維持したい。

### 要件

- **要件1（ruleset の実適用）**: `.agent-skill-chain/scripts/setup-ruleset.sh`（正本 `.agent-skill-chain/templates/github/provisioning/rulesets/main.json`）を `techbeansjp-free/AGENTS.md` へ実際に適用し、ruleset `main-protection` が `enforcement: active` で存在する状態にする。適用後の ruleset の `required_status_checks` に `agent-skill-chain/spec-gate`・`agent-skill-chain/design-gate`・`agent-skill-chain/implementation-gate`・`agent-skill-chain/validation-gate`・`verify` が含まれること。
- **要件2（main および統合ブランチ双方での機械強制）**: `main` と統合ブランチ `chore/162-agent-skill-chain-bootstrap` の双方で、required check 未達の PR がマージ不可になる状態にする。正本 ruleset の `conditions.ref_name.include` は現状 `refs/heads/main` のみを対象とするため、統合ブランチにも同等の required check を機能させる実現方式（ruleset の対象 ref 拡張、統合ブランチへの branch protection 併用、その他）は設計フェーズ（DESIGN.md）で確定する。本 SPEC は「双方で required check が機能する」という振る舞い要件のみを定める。
- **要件3（failing check がマージをブロックすることの実機確認）**: 使い捨てブランチ・PR を作成し、`verify` または `agent-skill-chain/*-gate` の少なくとも 1 つが意図的に failure（または未達）となる状態で、当該 PR が required check 未達によりマージ不可になることを、GitHub API（`gh pr view --json mergeable,statusCheckRollup` 等）で実測する。検証後、この使い捨て PR・ブランチはマージせず close・削除し、`main`・統合ブランチへ混入させない。
- **要件4（worker/review adapter の claude 切替）**: `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.adapter` と `review.adapter` を `human` から `claude` へ変更する。恒久既定値とするかの意思決定は対象外（本 Issue の実機検証結果を踏まえ別途判断）だが、実機検証を成立させるための設定変更自体は本 Issue のスコープ内とする。
- **要件5（launch_worker の実機完走）**: `worker.adapter: claude` 設定下で、本物の `claude` CLI（headless・認証情報あり・CLI 利用可）を実行系として `launch_worker <issue_id> <segment>` を 1 セグメント以上起動し、人間の追加入力・手動代行なしにワーカーが完了することを実測する。完了は、launch_worker が終了コード 0 で返り、`report latest` の直近レコードが `status=completed` かつ `target_sha` が push 済み HEAD と一致し、lease が解放された状態で判定する。実行ログ・report-status 記録を証跡として残す。
- **要件6（正常経路で human_required が誤発火しないこと）**: 要件5 の正常経路の実行中、launch_worker のフェイルセーフ（`report_status blocked` の `human_escalation_requested` 扱い）および（review 検証を行う場合は）launch_gate_reviewer の `gate mark-human-required` が一度も発火しないことを実測する。あわせて、認証欠如または CLI 不在といった真の異常を注入した対照条件では `human_required` が正しく発火することを確認し、「正常経路では発火せず、真の異常時のみ発火する」ことを対照的に裏付ける。
- **要件7（既存テストスイートの維持）**: 本 Issue の全変更（config の adapter 切替・検証手順・ruleset 適用に伴うリポジトリ側変更）を反映した状態で、リポジトリのテストスイート全体（`npm test` 相当）が全て pass する（regression なし）。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える。

#### AC-1: ruleset `main-protection` が実リポジトリへ適用され active である

- Given: `.agent-skill-chain/scripts/setup-ruleset.sh`（正本 `.agent-skill-chain/templates/github/provisioning/rulesets/main.json`）を `techbeansjp-free/AGENTS.md` へ適用した後の状態
- When: `gh api repos/techbeansjp-free/AGENTS.md/rulesets` を実行する
- Then: 返却が空配列（`[]`）ではなく、ruleset `main-protection` が `enforcement: active` で存在することを実測確認する（現状は `[]` であることを確認済み）
- 検証方法見込み: `manual`（実リポジトリの ruleset 適用結果を GitHub API で実機確認する一回性手順のため。手順・実行者・証跡は VALIDATION.md で確定する）

#### AC-2: 適用された ruleset の required_status_checks に想定 Check Run が含まれる

- Given: AC-1 で適用済みの ruleset `main-protection`
- When: 当該 ruleset の `required_status_checks` を GitHub API で取得する
- Then: `agent-skill-chain/spec-gate`・`agent-skill-chain/design-gate`・`agent-skill-chain/implementation-gate`・`agent-skill-chain/validation-gate`・`verify` の 5 コンテキストがすべて required として含まれることを実測確認する
- 検証方法見込み: `manual`（ライブ ruleset の内容を GitHub API で照合する実機確認のため）

#### AC-3: main および統合ブランチ双方で required check が機械強制される

- Given: 要件2 の実現方式（ruleset 対象 ref 拡張または統合ブランチへの branch protection 併用等、DESIGN.md で確定）を適用した状態
- When: `main` と `chore/162-agent-skill-chain-bootstrap` それぞれを base とする PR の保護状態を GitHub API（`gh api .../rulesets`・`.../branches/<branch>/protection`・PR の `statusCheckRollup` 等）で確認する
- Then: 双方のブランチで、required check 未達の PR がマージ不可になる状態であることを実測確認する（統合ブランチが現状 protection 未設定＝404 である状態が解消されていること）
- 検証方法見込み: `manual`（両ブランチのライブ保護状態を GitHub API で実機確認するため）

#### AC-4: 使い捨て PR で failing required check が実際にマージをブロックする

- Given: `verify` または `agent-skill-chain/*-gate` の少なくとも 1 つが意図的に failure（または未達）となる差分を含む使い捨てブランチ・PR
- When: 当該 PR に対して `gh pr view --json mergeable,statusCheckRollup` 等でマージ可否を取得する
- Then: `mergeable` が `MERGEABLE` ではない（required check 未達により BLOCKED / マージ不可）ことを実測確認する（現状は failing check でも `MERGEABLE` であることを確認済み）。検証後、この使い捨て PR・ブランチはマージせず close・削除し、`main`・統合ブランチへ混入させない
- 検証方法見込み: `manual`（ライブ PR を作成してマージ可否を実機確認し、後始末する一回性手順のため）

#### AC-5: worker.adapter・review.adapter が claude へ切り替わっている

- Given: `.agent-skill-chain/config/agent-skill-chain.yaml`
- When: `worker.adapter` と `review.adapter` の値を確認する
- Then: 双方が `claude` であることを確認する（実機検証を成立させるための設定変更が反映されていること）
- 検証方法見込み: `automated`（設定ファイルの値検査）

> **注記（AC-6・AC-7・AC-8 の実行結果）**: 以下の AC-6・AC-7・AC-8 は、本 Issue #180 の実行結果としては **FAIL（未達成）** である。定義はそのまま残す（実測結果・追跡可能性 I1 を保つため）。未達成の事実・根本原因・本 Issue のスコープにおける「完了」の意味・恒久解消を引き継ぐ後継 Issue #183 は、本 SPEC 後半の「既知の未達成事項（本 Issue #180 の実行結果）」節に自己完結して記載する。

#### AC-6: launch_worker が本物の claude CLI で 1 セグメントを人間介在なく完了させる

- Given: `worker.adapter: claude` 設定・認証情報あり（`ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN`）・`claude` CLI 利用可という正常な前提
- When: `.agent-skill-chain/adapters/claude.sh` の `launch_worker <issue_id> <segment>` を 1 セグメント（spec/design/implementation/validation のいずれか）に対して起動し、人間の追加入力・手動代行を一切与えずに完了まで待つ
- Then: launch_worker が終了コード 0 で返り、`report latest <issue_id> <segment>` の直近レコードが `status=completed` かつ `target_sha` が push 済み HEAD と一致し、lease が解放されていることを実測確認する
- 検証方法見込み: `manual`（本物の claude CLI・認証情報を用いたライブ起動の一回性検証のため。手順・実行者・証跡は VALIDATION.md で確定する）

#### AC-7: launch_worker 完走の証跡（ログ・report-status 記録）が残る

- Given: AC-6 の実機起動
- When: launch_worker の実行ログと report-status の記録を採取する
- Then: 「人間介在なしに 1 セグメントが正常完了した」ことを示す実行ログ・report-status 記録が VALIDATION.md に実測証跡として記載されることを確認する
- 検証方法見込み: `manual`（実機実行の証跡採取・記載のため）

#### AC-8: 正常経路で human_required が発生しない

- Given: AC-6 の正常経路（認証あり・CLI 利用可）の実機起動
- When: launch_worker の実行中および完了時の report-status 履歴・gate-report を確認する
- Then: フェイルセーフ経路（`report_status blocked` の `human_escalation_requested` 扱い、および review 検証を行う場合は launch_gate_reviewer の `gate mark-human-required`）が一度も発火していないこと（正常経路で `human_required` が誤発火していないこと）を実測確認する
- 検証方法見込み: `manual`（正常経路のライブ実行結果を確認するため）

#### AC-9: human_required は真の異常時のみ発火する（対照確認）

- Given: 認証欠如（`ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` 未設定）または CLI 不在（`WORKER_CMD` 未設定かつ `claude` コマンド不在）を注入した対照条件
- When: 同条件で launch_worker を起動する
- Then: 当該異常条件では `report_status blocked`（human_escalation_requested 扱い）が発火し非ゼロ（≠3）で返ることを確認し、AC-8 の正常経路との対比により「正常経路では発火せず、真の異常時のみ発火する」ことが裏付けられることを実測確認する
- 検証方法見込み: `hybrid`（異常注入は `WORKER_CMD` モックや環境変数操作で自動テスト化できる一方、正常経路との対照は本物の CLI 実行を伴うため）

#### AC-10: 既存テストスイートが全て pass する（regression なし）

- Given: 本 Issue の全変更（config の adapter 切替を含む）を `chore/162-agent-skill-chain-bootstrap` 統合ブランチ上へ反映した状態
- When: リポジトリのテストスイート全体（`npm test` 相当）を実行する
- Then: 既存テストが全て pass し、新規追加テスト（AC-9 の異常注入テスト等を追加した場合はそれも含む）も全て pass する（regression なし）ことを実測確認する
- 検証方法見込み: `automated`

## 既知の未達成事項（本 Issue #180 の実行結果）

独立検証（VALIDATION.md、AC-1〜AC-10 の再実測）の結果、**AC-6・AC-7・AC-8 は本 Issue #180 の実行結果として FAIL（未達成）** で確定した。要旨を以下に自己完結して記す（外部ファイル参照だけで意味を委譲しない。詳細な実測手順・証跡は VALIDATION.md、恒久修正の対象範囲・成功基準は Issue #183 が正本）。

- **何が未達成か**: 本物の `claude` CLI（headless・認証あり・CLI 利用可という正常な前提）で `launch_worker` を 1 セグメント人間介在なく完走させること（AC-6）、その正常完走の証跡を残すこと（AC-7）、正常経路で `human_required` が発火しないこと（AC-8）の 3 点。実機検証を複数回試みたが達成できなかった。
- **根本原因（認証・CLI 可用性ではない）**: (1) `launch_worker` の既定 `WORKER_CMD`（`claude -p --output-format text --permission-mode acceptEdits`）の `acceptEdits` は、ファイル編集ツールは自動承認するが、`git push` 等の Bash／ネットワーク操作を非対話ヘッドレス実行では自動承認しない。このため spec worker は `SPEC.md` 作成・`git commit` までは無介在で進むが、`git push` で承認待ちのまま停止し、`launch_worker` が完了未検知としてフェイルセーフ（`report_status blocked` の `human_escalation_requested` 扱い、終了コード 2）へ倒れた。正常経路でのこの発火が AC-8 の観点では「誤発火」に該当し、完走（AC-6）・完走証跡（AC-7）も成立しない。(2) 併せて、ローカルバックエンドの状態スキーマ（`.agent-skill-chain/schemas/state.schema.yaml`）に issue のタイトル・要求内容に相当するフィールドが無く、使い捨て issue での実機検証時に issue 本文を人間が作り込む必要があった点も一因である。なお、フェイルセーフ機構自体は「`git push` 続行不能」という実ブロッカーに対して正しく安全側へ倒れており、機構の欠陥ではない。
- **本 Issue #180 のスコープにおける「完了」の意味**: 本 Issue の完了は、(a) ライブの GitHub でゲートを機械強制する状態（AC-1〜AC-4）を達成したこと、および (b) 自走アダプタの現状の実効性を本物の CLI で実機検証し明らかにしたこと（AC-6/AC-7/AC-8 の**未達成という事実の確定**を含む）を指す。**AC-6/AC-7/AC-8 の "達成" そのものは本 Issue #180 の完了条件ではない。** これらの恒久的な達成は後継 Issue #183 の完了条件とする。
- **恒久解消の切り出し先（Issue #183）**: 上記根本原因の恒久解消——(1) `launch_worker` がワーカーの正規責務範囲（自ブランチへの `git push`・Draft PR 作成）を人間の追加承認なく実行できる権限モード・起動フラグの設計・実装（無制限な `bypassPermissions` を安易に採用しない責務限定設計）、(2) `state.schema.yaml` への issue タイトル・要求内容フィールドの追加、および (3) その対応後の AC-6・AC-7・AC-8 相当の再実機検証——は、ユーザー決定により本 Issue #180 のスコープ外とし、後継 **Issue #183**（`agent-skill-chain — launch_workerの権限モード不足解消・ローカルバックエンドissue本文スキーマ拡張`）へ切り出し済みである。

AC-6/AC-7/AC-8 の AC 番号・定義・検証記録（VALIDATION.md の `result: fail`）は追跡可能性（I1）のため削除せず、FAIL という結果ごと残す。

## スコープ外

この Issue では対応しない事項を明記する。曖昧語・対象外欠落は仕様ゲートの反証観点で指摘される。

- **AC-6・AC-7・AC-8 の "達成" そのもの**（本物の `claude` CLI での `launch_worker` 人間介在なし完走、その完走証跡、正常経路での `human_required` 不発火）。本 Issue #180 のスコープにおける「完了」は、前節「既知の未達成事項」のとおり、ライブ GitHub でのゲート機械強制（AC-1〜AC-4）の達成と、自走アダプタの現状の実効性を実機検証で明らかにしたこと（AC-6/AC-7/AC-8 の未達成という事実の確定を含む）までであり、AC-6/AC-7/AC-8 の達成は本 Issue の完了条件に含めない。その恒久解消（権限モード設計・ローカルバックエンドの状態スキーマ拡張・再実機検証）は後継 **Issue #183** で行う。

- `worker.adapter` / `review.adapter` を本リポジトリの恒久的な既定値として `claude` へ変更するかどうかの意思決定。本 Issue の実機検証結果を踏まえ別途判断する（本 Issue では検証を成立させるための設定変更と実測までを対象とする）。
- Issue #178 で見送った他の未決事項、すなわち lint-vocab の CLI サブコマンド文脈判定の抜け穴、および ADR finalize の正規手順未経由。これらは本 Issue の対象外。
- `launch_worker` が既定で用いる `claude` CLI の正確な起動フラグ（`--permission-mode` 等）の恒久確定。`WORKER_CMD` による完全上書きが可能なため、実機検証はこの確定の遅延に影響されない。フラグの最終確定は別途行う。
- 過去 commit に既に混入している可能性のある状態の遡及監査・修正。本 Issue はライブ設定の実適用と自走アダプタの実機検証のみを対象とし、履歴の遡及監査は行わない。
- `human_required` の 4 種の真の異常経路（認証欠如・CLI 不在・timeout・完了偽装検知）すべての網羅的な故障注入テストの新規整備。本 Issue は「正常経路で誤発火しない」ことの実測と、それを裏付けるための最小限の対照（認証欠如または CLI 不在の少なくとも 1 種）までを対象とする。
