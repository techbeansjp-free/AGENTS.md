# SPEC: risk:normalの狭い範囲だけをcore_review強制の対象外へ降格させる allowlist を追加する

- Issue: `ISSUE-359`
- 作成者: `spec_worker`
- 対象ブランチ: `process/359-narrow-core-review-scope`

## 目的・背景

`.agent-skill-chain/project/manifest.yaml` の `model_selection.core_review.triggers.path_prefixes` は、`.agent-skill-chain/project/`・`.agent-skill-chain/config/`・`.agent-skill-chain/schemas/`・`.agent-skill-chain/adapters/`・`.agent-skill-chain/scripts/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/templates/github/`・`.github/`・`src/commands/`・`src/lib/` を列挙している。`src/lib/model-selection.ts` の `matchesCorePath` はこれらを単純な前方一致（`startsWith`）で判定し、一致した変更はIssue自身の `risk` 分類（`normal`/`high`/`unclassified`）に関わらず `required_profile: strict`（専任2レビュア・`model_tier: frontier_coding`・`reasoning_tier: maximum_reasoning`）を強制する。この広さにより、通常のバグ修正・軽微な機能追加を含むこのリポジトリのソースコード変更のほぼ全てがStrictへ強制され、2026-08-02〜08-03のセッションではIssue #342等の並行実装が12ラウンド以上の往復を要した。

本Issueは当初、この広すぎる `path_prefixes` を「信頼境界に直接関わる範囲だけを残す」形へ絞り込む案（保護すべき箇所を列挙し、それ以外を除外するdenylist方式）で進めていた。しかし5ラウンドのspec-gate strictレビューを通じて、`matchesCorePath`/`classifyCoreReview` 本体だけでなく `src/lib` 全体に信頼境界ロジックが分散している事実、`lease-*.sh` が薄いラッパーで実体が別ファイルにある事実、`src/commands/setup.ts` の `ruleset()` がbranch protection機構そのものである事実、`project-policy.schema.yaml` の核心invariantコメントの扱い等、新たな見落としが毎回見つかり続けた。「保護すべき箇所を全て列挙し尽くす」ことは、信頼境界ロジックが複数ファイルへ分散した現状のコードベースに対しては実務上収束しないと判断し、方針を転換する。

新方針は、既存の `path_prefixes`（＝現状のStrict強制範囲）には一切手を加えず安全側のまま維持し、その代わりに「確実にリスクが無いと個別に確認できた狭い範囲」だけを明示的なallowlistとして新設し、その範囲に完全に収まる変更に限り、Issue自身の `risk` 分類に基づく既定のI8ルール（`risk: normal` かつ `autonomy != full` なら `standard`）へ委ねる。既存の広い `path_prefixes` を編集しない（＝既存境界の走査・列挙をやり直さない）ため、「見落とし」という失敗モード自体が発生しない。allowlist候補は、信頼境界・実行ロジックに一切関わらないことが自明なもの（文書のみ）に限定し、`src/` 配下やadapters/scripts配下の実行可能ファイルは、一見軽微に見えるものでも当面allowlistに含めない。将来コード側の絞り込みが必要になれば、本Issueの後続Issueとして別途対応する。

## 要求 → 要件 → 受入条件

### 要求

`model_selection.core_review` に、既存の `path_prefixes`／`exact_paths`（Strict強制範囲）を変更せず維持したまま、信頼境界・実行ロジックに一切関わらないと個別に確認された狭い path prefix の集合だけを対象外化できる allowlist 機構を追加する。allowlistに完全に収まる変更のみ、Issue自身の `risk` 分類に基づく既定のI8ルールへ委ねる。それ以外（allowlist外を1つでも含む変更）は現状どおりStrictを強制する。

### 要件

- 既存の `model_selection.core_review.triggers.exact_paths` と `path_prefixes` は、本Issueの変更前後で値を一切変更しない（追加・削除・並べ替えいずれも行わない）。既存のStrict強制範囲を安全側のまま維持することが本Issueの前提であり、範囲の再列挙・再絞り込みは行わない。
- `model_selection.core_review` に、allowlistとなる path prefix の集合を新たに定義できるフィールドを追加する。具体的なフィールド名・データ形状（`triggers` 配下に追加するか同階層の兄弟キーとするか等）の確定は設計セグメントの責務とする。
- 判定順序は「変更差分に含まれる全パスが、新設allowlistのいずれかのprefixに一致する」場合に限り対象外化が成立する。1つでもallowlist外のパス（既存の `exact_paths`／`path_prefixes` に一致するパスを含む）が変更差分に含まれる場合、その変更差分全体を従来どおりcore_review対象（Strict強制）として扱う。allowlistは「変更差分全体がallowlistに収まる場合のみ」有効な機構であり、ファイル単位の部分適用は行わない。
- 新設allowlistの初期値は、信頼境界・実行ロジックに一切関わらないことが自明な文書のみに限定する。対象候補は `.agent-skill-chain/project/RULES.md`、`.agent-skill-chain/templates/issue/` 配下のドキュメントテンプレート、`docs/` 配下の文書とする。`src/` 配下（`src/commands/`・`src/lib/` を含む）、`.agent-skill-chain/adapters/`・`.agent-skill-chain/scripts/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/schemas/`・`.agent-skill-chain/config/`・`.github/`・`.agent-skill-chain/templates/github/.github/` は、一見軽微に見える変更であっても実行ロジック・信頼境界との結合が判別困難なため、本Issueでは一切allowlistに含めない。最終的な初期allowlist要素の確定は設計セグメントの責務とするが、上記の対象外方針（コード実装ファイルを含めない）は本Issueの完了条件として維持する。
- 新設allowlist機構自体の定義箇所（`manifest.yaml` 内で allowlist を宣言するセクション）と、allowlist評価ロジックを実装するコード（`src/lib/model-selection.ts` の `matchesCorePath`／`classifyCoreReview`、または新設ロジックの実装箇所）は、既存の `path_prefixes` に含まれる `.agent-skill-chain/project/`・`src/lib/` の範囲内にあるため、既存のStrict強制範囲を変更しないという前提により自動的にStrict維持となる。この自己言及的な保護が既存範囲不変によって成立することを完了条件として明記する。
- `.agent-skill-chain/schemas/project-policy.schema.yaml` は新設フィールドを許容するよう改定が必要になる（`additionalProperties: false` のため）。改定後も `agent-skill-chain/project-policy/v1` の `schema_version` は維持し、既存フィールドの制約（`path_prefixes`／`exact_paths` の `minItems: 1`・`uniqueItems: true` 等）を変更しない。

### 受入条件（Acceptance Criteria）

#### AC-1: 既存のStrict強制範囲（exact_paths・path_prefixes）は変更されない

- Given: 本Issueの変更後の `.agent-skill-chain/project/manifest.yaml`。
- When: `model_selection.core_review.triggers.exact_paths` と `path_prefixes` の値を、本Issue着手前の値（`AGENTS.md`・`package.json`・`package-lock.json` および `.agent-skill-chain/project/`・`.agent-skill-chain/config/`・`.agent-skill-chain/schemas/`・`.agent-skill-chain/adapters/`・`.agent-skill-chain/scripts/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/templates/github/`・`.github/`・`src/commands/`・`src/lib/`）と比較する。
- Then: 要素の追加・削除・変更が一切無く完全一致する。
- 検証方法見込み: `automated`

#### AC-2: 新設allowlistフィールド追加後もスキーマに適合する

- Given: allowlistフィールドを追加した `.agent-skill-chain/project/manifest.yaml` と、対応する改定後の `.agent-skill-chain/schemas/project-policy.schema.yaml`。
- When: `agent-skill-chain/project-policy/v1` に対して検証する。
- Then: 適合が維持され、`schema_version` は変更されない。新設allowlistフィールドはドキュメントのみを対象とする初期値（`.agent-skill-chain/project/RULES.md` 等）を持つ。
- 検証方法見込み: `automated`

#### AC-3: allowlistに完全に収まる変更は、risk:normalのIssueであればstandardプロファイルで完了できる

- Given: `risk: normal` かつ `autonomy != full` を明示したIssueが、`.agent-skill-chain/project/RULES.md` のみを変更するPR。
- When: 当該PRがゲート判定（core_review要否・プロファイル解決ロジック）を通過する。
- Then: core_review対象外（`required: false`）と判定され、`review_profile: standard`（1レビュアによるconformance→falsification）で完了できる。
- 検証方法見込み: `hybrid`（判定ロジック自体は`automated`で確認するが、実issueでの実地確認を要するため`automated`単独では完結しない）

#### AC-4: allowlist外を1つでも含む変更差分は、allowlist対象ファイルを含んでいても全体がStrict対象のまま

- Given: `.agent-skill-chain/project/RULES.md`（allowlist対象）と `src/commands/adr.ts`（既存 `path_prefixes` 内・allowlist外）の両方を変更するPR。
- When: 当該変更差分をcore_review判定ロジックで判定する。
- Then: 変更差分全体がcore_review対象（`required: true`）として検出され、Strictが強制される。
- 検証方法見込み: `automated`

#### AC-5: allowlistに含まれない既存Strict対象範囲は、単独の変更でも従来どおりStrict対象のまま

- Given: `src/commands/gate.ts` のみ、または `src/lib/model-selection.ts` のみを変更するPR（いずれもallowlist外）。
- When: 当該変更差分をcore_review判定ロジックで判定する。
- Then: 変更差分全体がcore_review対象（`required: true`）として検出され、Issue自身の`risk`分類に関わらずStrictが強制される。
- 検証方法見込み: `automated`

#### AC-6: 新設allowlist機構自体の定義箇所・評価ロジックはStrict対象のまま

- Given: `.agent-skill-chain/project/manifest.yaml` 内の新設allowlist定義セクション自体、または `src/lib/model-selection.ts` の判定ロジック自体への変更。
- When: 当該変更差分をcore_review判定ロジックで判定する。
- Then: 既存の `path_prefixes`（`.agent-skill-chain/project/`・`src/lib/`）に含まれるため、変更差分全体がcore_review対象（`required: true`）として検出される。
- 検証方法見込み: `automated`

## スコープ外

- `src/` 配下（`src/commands/`・`src/lib/`）、`.agent-skill-chain/adapters/`・`.agent-skill-chain/scripts/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/schemas/`・`.agent-skill-chain/config/`・`.github/`・`.agent-skill-chain/templates/github/.github/` 等、コード実装・実行可能ファイルをallowlistへ追加すること。これらは将来、必要性が具体的に確認された時点で本Issueの後続Issueとして個別に扱う。
- 既存の `path_prefixes`／`exact_paths` の内容そのものの絞り込み・再列挙（＝denylist方式そのもの）。
- I8不変条件そのもの（`risk != normal（unclassified含む）OR autonomy == full → strict`という既定ルール自体）の変更。
- Strictプロファイル自体の実行方式（専任2レビュア・`frontier_coding`・`maximum_reasoning`）の変更。
- `core_review.triggers.github_label`・`local_state_value`（明示的な`core_audit`指定経路）の変更。
- ADR-0009・ADR-0015等、現在`status: proposed`のADRを`accepted`へ進める判断。これらは本Issueとは独立した別判断であり、本Issueの変更はこれらADRの内容に依拠しない。
- 非コア（ordinary）作業のモデル選択方式（`model_selection.ordinary.behavior: explicit_selection`）の変更。
