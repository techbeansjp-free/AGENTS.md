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
- 既存の`verify gate-report`関連の挙動（`target_sha`以外の検証項目）は変更しない。
- 前提条件: `target_sha`が指すcommitオブジェクトが、`verify gate-report`実行環境のローカルGit object databaseに到達可能である必要がある（shallow cloneでPR headをfetchしていない環境等では、対象ファイルが実際に存在する場合でも`git show`が失敗し「削除されています」と誤報告されうる）。`.github/workflows/agent-skill-chain-gate.yml`の`Fetch target as read-only Git object`ステップがこの前提を満たす。

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

#### AC-4: 既存のverify gate-report関連テストが後退しない

- Given: 既存のverify gate-report統合テスト
- When: `npm test`を実行する
- Then: 全件成功する
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

## スコープ外

- Issue #283/PR #284が導入したcheckout戦略（protected base = mainをcheckoutする設計）自体の変更は行わない。
- `gate-report.yaml`のスキーマ自体の変更は行わない（`target_sha`は既にrequiredフィールドとして存在する）。
