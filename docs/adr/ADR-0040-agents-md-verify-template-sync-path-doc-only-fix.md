# ADR

```yaml
id: ADR-0040
status: proposed   # proposed | accepted | superseded | deprecated
title: verify-template-sync.shパス誤記はコード配置変更ではなくAGENTS.md記載修正で解消する
tags: [documentation, self-consistency]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`AGENTS.md`「GitHub配布・マルチAI対応」節は `.github/` の同期検査スクリプトとして `.agent-skill-chain/scripts/verify-template-sync.sh` を記載しているが、実際のファイルは `.agent-skill-chain/ci/verify-template-sync.sh` に存在し、`.agent-skill-chain/scripts/verify-template-sync.sh` は存在しない。実在するCIワークフロー（`.github/workflows/agent-skill-chain-ci.yml`・配布元テンプレート `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`）はいずれも `.agent-skill-chain/ci/verify-template-sync.sh` を呼び出している。さらに `AGENTS.md`「ディレクトリ構成」節のツリー表記は `ci/` 配下の一覧に `verify-template-sync` を正しく列挙しており、`AGENTS.md` は本文内で自己矛盾している。2026-08-10、別プロジェクトでのCodeRabbitレビューにより指摘を受け、ユーザーから報告された（ISSUE-553）。

この不一致を解消する手段は次の2通りが考えられた。

1. **文書側を実在コード配置へ合わせる**: `AGENTS.md`の記載を `.agent-skill-chain/ci/verify-template-sync.sh` に修正する。コード・CIワークフロー・スキーマは一切変更しない。
2. **コード側を文書の記載へ合わせる**: `.agent-skill-chain/ci/verify-template-sync.sh` を `.agent-skill-chain/scripts/verify-template-sync.sh` へ移動し、CIワークフロー（本体・配布元テンプレート双方）の呼び出しパスを追従修正する。

選択肢2は、`.agent-skill-chain/ci/` に集約されている他の検証スクリプト（`verify-branch-name.sh`・`verify-worktree-path.sh`・`verify-doc-length.sh`・`verify-ac-coverage.sh`・`verify-gate-report.sh`・`verify-artifacts.sh`・`verify-adr.sh` 等）との配置一貫性を崩し、CIワークフロー本体と配布元テンプレートの双方を同時に変更する必要があるため変更範囲・リスクが大きい。選択肢1は `AGENTS.md`「ディレクトリ構成」節が既に `ci/` 配下への配置を正しい設計として列挙しており、その既存の正しい記載と一致させるだけで自己矛盾を解消できる。

## Decision

`AGENTS.md`「GitHub配布・マルチAI対応」節の該当文中、`.agent-skill-chain/scripts/verify-template-sync.sh` という誤記載を実在パス `.agent-skill-chain/ci/verify-template-sync.sh` へ修正する（選択肢1を採用）。`.agent-skill-chain/ci/verify-template-sync.sh` 自体の配置、CIワークフローの呼び出しパス、同一文中に併記されている `setup-labels.sh`・`setup-ruleset.sh` への言及（`.agent-skill-chain/scripts/` 配下、実在パスと既に一致）は変更しない。

## Consequences

- `AGENTS.md`本文中の`verify-template-sync.sh`へのパス言及が全箇所で実在パスと一致し、「GitHub配布・マルチAI対応」節と「ディレクトリ構成」節の間の自己矛盾が解消される。
- 実行コード・CIワークフロー・スキーマ・設定への変更が一切無いため、既存の検証挙動・呼び出し経路に影響しない。
- `.agent-skill-chain/ci/` 配下への検証スクリプト集約という既存の配置方針が維持される。
- フォローアップ: 本Issueのスコープ外である他成果物（README.md・`.agent-skill-chain/standards/` 配下等）における同種のパス言及の網羅点検は対象外とする。将来別Issueで必要性が判断された場合に扱う。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```

- `proposed → accepted`: 設計ゲート承認時に遷移する。設計レビュアは ADR 本文をレビューし content digest を承認するのみ（read-only、直接 status を書き換えない）。進行役が `.agent-skill-chain/scripts/adr-finalize.sh` を起動し、専任の ADR finalization ワーカーが writer lease を取得したうえで `status` のみを `accepted` に更新して commit・push する（`.agent-skill-chain/config/roles.yaml` の `adr_finalization_worker`、`scope: adr_status_only`）。finalization ワーカーは書込み前に content digest を再検査する。
- `accepted → superseded`: 新しい ADR を含む同一 PR 内で、新 ADR の作者（ワーカー）が旧 ADR の `status` / `superseded-by` を同一 PR で更新する。`supersedes` ⇔ `superseded-by` の対称性・参照先の実在が機械検査される。
- `accepted → deprecated`: 前提が消滅し後継が無い場合に遷移する。`deprecated-reason` に1行の理由を記録する（存在検査あり）。

## related_adrs 参照ルール

他 Issue の `DESIGN.md` から本 ADR を参照する場合は `related_adrs:` フィールド（構造化リスト）を用いる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。本文中の自然文による歴史的言及（例: 「本決定は ADR-0007 を置き換える」）は検査対象外であり許可される。
