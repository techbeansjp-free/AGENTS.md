# SPEC: project固有ポリシー(manifest.yaml登録文書)がsegment start経由でワーカーへ配布されない

- Issue: `ISSUE-326`
- 作成者: `orchestrator`
- 対象ブランチ: `bugfix/326-segment-start-policy-dist`

## 目的・背景

AGENTS.md「プロジェクト固有ポリシー」節は「進行役は `manifest.yaml` 全体を読み、各ワーカーには `documents.common` と自role分のみを渡す」と定める。しかし `agent-skill-chain segment start`（`src/commands/segment.ts` の `start()`）が組み立てるセグメント作業ワーカー起動プロンプトは `.agent-skill-chain/config/roles.yaml` の `role_contracts.<segment>_worker` のみで構成され、`.agent-skill-chain/project/manifest.yaml` を一切読み込まない。

結果として、`documents.common`（`RULES.md`・`自己拡張ワークフロー.md`・`OPERATING_PRINCIPLES.md`・`MODEL_TIER_TABLE.md`）および `documents.roles.<segment>` に登録された project 固有ポリシー文書は、spec/design/implementation/validationいずれのセグメント作業ワーカーにも一度も配布されていない。これは仕様（AGENTS.md）と実装の食い違いであり、project固有ポリシーが実効性を持たない状態を放置している。

## 要求 → 要件 → 受入条件

### 要求

`segment start` で起動するセグメント作業ワーカーが、`.agent-skill-chain/project/manifest.yaml` に登録された project 固有ポリシー文書（`documents.common` および自セグメント分の `documents.roles.<segment>`）を実際に読める状態にする。

### 要件

- manifest.yamlが存在するプロジェクトでは、`segment start <issue_id> <segment>` の出力に `documents.common` の各文書内容が含まれる。
- `documents.roles.<segment>` にそのセグメント向けの文書が登録されていれば、その内容も含まれる。
- manifest.yaml自体が存在しない（project固有ポリシー未導入の）consumer projectでは、従来どおり `role_contract` のみが出力される（後方互換）。
- manifest.yamlが存在するがスキーマに適合しない場合は、サイレントに無視せずエラーとして扱う（I8: 迷ったら安全側）。

### 受入条件（Acceptance Criteria）

#### AC-1: documents.commonの配布

- Given: `.agent-skill-chain/project/manifest.yaml` が存在し、`documents.common` に1件以上の文書パスが登録されている。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 標準出力に、`documents.common` に列挙された各ファイルの内容が含まれる。
- 検証方法見込み: `automated`

#### AC-2: documents.roles.<segment>の配布

- Given: `.agent-skill-chain/project/manifest.yaml` の `documents.roles.<segment>` に、当該セグメント向けの文書パスが1件以上登録されている。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 標準出力に、その文書の内容が含まれる。他セグメント向けに登録された文書（例: `documents.roles.spec` のみに登録された文書）は、`implementation` セグメント起動時の出力には含まれない。
- 検証方法見込み: `automated`

#### AC-3: manifest.yaml不在時の後方互換

- Given: `.agent-skill-chain/project/manifest.yaml` が存在しない。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 現行と同じ出力（`role:` ＋ `issue:`（あれば）＋ `role_contracts` のみ）を返し、エラーにならない。
- 検証方法見込み: `automated`

#### AC-4: manifest.yamlスキーマ不正時のfail-safe

- Given: `.agent-skill-chain/project/manifest.yaml` が存在するが、`project-policy` スキーマに適合しない（例: 必須フィールド欠落）。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: エラーを返し、終了コードは非0になる（サイレントに無視して起動を続けない）。
- 検証方法見込み: `automated`

#### AC-5: 既存動作への非破壊

- Given: 本Issueの変更後のコードベース。
- When: `npm test` を実行する。
- Then: `self-extension-policy` 関連テスト・`schema` 関連テスト・その他既存テストが全て成功し続ける。
- 検証方法見込み: `automated`

## スコープ外

- `.agent-skill-chain/project/manifest.yaml` のスキーマ（`project-policy.schema.yaml`）自体の変更。
- ゲートレビュア（`launch_gate_reviewer`）へのproject policy配布（別Issueで扱う）。
- 対話セッション（Claude Code CLI等での直接チャット）における実装委譲の運用（`.agent-skill-chain/project/roles/implementation.md` で別途定義済み、本Issueの対象外）。
