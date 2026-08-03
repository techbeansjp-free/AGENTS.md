# SPEC: プロジェクトポリシーへのCI確認義務・Codex実装委譲ロールの正規commit化

- Issue: `ISSUE-340`
- 作成者: `spec_worker`
- 対象ブランチ: `process/340-policy-ci-check-codex-role`

## 目的・背景

前セッションの作業中、`.agent-skill-chain/project/RULES.md`・`.agent-skill-chain/project/manifest.yaml`への変更と、新規ファイル`.agent-skill-chain/project/interactive-implementation-delegation.md`が、正規の4セグメントフロー（Issue・ブランチ・PR・ゲート）を経ずに main worktree 上で未commitのまま放置された。本Issueはこれを正規化し、既に内容が確定している3つの変更を、SPEC/DESIGN/実装/検証の正規フローに乗せてcommit・PR化することを目的とする。

対象は3件。(1) `RULES.md`へCI確認義務の追記、(2) `manifest.yaml`の`documents.common`への`interactive-implementation-delegation.md`登録と`policy_version`更新、(3) 新規`interactive-implementation-delegation.md`（対話セッション中の実装作業をCodex CLIへreasoning effort `high`（実装者判断で`xhigh`許可）で委譲する project 固有ポリシー。委譲は既存のIssue・ブランチ・worktreeの文脈内に限る）の追加。

ファイル名を`roles/implementation.md`ではなく`interactive-implementation-delegation.md`とし、`.agent-skill-chain/project/roles/`ディレクトリ配下には置かない。AGENTS.mdは`roles/<role>.md`をrole固有規約が必要な場合のみ置く場所と定め、`.agent-skill-chain/schemas/project-policy.schema.yaml`のexamplesも`roles/implementation.md`を`documents.roles.implementation`（implementation segment worker専用の配送チャネル）へ登録する例として示す。本文書の想定読者は対話セッション中に実装依頼を受けるAI（進行役・対話エージェント）でありimplementation segment workerではないため、`roles/`配下に`documents.common`登録の文書を置くと、読者に「segment worker専用チャネルの文書である」という誤認を与える。ディレクトリ・登録先の両方を実態（対話セッション向け・`documents.common`配送）に一致させることで、この誤認を構造的に排除する。

## 要求 → 要件 → 受入条件

### 要求

- 開発者（進行役）として、PR作成後にCI結果を確認せずレビュー依頼・マージ判断へ進んでしまう事故を防ぎたいので、`RULES.md`にCI確認義務を明文化してほしい。
- 開発者として、対話セッション中の実装依頼はCodex CLIへ委譲するという既存の運用実態を、project固有ポリシーとして`manifest.yaml`経由で正規に読み込ませたい。ただし、この委譲は進行役が自ら成果物branchへcommitする迂回路になってはならず、既存の4セグメント・4ゲート手続き（writer lease・segment worker・implementation-gate）の内側でのみ働くことを明文化したい。
- 開発者として、上記2件を`.agent-skill-chain/schemas/project-policy.schema.yaml`に適合する形でmanifestへ反映し、CI検証（`verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`）を通過させたい。ただし、これら3検査は`.agent-skill-chain/project/`配下を走査対象に含まないため、内容面の検証はCI検査だけでは完結せず、strict profileレビュアによる目視確認を要することを踏まえて受入条件を定義したい。

### 要件

- `RULES.md`の「追加規約」箇条書きの末尾に、PR作成後のCI（Check Run・ワークフロー実行結果）確認義務を1行追記する。文言は「PR作成後は、必ずCI（Check Run・ワークフロー実行結果）にエラーが無いかを確認する。エラーがあれば原因を特定し、修正して再pushするか、対応不能な場合はユーザーへ報告する。CI結果を未確認のままレビュー依頼・マージ判断へ進めない。」とする。
- `manifest.yaml`の`project.policy_version`を`2`から`3`へ更新する。
- `manifest.yaml`の`documents.common`の末尾に`interactive-implementation-delegation.md`を追加登録する（`documents.roles`は変更せず現状の`{}`のまま維持する）。登録先を`documents.roles.implementation`ではなく`documents.common`とする理由は次のとおり：`documents.roles.<segment>`は当該segment worker専用の配送チャネルであり、本文書の実際の想定読者は対話セッション中にユーザーから直接実装依頼を受けるAI（進行役・対話エージェント）であってimplementation segment workerではない。ファイル名・配置も`roles/`ディレクトリ外の`interactive-implementation-delegation.md`とすることで、配送先（`documents.common`）とファイルの見た目（role固有規約に見えるパス）の不一致を構造的に排除する。
- 新規ファイル`.agent-skill-chain/project/interactive-implementation-delegation.md`を作成する。内容は、対話セッション中にユーザーから直接実装を依頼された場合に限り、実装作業をCodex CLI（`codex exec`）へreasoning effort `high`（既定、実装者=Codexの判断で`xhigh`への格上げを許可）で委譲することを定める。当該委譲は次の全てを満たす場合に限り成果物branchへのcommitを正当化する：(i) 既存のIssue・ブランチ・worktreeの文脈内で行われること（新規のmain worktree直接編集やIssueに紐づかない変更を正当化しない）、(ii) 当該Issueのwriter leaseを取得済みであること、(iii) 実行主体がAGENTS.md「役割・権限・writer lease」表の進行役ではなくセグメント作業ワーカーであること、(iv) implementation-gateを通過すること。agent-skill-chain正規Issueフロー上のimplementation segment worker（`agent-skill-chain.yaml`の`worker.segment_overrides.implementation`が別途規定）には影響しないことも本文中に明記する。さらに、`xhigh`への実装者判断による格上げが`manifest.yaml`の`model_selection.ordinary.behavior: explicit_selection`および`MODEL_TIER_TABLE.md`の「通常作業は明示された既存adapter/model選択を維持する」原則と適用範囲において排他的であり衝突しないことを本文中に明記する。
- `manifest.yaml`は`.agent-skill-chain/schemas/project-policy.schema.yaml`に適合し続ける（`documents.common`は既に4件の文字列を保持する配列型であり、5件目の追加はスキーマ上の型制約に抵触しない）。
- 本Issueの変更後も`.agent-skill-chain/ci/verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`が通過する。ただし、これら3検査の走査対象（`src/lib/scan.ts`の`defaultLiveFileRoots`・`defaultVocabFileRoots`・`defaultReferenceFileRoots`、`src/commands/verify.ts`の`docLength`）はいずれも`.agent-skill-chain/project/`を含まないため、この通過は各ACの前提条件（機械的な体裁検査）であって、`RULES.md`・`interactive-implementation-delegation.md`の内容そのものの正しさを検証するものではない。内容面の実質的検証はstrict profile独立2レビュアによる目視確認が担う。

### 受入条件（Acceptance Criteria）

#### AC-1: RULES.mdへのCI確認義務追記

- Given: `.agent-skill-chain/project/RULES.md`の「追加規約」節に既存4項目の箇条書きがある
- When: 5項目目として「PR作成後は、必ずCI（Check Run・ワークフロー実行結果）にエラーが無いかを確認する。エラーがあれば原因を特定し、修正して再pushするか、対応不能な場合はユーザーへ報告する。CI結果を未確認のままレビュー依頼・マージ判断へ進めない。」を追記する
- Then: `RULES.md`の当該箇条書きに上記文言が一言一句そのまま存在し、既存4項目は変更されない。`.agent-skill-chain/ci/verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`の通過を前提条件として要求するが、これら3検査は`.agent-skill-chain/project/`配下を走査対象に含まないため、上記の一言一句一致・既存4項目不変という内容面はCI検査では検証されない。本ACの実質的な検証手段は、AC-4が定めるstrict profile（専任2体の独立レビュア）による、design-gate以降の各ゲートでの目視確認である
- 検証方法見込み: `hybrid`（前提条件：3件のCI検査通過。実質的検証：strict profile独立2レビュアによる目視確認）

#### AC-2: manifest.yamlへのポリシー文書登録とpolicy_version更新

- Given: `.agent-skill-chain/project/manifest.yaml`が`project.policy_version: 2`、`documents.common: [RULES.md, 自己拡張ワークフロー.md, OPERATING_PRINCIPLES.md, MODEL_TIER_TABLE.md]`、`documents.roles: {}`である
- When: `project.policy_version`を`3`へ変更し、`documents.common`の末尾に`interactive-implementation-delegation.md`を追加する（`documents.roles`は変更しない）
- Then: `manifest.yaml`が`.agent-skill-chain/schemas/project-policy.schema.yaml`に適合し、`documents.common`が`[RULES.md, 自己拡張ワークフロー.md, OPERATING_PRINCIPLES.md, MODEL_TIER_TABLE.md, interactive-implementation-delegation.md]`、`project.policy_version`が`3`になっている。`documents.roles`は`{}`のまま変更されない。他フィールド（`precedence`・`constraints`・`model_selection`）は変更されない
- 検証方法見込み: `automated`

#### AC-3: 対話セッション実装委譲ポリシー文書の新規作成

- Given: `.agent-skill-chain/project/`配下に、対話セッション中の実装委譲を定めた文書が存在しない
- When: `.agent-skill-chain/project/interactive-implementation-delegation.md`（`roles/`ディレクトリ外）を新規作成し、以下(a)〜(d)を本文中に明記する
  - (a) 対話セッション中にユーザーから直接実装を依頼された場合、実装作業をCodex CLI（`codex exec`）へreasoning effort `high`（実装者=Codexの判断で`xhigh`への格上げを許可）で委譲する旨
  - (b) 当該委譲は次の全てを満たす場合に限り成果物branchへのcommitを正当化すること：既存のIssue・ブランチ・worktreeの文脈内であること、当該Issueのwriter leaseを取得済みであること、実行主体がAGENTS.md「役割・権限・writer lease」表の進行役ではなくセグメント作業ワーカーであること（I5 進行役の純粋性：進行役は成果物branchへcommit禁止）、implementation-gate（I2）を通過すること。いずれかを欠く場合、新規のmain worktree直接編集やIssueに紐づかない変更を正当化しない
  - (c) agent-skill-chain正規Issueフロー上のimplementation segment workerには影響しない旨（担当・reasoning effortは`agent-skill-chain.yaml`の`worker.segment_overrides.implementation`が別途・恒久的に規定する）
  - (d) `xhigh`への実装者判断による格上げは、`manifest.yaml`の`model_selection.ordinary.behavior: explicit_selection`・`MODEL_TIER_TABLE.md`の「通常作業は明示された既存adapter/model選択を維持する」原則と適用対象が排他的であり衝突しない旨——`MODEL_TIER_TABLE.md`の当該原則はagent-skill-chain正規Issueフロー上の各segment worker起動時の恒久設定（`agent-skill-chain.yaml`の`worker.segment_overrides`等、Issueをまたいで維持される選択）を指す。本文書が規定するreasoning effort格上げは、対話セッションで委譲された実装が(b)の4条件下でその場のIssue・PRスコープに閉じて行う実行時の担当割り当てであり、恒久設定を変更しない。両者は異なる対象（恒久設定 vs 単発Issueスコープの実行時判断）に適用されるため、同一の「明示的選択の維持」を巡って衝突しない
- Then: `interactive-implementation-delegation.md`が存在し、AC-2で`manifest.yaml`に登録した参照先パスと一致する。本文中に(a)〜(d)の4点がいずれも趣旨として明記されている。`.agent-skill-chain/ci/verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`の通過（禁止語・セクション番号参照・ファイルパス＋行番号参照の禁止に適合すること）を前提条件として要求するが、これら3検査は`.agent-skill-chain/project/`配下を走査対象に含まないため、(a)〜(d)の記載有無・整合性そのものはCI検査では検証されない。本ACの実質的な検証手段は、AC-4が定めるstrict profile（専任2体の独立レビュア）による、design-gate以降の各ゲートでの目視確認である
- 検証方法見込み: `hybrid`（前提条件：3件のCI検査通過。実質的検証：strict profile独立2レビュアによる目視確認）

#### AC-4: 3変更の一括commit・push・Draft PR化

- Given: AC-1〜AC-3の変更内容がworktree `process/340-policy-ci-check-codex-role`上に存在する
- When: 変更をcommitし、リモートブランチ`process/340-policy-ci-check-codex-role`へpushし、`Closes #340`を含むDraft PRを作成する
- Then: リモートブランチに変更がpush済みであり、Draft PRが本Issueをclose対象として参照している。以降の設計・実装・検証セグメントは同一PRのheadブランチへcommit/pushする。本Issueが変更する3ファイル（`RULES.md`・`manifest.yaml`・`interactive-implementation-delegation.md`）はいずれも`manifest.yaml`の`model_selection.core_review.triggers.path_prefixes`に登録された`.agent-skill-chain/project/`配下に存在するため、design-gate・implementation-gate・validation-gateのいずれも`required_profile: strict`（専任2体の独立レビュア、各レビュアは`model_tier: frontier_coding`かつ`reasoning_tier: maximum_reasoning`の能力証明を要する）での通過が必須であり、進行役はこの前提でstrict profileのゲートレビューを手配する。レビュア確保が不可能な場合は`unavailable: human_required`に従い人間判断へ昇格する
- 検証方法見込み: `manual`

## スコープ外

- `RULES.md`・`manifest.yaml`・`interactive-implementation-delegation.md`以外のproject固有ポリシー文書（`自己拡張ワークフロー.md`・`OPERATING_PRINCIPLES.md`・`MODEL_TIER_TABLE.md`）の内容変更。
- `.agent-skill-chain/config/agent-skill-chain.yaml`の`worker.segment_overrides.implementation`（ISSUE-307で恒久設定済み）の変更。
- agent-skill-chain正規Issueフロー上のimplementation segment workerの起動プロンプト構成（`src/commands/segment.ts`・`.agent-skill-chain/config/roles.yaml`）の変更。
- consumer project向け配布物・挙動への影響（`.agent-skill-chain/project/`は配布対象外のため対象外）。
- 新規CI検査ルールの追加・既存CI検査スクリプトの改修（`verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`の走査対象へ`.agent-skill-chain/project/`を含める変更を含む。本Issueはこれらの検査が`.agent-skill-chain/project/`配下を検証しないという既存の制約を前提として受入条件を定義するに留め、検査自体の改修は別Issueの対象とする）。
