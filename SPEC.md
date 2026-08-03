# SPEC: manifest.yamlのcore_review.triggers.path_prefixesを真に信頼境界に関わる範囲へ絞り込む

- Issue: `ISSUE-359`
- 作成者: `spec_worker`
- 対象ブランチ: `process/359-narrow-core-review-scope`

## 目的・背景

`.agent-skill-chain/project/manifest.yaml` の `model_selection.core_review.triggers.path_prefixes` は、`.agent-skill-chain/project/`・`.agent-skill-chain/config/`・`.agent-skill-chain/schemas/`・`.agent-skill-chain/adapters/`・`.agent-skill-chain/scripts/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/templates/github/`・`.github/`・`src/commands/`・`src/lib/` を列挙している。`src/lib/model-selection.ts` の `matchesCorePath` はこれらを単純な前方一致（`startsWith`）で判定し、一致した変更はIssue自身の `risk` 分類（`normal`/`high`/`unclassified`）に関わらず `required_profile: strict`（専任2レビュア・`model_tier: frontier_coding`・`reasoning_tier: maximum_reasoning`）を強制する。

`src/commands/`・`src/lib/` はagent-skill-chain CLI実装のほぼ全体を占めるため、通常のバグ修正・軽微な機能追加を含むこのリポジトリのソースコード変更のほぼ全てがStrictへ強制される状態になっている。2026-08-02〜08-03のセッションでは、Issue #342等の並行実装がこの無差別なStrict適用により12ラウンド以上の往復を要し、複数Issueが長時間マージに至らず、ユーザーから明示的な改善指摘を受けた。

Strictプロファイル自体（専任2レビュアによる立証・反証の分離、`frontier_coding`・`maximum_reasoning`能力要求）は、GitHub Actionsのtrigger方式・permissions・Check Run発行ロジック、writer lease・ゲート判定の中核処理、ゲートレビュア起動系（adapters）等、真に信頼境界に関わる変更に対しては妥当である。本Issueは、この保護を残したまま、無関係な変更まで一律にStrictへ強制している現在の`path_prefixes`の広さを是正する。

`core_review`の要否・プロファイル強制ロジック自体（`src/lib/model-selection.ts`の`matchesCorePath`・`classifyCoreReview`、`src/commands/gate.ts`——`classifyCoreReview`/プロファイル関連の参照がファイル全体で23箇所に散在し、I8ラチェット判定とtrusted attestation再構築が同一関数内に共存しているためファイル単位で扱う）、この判定が参照する`.agent-skill-chain/project/manifest.yaml`の`model_selection.core_review`セクション自体（絞り込みルールそのものを定義する箇所）、およびI1（追跡可能性）・I2（セグメントゲート）・I3（耐久性）・I4（分離）・I5（進行役の純粋性）・I6（正準モデル）・I7（仕様⇔検証の追跡）の検査手段を実装する`.agent-skill-chain/scripts/`・`.agent-skill-chain/schemas/`・`.agent-skill-chain/ci/`内の一部ファイルは、絞り込みの対象そのものが自己言及的にstrict強制を弱体化しうる特別な範囲である。本Issueはこれらを絞り込み対象から明確に除外し、strict維持を要求レベルで明記する。

## 要求 → 要件 → 受入条件

### 要求

`core_review.triggers.path_prefixes` を、実際にIssueのCheck Run発行・writer lease・ゲート判定・信頼境界（GitHub Actionsのtrigger方式・permissions・source identity検証等）に直接関わる範囲へ絞り込み、それ以外の変更はIssue自身の`risk`分類に基づく既定のI8ルール（`risk != normal → strict`、`risk: normal`かつ`autonomy != full`なら`standard`）へ委ねる。

### 要件

- 絞り込み後の`path_prefixes`は、GitHub Actionsのtrigger方式・permissions・Check Run発行ロジックを担うワークフロー本体（および配布テンプレート内の同型ファイル）、writer lease・ゲート判定の中核スクリプト、ゲートレビュア起動系（adapters）など、信頼境界に直接関わるパスのみを含む。具体的な最終パス一覧の確定は設計セグメントの責務とする。
- 絞り込み後も`.agent-skill-chain/schemas/project-policy.schema.yaml`（`agent-skill-chain/project-policy/v1`）へ適合し続ける。`path_prefixes`は`minItems: 1`・`uniqueItems: true`の制約を満たす。
- `exact_paths`（`AGENTS.md`・`package.json`・`package-lock.json`）は本Issueの対象外とし変更しない。
- `core_review`の要否判定・プロファイル強制ロジック自体を実装するコード（`src/lib/model-selection.ts`の`matchesCorePath`・`classifyCoreReview`、および`src/commands/gate.ts`）は、絞り込みの対象から明確に除外し、`path_prefixes`（または同等の判定範囲）に含めてstrict維持対象とする。これにより「strict対象を判定するコード自体」が将来standardプロファイルで変更可能になり、自己言及的にstrict強制を弱体化する事態を防ぐ。`src/lib/model-selection.ts`は単一責務ファイルであり、`matchesCorePath`・`classifyCoreReview`のみをファイル単位でstrict維持対象とすることに支障はない。一方`src/commands/gate.ts`は、`classifyCoreReview`/プロファイル関連の参照がファイル全体で23箇所に散在し、I8ラチェット判定とtrusted attestation再構築が同一関数内に共存しているため、ファイル内で「プロファイル強制ロジック部分」とそれ以外を実務上分離できない。したがって`gate.ts`はサブファイル粒度での分離を行わず、**ファイル全体**をstrict維持対象とする（`gate.ts`自体の分割リファクタは本Issueのスコープ外とする）。この結果、`src/commands/`のうち絞り込みの恩恵（standardプロファイル移行）を受けるのは、`gate.ts`を除く他のコマンドファイル（`adr.ts`・`checkpoint.ts`・`worker.ts`等、`classifyCoreReview`と無関係なもの）のみとなる。
- `.agent-skill-chain/project/manifest.yaml`自体のうち、少なくとも`model_selection.core_review`セクション（`triggers.path_prefixes`・`triggers.exact_paths`・`triggers.github_label`・`triggers.local_state_value`・`profile`・`execution.trusted_reviewer_actors`を含む、絞り込みルールそのものを定義する箇所）は、絞り込み対象から明確に除外し、strict維持対象とする。`manifest.yaml`は`.agent-skill-chain/project/`配下にあり本Issueの絞り込み対象の候補となりうるが、この絞り込みルール自体を将来standardプロファイルで変更できてしまうと保護機構自体が無防備になるため、自己言及的な除外として明記する。ファイル単位・セクション単位いずれの粒度で表現するかは設計セグメントの責務とする。
- `.agent-skill-chain/schemas/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/scripts/`は絞り込み対象の候補とするが、AGENTS.mdの不変条件検査手段を実装するファイルは一貫して絞り込み対象から除外しstrict維持とする。対象は、I2（セグメントゲート）・I4（分離）・I5（進行役の純粋性）・I7（仕様⇔検証の追跡）の検査手段（`.agent-skill-chain/schemas/`内の`gate-report.schema.yaml`・`lease.schema.yaml`・`worker-report.schema.yaml`・`state.schema.yaml`・`segments.schema.yaml`、`.agent-skill-chain/ci/`内の`verify-gate-report.sh`・`verify-artifacts.sh`・`verify-branch-name.sh`・`verify-worktree-path.sh`・`verify-ac-coverage.sh`）に加え、I1（追跡可能性）・I3（耐久性）・I6（正準モデル）の検査手段（`.agent-skill-chain/scripts/`内の`adr-lint.sh`・`issue-resume.sh`・`lint-vocab.sh`）、および関連するCI検査（`.agent-skill-chain/ci/`内の`verify-adr.sh`・`verify-doc-length.sh`・`verify-root-clean.sh`・`verify-template-sync.sh`）である。特定の不変条件だけを対象外とする合理的理由がない限り、全不変条件の検査手段を同列に扱いstrict維持対象とする。`.agent-skill-chain/scripts/`のうちゲート判定・lease操作の中核スクリプト（`gate-*.sh`・`lease-*.sh`）は既にAC-3(a)でstrict維持対象である。これら以外の低リスクな`schemas/`・`ci/`・`scripts/`内容（上記の不変条件検査手段・中核スクリプトに該当しないファイル。例：`doctor.sh`・`cleanup.sh`・`issue-start.sh`等）のみを絞り込み候補とする。
- `.agent-skill-chain/config/`（`agent-skill-chain.yaml`・`roles.yaml`・`segments.yaml`）には`core_review`関連設定が存在しない（`core_review`設定は`.agent-skill-chain/project/manifest.yaml`にのみ存在する）ため、`.agent-skill-chain/config/`配下全体を絞り込み対象とする。
- `.agent-skill-chain/project/`のうち、上記の`manifest.yaml`の`model_selection.core_review`セクションを除く部分（`manifest.yaml`のcore_review以外のセクション、および`RULES.md`・`COVERAGE_EXCEPTIONS.md`・`MODEL_TIER_TABLE.md`・`OPERATING_PRINCIPLES.md`等のその他文書）は絞り込み対象とする。
- `.github/`および`.agent-skill-chain/templates/github/.github/`のうち、AC-2が対象とするワークフロー本体（`workflows/`配下）を除く部分（`CODEOWNERS`・`ISSUE_TEMPLATE/`・`pull_request_template.md`・`SECURITY.md`・`dependabot.yml`）は絞り込み対象とする。
- 絞り込みにより`path_prefixes`から外れた範囲（`src/commands/`のうち`gate.ts`を除く部分、`src/lib/`のうち`matchesCorePath`・`classifyCoreReview`を除く部分、`.agent-skill-chain/config/`全体、`.agent-skill-chain/project/`のうち`manifest.yaml`の`model_selection.core_review`セクションを除く部分、`.agent-skill-chain/schemas/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/scripts/`のうち信頼境界に無関係な部分（ただし上記のI1/I2/I3/I4/I5/I6/I7検査手段ファイル・中核スクリプトを除く）、`.github/`および配布テンプレートのうちワークフロー本体を除く部分等）への変更は、`risk: normal`かつ`autonomy != full`のIssueであれば`review_profile: standard`（1レビュアによるconformance→falsification）で完了できる。
- 絞り込み後も、真に信頼境界に関わる範囲（ゲート/reconcileワークフロー本体、対応する配布テンプレート、adapters、ゲート判定・lease操作の中核スクリプト、`core_review`判定・プロファイル強制ロジック自体（`gate.ts`はファイル全体）、`manifest.yaml`の`model_selection.core_review`セクション自体、I1/I2/I3/I4/I5/I6/I7検査手段を実装する`scripts/`・`schemas/`・`ci/`ファイル）への変更は、Issue自身の`risk`分類に関わらず引き続き`required_profile: strict`として検出される。

### 受入条件（Acceptance Criteria）

#### AC-1: 絞り込み後もスキーマに適合する

- Given: 絞り込み後の`.agent-skill-chain/project/manifest.yaml`。
- When: `.agent-skill-chain/schemas/project-policy.schema.yaml`に対して検証する。
- Then: `agent-skill-chain/project-policy/v1`への適合が維持され、`path_prefixes`は`minItems: 1`・`uniqueItems: true`を満たし、スキーマ自体・`schema_version`の変更を要さない。
- 検証方法見込み: `automated`

#### AC-2: GitHub Actionsのtrigger方式・Check Run発行ロジックに関わるワークフロー本体はStrict対象のまま

- Given: 絞り込み後の`path_prefixes`。
- When: ゲート/reconcileワークフロー本体（trigger方式・permissions・Check Run発行ロジックを担うファイル）、および`.agent-skill-chain/templates/github/.github/workflows/`配下の対応する配布テンプレートファイルへの変更差分を`matchesCorePath`（`src/lib/model-selection.ts`）で判定する。
- Then: 該当ファイルへの変更は引き続きcore_review対象（`required: true`）として検出される。
- 検証方法見込み: `automated`

#### AC-3: writer lease・ゲート判定の中核スクリプト、adapters、`core_review`判定/プロファイル強制ロジック自体（`gate.ts`はファイル全体）、`manifest.yaml`の絞り込みルール自体、およびI1/I2/I3/I4/I5/I6/I7検査手段を実装する`scripts/`・`schemas/`・`ci/`ファイルはStrict対象のまま

- Given: 絞り込み後の`path_prefixes`（および`matchesCorePath`の判定範囲）。
- When: 以下のいずれかへの変更差分を`matchesCorePath`（`src/lib/model-selection.ts`）で判定する。
  - (a) ゲート判定・lease操作の中核スクリプト
  - (b) `.agent-skill-chain/adapters/`配下のファイル
  - (c) `src/lib/model-selection.ts`の`matchesCorePath`・`classifyCoreReview`自体
  - (d) `src/commands/gate.ts`（ファイル全体。`classifyCoreReview`/プロファイル関連の参照がファイル全体に散在し、I8ラチェット判定とtrusted attestation再構築が同一関数内に共存していてサブファイル粒度で分離できないため、ファイル単位でstrict維持対象とする）
  - (e) `.agent-skill-chain/schemas/`内の`gate-report.schema.yaml`・`lease.schema.yaml`・`worker-report.schema.yaml`・`state.schema.yaml`・`segments.schema.yaml`
  - (f) `.agent-skill-chain/ci/`内の`verify-gate-report.sh`・`verify-artifacts.sh`・`verify-branch-name.sh`・`verify-worktree-path.sh`・`verify-ac-coverage.sh`・`verify-adr.sh`・`verify-doc-length.sh`・`verify-root-clean.sh`・`verify-template-sync.sh`
  - (g) `.agent-skill-chain/project/manifest.yaml`の`model_selection.core_review`セクション自体
  - (h) `.agent-skill-chain/scripts/`内の`adr-lint.sh`（I1追跡可能性の検査手段）・`issue-resume.sh`（I3耐久性の検査手段）・`lint-vocab.sh`（I6正準モデルの検査手段）
- Then: 該当ファイルへの変更は引き続きcore_review対象（`required: true`）として検出される。
- 検証方法見込み: `automated`

#### AC-4: 信頼境界に無関係な範囲（`src/commands/`・`src/lib/`・`scripts/`・`config/`・`project/`・`schemas/`・`ci/`・`.github/`等）はcore_review対象から外れる

- Given: 絞り込み後の`path_prefixes`（および`matchesCorePath`の判定範囲）。
- When: 以下のいずれかへの変更差分を`matchesCorePath`（`src/lib/model-selection.ts`）で判定する。
  - `src/commands/`のうちAC-3(d)の`gate.ts`を除く全ファイル（`adr.ts`・`checkpoint.ts`・`worker.ts`等、`classifyCoreReview`と無関係なコマンドファイル）
  - `src/lib/`のうちAC-3(c)の`matchesCorePath`・`classifyCoreReview`実装部分を除く部分
  - `.agent-skill-chain/scripts/`のうちAC-3(a)のゲート判定・lease操作の中核スクリプト（`gate-*.sh`・`lease-*.sh`）およびAC-3(h)の`adr-lint.sh`・`issue-resume.sh`・`lint-vocab.sh`を除く部分（`doctor.sh`・`cleanup.sh`・`issue-start.sh`等の非中核スクリプト）
  - `.agent-skill-chain/config/`全体（`agent-skill-chain.yaml`・`roles.yaml`・`segments.yaml`）
  - `.agent-skill-chain/project/`のうちAC-3(g)の`manifest.yaml`の`model_selection.core_review`セクションを除く部分（`manifest.yaml`のcore_review以外のセクション、`RULES.md`等のその他文書）
  - `.agent-skill-chain/schemas/`のうちAC-3(e)を除く部分
  - `.agent-skill-chain/ci/`のうちAC-3(f)を除く部分
  - `.github/`および`.agent-skill-chain/templates/github/.github/`のうちAC-2のワークフロー本体（`workflows/`配下）を除く部分（`CODEOWNERS`・`ISSUE_TEMPLATE/`・`pull_request_template.md`・`SECURITY.md`・`dependabot.yml`）
- Then: 該当ファイルへの変更はcore_review対象外（`required: false`、`reason: 'ordinary'`相当）として検出される。
- 検証方法見込み: `automated`

#### AC-5: risk: normalのIssueが絞り込み後の対象外パスのみを変更する場合、standardプロファイルで完了できる

- Given: `risk: normal`かつ`autonomy != full`を明示したIssueが、絞り込み後にcore_review対象外となったパスのみを変更するPR。
- When: 当該PRがゲート判定（`src/commands/gate.ts`のプロファイル解決）を通過する。
- Then: `review_profile: standard`（1レビュアによるconformance→falsification）で承認・マージに至る。
- 検証方法見込み: `hybrid`（分類ロジック自体の判定は`automated`で確認するが、Strict往復の解消という実際の効果は、本Issue後に作成される実issueでの実地確認を要するため`automated`単独では完結しない）

#### AC-6: 絞り込み後もexact_pathsは変更されない

- Given: 本Issueの変更後の`.agent-skill-chain/project/manifest.yaml`。
- When: `model_selection.core_review.triggers.exact_paths`を確認する。
- Then: `AGENTS.md`・`package.json`・`package-lock.json`のまま変更されていない。
- 検証方法見込み: `automated`

## スコープ外

- I8不変条件そのもの（`risk != normal（unclassified含む）OR autonomy == full → strict`という既定ルール自体）の変更。
- Strictプロファイル自体の実行方式（専任2レビュア・`frontier_coding`・`maximum_reasoning`）の変更。
- `core_review.triggers.exact_paths`（`AGENTS.md`・`package.json`・`package-lock.json`）の変更。
- `core_review.triggers.github_label`・`local_state_value`（明示的な`core_audit`指定経路）の変更。
- ADR-0009・ADR-0015等、現在`status: proposed`のADRを`accepted`へ進める判断。これらは本Issueとは独立した別判断であり、本Issueの絞り込みはこれらADRの内容に依拠しない。
- 非コア（ordinary）作業のモデル選択方式（`model_selection.ordinary.behavior: explicit_selection`）の変更。
