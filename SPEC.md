# SPEC: プロジェクトポリシーへのCI確認義務・Codex実装委譲ロールの正規commit化

- Issue: `ISSUE-340`
- 作成者: `spec_worker`
- 対象ブランチ: `process/340-policy-ci-check-codex-role`

## 目的・背景

前セッションの作業中、`.agent-skill-chain/project/RULES.md`・`.agent-skill-chain/project/manifest.yaml`への変更と、新規ファイル`.agent-skill-chain/project/roles/implementation.md`が、正規の4セグメントフロー（Issue・ブランチ・PR・ゲート）を経ずに main worktree 上で未commitのまま放置された。本Issueはこれを正規化し、既に内容が確定している3つの変更を、SPEC/DESIGN/実装/検証の正規フローに乗せてcommit・PR化することを目的とする。

対象は3件。(1) `RULES.md`へCI確認義務の追記、(2) `manifest.yaml`の`documents.roles.implementation`登録と`policy_version`更新、(3) 新規`roles/implementation.md`（対話セッション中の実装作業をCodex CLIへreasoning effort `high`（実装者判断で`xhigh`許可）で委譲する project 固有ポリシー）の追加。いずれも内容は既に確定済みであり、本Issueでの要求の再検討は行わない。

## 要求 → 要件 → 受入条件

### 要求

- 開発者（進行役）として、PR作成後にCI結果を確認せずレビュー依頼・マージ判断へ進んでしまう事故を防ぎたいので、`RULES.md`にCI確認義務を明文化してほしい。
- 開発者として、対話セッション中の実装依頼はCodex CLIへ委譲するという既存の運用実態を、project固有ポリシーとして`manifest.yaml`経由で正規に読み込ませたい。
- 開発者として、上記2件を`.agent-skill-chain/schemas/project-policy.schema.yaml`に適合する形でmanifestへ反映し、CI検証（`verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`）を通過させたい。

### 要件

- `RULES.md`の「追加規約」箇条書きの末尾に、PR作成後のCI（Check Run・ワークフロー実行結果）確認義務を1行追記する。文言は「PR作成後は、必ずCI（Check Run・ワークフロー実行結果）にエラーが無いかを確認する。エラーがあれば原因を特定し、修正して再pushするか、対応不能な場合はユーザーへ報告する。CI結果を未確認のままレビュー依頼・マージ判断へ進めない。」とする。
- `manifest.yaml`の`project.policy_version`を`2`から`3`へ更新する。
- `manifest.yaml`の`documents.roles.implementation`に`roles/implementation.md`を登録する（現状`roles: {}`）。
- 新規ファイル`.agent-skill-chain/project/roles/implementation.md`を作成する。内容は、対話セッション中にユーザーから直接実装を依頼された場合に限り、実装作業をCodex CLI（`codex exec`）へreasoning effort `high`（既定、実装者=Codexの判断で`xhigh`への格上げを許可）で委譲することを定める。agent-skill-chain正規Issueフロー上のimplementation segment worker（`agent-skill-chain.yaml`の`worker.segment_overrides.implementation`が別途規定）には影響しないことを本文中に明記する。
- `manifest.yaml`は`.agent-skill-chain/schemas/project-policy.schema.yaml`に適合し続ける（`documents.roles.implementation`は配列型であり、スキーマの`roles`プロパティ定義に既に存在する）。
- 本Issueの変更後も`.agent-skill-chain/ci/verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`が通過する。

### 受入条件（Acceptance Criteria）

#### AC-1: RULES.mdへのCI確認義務追記

- Given: `.agent-skill-chain/project/RULES.md`の「追加規約」節に既存4項目の箇条書きがある
- When: 5項目目として「PR作成後は、必ずCI（Check Run・ワークフロー実行結果）にエラーが無いかを確認する。エラーがあれば原因を特定し、修正して再pushするか、対応不能な場合はユーザーへ報告する。CI結果を未確認のままレビュー依頼・マージ判断へ進めない。」を追記する
- Then: `RULES.md`の当該箇条書きに上記文言が一言一句そのまま存在し、既存4項目は変更されない。かつ`.agent-skill-chain/ci/verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`が通過する
- 検証方法見込み: `automated`

#### AC-2: manifest.yamlへのimplementationロール登録とpolicy_version更新

- Given: `.agent-skill-chain/project/manifest.yaml`が`project.policy_version: 2`かつ`documents.roles: {}`である
- When: `project.policy_version`を`3`へ変更し、`documents.roles.implementation`に`[roles/implementation.md]`を設定する
- Then: `manifest.yaml`が`.agent-skill-chain/schemas/project-policy.schema.yaml`に適合し、`documents.roles.implementation`が`["roles/implementation.md"]`、`project.policy_version`が`3`になっている。他フィールド（`documents.common`・`precedence`・`constraints`・`model_selection`）は変更されない
- 検証方法見込み: `automated`

#### AC-3: roles/implementation.mdの新規作成

- Given: `.agent-skill-chain/project/roles/`ディレクトリが存在しない
- When: `.agent-skill-chain/project/roles/implementation.md`を新規作成し、対話セッション中の実装依頼をCodex CLI（`codex exec`）へreasoning effort `high`（実装者判断で`xhigh`許可）で委譲する旨、およびagent-skill-chain正規Issueフローのimplementation segment workerには影響しない旨を記述する
- Then: `roles/implementation.md`が存在し、AC-2で`manifest.yaml`に登録した参照先パスと一致する。CI検査対象言語（禁止語・セクション番号参照・ファイルパス＋行番号参照の禁止）に適合し、`.agent-skill-chain/ci/verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh`が通過する
- 検証方法見込み: `automated`

#### AC-4: 3変更の一括commit・push・Draft PR化

- Given: AC-1〜AC-3の変更内容がworktree `process/340-policy-ci-check-codex-role`上に存在する
- When: 変更をcommitし、リモートブランチ`process/340-policy-ci-check-codex-role`へpushし、`Closes #340`を含むDraft PRを作成する
- Then: リモートブランチに変更がpush済みであり、Draft PRが本Issueをclose対象として参照している。以降の設計・実装・検証セグメントは同一PRのheadブランチへcommit/pushする
- 検証方法見込み: `manual`

## スコープ外

- `RULES.md`・`manifest.yaml`・`roles/implementation.md`以外のproject固有ポリシー文書（`自己拡張ワークフロー.md`・`OPERATING_PRINCIPLES.md`・`MODEL_TIER_TABLE.md`）の内容変更。
- `.agent-skill-chain/config/agent-skill-chain.yaml`の`worker.segment_overrides.implementation`（ISSUE-307で恒久設定済み）の変更。
- agent-skill-chain正規Issueフロー上のimplementation segment workerの起動プロンプト構成（`src/commands/segment.ts`・`.agent-skill-chain/config/roles.yaml`）の変更。
- consumer project向け配布物・挙動への影響（`.agent-skill-chain/project/`は配布対象外のため対象外）。
- 新規CI検査ルールの追加・既存CI検査スクリプトの改修。
