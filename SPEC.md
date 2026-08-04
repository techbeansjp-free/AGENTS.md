# SPEC: bugfix: 期限切れ+credential紛失writer leaseを人間が回収するための正規CLI経路が無い

- Issue: `ISSUE-441`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/441-lease-reclaim-cli`

## 目的・背景

Issue #286（クローズ済み、ADR-0014）で「同一Issue・同一worktree・同一holder runの期限切れlease」の安全な再開（resume）は実装済みである。`lease resume` は同一holder credentialかつ同一worktreeがdirtyであることを検査した上でのみ、object ID比較更新でrefを移譲する。検査が一致しない場合（他holder、credential紛失、worktree不一致等）は、意図的に自動移譲せず `human_required` として停止する設計になっている。

しかし、この `human_required` に倒れた後、**人間（進行役）が実際に当該leaseを回収するための正規CLIコマンドが存在しない**。既存の `lease acquire` はrefが既に存在する限り（期限切れでも）non-fast-forwardとして拒否し、`lease resume` はcredential一致が前提で別workerへの引き継ぎには使えず、`lease release` もcredential一致（またはtoken入力）を要求するため元workerのcredentialファイル（`.git/agent-skill-chain/lease-credentials/<issue>.yaml`）が既に失われている場合は実行不能である。

2026-08-04、本リポジトリ自身でIssue #437のimplementationセグメントworkerを再起動しようとした際にこの状況へ実際に遭遇し、進行役は `git push origin --delete refs/agent-skill-chain/leases/<issue>-<segment>` という低レベルなgit操作を手動で行うしかなかった。これは本来ツールが抽象化すべき調整状態（coordination state）への直接操作であり、事故時の安全弁としては粗すぎ、誰が・いつ・なぜ回収したかの証跡も残らない。

本Issueは、`human_required` 状態からの正規の人間向け回収経路をCLIコマンドとして新設し、期限切れであることの機械的な確認と回収証跡の記録を伴った安全なlease ref削除・再取得可能化を実現する。

## 要求 → 要件 → 受入条件

### 要求

進行役は、`human_required` へ倒れた期限切れwriter leaseを、低レベルなgit ref操作に頼らずCLI経由で安全に回収できなければならない。回収操作は誰が・いつ・どのIssue/segmentを回収したかの証跡を残さなければならない。

### 要件

- 対象leaseが実際に期限切れ（`expires_at <= 現在時刻`）であることを検査してから削除を実行すること。期限内のleaseは回収を拒否すること。
- 回収操作の呼び出しが進行役の操作であること（対象leaseのwriter credentialを保有・提示する操作ではないこと）をコマンドの用途・出力上区別できること（AGENTS.md I5：進行役は成果物branchへのcommit禁止、調整状態のみを扱う）。
- 回収は明示的なオプトイン操作であること（誤操作防止のため、確認フラグなしの実行では回収しないこと）。
- 回収操作の証跡（誰が・いつ・どのIssue/segmentのleaseを・どのholderから回収したか）をIssueコメント等、Coordination Backend上の記録として残すこと。
- 回収後、当該Issue/segmentに対して新たなwriter leaseを `lease acquire` で取得可能な状態になること。
- 回収対象のref検査からref削除までの間に当該leaseが更新された場合（対象workerがresume/renewに成功した場合等）、回収を行わず安全側で停止すること。

### 受入条件（Acceptance Criteria）

#### AC-1: 期限切れleaseを進行役が回収できる

- Given: 対象Issue・segmentに `expires_at` が現在時刻より過去のwriter leaseが存在する
- When: 進行役が回収コマンドを明示的な確認オプション付きで実行する
- Then: 対象leaseのrefが削除され、コマンドは終了コード0で成功を報告する
- 検証方法見込み: `automated`

#### AC-2: 期限内のleaseは回収できない

- Given: 対象Issue・segmentに `expires_at` が現在時刻より未来のwriter leaseが存在する
- When: 進行役が回収コマンドを実行する
- Then: 回収は実行されず、refは変更されないままコマンドは終了コード1以上で失敗を報告する
- 検証方法見込み: `automated`

#### AC-3: 確認オプションなしでは回収されない

- Given: 対象Issue・segmentに期限切れのwriter leaseが存在する
- When: 進行役が明示的な確認オプションを付けずに回収コマンドを実行する
- Then: 回収は実行されず、refは変更されないままコマンドは終了コード1以上で失敗を報告し、確認オプションを付けて再実行するよう促すメッセージを表示する
- 検証方法見込み: `automated`

#### AC-4: 回収証跡がCoordination Backendに記録される

- Given: 期限切れleaseの回収がAC-1の手順で成功する
- When: 回収完了後にIssueのコメント履歴を確認する
- Then: 回収を行った主体・回収日時・対象Issue/segment・回収前のholderを含むコメントが追加されている
- 検証方法見込み: `automated`

#### AC-5: 検査後にrefが更新された場合は回収せず安全側で停止する

- Given: 回収コマンドが対象leaseの期限切れを検査した直後に、対象leaseのholderが `lease resume` 等でrefを更新する
- When: 回収コマンドが検査済みSHAを条件にref削除を試みる
- Then: 削除は拒否され、更新後のrefはそのまま残り、コマンドは終了コード1以上で失敗を報告する
- 検証方法見込み: `automated`

#### AC-6: 回収後は新規lease取得が可能になる

- Given: AC-1の手順で対象Issue・segmentのleaseが回収済みである
- When: 任意のworkerが同一Issue・segmentに対して `lease acquire` を実行する
- Then: 既存refとの競合なく新規writer leaseが取得できる
- 検証方法見込み: `automated`

#### AC-7: writer credentialを保有していない回収操作でも成立する

- Given: 対象leaseの元workerが作成したcredentialファイル（`.git/agent-skill-chain/lease-credentials/` 配下、対象Issue名を含むファイル名）が存在しない、または元workerのholder識別情報と一致しない
- When: 進行役が回収コマンドを実行する
- Then: writer credentialの一致検査を経ずに、期限切れ検査と確認オプションのみを条件として回収が成立する
- 検証方法見込み: `automated`

## スコープ外

- 期限内のdirty leaseを他workerへ強制移譲する機能（Issue #286・ADR-0014で意図的に `human_required` としている挙動を変更すること）。
- `lease resume`・`lease release`・`lease acquire` 既存コマンドの検査ロジック自体の変更。
- reconcileワークフロー（自動照合）による期限切れleaseの自動回収。本Issueが新設するのは人間（進行役）が明示的に実行するコマンドであり、自動化は対象外。
- Issue #442（worker-launch worktree特定不備）で指摘されている、worker-launchが対象worktreeを特定できない問題への対応。
- 回収コマンドの呼び出し主体が真に進行役であることをcredential・権限分離の仕組みで機械的に強制する実装（role capability・credential分離自体の再設計）。現時点ではコマンドの用途上の区別（AC-1〜AC-7）に留める。
