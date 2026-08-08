# CONFIGURATION.md — agent-skill-chain 設定リファレンス

## 目的・対象範囲

本ドキュメントは、agent-skill-chain の設定項目を一覧し、各値が運用へ与える影響と設定軸同士の関係を説明する。対象は `.agent-skill-chain/schemas/config.schema.yaml` のトップレベルプロパティのうち、版識別子 `schema_version` を除く全項目である。

設定値の正本は `.agent-skill-chain/config/agent-skill-chain.yaml`、許容する構造と値の正本は `.agent-skill-chain/schemas/config.schema.yaml` である。本ドキュメントの「既定値」は前者に同梱された値を示す。後方互換のため省略可能な項目は、CLI が適用する「未設定時」の値も併記する。

対象読者は、agent-skill-chain を導入・運用する開発者と、進行役・セグメント作業ワーカー・ゲートレビュアである。設定項目の追加・削除、スキーマ migration、プロジェクト固有ポリシーの書式は対象外とする。

## 前提・用語

- **Coordination Backend**: 調整状態の正本。GitHub またはローカル Git 管理下状態のどちらか一方を選ぶ。
- **現在値**: 同梱された `.agent-skill-chain/config/agent-skill-chain.yaml` に明記された値。
- **未設定時**: 後方互換の任意項目が設定ファイルに存在しない場合に CLI が採る値。
- **review profile**: Standard・Light・Strict のレビュー構成。`risk` と `autonomy` が Standard または Strict の基準を決め、Light は人間が別の調整状態シグナルで明示要求した安全な場合だけ適用される。
- **consumer プロジェクト**: agent-skill-chain を導入して利用する対象リポジトリ。本リポジトリ自身の dogfooding 設定とは区別する。

## 設定項目一覧

### `coordination`

- **既定値**: `backend: github`
- **取りうる値**: `backend` は `github | local`。
- **影響**: Issue・PR・Check Run を調整状態の正本にするか、Git 管理下の `state.yaml` と `reviews/<gate>.yaml` を正本にするかを選ぶ。両方を同一 Issue の正本として同期しない。
- **詳細**: [AGENTS.md の「Coordination Backend」](../AGENTS.md#coordination-backend)

### `durability`

- **既定値**: `backend: remote`
- **取りうる値**: `backend` は `remote | local_mirror`。
- **影響**: checkpoint の push 先はどちらも Git の `origin` であり、この値は `doctor` が `origin` をネットワーク上の remote として疎通確認するか、ローカルミラーのパスとして存在確認するかを切り替える。
- **詳細**: [AGENTS.md の不変条件 I3「耐久性」](../AGENTS.md#不変条件-i1i8)

### `autonomy`

- **既定値**: `default: gated`
- **取りうる値**: `default` は `gated | full`。
- **影響**: レビュープロファイル選択に使う。`full` は無条件に Strict を要求するが、実装着手やマージの許可を単独では与えない。
- **詳細**: [AGENTS.md の不変条件 I8「安全側ラチェット」](../AGENTS.md#不変条件-i1i8)

### `risk`

- **既定値**: `default: unclassified`
- **取りうる値**: `default` は `unclassified | normal | high`。
- **影響**: `normal` 以外は Strict review を要求する。`unclassified` も安全側に Strict として扱い、quick 成果物免除の対象外になる。
- **詳細**: [AGENTS.md の不変条件 I8「安全側ラチェット」](../AGENTS.md#不変条件-i1i8)

### `review`

- **既定値**: `adapter: claude`、Standard は reviewer 1体で `conformance` と `falsification`、Strict は reviewer 2体で `risk_not_normal` または `autonomy_full` をトリガーとする。
- **取りうる値**: `adapter` は `claude | codex | human`。各 `reviewer_count` は1以上の整数、Standard の `modes` は `conformance | falsification` の配列、Strict の各トリガーは真偽値。
- **影響**: 現行 CLI は `adapter` と、選択済み Standard/Strict profile の `reviewer_count` をゲートレビュー起動に使う。基準 profile は I8 の `risk != normal` または `autonomy == full` で決まり、`standard.modes` と `strict.trigger` は現行 CLI の分岐では参照しない。Light はこの設定ではなく、人間が付与した `review:light` 等の独立シグナルと安全側ガードレールから決まる。
- **詳細**: [AGENTS.md の「4 セグメント・4 ゲート」](../AGENTS.md#4-セグメント4-ゲート)

### `worker`

- **既定値**: `adapter: claude`。`implementation` だけ `adapter: codex`、`model_tier: highest_capability`、`reasoning_effort: high` で上書きし、`highest_capability.codex: gpt-5.6-sol` へ解決する。
- **取りうる値**: adapter は `claude | codex | human`。上書き対象は `spec | design | implementation | validation`、`model_tier` は `highest_capability`、`reasoning_effort` は `medium | high | xhigh`。tier と effort の指定時は `adapter: codex` が必須で、`model_tiers.highest_capability.codex` は空でないモデル文字列を取る。
- **影響**: セグメント作業ワーカーの実行系とモデル選択を決める。具体的なモデル文字列は `model_tiers` だけに置き、セグメント別設定は tier 名を参照する。セグメント別 adapter が無い場合は `worker.adapter`、それも無い場合は `human` へフォールバックする。
- **詳細**: [ADR-0015: セグメントワーカーの adapter と model tier 設定](adr/ADR-0015-segment-worker-adapter-and-model-tier-config.md)

### `worktree`

- **既定値**: `root: .worktrees`、`path_pattern: "{issue_created_at}-{type}-{issue_id}-{slug}"`、timestamp は Issue 作成日時を `Asia/Tokyo` の `%Y%m%d_%H%M%S` で表現、`slug_max_length: 48`、`immutable_path: true`。
- **取りうる値**: `root`・`path_pattern`・timestamp の `source | format | timezone` は文字列、`slug_max_length` は1以上の整数、`immutable_path` は真偽値。
- **影響**: 現行 CLI は `root`・`path_pattern`・`timestamp.format`・`slug_max_length` を配置、命名、入力検査に使う。`timestamp.source`・`timestamp.timezone`・`immutable_path` はスキーマで保持する契約値であり、現行 CLI の分岐では参照しない。実在 worktree の正本は `git worktree list --porcelain` である。
- **詳細**: [AGENTS.md の「ブランチ・worktree」](../AGENTS.md#ブランチworktree)

### `branch`

- **既定値**: `pattern: "{type}/{issue_id}-{slug}"`
- **取りうる値**: `pattern` は文字列。利用可能な placeholder は CLI が解釈する命名契約に従う。
- **影響**: 1 Issue に対応する branch 名を決め、branch-name 検査と Issue 文脈の解決に使う。
- **詳細**: [AGENTS.md の「ブランチ・worktree」](../AGENTS.md#ブランチworktree)

### `issue`

- **既定値**: `allowed_types: [feature, bugfix, hotfix, refactor, docs, process, chore]`
- **取りうる値**: `allowed_types` は `feature | bugfix | hotfix | refactor | docs | process | chore` から1個以上を選ぶ配列。
- **影響**: `issue start` で許可する作業種別を限定し、branch と worktree の `{type}` に利用する。
- **詳細**: [AGENTS.md の「ブランチ・worktree」](../AGENTS.md#ブランチworktree)

### `wip`

- **既定値**: `limit: 3`、`count_by: active_writer_lease`
- **取りうる値**: `limit` は1以上の整数、`count_by` は `active_writer_lease`。
- **影響**: `limit` が有効な writer lease の同時上限を定める。`count_by` は現在 `active_writer_lease` だけを許容し、現行 CLI も常に同じ方式で数える。
- **詳細**: [AGENTS.md の「役割・権限・writer lease」](../AGENTS.md#役割権限writer-lease)

### `lease`

- **既定値**: `ttl_seconds: 3600`、`renewal_interval_seconds: 900`
- **取りうる値**: どちらも1以上の整数（秒）。
- **影響**: 1 Issue に1つだけ許可される writer lease の有効期間と更新間隔を定め、同時書込みを防ぐ。
- **詳細**: [AGENTS.md の「役割・権限・writer lease」](../AGENTS.md#役割権限writer-lease)

### `bdd`

- **既定値**: `profile: standard`
- **取りうる値**: `profile` は `standard | strict`。
- **影響**: SPEC の BDD 検査強度を表す設定値だが、現行の `verify spec-bdd` はこの値を参照せず両値で同じ検査を行う。gate の Standard/Strict reviewer profile とは別の軸である。
- **詳細**: [AGENTS.md の「ADR・テンプレート・テスト適用性」](../AGENTS.md#adrテンプレートテスト適用性)

### `issue_sync`

- **既定値**: `enabled: false`、`target: issue_body`、`max_body_chars: 60000`。項目全体の未設定時も無効である。
- **取りうる値**: `enabled` は真偽値、`target` は `issue_body | pr_body | both`、`max_body_chars` は1〜65536の整数。
- **影響**: GitHub モードのゲート通過時に、成果物全文とゲート状態を Issue/PR 本文の固定マーカー区間へ一方向転記するかを制御する。ローカルモードでは常に無効として扱う。
- **詳細**: [ADR-0021: GitHub Issue sync と成果物内容の正本](adr/ADR-0021-github-issue-sync-full-text-content-canonical.md)

### `merge`

- **既定値**: 本リポジトリの現在値は `autonomous: true`。任意項目の未設定時は `false` として扱い、consumer の安全側既定とする。
- **取りうる値**: `autonomous` は真偽値。
- **影響**: 進行役が `pr merge` コマンド自体で PR をマージしてよいかを制御する。`true` は実行許可であり、レビュー要否や branch protection を解除しない。
- **詳細**: [AGENTS.md の不変条件 I8「安全側ラチェット」](../AGENTS.md#不変条件-i1i8)

### `human_confirmation`

- **既定値**: 本リポジトリの現在値は `before_implementation: false`。任意項目の未設定時は `true` として扱い、consumer では実装着手前の確認を要求する。
- **取りうる値**: `before_implementation` は真偽値。
- **影響**: implementation セグメント開始前に人間の明示確認を要求するかを制御する。値の極性は `merge.autonomous` と逆である。
- **詳細**: [AGENTS.md の不変条件 I8「安全側ラチェット」](../AGENTS.md#不変条件-i1i8)

### `profile`

- **既定値**: `standard`
- **取りうる値**: `standard | lightweight`。
- **影響**: 軽量プロファイルかどうかを機械的に判定する唯一の正本。`init` 実行時にのみ確定し、`upgrade` では変更されない。`lightweight` は `CLAUDE.md` の `@AGENTS.md` 常時import・強制層（`setup github`・`enforce on`）を適用せず、`coordination.backend: local` を既定にする。`coordination.backend` とは独立した軸であり、既定プロファイルのまま手動で `coordination.backend: local` を選んだ通常のローカルモードとは値として区別される。
- **詳細**: [docs/adr/ADR-0023-agent-skill-chain-as-skill-feasibility.md](adr/ADR-0023-agent-skill-chain-as-skill-feasibility.md)、[AGENTS.md の不変条件 I2「セグメントゲート」](../AGENTS.md#不変条件-i1i8)

### `templates`

- **既定値**: `github_source: .agent-skill-chain/templates/github/.github`、`github_target: .github`、`verify_sync: true`
- **取りうる値**: 各 source と target は文字列、`verify_sync` は真偽値。
- **影響**: GitHub 向けテンプレートの配布元・展開先・同期検査方針を表し、`sync templates` と `verify template-sync` で使う。
- **詳細**: [AGENTS.md の「GitHub配布・マルチAI対応」](../AGENTS.md#github配布マルチai対応)

### `checks`

- **既定値**: `spec | design | implementation | validation` に、それぞれ `agent-skill-chain/<segment>-gate` を設定する。
- **取りうる値**: 各ゲートの Check Run 名を表す文字列。
- **影響**: ゲート結果を発行・照合するときの Check Run 名を定める。4セグメントの構成や判定規則そのものは変更しない。
- **詳細**: [AGENTS.md の「ゲートの継承・無効化」](../AGENTS.md#ゲートの継承無効化)

## 独立な設定軸の関係

設定軸は一つの「自動化レベル」へまとめず、次の責務ごとに独立して評価する。

| 設定軸 | 決めること | 他軸との組み合わせ |
|---|---|---|
| `coordination.backend` | 調整状態とゲート証跡の正本 | `issue_sync` は `github` のときだけ有効。`local` では常に無効 |
| `profile` | `init` 時の導入形態（既定 `standard` / 軽量 `lightweight`） | `coordination.backend` とは独立の別軸。`lightweight` は `init` 時に `coordination.backend: local` を既定にするが、両者は別フィールドであり値として区別される |
| `risk.default` × `autonomy.default` | reviewer profile | `risk != normal` または `autonomy == full` なら Strict。それ以外だけ Standard |
| Light review シグナル | Standard より軽量なレビューの明示要求 | `review` 設定とは独立。人間による要求を確認でき、I8・core review・自己参照変更のガードレールに該当しない場合だけ適用 |
| `human_confirmation.before_implementation` | implementation 着手前の人間確認 | `autonomy` とは独立。`autonomy: full` でも値が未設定または `true` なら確認が必要 |
| `merge.autonomous` | 進行役による `pr merge` 実行許可 | `autonomy` と実装着手確認から独立。`true` でも検査・レビュー・branch protection は維持 |
| `bdd.profile` | SPEC の BDD 記述検査強度 | `review.standard | strict` とは独立 |
| `review.adapter` | ゲートレビュアの実行系 | `worker.adapter` と独立。成果物の著者とレビュアの役割を分離 |
| `wip.limit` × `lease.*` | 同時 writer 数とlease寿命 | worktree の残存数ではなく、有効な writer lease だけを数える |

`merge.autonomous` と `human_confirmation.before_implementation` は真偽の意味も異なる。前者は `true` が自動実行の許可、後者は `true` が人間確認の要求である。いずれを変更しても、`risk` と `autonomy` による Strict 判定は変化しない。

## ARCHITECTURE.md との役割分担

本ドキュメントは「何を設定でき、各値が何に影響するか」を調べるためのリファレンスである。[ARCHITECTURE.md](ARCHITECTURE.md) は Issue 作成から worktree・PR・セグメント・ゲート・マージへ至る動作フロー、役割間の呼出し、状態遷移、主要データ構造を図で理解するための資料である。

設定値の許容範囲は設定スキーマ、運用規約は `AGENTS.md`、処理の図解は `ARCHITECTURE.md` を正本または補助資料とし、本ドキュメントはそれらの内容を置き換えない。

## 入力・出力・制約・完了条件

- **入力**: 同梱設定ファイルと設定スキーマ。
- **出力**: `schema_version` を除く全トップレベル設定の名前、既定値、取りうる値、影響、詳細リンク。
- **制約**: 架空の設定を追加せず、項目ごとに `### \`<key>\`` の見出しを使う。正本の判断内容を外部参照だけへ委譲しない。
- **完了条件・検証方法**: `verify config-doc-sync` がスキーマ側の全トップレベル項目に対応する見出しを検出し、設定ファイル・スキーマとの内容照合で現在値と許容値が一致すること。
- **未決事項**: なし。
- **対象外**: CLI 引数一覧、内部実装の呼出し順、設定項目自体の変更、migration 手順。
