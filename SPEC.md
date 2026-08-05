# SPEC: bugfix: worker-launchが対象issueの専用worktreeへcdせず、複数worktree並存時に対象を特定できない

- Issue: `ISSUE-442`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/442-worker-launch-worktree-cd`

## 目的・背景

進行役が `.agent-skill-chain/scripts/worker-launch.sh`（issue_id・segment名を引数に指定）でセグメント作業ワーカーを起動する際、起動系（`worker-launch.sh` および `.agent-skill-chain/adapters/claude.sh` の `launch_worker`）は、対象issue専用のworktreeパスをissue_idから解決してcdする処理を持たない。`REPO_ROOT` は自身の `BASH_SOURCE`（呼び出しに使われたスクリプトファイルのパス）から解決されるだけであり、`segment start` が返すrole_contract（`.agent-skill-chain/config/roles.yaml` の静的な内容）にも対象worktreeパスやissue番号は含まれない（GitHubモードでは `issueBlock` すら付与されない）。結果として、ワーカープロセスの実行コンテキストは「呼び出し元のプロセスがたまたまどのディレクトリにいたか」に依存し、対象issueのworktreeへの到達は暗黙の前提でしかない。

2026-08-04、本リポジトリ自身でIssue #437のimplementationセグメントworkerを起動した際、main worktree（複数issueのworktreeが見える場所）でworkerが起動し、対象を一意特定できずに変更を一切加えず終了する事象が実際に発生した。このとき同一リポジトリ内にIssue #437用worktreeと、着手保留中のIssue #429用worktreeが並存していた。

2026-08-05、本Issueの調査過程で、進行役自身がIssue #446のdesign workerをmain worktree直下から `worker-launch.sh` の絶対パス経由で起動した際に同種の事象が再現した。ワーカーはSPEC.md等を発見できず「対象を一意に特定できない」として`blocked`終了し、さらに `launch_worker` の完了確認処理（`.agent-skill-chain/adapters/claude.sh`）がworker報告の `target_sha` と突合する「現在HEAD」を、実行プロセスのcwd起点で `git rev-parse HEAD` により取得していたため、報告された `target_sha` が対象issueブランチのHEADと一致せず（実行環境のHEADがmainのHEADになっていた）フェイルセーフが誤発動した。worktree配下のスクリプトコピーへ切り替えて起動し直したところ正常に対象を特定できた。単一issueのworktreeしか存在しない状況では気づかれにくい潜在バグであり、複数issueが並行進行中の運用では頻発しうる。

なお、Issue #446で発見・修正済みの根本原因（`src/commands/segment.ts` の `repoRoot()` がlinked worktreeを常にmain worktreeへ正規化する設計により、TypeScript側のブランチ解決がmainへ誤解決していた問題）とは発生機構が異なる。本Issueが対象とするのは、シェルレベルの起動系（`worker-launch.sh`・`launch_worker`）が対象worktreeを解決・cdせず、かつ完了確認の「現在HEAD」検査も対象worktree基準になっていない問題である。症状（対象を取り違える／特定できない）は同型だが、修正対象のコードレイヤーが異なる。

## 要求 → 要件 → 受入条件

### 要求

進行役が `worker-launch.sh`（issue_id・segment名を引数に指定）をどのカレントディレクトリ・どの呼び出し経路（絶対パス経由を含む）から実行しても、起動されるセグメント作業ワーカーのプロセスは必ず対象issue専用のworktreeを操作対象として動作しなければならない。複数のissue用worktreeが同時に存在する状況でも、対象issueを取り違えたり、対象を特定できずに誤ってblocked終了したりしてはならない。

### 要件

- 起動系は、呼び出し元のカレントディレクトリや自身のスクリプトパス（`BASH_SOURCE`）に依存せず、issue_idから対象issue専用のworktreeパスを一意に解決すること。
- 起動されるワーカープロセスの実行コンテキスト（ファイルの読み書き対象、commit/push対象branch）は、解決された対象issue専用worktreeと一致すること。
- 対象issueのworktreeが一意に解決できない場合（該当worktreeが存在しない、命名規則上複数該当する等）は、ワーカーを起動する前に安全側で停止し、0以外の終了コードでエラーを報告すること（正常起動やlease取得成功を装ってはならない。AGENTS.md I8）。
- 複数のissue用worktreeが並存する状態でも、上記の解決・起動が対象issueを取り違えないこと。
- ワーカー完了確認（`launch_worker` が行う、worker報告の `target_sha` と「現在HEAD」の突合）は、対象issue専用worktreeのHEADを基準に行うこと。呼び出し元プロセスのカレントディレクトリがたまたま指していた別worktreeのHEADと誤って比較し、正当な完了報告をフェイルセーフ誤発動で拒否してはならない。

### 受入条件（Acceptance Criteria）

#### AC-1: 単一worktree環境で対象issue専用worktreeへ向けて起動される

- Given: 対象issue用のworktreeが1つだけ存在する
- When: 進行役が任意のカレントディレクトリから `worker-launch.sh`（対象issueのissue_id・segment名を指定）を実行する
- Then: 起動されたワーカーは対象issue専用worktree内のファイル（SPEC.md等）を読み書き対象として動作し、対象issueのbranchへcommit/pushする
- 検証方法見込み: `automated`

#### AC-2: 複数worktree並存環境でも対象issueを取り違えない

- Given: 対象issue用worktreeと、少なくとも1つの別issue用worktreeが同時に存在する（本Issue起票時に実際に発生した状況と同型）
- When: 進行役がmain worktreeのカレントディレクトリから、またはmain worktree配下の絶対パス指定で `worker-launch.sh`（対象issueのissue_id・segment名を指定）を実行する
- Then: 起動されたワーカーは対象issueのworktreeを一意に特定し、他issue用worktreeの内容と混同せずに対象issue専用worktree内で動作する
- 検証方法見込み: `automated`

#### AC-3: 呼び出し元のスクリプトパス・カレントディレクトリに依存せず対象worktreeが解決される

- Given: 進行役が対象issue専用worktree以外の場所（main worktreeの絶対パス経由等）から `worker-launch.sh` を呼び出す
- When: `worker-launch.sh` が対象issueのworktreeを解決する
- Then: 解決結果は、呼び出しに使ったスクリプトパスやカレントディレクトリに関わらず、issue_idから一意に導かれる対象issue専用worktreeと一致する
- 検証方法見込み: `automated`

#### AC-4: 対象worktreeが一意に解決できない場合は起動前に安全側で停止する

- Given: issue_idに対応するworktreeが存在しない、または命名規則上複数該当し一意に解決できない
- When: 進行役が `worker-launch.sh`（存在しない、または一意に定まらないissue_idを指定）を実行する
- Then: ワーカーは起動されず、コマンドは0以外の終了コードでエラーを報告する。この時点でwriter leaseがまだ取得されていない場合は取得も行わない
- 検証方法見込み: `automated`

#### AC-5: ワーカー完了確認が対象worktree基準のHEADで行われる

- Given: ワーカーが対象issue専用worktree内で作業を完了し、checkpointをpush済みである
- When: `launch_worker` が完了確認のため、worker報告の `target_sha` と「現在HEAD」を突合する
- Then: 突合対象の「現在HEAD」は対象issue専用worktreeのHEADであり、他のworktree（呼び出し元プロセスのカレントディレクトリがたまたま指していたworktree等）のHEADと誤って比較されず、正当な完了報告が誤ってblocked扱いされない
- 検証方法見込み: `automated`

## スコープ外

- Issue #446（resumeしたworkerがPR/Issueレビューフィードバックを参照せず静的checklistで完了自己判定する問題）。既にPR #447で対応・マージ済み。
- Issue #441（期限切れ+credential紛失writer leaseを人間が回収するための正規CLI経路）。既にPR #445で対応・マージ済み。
- `src/commands/segment.ts` 等TypeScript側の `repoRoot()`/`worktreeRoot()` 使い分け（Issue #446のPR #447 commit `8a689557`で対応済み）の再修正。本Issueが対象とするのはシェルレベルの起動系（`worker-launch.sh`・`.agent-skill-chain/adapters/claude.sh` の `launch_worker`）における対象worktree解決・完了確認である。
- role_contract（`.agent-skill-chain/config/roles.yaml`）自体の内容再設計（GitHubモードで `issueBlock` 相当の情報を一律追加するかどうか等）。対象worktreeの解決・起動コンテキストの一致・完了確認という振る舞い要件さえ満たせば、実現手段（cd、role_contractへの情報埋め込み、その他）の選択は設計セグメントの裁量とする。
- read-onlyのゲートレビュア起動経路（`launch_gate_reviewer` 等）における同種の対象特定問題。read-onlyレビュアはclone・target_shaベースの別機構で動作しており、本Issueが対象とする書込み系ワーカーのworktree特定問題とは分離する。設計・実装セグメントで同種の `repoRoot`/`worktreeRoot` 誤用が他の呼び出し箇所に潜んでいないか横断的に確認することは妨げないが、本SPECの受入条件はworker-launch経路に限定する。
