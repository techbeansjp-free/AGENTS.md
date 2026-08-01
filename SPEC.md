# SPEC: verify gate-reportがprotected base checkoutではなくtarget_shaのGit objectを見るべき

- Issue: `ISSUE-316`
- 作成者: `implementation_worker`
- 対象ブランチ: `bugfix/316-gate-report-target-sha`

## 目的・背景

`agent-skill-chain verify gate-report`（`src/commands/verify.ts`の`gateReport`関数）は、`gate-report.yaml`の`approved_artifacts`各要素について、対象ファイルが実在するか・digestが一致するかを`fs.existsSync(path.join(worktreeRoot(), artifact.path))`というファイルシステム上の実在チェックで検証する。

しかし`.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish`ジョブは、`Checkout protected base trust root`ステップで対象PRのbase（main）をcheckoutしており、PR headはcheckoutされない（PR headはGit objectとしてfetchされるのみで、working directoryには反映されない）。SPEC.md・DESIGN.md・PLAN.md・VALIDATION.md等のIssueスコープ成果物は候補ブランチ（PR head）にしか存在しないため、`gateReport`のファイルシステム実在チェックは常に「削除されている」と誤判定する。

`worktreeRoot()`を使う設計は、Issue #185当時の同期的レビューフロー（レビュアが候補ブランチのworktree上で直接実行される想定）を前提にしており、Issue #283/PR #284によるtrusted gate recorderへの全面刷新（`verify-and-publish`のcheckout先をprotected base = mainへ変更）に伴って更新されていなかった。

実測: PR #311（Issue #300自身）のspec gateで、独立2体のOpusレビューが両方とも`conformance: pass, falsification: pass`（blocking findingなし）で`final: approved`となったにもかかわらず、後続の「Verify gate report schema」ステップが`approved_artifacts のファイルが削除されています（digest不一致として扱います）: SPEC.md`で失敗することを確認した（2026-07-26、run 30221305661）。

## 要求 → 要件 → 受入条件

### 要求

`gateReport`の成果物検証が、`verify-and-publish`ジョブの実際のcheckout先（protected base = main）に依存せず、`gate-report.yaml`自身が記録する`target_sha`（PRの実際のhead SHA）における成果物の内容を正しく参照して検証する。

### 要件

- `gateReport`の成果物存在・digest検証を、ファイルシステムの実在チェック（`fs.existsSync`）から、`git show <target_sha>:<path>`によるGit object参照へ変更する（`src/commands/gate.ts`の`artifactDigestAtSha`と同様のパターン）。
- `GateReport`インターフェース（`verify.ts`内、`gate-report.schema.yaml`の`target_sha`フィールドに対応）へ`target_sha`を追加する。
- `git show`は`repoRoot()`をcwdとして実行する（`worktreeRoot()`ではない）。schema検証（アセット解決）が既に`repoRoot()`基点であることと一致させ、成果物解決とschema解決で異なるrootを使わない。
- `target_sha`におけるGit blob取得に失敗した場合（対象ファイルが実際にそのSHAで存在しない場合）を「削除されている」として扱い、blob取得に成功しdigestが一致しない場合を「digest不一致」として扱う、という既存の意味的な区別を維持する。
- ただし`src/commands/gate.ts`はimplementation gateに限り、target_shaに実在しない成果物を`ABSENT_ARTIFACT_DIGEST`という固定sentinel digest（`digestOf('agent-skill-chain:artifact-absent:v1')`）で正当に記録する（`artifactsAtSha`/`artifactDigestAtSha`の`allowAbsent`分岐、`allowAbsent`は`gateId === 'implementation'`の場合のみ真）。この例外は`report.gate.id === 'implementation'`の場合にのみ適用する（spec/design/validation gateでは、証跡生成側がそもそもsentinel digestを持つ`approved_artifacts`エントリを生成し得ないため、検証側で無条件に許容するとI8の安全側原則に反し、本来存在しないはずの「不在の正当な記録」を偽装できてしまう）。gate.id以外の条件下でGit blob取得が失敗した場合、記載digestに関わらず「削除されている」エラーとする。
- 既存の`verify gate-report`関連の挙動（`target_sha`以外の検証項目）は変更しない。ただし後述のAC-4が定める2件の既存テスト（承認済み成功ケース・ISSUE-176 AC-4由来の削除検知ケース）に限り、`target_sha`意味論への移行に伴う改訂・退役を認める。
- 前提条件: `target_sha`が指すcommitオブジェクトが、`verify gate-report`実行環境のローカルGit object databaseに到達可能である必要がある（shallow cloneでPR headをfetchしていない環境等では、対象ファイルが実際に存在する場合でも`git show`が失敗し「削除されています」と誤報告されうる）。`.github/workflows/agent-skill-chain-gate.yml`の`Fetch target as read-only Git object`ステップがこの前提を満たす。
- ローカルモード（`gate review` → `gate record-verdict` → `verify gate-report`）では、`gate review`が捕捉する`target_sha`は実行時点のworktree HEADである。`record-verdict`が`artifact_base_dir`指定時に算出するdigestはworktreeファイルシステムの実体に基づくため、`gate review`実行時点で`approved_artifacts`対象ファイルがcommit済みでない、またはcommit後に編集されている場合、当該ファイルは`target_sha`のGit blobに存在しないか内容が異なる。この場合、後続の`verify gate-report`は（implementation gateのABSENT_ARTIFACT_DIGESTsentinelが正当に記録されている場合を除き）「削除されています」または「digest不一致」として拒否する。これはAGENTS.md I3（耐久性：セグメント完了ごとのcommit）が要求するworkflowを事実上強制するfail-closedな挙動であり、意図された仕様とする。

### 受入条件（Acceptance Criteria）

#### AC-1: worktreeのファイルシステムに対象ファイルが無くても、target_sha上に存在すれば検証成功する

- Given: `worktreeRoot()`のファイルシステム上には存在しないが、`gate-report.yaml`の`target_sha`が指すGit commitには実在し、かつdigestが一致するファイルを`approved_artifacts`に持つgate-report
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: 「削除されています」エラーを出さず、終了コード0（他の検証項目に問題が無い場合）になる
- 検証方法見込み: `automated`

#### AC-2: target_sha上にも実在しないファイルは、implementation gateでsentinel digestが正当に記録されている場合を除き「削除されている」エラーになる

- Given: `target_sha`が指すGit commitにも存在しないパスを`approved_artifacts`に持つgate-report
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: `report.gate.id === 'implementation'`かつ記載digestが`ABSENT_ARTIFACT_DIGEST`sentinel値と一致する場合は検証成功。それ以外（gate.idがimplementation以外、またはimplementationでもsentinel値と不一致）は「削除されています（digest不一致として扱います）」エラーで終了コード1以上になる
- 検証方法見込み: `automated`

#### AC-3: target_sha上に存在するがdigestが異なる場合は「digest不一致」エラーになる

- Given: `target_sha`が指すGit commitに実在するが、内容が`approved_artifacts`記載のdigestと異なるファイル
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: 「digest が現在のファイル内容と一致しません」エラーで終了コード1以上になる
- 検証方法見込み: `automated`
- 補足（自己完結性）: `target_sha`はcommit SHAとして不変であるため、この不一致は「承認後に成果物の実内容が改ざんされた」ことを意味しない（同一target_shaのGit blobは常に同一内容である）。この検証が実際に検知するのは、`approved_artifacts`のdigestフィールド自体が、記録時点の実内容と異なる値で保存された場合（証跡生成過程の不整合・手編集等）である。
- 補足（用語）: エラーメッセージ文言「digest が現在のファイル内容と一致しません」における「現在のファイル内容」とは、worktreeファイルシステム上の現在のファイルではなく、`target_sha`が指すGit blobの内容を指す（既存の`verify gate-report`関連の挙動は変更しない方針のため、メッセージ文言自体はそのまま維持する）。

#### AC-4: 既存のverify gate-report関連テストが、検証意図を保ったままtarget_sha意味論に整合するよう改訂され、後退しない

- Given: 既存の`verify gate-report`統合テストのうち、(a) 承認済みgate-reportが成功することを検証するテスト、(b) ISSUE-176 AC-4「承認後にworktreeファイルシステム上で成果物が削除された場合をdigest不一致として検知する」ケースを検証するテスト
- When: 本Issueの要件（AC-1〜AC-3）を実装する
- Then:
  - (a)は、検証対象の成果物を`target_sha`が指すcommitへ実際にcommitした状態で検証するようGivenを改訂したうえで、成功を維持する（`worktreeRoot()`へ書き込むだけでcommitしない従来のGivenは、target_sha意味論の下では成立しない）。
  - (b)は、`target_sha`（不変のcommit SHA）基準の検証へ移行したことで「worktreeファイルシステム上の削除を検知する」という検証意図自体が意味を持たなくなるため、本Issueにより退役・削除する。承認後の作業ツリー改ざんを継続監視する責務は本Issueの対象外であり、既存の`gate reconcile`（push毎の承認済み成果物digest再照合、既存機構）が引き続き担う。
  - (a)(b)を除く既存の`verify gate-report`関連テストは後退せず成功する。`npm test`は全件成功する。
- 検証方法見込み: `automated`

#### AC-5: implementation gateのABSENT_ARTIFACT_DIGEST sentinelは正しく検証成功する

- Given: `gate.id === 'implementation'`のgate-reportで、target_shaに実在しないpathを`ABSENT_ARTIFACT_DIGEST`sentinel値で記録した`approved_artifacts`エントリ
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: 「削除されています」エラーを出さず検証成功する
- 検証方法見込み: `automated`

#### AC-6: implementation以外のgateではABSENT_ARTIFACT_DIGEST sentinelを許容しない

- Given: `gate.id === 'spec'`（design/validationでも同様）のgate-reportで、target_shaに実在しないpathを`ABSENT_ARTIFACT_DIGEST`sentinel値で記録した`approved_artifacts`エントリ
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: gate.idがimplementationでないため例外は適用されず、「削除されています（digest不一致として扱います）」エラーで終了コード1以上になる
- 検証方法見込み: `automated`

#### AC-7: ローカルモードでcommit前・commit後編集済みの成果物を検証すると「削除されている」またはdigest不一致として拒否される

- Given: `gate review`実行時点のworktree HEAD（`target_sha`として記録される）に、`approved_artifacts`が参照する成果物がまだcommitされていない、またはcommit後に編集されているgate-report
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: 対象成果物は`target_sha`のGit object上に存在しないか内容が異なるため、「削除されています（digest不一致として扱います）」または「digestが一致しません」エラーで終了コード1以上になる（implementation gateのABSENT_ARTIFACT_DIGESTsentinelが正当に記録されている場合を除く）。これはAC-1〜AC-3が定めるGit object参照の検証ロジックがGitHubモード・ローカルモード双方に等しく適用されることの帰結であり、ローカルモード固有の例外は設けない。
- 検証方法見込み: `automated`（AC-1〜AC-3を検証する既存の検証ロジック・テストと同一のコードパスで担保される。backend種別による分岐は実装しない）

## スコープ外

- Issue #283/PR #284が導入したcheckout戦略（protected base = mainをcheckoutする設計）自体の変更は行わない。
- `gate-report.yaml`のスキーマ自体の変更は行わない（`target_sha`は既にrequiredフィールドとして存在する）。
- 既知の限界（digest計算方式の非対称性）: `gate record-verdict <report> <artifact_base_dir>`（ローカル非GitHub評価経路、`.agent-skill-chain/adapters/claude.sh`が使用）はdigestを`digestOfFile`（ファイルシステムの生バイト）で算出する。本Issueの変更後、`verify gate-report`は`digestOf(git show <target_sha>:<path>の標準出力)`（`src/lib/exec.ts`の`encoding: 'utf8'`によるテキスト復号を経由）で算出するため、バイナリ成果物やCRLF等の改行コード差異がある場合、両者のdigestが理論上一致しないことがありうる。本変更が対象とするGitHubモードの`verify-and-publish`経路（`gate submit-evidence`・`artifactDigestAtSha`もgit show経由でありverify側と対称）ではこの非対称性は生じない。`record-verdict`側のdigest計算方式変更は本Issueのスコープ外とする（別コマンドであり、既存のローカルモード運用・過去のgate-reportとの互換性検討を要するため）。
