<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: main リポジトリルート直下に混入した stray なセグメント成果物ファイルの削除

- Issue: `ISSUE-200`
- 対応する SPEC: `SPEC.md`

## 前提

本 Issue は恒久的な設計判断を伴わない単純なファイル削除である。ADR は「なぜその判断をしたか」という恒久的判断を記録する成果物であり、本 Issue には該当する判断が存在しないため作成しない。

## 事前調査（削除の安全性確認）

削除対象ファイル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）が、CI・CLI 実装上「main リポジトリルート直下に恒久的に存在すること」を前提にしていないかを `grep` で確認した。結果は以下の通りで、いずれも Issue 固有の worktree 単位でこれらのファイルの有無を検査する設計であり、main のルート直下に恒久的に存在することを前提にしたコードは存在しない。

- `.agent-skill-chain/ci/verify-artifacts.sh` / `.agent-skill-chain/ci/verify-ac-coverage.sh`: いずれも `src/commands/verify.ts` の `artifacts`/`acCoverage` サブコマンドへの薄いラッパーであり、`<issue_id>` 引数から `findIssueWorktree()` で解決した**当該 Issue の worktree パス**（`entry.path`）を基点にファイル存在を確認する。`repoRoot()`（main worktree）は検査対象にしていない。
- `src/commands/verify.ts` の `checkOutputExists()` は `worktreePath` 引数配下の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を検査対象とし、常に `artifacts()` から渡される Issue worktree パスに対して実行される。
- `src/commands/verify.ts` の `docLength()` が参照する `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md` は `.agent-skill-chain/templates/issue/` 配下の**雛形ファイル**であり、本 Issue の削除対象（root 直下の実ファイル）とは別物で影響を受けない。
- `.github/workflows/agent-skill-chain-ci.yml` は `verify-artifacts.sh "$issue_id" "$segment"` の形で PR に対応する Issue 番号を渡しており、root 直下のファイルを直接参照する記述は無い。
- `test/integration/verify.test.ts` 等の既存テストは全て一時リポジトリ・一時 worktree 上で `SPEC.md` 等を作成・検証しており、main リポジトリルートの実ファイルに依存するテストは存在しない。

以上より、root 直下の4ファイル削除は既存 CI・CLI のいずれの前提にも抵触しない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（root 直下の stray ファイル削除） | 実装セグメントでの `git rm` 実行 | 対象は root 直下の4ファイルのみ。`.agent-skill-chain/templates/issue/` 配下の雛形・`.worktrees/` 配下の他 Issue 成果物は対象外（要件2） |
| `AC-2`（削除後も CI が通過） | 上記「事前調査」による事前確認 ＋ 実装セグメントでの実際の CI 実行結果確認 | 削除に伴う追加のコード変更は不要（純粋な削除のみで完結する） |

## 責務・境界

### コンポーネント構成

本 Issue は新規コンポーネントを導入しない。既存 stray ファイルの削除のみが変更内容である。

- 実装セグメント: root 直下の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を `git rm` で削除する責務を持つ。他の場所（`.agent-skill-chain/templates/issue/`・`.worktrees/`）のファイルには一切触れない。
- 独立検証セグメント: 削除後に既存 CI ワークフロー（`.agent-skill-chain/ci/` 配下の `verify-branch-name.sh`・`verify-worktree-path.sh`・`verify-template-sync.sh`・`verify-artifacts.sh`・`verify-ac-coverage.sh`・`verify-adr.sh` および `.github/workflows/agent-skill-chain-ci.yml`）が引き続き成功することを確認する責務を持つ。

### 依存関係

```text
実装セグメント（git rm） → 独立検証セグメント（既存CIワークフロー実行確認） → PR
```

新規の外部依存・コンポーネント間依存は発生しない。

## 関連ADR

該当なし。本 Issue は恒久的な設計判断を伴わないファイル削除のため ADR を作成しない。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モード: 削除後に既存 CI が予期せず失敗する（「事前調査」で洗い出せなかった隠れた依存が存在した場合）。
- ロールバック手順: 本 PR のブランチ（`chore/200-stray-root-artifacts`）は close・破棄すれば main には一切影響しない。万一 main へマージ後に問題が判明した場合も、削除された4ファイルは Git 履歴から `git revert` により復元可能。
- 影響を受ける既存機能: なし。root 直下の4ファイルは過去 Issue（#196・#191）の作業過程で誤って main に混入した stray な成果物であり、他のいかなる機能もこれらの root 直下ファイルの恒久的存在を前提にしていないことを「事前調査」で確認済み。
