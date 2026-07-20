# DESIGN: CI/gate運用の本番導入とE2Eフロー実地一周

- Issue: `ISSUE-171`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`, `AC-2` | `init`コマンド（`src/commands/init.ts`、Issue #169実装済み）+ `.agent-skill-chain/templates/github/.github/`テンプレート一式 | 新規実装なし。既存CLIの実行のみ |
| `AC-3`, `AC-4` | `.agent-skill-chain/config/agent-skill-chain.yaml`の`review.adapter`設定値 + `.agent-skill-chain/schemas/config.schema.yaml`のenum定義 | 設定値の変更のみ、schema変更不要 |
| `AC-5` | `src/commands/verify.ts`の`branchName()`、`src/commands/checkpoint.ts`の`run()`、`src/lib/worktree.ts`の`resolveCurrentBranch()`/`resolveCurrentBranchInfo()` | detached HEAD対応の共有ヘルパーを本Issue実地実行中に新設 |
| `AC-6` | 既存テストスイート（`test/`配下全体）、`test/helpers/tmp-repo.ts` | `.installed_version`混入は許容し恒久修正はスコープ外 |
| `AC-7` | `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`（本ファイル群）、`src/commands/verify.ts`の`artifacts()`/`acCoverage()` | 本追記で新規作成 |

## 責務・境界

### コンポーネント構成

- `init`コマンド（既存）: `.agent-skill-chain/templates/github/.github/`を対象リポジトリの`.github/`へ展開する。本Issueでは新規実装せず既存動作をそのまま利用する。
- `.agent-skill-chain/config/agent-skill-chain.yaml`: `review.adapter`設定値の唯一の正本。本Issueでは`human`へ変更する1行のみを責務とする。
- `src/lib/worktree.ts`の`resolveCurrentBranchInfo()`/`resolveCurrentBranch()`: 現在のHEADブランチ名解決を一箇所に集約する共有ヘルパー。(1) 通常チェックアウト、(2) detached HEAD（`GITHUB_HEAD_REF`環境変数フォールバック）、(3) detached HEADかつ`GITHUB_HEAD_REF`未設定でも`git worktree list --porcelain`が単一エントリ（CI相当の単一checkout）ならissueNumber自体を信頼、の3パターンを1関数で処理する。`findIssueWorktree()`・`verify branch-name`・`checkpoint`が共通利用する。
- `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`: `gate-review.sh`の複数行標準出力（`gate_report_path:`/`reviewer_count:`）から`gate_report_path:`行のみを`sed`抽出して`$GITHUB_OUTPUT`へ書き込む。`gh`コマンドを呼ぶステップ（judgment・publish）に`GH_TOKEN: ${{ github.token }}`を付与し認証を担保する。`.agent-skill-chain-reconcile.yml`にも同様の`GH_TOKEN`を付与する。
- `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`（リポジトリルート）: `segments.yaml`が定める正式成果物規約に適合させるため本追記で新設。`verify artifacts`・`verify ac-coverage`の検証対象。

### 依存関係

```text
verify branch-name / checkpoint → resolveCurrentBranch() → resolveCurrentBranchInfo() → git rev-parse / GITHUB_HEAD_REF
gate-review.sh → src/commands/gate.ts (review) → 標準出力(gate_report_path/reviewer_count) → workflow側sed抽出 → $GITHUB_OUTPUT
gate reviewer judgment / gate publish → gh api・gh issue comment → GH_TOKEN
verify artifacts / verify ac-coverage → SPEC.md / DESIGN.md / PLAN.md / VALIDATION.md（リポジトリルート）
```

循環依存は無い。`resolveCurrentBranchInfo()`はgit以外の外部システムに依存しない。gate workflowの`gh`呼び出しはGitHub Actions提供の`github.token`にのみ依存する。

## 関連ADR

本Issueは既存CLI（`init`、Issue #169実装済み）・既存設定ファイルの値変更・既存ロジックの重複解消（detached HEAD対応を1箇所へ統一）・CI workflowの記述修正（GITHUB_OUTPUT抽出、GH_TOKEN付与）・成果物ドキュメントの追加のみで完結する。`segments.yaml`が定めるセグメント構成自体（spec/design/implementation/validationの4区分、各segmentのoutputs定義）の追加・変更は行っていない。よって新規のアーキテクチャ決定を伴わず、ADR新設は不要と判断した。

関連ADRは無い（`docs/adr/ADR-0001-docs-system-spec-construction.md`は`docs/system-spec/`新設提案であり本Issueとは独立した別件）。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - detached HEAD時のブランチ名解決を誤ると、意図しないissueをworktree対象として扱う誤爆リスクがある。対策として、ブランチ名が判明している場合は必ず`branch.pattern`との一致確認を行い、issueNumber信頼フォールバックは「ブランチ名が完全に不明（detached HEADかつ`GITHUB_HEAD_REF`未設定）」の場合のみに限定した。
  - gate workflowの`$GITHUB_OUTPUT`書き込みが複数行値を誤って単一変数へ代入すると、`Invalid format`でjobが停止する（本Issュー実地実行で実際に発生・修正済み）。
  - `gh`呼び出しを含むステップで`GH_TOKEN`が欠落すると、認証エラーでjobが即座に非ゼロ終了する（本Issue実地実行で実際に発生・修正済み）。
- ロールバック手順: 各修正は独立commit（`edd5990`・`7182636`・`686bbd3`・`37b96b2`・`bae0fda`）であり`git revert <sha>`で個別に戻せる。`review.adapter`の変更は1行のみのため`git revert`で即時復元できる。`SPEC.md`等の本追記もリポジトリルート直下の独立ファイルであり、削除のみでロールバックできる。
- 影響を受ける既存機能: `gate review`・`gate publish`・`gate reconcile`・`verify branch-name`・`checkpoint`コマンド全般（CI・ローカル両方の呼び出し経路）。
