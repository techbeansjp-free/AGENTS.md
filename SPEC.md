<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: agent-skill-chain — writer leaseの真の原子性強化・.worktrees未gitignore・gate-report digest不一致検知漏れ

- Issue: `ISSUE-176`
- 作成者: `claude`
- 対象ブランチ: `feature/176-lease-atomicity`

## 目的・背景

実装チェックリストとのギャップ分析の残課題のうち、writer leaseの排他制御の堅牢性に関わるものをまとめて対応する。対象は独立した4件（相互依存なし、変更規模が小さいためのバッチ化）。

1. **writer leaseの真の原子性強化**（第13.2章）: `src/lib/github-lease.ts`のGitHubモードは「投稿前に既存アクティブleaseの有無を確認し、投稿後に競合有無を再確認する」楽観的排他制御（`acquire()`内、`postLeaseComment`後の`rivals`再確認ロジック）で近似しており、コード内コメントに「真の原子性は保証しない」と明記されている。2プロセスがほぼ同時に`activeLeaseFor`の確認をパスしてから投稿する場合、投稿タイムスタンプの分解能・GitHub API応答順序に依存するTOCTOUウィンドウが残る。ローカルモード（`src/commands/lease.ts`の`acquire()`）も`tryReadYamlFile`（存在確認）→`writeYamlFileAtomic`（tmp+rename）という read-check-then-write であり、`writeYamlFileAtomic`はファイル内容の書込み自体は原子的だが「既存ファイルが無い場合のみ書く」という compare-and-swap ではないため、2プロセスが共に「既存lease無し」を確認した直後に両者が書き込むと後勝ちで前者のlease保持を無言のまま奪う（局所TOCTOU）。
2. **main worktreeが`.worktrees/`未gitignore登録により常時dirty表示される**（Issue #174のdoctor拡張検証で発見）: AGENTS.mdは`.worktrees/`をroot直下の正規ディレクトリと位置づけるが`.gitignore`に未登録のため、worktreeが1つも無くても`.worktrees/`という空の親ディレクトリ自体がuntracked表示され、`git status`が常時dirtyになる。
3. **`verify gate-report`が削除済み成果物のdigest不一致を検知しない**: `src/commands/verify.ts`の`gateReport()`は`if (fs.existsSync(abs) && digestOfFile(abs) !== artifact.digest) {...}`という実装であり、`fs.existsSync(abs)`がfalse（承認後にファイルが削除された）の場合は条件全体がfalseになり一致検査自体がスキップされる。承認済み成果物が削除された状態でも`verify gate-report`は成功してしまい、AGENTS.md「ゲートの継承・無効化」が求める「digest不一致（この場合は削除）→ゲート無効化」の前提が崩れる。
4. **lease renewのバックエンド間非対称性**: `src/commands/lease.ts`の`renew()`はGitHubモードで`held.lease.writer_lease.expires_at <= now.toISOString()`を検査し期限切れなら`fail`するが、ローカルモード分岐（同関数内の`if (config.coordination.backend === 'local') {...}`）にはこの期限切れチェックが無く、token一致さえすれば期限切れ後でも無条件にrenewが成功し期限切れleaseを復活させてしまう。両バックエンドで意図的な差異が無いにもかかわらず挙動が異なる。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

Issue #176本文（対象範囲1〜4・成功基準）に基づく要求：

- GitHubモードのwriter lease取得について、並行acquireで二重取得が発生しないことを実際に競わせて確認できる、真に原子的（またはそれに準ずる、TOCTOUウィンドウを実質排除する）機構にしたい。
- ローカルモードのwriter lease取得についても、同様に並行acquireで二重取得が発生しない機構にしたい。
- このリポジトリのmain worktreeが、worktreeが1つも存在しない状態で`git status`上clean（untracked表示無し）になるようにしたい。
- `verify gate-report`が、承認済み成果物が削除された場合を確実にdigest不一致として検知するようにしたい。
- lease renewのバックエンド間非対称性を解消し、期限切れleaseの復活をどちらのバックエンドでも一貫して拒否したい。
- 上記変更後も既存テストスイート（371件超）が統合ブランチ`chore/162-agent-skill-chain-bootstrap`上で全てpassする状態を維持したい。

### 要件

- **要件1（GitHubモードのlease原子性）**: GitHubモードのwriter lease取得・解放を、真に原子的な比較更新（compare-and-set）プリミティブに置き換える。技術検討の結果、gitのref更新はGitHub上でも真のcompare-and-swap保証を持つことを確認した（下記「技術検討: gitのref-based lock機構」参照）。設計フェーズでは、この保証を活かす具体的な実装（lock専用ref・issueコメントとの役割分担・token/holder/expires_atのエンコード方式・renewの実装方式）を確定する。既存の「投稿→再確認→撤回」ロジックとの共存可否・置換範囲も設計フェーズの判断とする。
- **要件2（ローカルモードのlease原子性）**: ローカルモードのwriter lease取得を、OS提供の排他的ファイル作成（例: `O_CREAT | O_EXCL`相当、既存ファイルが存在すればエラーになる原子的操作）を用いた真のcompare-and-set相当の機構に強化する。既存の`writeYamlFileAtomic`（tmp+rename）は書込み内容の原子性のみを保証し、存在確認との組合せでは compare-and-set にならないため、acquire経路はこの強化された原子的作成を用いる（release/renewは既存token検査ベースのままで良いか設計フェーズで判断する）。
- **要件3（.worktrees/のgitignore登録）**: `.gitignore`に`.worktrees/`を追加する。worktree自体の中身（各worktree配下は別リポジトリとして扱われるためgit管理外）ではなく、空の親ディレクトリのuntracked表示のみを対象とする。
- **要件4（gate-report削除検知）**: `src/commands/verify.ts`の`gateReport()`を、`approved_artifacts`の各要素についてファイルが存在しない場合も不一致（削除された成果物）として検知するよう修正する。ファイルが存在する場合の内容不一致検知（既存ロジック）は維持する。
- **要件5（lease renew非対称性の是正）**: ローカルモードの`renew()`にGitHubモードと同等の期限切れチェックを追加し、期限切れ後のrenewをどちらのバックエンドでも一貫して拒否する。

### 技術検討: gitのref-based lock機構

Issue本文が提案する「git自体のfast-forward-only pushを使ったlock ref機構」について、実際にローカルbareリポジトリで2クライアントが同一refを競合作成するシナリオを再現して検証した。

- 存在しないref（例: `refs/agent-skill-chain/leases/<issue>-<segment>`）へ`git push origin <sha>:<ref>`で作成すると新規ref作成として成功する。
- 別クライアントが同名refへ別コミット（祖先関係なし）を同様にforce無しでpushすると、`! [rejected] ... (fetch first)`で拒否されることを実測確認した。この拒否はgitのreceive-pack側がref更新時に現在値を再検証する処理であり、クライアント側の事前知識に依存しない（サーバ側で真にatomicなref更新保証を提供する、git自体の一般的性質）。
- 同名refへの`--force`指定時は上書きに成功することも確認した（＝lock機構としてはacquire/renewでforceを使わない設計にする必要がある）。
- ref削除（release相当）後は再作成が成功することを確認した。
- GitHub.com上での実運用可否については、公式一次情報に基づき「GitHubは`refs/heads/`・`refs/tags/`以外の任意のカスタムref namespaceへのpushをネイティブgitプロトコル経由でサポートする（GitHub自身が管理する`refs/pull/*`等一部の予約済みnamespaceのみ書込み拒否対象）」ことを確認した。本Issueで提案するnamespace（`refs/agent-skill-chain/leases/*`）はこの予約済みnamespaceと衝突しない。
- 未検証・設計フェーズでの確認事項として残るのは、fine-grained PAT／GitHub App installation permissionの`contents`権限がこのカスタムref namespaceへのpushも実際に許可するかどうかの実機確認（本セッションでは実リポジトリへの実push権限が付与されておらず未実施）。

以上より、GitHubモードでのref-based lock機構は技術的に実現可能と見込む（設計フェーズで実装方式を確定する）。

### 受入条件（Acceptance Criteria）

#### AC-1: GitHubモードで並行acquireが二重取得を許さない

- Given: 同一Issue・同一segmentに対して2つのプロセスがほぼ同時に`lease acquire`を試みる状況を、実際に並行実行するテストで再現する
- When: 2プロセスが競合してacquireを実行する
- Then: 一方のみが成功し、他方は既存leaseとの競合を理由に失敗する（両者が成功する＝二重取得が発生することは無い）ことを実測確認する
- 検証方法見込み: `automated`

#### AC-2: ローカルモードで並行acquireが二重取得を許さない

- Given: 同一Issueに対して2つのプロセスがほぼ同時に`lease acquire`を試みる状況を、実際に並行実行するテストで再現する
- When: 2プロセスが競合してacquireを実行する
- Then: 一方のみが成功し、他方は既存leaseとの競合を理由に失敗する（後勝ちで前者のlease保持を無言で奪うことが無い）ことを実測確認する
- 検証方法見込み: `automated`

#### AC-3: .worktrees/がgitignoreされmain worktreeがclean判定される

- Given: `.gitignore`に`.worktrees/`を追加済みで、かつworktreeが1つも存在しない状態（`git worktree list`がmain worktreeのみを返す）
- When: `git status`および`agent-skill-chain doctor`のmain worktree cleanチェックを実行する
- Then: `.worktrees/`がuntracked表示されず、`git status`はclean、doctorのmain worktree cleanチェックはOKになる（worktree存在時にdirty判定される問題は本Issueのスコープ外として残ってよい）
- 検証方法見込み: `automated`

#### AC-4: verify gate-reportが削除済み承認成果物のdigest不一致を検知する

- Given: gate-reportの`approved_artifacts`に記載されたパスのファイルが実際には削除されている
- When: `agent-skill-chain verify gate-report <path>`を実行する
- Then: 終了コード1以上になり、標準エラーに当該パスが削除されている旨（digest不一致として扱われる）が出力される
- 検証方法見込み: `automated`

#### AC-5: verify gate-reportの既存digest不一致検知（内容変更）が引き続き正しく動作する

- Given: `approved_artifacts`記載のファイルが存在するがdigestが記録値と異なる（内容が変更された）
- When: `agent-skill-chain verify gate-report <path>`を実行する
- Then: 従来通り終了コード1以上になる（regressionなし）
- 検証方法見込み: `automated`

#### AC-6: lease renewが期限切れleaseの復活をどちらのバックエンドでも拒否する

- Given: 有効期限が過ぎた（`expires_at`が現在時刻より過去の）writer leaseが存在し、正しいtokenを保持している
- When: ローカルモード・GitHubモードそれぞれで`lease renew <issue_id> <token>`を実行する
- Then: どちらのバックエンドでも「lease は既に期限切れです」相当の理由で失敗し、期限切れleaseがrenewによって復活しない
- 検証方法見込み: `automated`

#### AC-7: 既存371件超のテストが全てpassする

- Given: 本Issueの全変更（github-lease.ts・lease.ts・.gitignore・verify.ts）を`chore/162-agent-skill-chain-bootstrap`統合ブランチ上へ反映した状態
- When: リポジトリのテストスイート全体（`npm test`相当）を実行する
- Then: 既存テスト（371件超）が全てpassし、新規追加テストも全てpassする（regressionなし）
- 検証方法見込み: `automated`

## スコープ外

この Issue では対応しない事項を明記する。曖昧語・対象外欠落は仕様ゲートの反証観点で指摘される。

- doctorの残り検査項目（docs/system-spec関連・requirement ID traceability・Durability Backend、ADR-0001先送り分）。
- lint-vocabスキャナの本格改修（別途follow-up）。
- secret scanの新規導入（第25.3章、別Issue）。
- worktree存在時にmain worktreeがdirty判定される問題（AC-3注記の通り、本Issueのスコープ外として残る）。
- fine-grained PAT／GitHub App installation permissionのカスタムref namespaceへの書込み許可の実機検証（設計・実装フェーズでの確認事項として持ち越す）。
