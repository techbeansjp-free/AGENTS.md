# SPEC: consumer project固有ポリシー（`.agent-skill-chain/project/`）の作成導線・雛形が皆無で導入時に設定方法が分からない

- Issue: `ISSUE-586`
- 作成者: `spec_worker`
- 対象ブランチ: `process/586-project-policy-scaffold`

## 目的・背景

AGENTS.md（規範文書）は、consumer project がプロジェクト固有の追加プロセス規約を `.agent-skill-chain/project/`（`manifest.yaml` + `RULES.md`、role固有規約が必要な場合のみ `roles/<role>.md`）に自然文で記述できると定めている。`manifest.yaml` は `.agent-skill-chain/schemas/project-policy.schema.yaml` で検証される。

しかし現状の `init`/`setup github`/`upgrade`/`uninstall` のいずれも、consumer project 側に `.agent-skill-chain/project/` ディレクトリを作成・案内しない。`upgrade`/`uninstall` が `project/` を対象から除外するのは、consumer の独自ポリシーを誤って上書き・削除しないための意図的な安全設計であり、README.md が明記する「`upgrade` は project/ に対して不可侵」「`uninstall` は project/ を保持する」という不変条件（本 Issue では変更しない）と一致する。ところがこの除外の副作用として、`init` を新規実行しても `.agent-skill-chain/project/` 自体もその配下のファイルも一切作成されない。

代替の道しるべも存在しない。`.agent-skill-chain/templates/` 配下には `manifest.yaml`/`RULES.md` の雛形ファイルが standard/lightweight いずれのプロファイル向けにも存在しない。`docs/CONFIGURATION.md` は「プロジェクト固有ポリシーの書式は対象外とする」と明記して解説を除外している。`README.md` は AGENTS.md への参照のみで実例を示さない。`doctor` コマンドは `.agent-skill-chain/project/manifest.yaml` の有無を一切チェック・案内しない。CLI（`src/commands/` 配下、`bin/agents-md.js` のルーティング）には `project/` を新規作成するための専用サブコマンドが存在しない。加えて `src/lib/project-policy.ts` は `manifest.yaml` が存在しない場合、エラーにせず「追加ポリシーなしで動作」する後方互換パス（空配列を返す）へ静かにフォールバックし、CLI は何も警告しない。

結果として、`.agent-skill-chain/project/` という機能の存在自体が AGENTS.md の散文以外の場所に一切現れず、consumer project の導入者は実際にどう作ればよいかを把握する手段を持たない。2026-08-11、別プロジェクトでの新規導入時にユーザーから同様の報告を受けた。本 Issue は、`project/` を「意図的に除外して安全を保つ」という既存の不変条件（`upgrade`/`uninstall` の不可侵・保持）を崩さないまま、consumer project が `.agent-skill-chain/project/` の作り方を把握できる具体的な導線を用意することを目的とする。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

- `.agent-skill-chain/project/` を新規に使い始めたい consumer project の導入者が、AGENTS.md の散文を読み解かなくても、何を・どこに・どのスキーマに沿って書けばよいかを把握できる具体的な手がかりを、導入操作（`init` 等）またはリポジトリ内の成果物から直接得られるようにしてほしい（2026-08-11、別プロジェクトでの新規導入時にユーザーから報告）。
- 既存の `upgrade`/`uninstall` が `project/` を上書き・削除しない安全な既定動作は、今回の変更後も維持してほしい。

### 要件

- 要件1: consumer project は、`init`（新規導入、`--dry-run` 無し）を実行した結果として、`.agent-skill-chain/project/` の作り方（雛形ファイルの配置、または具体的な作成手順を示す案内メッセージ）を把握できる。
- 要件2: 要件1で提供される雛形または案内内容は、`.agent-skill-chain/schemas/project-policy.schema.yaml` が要求する `manifest.yaml` の必須フィールド（`schema_version`・`project`・`documents`・`precedence`・`constraints`、および各々のネストした必須プロパティ）を過不足なく満たす、またはそれらを満たす具体的な記述例を提示する。
- 要件3: 要件1・要件2で導入する手段は、`upgrade` が既存の `.agent-skill-chain/project/` 配下のファイルを上書き・削除しない（README.md記載の不可侵）という既存の不変条件を変更しない。
- 要件4: 要件1・要件2で導入する手段は、`uninstall` が既存の `.agent-skill-chain/project/` 配下のファイルを削除せず保持するという既存の不変条件を変更しない。
- 要件5: `docs/CONFIGURATION.md` または新規に追加する文書に、`.agent-skill-chain/project/manifest.yaml` と `RULES.md` の組み合わせについて、そのまま流用または参考にできる具体的な最小記述例（`schema_version`・`project`・`documents`・`precedence`・`constraints` を含む）を追記する。
- 要件6: 要件1で新規に `.agent-skill-chain/project/` 配下へ何らかのファイルを作成する場合、既に `.agent-skill-chain/project/manifest.yaml` が存在する対象ディレクトリへ `init` を再実行しても、既存の `manifest.yaml`・`RULES.md`・`roles/` 配下のファイル内容を上書き・削除しない。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える（構造化マーカーの強制は `bdd.profile: strict` の場合のみ。`.agent-skill-chain/config/agent-skill-chain.yaml` 参照）。以下の `<...>` は全て実内容に置き換える。空欄・プレースホルダ残存は `verify spec-bdd`（`.agent-skill-chain/ci/verify-spec-bdd.sh`）が機械検査し、spec-gate通過を妨げる。検証方法見込みは `automated`・`manual`・`hybrid` のいずれか1語で記す。

#### AC-1: `init` 新規導入後に `.agent-skill-chain/project/` の作り方を把握できる具体的な導線が存在する

- Given: `.agent-skill-chain/project/` が存在しない空のディレクトリ
- When: `agent-skill-chain init`（`--dry-run` 無し）を実行する
- Then: 実行結果（標準出力メッセージ、または新規作成されたファイル）から、`.agent-skill-chain/project/manifest.yaml`・`RULES.md` をどこに・どのスキーマで作成すればよいかが具体的に分かる（AGENTS.md の散文だけを頼りにする必要がない）
- 検証方法見込み: `automated`

#### AC-2: 提供される雛形・案内内容が `project-policy.schema.yaml` の必須フィールドと整合する

- Given: AC-1 の実行によって得られた雛形ファイルまたは案内メッセージ中の記述例
- When: その内容（雛形ファイルであれば `manifest.yaml` としてそのまま、案内メッセージであれば例示された記述）を `.agent-skill-chain/schemas/project-policy.schema.yaml` に照らして検証する
- Then: `schema_version`・`project`（`id`・`policy_version`）・`documents`（`common`・`roles`）・`precedence`（`level`・`overrides`）・`constraints`（`may_override_core_invariants`・`unregistered_documents_are_normative`）の必須フィールドが全て充足され、スキーマ検証がエラーなく通る
- 検証方法見込み: `automated`

#### AC-3: `upgrade` は既存の `.agent-skill-chain/project/` を上書き・削除しない（回帰なし）

- Given: `.agent-skill-chain/project/manifest.yaml`・`RULES.md` を含む既導入の consumer project ディレクトリ
- When: パッケージの新しいバージョンに対して `agent-skill-chain upgrade`（`--dry-run` 無し）を実行する
- Then: `.agent-skill-chain/project/` 配下の既存ファイルの内容・存在が一切変更されない
- 検証方法見込み: `automated`

#### AC-4: `uninstall` は既存の `.agent-skill-chain/project/` を保持する（回帰なし）

- Given: `.agent-skill-chain/project/manifest.yaml`・`RULES.md` を含む既導入の consumer project ディレクトリ
- When: 安全確認を満たした状態で `agent-skill-chain uninstall`（`--dry-run` 無し）を実行する
- Then: agent-skill-chain が管理する他の資産は撤去されるが、`.agent-skill-chain/project/` 配下の既存ファイルは削除されず保持される
- 検証方法見込み: `automated`

#### AC-5: 成果物に `manifest.yaml`/`RULES.md` の最小具体例が追記されている

- Given: `docs/CONFIGURATION.md` または本 Issue で新規追加する成果物
- When: その成果物を参照する
- Then: `.agent-skill-chain/project/manifest.yaml` の必須フィールドを全て埋めた最小具体例と、対応する `RULES.md` の記述例が、当該成果物内に自己完結して記載されている
- 検証方法見込み: `manual`

#### AC-6: `init` の再実行は既存の `.agent-skill-chain/project/manifest.yaml` を上書きしない

- Given: `.agent-skill-chain/project/manifest.yaml` が既に存在し、AGENTS.md の既定の記述内容とは異なる内容（consumer project 独自の値）を持つディレクトリ
- When: 同じディレクトリに対して `agent-skill-chain init`（`--dry-run` 無し）を再実行する
- Then: 既存の `.agent-skill-chain/project/manifest.yaml` の内容が変更されない
- 検証方法見込み: `automated`

<!-- AC を追加する場合は AC-7, AC-8 ... と連番で追加する -->

## スコープ外

- `.agent-skill-chain/project/` の作り方を提示する具体的な実現手段の選定（`.agent-skill-chain/templates/` へのコメント付き雛形追加、`init` 実行時の案内メッセージ標準出力、明示オプトインによる雛形生成コマンドの新設、またはこれらの組み合わせ）。要件1・要件2の充足方法は `DESIGN.md` で確定する。
- `manifest.yaml`/`RULES.md` 以外の `.agent-skill-chain/project/roles/<role>.md` の雛形・案内の要否。本 Issue は `documents.common`（`RULES.md`）と `manifest.yaml` を最小限の対象とし、role固有規約の雛形提供が必要かどうかの判断は `DESIGN.md` に委ねる。
- `project-policy.schema.yaml` 自体のフィールド追加・変更。本 Issue はスキーマの現状定義への準拠を扱うのみで、スキーマの改定は対象外とする。
- `doctor` コマンドへの `.agent-skill-chain/project/manifest.yaml` 不在時の情報提示ロジックの追加要否。問題調査（Issue本文）では調査済み事項として挙げられているが、要件1・要件2（`init` を起点とした導線）で目的が達成できる場合、`doctor` 側の追加対応は必須としない。追加するか否かは `DESIGN.md` で判断する。
- `src/lib/project-policy.ts` が `manifest.yaml` 不在時に「追加ポリシーなしで動作」する後方互換フォールバック自体の挙動変更（エラー化・警告表示への変更）。本 Issue は導入時の作成導線の欠如を解決することが目的であり、実行時フォールバック挙動の是非は別Issueの対象とする。
- consumer project が実際にどのようなプロジェクト固有ポリシーを書くべきかという内容面のガイダンス（業種・組織固有のルール文例作成等）。
