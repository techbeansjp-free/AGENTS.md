# SPEC: docs/adr/でADR番号が重複しており(ADR-0016×3・ADR-0008×2・ADR-0039×2)、adr-lintがID一意性を検査していないためCIで検出されない

- Issue: `ISSUE-539`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/539-adr-id-uniqueness`

## 目的・背景

`docs/adr/` 配下には、frontmatterの `id:` フィールドが一意な追跡識別子であるという前提（AGENTS.md §I1 追跡可能性、`related_adrs:` 構造化フィールド経由の参照ルール）がある。しかし現状、同一ADR番号が複数ファイルに重複使用されている：

| ADR番号 | ファイル | status |
|---|---|---|
| ADR-0016 | ADR-0016-reconcile-workflow-run-trust-boundary.md | accepted |
| ADR-0016 | ADR-0016-codex-exec-unsupported-flag-as-config-override.md | accepted |
| ADR-0016 | ADR-0016-worktree-cleanup-detection-over-merge-chaining.md | proposed |
| ADR-0008 | ADR-0008-npm-package-asset-allowlist.md | proposed |
| ADR-0008 | ADR-0008-test-execution-log-preservation.md | proposed |
| ADR-0039 | ADR-0039-upgrade-stale-file-ownership-record.md | proposed |
| ADR-0039 | ADR-0039-pr-merge-freshness-check-mergestatestatus-optin-update.md | proposed |

`lint adr check`（`.agent-skill-chain/scripts/adr-lint.sh check`、CI: `agent-skill-chain-ci.yml` の `adr-lint` ステップ）はID一意性を検査しないため、重複が存在してもexit 0で通過し、CIで検出されない。これにより、ADR IDを介した参照（`related_adrs:` 等）や由来提示が意図しない対象を指し得る状態が、機械検査をすり抜けたまま蓄積し続ける。

本Issueは、(1) ID一意性の機械検査を追加してこの種の重複を将来にわたり防止し、(2) 既存の重複7ファイルを一意なADR番号へ再採番して現状を是正することを目的とする。

## 要求 → 要件 → 受入条件

### 要求

`docs/adr/` 配下の全ADRファイルについて、frontmatterの `id:` フィールドの一意性が機械的に保証されており、既存の重複が解消されていること。

### 要件

- `docs/adr/` に同一 `id:` を持つ複数ファイルが存在する状態を、既存の `lint adr check` 実行経路（CI含む）がエラーとして検出すること。
- 検出時のエラー出力には、重複しているADR IDと、当該IDを持つファイル名（重複の特定に必要な情報）が含まれること。
- 現存する7件の重複ADRファイルが、それぞれ一意なADR番号へ再採番されていること。
- 再採番後、`docs/adr/` 内の `related_adrs:`・`supersedes`・`superseded-by` 等の構造化参照フィールドが、再採番前と同じ論理的な参照先ADRを指し続けること（参照の断線・誤参照が発生しないこと）。
- 再採番後、再採番対象IDへのソースコード内 `// Issue #123` 形式以外での直接参照（ADR番号のハードコード参照）が存在しないこと、または存在する場合は再採番後の新IDに追従していること。

### 受入条件（Acceptance Criteria）

#### AC-1: `docs/adr/` の同一ID重複を `lint adr check` がエラーとして検出する

- Given: `docs/adr/` 配下に、frontmatterの `id:` が同一値である2つ以上のADRファイルが存在する
- When: `lint adr check`（`.agent-skill-chain/scripts/adr-lint.sh check`）を実行する
- Then: コマンドが非ゼロの終了コードで終了し、標準エラー出力に重複しているADR IDと該当ファイル名が含まれる
- 検証方法見込み: `automated`

#### AC-2: 一意なIDの場合は `lint adr check` が引き続き成功する

- Given: `docs/adr/` 配下の全ADRファイルのframontmatter `id:` が互いに一意である
- When: `lint adr check` を実行する
- Then: コマンドが終了コード0で終了する（既存のsupersedes⇔superseded-by対称性検査の合否には影響しない）
- 検証方法見込み: `automated`

#### AC-3: 現存する7件の重複ADRが一意な番号へ再採番され、`lint adr check` がエラー無く通過する

- Given: 本Issue起票時点で `docs/adr/` に存在する、ADR-0016（3ファイル）・ADR-0008（2ファイル）・ADR-0039（2ファイル）の重複7ファイル
- When: 各ファイルのfrontmatter `id:` および対応するファイル名中のADR番号を、リポジトリ内で未使用の一意な番号へ再採番したうえで `lint adr check` を実行する
- Then: コマンドが終了コード0で終了し、`docs/adr/` 内に同一IDを持つファイルが存在しない
- 検証方法見込み: `automated`

#### AC-4: 再採番によって既存の構造化参照が壊れていない

- Given: AC-3の再採番後の `docs/adr/`
- When: 再採番前に存在していた `related_adrs:`・`supersedes`・`superseded-by` の各参照、およびソースコード中の当該ADR番号への直接参照（`// Issue #123` 形式以外のもの）を、再採番前後で突き合わせる
- Then: 各参照が再採番前と同じ論理的な参照先ADRを指し続けている（新IDに追従済み、または断線していない）
- 検証方法見込み: `manual`

## スコープ外

- ADR ID採番規則そのものの変更（連番方式・命名規則の見直し）は対象外とする。
- `lint adr check` 以外のADR関連検査（`verify-adr` 等の既存CIステップ）の仕様変更は対象外とする。
- 重複していない既存ADRファイルの内容・statusの変更は対象外とする。
- ID一意性検査の実装方式（アルゴリズム・エラーメッセージの具体文言・出力形式の詳細）は `DESIGN.md` で確定する設計事項であり、本SPECの対象外とする。
