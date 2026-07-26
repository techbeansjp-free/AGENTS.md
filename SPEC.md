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
- `target_sha`におけるGit blob取得に失敗した場合（対象ファイルが実際にそのSHAで存在しない場合）を「削除されている」として扱い、blob取得に成功しdigestが一致しない場合を「digest不一致」として扱う、という既存の意味的な区別を維持する。
- 既存の`verify gate-report`関連の挙動（`target_sha`以外の検証項目）は変更しない。

### 受入条件（Acceptance Criteria）

#### AC-1: worktreeのファイルシステムに対象ファイルが無くても、target_sha上に存在すれば検証成功する

- Given: `worktreeRoot()`のファイルシステム上には存在しないが、`gate-report.yaml`の`target_sha`が指すGit commitには実在し、かつdigestが一致するファイルを`approved_artifacts`に持つgate-report
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: 「削除されています」エラーを出さず、終了コード0（他の検証項目に問題が無い場合）になる
- 検証方法見込み: `automated`

#### AC-2: target_sha上にも実在しないファイルは引き続き「削除されている」エラーになる

- Given: `target_sha`が指すGit commitにも存在しないパスを`approved_artifacts`に持つgate-report
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: 「削除されています（digest不一致として扱います）」エラーで終了コード1以上になる
- 検証方法見込み: `automated`

#### AC-3: target_sha上に存在するがdigestが異なる場合は「digest不一致」エラーになる

- Given: `target_sha`が指すGit commitに実在するが、内容が`approved_artifacts`記載のdigestと異なるファイル
- When: `agent-skill-chain verify gate-report <path>` を実行する
- Then: 「digest が現在のファイル内容と一致しません」エラーで終了コード1以上になる
- 検証方法見込み: `automated`

#### AC-4: 既存のverify gate-report関連テストが後退しない

- Given: 既存のverify gate-report統合テスト
- When: `npm test`を実行する
- Then: 全件成功する
- 検証方法見込み: `automated`

## スコープ外

- Issue #283/PR #284が導入したcheckout戦略（protected base = mainをcheckoutする設計）自体の変更は行わない。
- `gate-report.yaml`のスキーマ自体の変更は行わない（`target_sha`は既にrequiredフィールドとして存在する）。
