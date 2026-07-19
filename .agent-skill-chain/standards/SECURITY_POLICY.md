# セキュリティポリシー

> 正本: `AGENTS.md` §不変条件I5・I6 / §役割・権限・writer lease / §コーディネーションバックエンド / `config/roles.yaml`
>
> 本ファイルは仕様書中の既存原則を集約したものであり、新しい方針を独自に定義しない。矛盾が生じた場合は `AGENTS.md` および `config/roles.yaml` を正とする。

## 権限モデル：credential/権限分離が主機構

権限の実装は、ツール名（Bash・Agent・gh 等）の一律 deny によるコマンドパターン分類では行わない（`AGENTS.md` I5）。担保するのは役割ごとの credential / GitHub 権限分離である。

- fine-grained PAT（Personal Access Token）
- GitHub App installation permission
- 実行環境の権限設定

「何のツールを使うか」ではなく「どの資格情報で何ができるか」によって権限境界を決める。ワーカー用の資格情報は、マージ・ゲート承認・他 Issue のラベル変更を行えない。進行役用の資格情報は、成果物ブランチへの書込み権限を持たない。

## ロールごとの権限境界（正本: `config/roles.yaml`）

各ロールの具体的な `capabilities` / `forbidden` の一覧は `config/roles.yaml` を正本とする。本ファイルでは境界の要旨のみを示す。

| ロール | 権限境界の要旨 |
|---|---|
| 進行役（orchestrator） | writer lease 対象外。成果物ブランチへの commit（`artifact_branch.commit`）・成果物の著述/内容取り込み（`artifact.author`）は禁止（I5：進行役の純粋性）。Issue 作成・状態遷移・worktree ライフサイクル管理・PR マージのみを行う。 |
| セグメント作業ワーカー（worker） | writer lease を保持し、自ブランチへの commit/push のみが許可される。他 Issue・他ブランチへの書込みは行わない。 |
| ゲートレビュア（gate_reviewer） | read-only。`branch.commit` / `branch.push` / `artifact.edit` は禁止。レビュー結果は Check Run（GitHub モード）または `reviews/<gate>.yaml`（ローカルモード）への発行のみ行う。 |
| ADR finalization ワーカー（adr_finalization_worker） | writer lease を保持するが、書込み範囲は ADR の status 系フィールド（`status` / `superseded-by` / `deprecated-reason` / `tags`）のみに限定（`scope: adr_status_only`）。`id` / Context / Decision / Consequences / `supersedes` を含む ADR 本文の編集（`adr.content_edit`）は禁止。 |

## writer lease による同時書込み制御

1 Issue につき同時に許可される writer lease は 1 つのみ（read-only のゲートレビュアは複数並列実行可）。この制約が、複数ワーカーによる同時書込みに起因する競合・破損（race condition によるブランチ破壊等）を防ぐ主機構である。lease の取得・更新・解放は各 Coordination Backend の compare-and-set 相当の原子的処理で実装し、スキーマは `schemas/lease.schema.yaml` を正本とする（既定 `ttl_seconds: 3600` / `renewal_interval_seconds: 900`）。期限切れ lease は `scripts/reconcile.sh` が検出し、成果物の push 状態を確認したうえで回収するか、人間判断へ昇格する。

## Coordination Backend の正本は一方のみ

調整状態（Issue・ブランチ・PR・ゲート状態等）の正本は、GitHub モードまたはローカルモードのいずれか一方のみであり、二重化しない（`AGENTS.md` I6）。複数バックエンド間で同一 Issue の状態を同期する設計は採用しない——「どちらが正しいか」という二重正本問題を再生産するためである。GitHub モードでは Issue・PR・ブランチ・Check Run が正本、ローカルモードでは `state.yaml`（Issue 毎、Git 管理下）が正本となる。
