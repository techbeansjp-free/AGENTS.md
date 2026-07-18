# AGENTS.md — agent-skill-chain 憲法

> 本ファイルが正本。CLAUDE.md 等の他ランタイム設定ファイルは `@AGENTS.md` インポートのみを行う。

本システムはソフトウェア開発の管理そのものをドメインとする。状態は選択した Coordination Backend（GitHub の Issue・ブランチ・PR・Check Run、またはローカルの Git 管理下状態ファイル）だけに存在し、Issue を集約ルート、GitHub Flow 標準語彙をユビキタス言語とし、すべての強制は commit・Check Run・マージというイベントへの反応として実装する（DDD）。仕様の受け入れ基準は一意な ID で検証証跡と機械的に結線され、承認後の仕様変更はゲート再通過を自動要求する——文書は書いて終わる散文ではなく、検証され続ける契約である（BDD）。作業は 1 Issue = 1 ブランチ = 1 worktree = 1 PR の小さなバッチで 4 セグメントを通じ並行に流れ、セグメントごとの push により失敗は常に安価に巻き戻せる。可逆だから安全であり、安全だから速い。改善はふりかえり専用の儀式ではなく通常の Issue として自システムの規律の下で処理される（アジャイル）。各スクリプトはちょうど 1 つの状態遷移だけを行い、検査は grep できる形で書き、疑わしい機能は追加しない（UNIX）。既定は常に安全側であり、速度は人間の明示的なオプトイン、危険信号による降格は自動である。

## 不変条件 I1〜I8

「(a) 違反がユーザーの実痛に直結し、(b) 機械的に検査可能」の両方を満たすものだけが不変条件。片方だけならテンプレート内のガイドラインに降格する。

| # | 不変条件 | 検査手段 |
|---|---|---|
| I1 追跡可能性 | 全変更は Issue に紐づき、要求→設計(ADR)→実装→レビューの証跡が Git 履歴に残り、現在有効な決定を指し続ける | PR に Issue 参照必須、成果物存在チェック、`scripts/adr-lint.sh check`（CI） |
| I2 フェーズゲート | 4 セグメント（①要求・要件 ②設計・実装計画 ③実装 ④独立検証）それぞれの完了時に、立証(conformance)+反証(falsification) の2観点レビューでゲートを通過する | GitHub モード：Check Run の成功状態（required status を専用 App/Workflow に限定）。ローカルモード：`reviews/<gate>.yaml` + `schemas/gate-report.schema.yaml` |
| I3 耐久性 | 作業状態は常に Git（remote push 済み）から完全復元可能。頭の中にしか無い状態を作らない | セグメント完了ごとの commit+push、`scripts/issue-resume.sh`、`durability.backend` 未設定環境では完全自走を拒否 |
| I4 分離 | 1 Issue = 1 ブランチ = 1 worktree = 1 PR。main への変更は PR 経由のみ | branch protection、`ci/verify-branch-name.sh`・`ci/verify-worktree-path.sh` |
| I5 進行役の純粋性 | 進行役が読み書きするのは調整状態（Issue・ラベル・PR・マージ・worktree ライフサイクル）のみ。成果物の著述・内容の取り込みは行わない | credential/権限分離（ツール名の一律 deny はしない）、main worktree clean チェック、ワーカー報告固定スキーマ |
| I6 正準モデル | 調整状態は選択された Coordination Backend のプリミティブにのみ存在し、GitHub Flow 標準語彙で記述する。複数バックエンド間で同一 Issue の状態を同期しない | GitHub モード：`scripts/lint-vocab.sh` + Check Run 正本。ローカルモード：`state.yaml` が正本 |
| I7 仕様⇔検証の追跡 | 全 AC-ID は最低1つの検証方法(`automated\|manual\|hybrid`)と証跡に対応する。承認後の AC 変更はゲート再通過を強制する | `ci/verify-ac-coverage.sh`、SPEC 差分検知によるゲート無効化（A-6 相当） |
| I8 安全側ラチェット | autonomy の降格は自動、昇格は人間の明示行為のみ。既定は `autonomy:gated`。`risk != normal`（`unclassified` 含む）OR `autonomy == full` → `review_profile: strict` | Actions の状態遷移規則（昇格 workflow が存在しないことを含め検査） |

## コーディネーションバックエンド

正本は必ずどちらか一方であり、二重化しない。

| モード | 調整状態の正本 | ゲートの正本 |
|---|---|---|
| GitHub モード | Issue・PR・branch・Check Run | GitHub Check Run（`agent-skill-chain/{spec,design,implementation,validation}-gate`） |
| ローカルモード | `state.yaml`（Issue 毎、Git 管理下） | `reviews/<gate>.yaml`（Git 管理下） |

共通の状態モデル（フィールド・enum）は `schemas/state.schema.yaml` が定義する。

## 4 セグメント・4 ゲート

固定4セグメント（`config/segments.yaml`）。追加・変更は破壊的変更とし ADR + 本ファイル改定 + `schema_version` 更新 + migration を要する。

```
Issue作成 → worktree作成 → SPECワーカーが最初のcheckpointをpush
→ SPECワーカーがDraft PRを作成（Closes #<id>）
→ 設計・実装・独立検証ワーカーが同一PRのheadブランチへcommit/push
→ 検証ゲート通過後、Draft→Ready for Review → auto-mergeまたは人間マージ
```

| セグメント | 主成果物 | ゲート |
|---|---|---|
| ①要求・要件 | `SPEC.md` | spec-gate |
| ②設計・実装計画 | `DESIGN.md` / ADR / `PLAN.md` | design-gate |
| ③実装 | コード・単体テスト結果 | implementation-gate |
| ④独立検証 | 受入/統合/回帰テスト・PR | validation-gate |

レビュープロファイル：Standard（既定、レビュア1体が conformance→falsification を順に実行）／Strict（`risk != normal` OR `autonomy == full`、専任2体）。ゲートは次のワーカーを直接起動しない——進行役がゲート状態のみを読み、次セグメント起動・`finding.origin`（`specification|design|implementation|validation`）に基づく差し戻し先決定・人間判断への昇格・マージ条件確認を行う。

## 役割・権限・writer lease

> 1 Issue には同時に1つの writer lease のみを許可する。read-only レビュアは複数並列実行できる。

| 役割 | 権限 | 種別 |
|---|---|---|
| 進行役 | Issue作成・状態遷移・worktree管理・マージ | writer lease対象外（成果物branchへのcommit禁止） |
| セグメント作業ワーカー | 自branchへのcommit/push、Draft PR作成（SPECワーカーのみ）、Issueコメント | writer（同時1つ） |
| ゲートレビュア | read-only + レビュー結果をCheck Run/レビューAPIへ送信 | read-only（複数並列可） |

権限は credential/GitHub 権限分離（fine-grained PAT・GitHub App installation permission）で担保し、ツール名の一律 deny では実装しない。lease スキーマは `schemas/lease.schema.yaml`、既定 `ttl_seconds: 3600` / `renewal_interval_seconds: 900`。WIP 上限は worktree 残存数ではなく有効 writer lease 数で判定（既定 `wip_limit: 3`）。

## ブランチ・worktree

```
branch:   <type>/<issue-id>-<slug>   例: feature/123-user-authentication
worktree: .worktrees/<YYYYMMDD_HHMMSS>-<type>-<issue-id>-<slug>/   (timestamp = Issue起票日時, Asia/Tokyo)
```

正本は `git worktree list --porcelain`。削除は `scripts/cleanup.sh` 経由のみ（writer lease不在・未commit/未push無し・PR完了済みを検査後 `git worktree remove` → `prune`）。詳細は `standards/GIT_CONVENTIONS.md` + `config/agent-skill-chain.yaml` + `scripts/issue-start.sh` + `ci/verify-branch-name.sh`/`ci/verify-worktree-path.sh` の4層。

## ゲートの継承・無効化

Check Run は commit SHA に紐づく。`scripts/gate-reconcile.sh` が push ごとに承認済み成果物 digest を照合し、変化なしなら最新 SHA へ成功を再発行、変化ありなら当該ゲートと全下流ゲートを無効化する（対応表は `schemas/gate-report.schema.yaml` 添付ドキュメント参照）。

## ADR・テンプレート・テスト適用性

ADR は `proposed → accepted`（設計ゲート承認時、finalization ワーカーが writer lease 取得の上 status のみ更新）→ `superseded/deprecated` のライフサイクルを取り、`docs/adr/` に保存する。テンプレート正本は `templates/`（`templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`、`templates/adr/ADR.md`、`templates/github/.github/...`）。AC ごとの検証方法・適用すべきテスト種別（常時必須／変更種別ごと／リリース単位）は `standards/TEST_POLICY.md` を正本とする。

## GitHub配布・マルチAI対応

`templates/github/.github/` を配布元の正本とし、対象リポジトリの `.github/` はその展開結果（`scripts/verify-template-sync.sh` で同期検査）。ラベル・ruleset は GitHub API 経由のみで適用（`provisioning/labels.yaml` → `scripts/setup-labels.sh`、`provisioning/rulesets/main.json` → `scripts/setup-ruleset.sh`）。作業エージェントの実体はベンダー中立の role contract（`config/roles.yaml`）を正本とし、`adapters/{claude,codex,human}.sh` が実行系へ変換する。

## 設定

初期値は `config/agent-skill-chain.yaml`（`schema_version: agent-skill-chain/config/v1`）が確定させる。項目追加は「①ハードコード不可の理由→②プロジェクト単位で変わる必要性→③スキーマ更新→④既定値定義→⑤migration定義→⑥必要ならADR」の手順を必須とする。スキーマ名前空間は `agent-skill-chain/{config,segments,state,gate-report,validation-report,lease,integration}/v1` に階層化する。

## ディレクトリ構成

```
AGENTS.md  CLAUDE.md  README.md
docs/{GLOSSARY.md, adr/}
standards/{GIT_CONVENTIONS,TEST_POLICY,SECURITY_POLICY}.md
templates/{issue/, adr/, github/}
schemas/{state,gate-report,validation-report,integration,lease,segments}.schema.yaml
config/{agent-skill-chain.yaml, segments.yaml, roles.yaml}
adapters/{claude,codex,human}.sh
scripts/  (setup*, issue-start/resume, lease-*, segment-start, gate-*, pr-create,
           adr-finalize, cleanup, doctor, reconcile, lint-vocab, adr-lint)
ci/  (verify-branch-name, verify-worktree-path, verify-template-sync,
      verify-ac-coverage, verify-gate-report, verify-artifacts, verify-adr)
.github/            # templates/github/.github/ の展開結果
.worktrees/
```

## 用語

「Issue」= GitHub Issue（またはローカルモードの Issue 状態ファイル）のみ。SPEC/DESIGN/PLAN/検証結果は「Issue に紐づく成果物」であり issue とは呼ばない。Task はセッション内の揮発的作業単位（永続化禁止）。用語集の正本は `docs/GLOSSARY.md`（用語・定義・禁止同義語の3列、20行以内）。禁止語混入は `scripts/lint-vocab.sh` が検査する。
