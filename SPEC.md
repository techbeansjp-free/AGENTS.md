<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: main リポジトリルート直下に混入した stray なセグメント成果物ファイルの削除

- Issue: `ISSUE-200`
- 作成者: `spec_worker`
- 対象ブランチ: `chore/200-stray-root-artifacts`

## 目的・背景

AGENTS.md §ディレクトリ構成は、root 直下を `AGENTS.md`・`CLAUDE.md`・`README.md`・`docs/`・`.github/`・`.worktrees/` のみに限定すると規定している。しかし現在の main のリポジトリルート直下には、本来 Issue 毎の worktree 直下にのみ存在すべきセグメント成果物ファイル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）が恒久的に存在してしまっている。

内訳:
- `SPEC.md`: Issue #196 の内容。PR #197 のマージで持ち込まれた。
- `DESIGN.md`・`PLAN.md`: テンプレートの空の内容。PR #191 の最終統合コミットで混入した。
- `VALIDATION.md`: 同上。

これらのファイルは Issue 毎の worktree 直下で作業ワーカーが作成・更新するファイルであり、Issue 固有の内容（今回の Issue #200 自身の SPEC.md を含む）を保持する。新規 Issue の worktree は常に main から分岐するため、これらのファイルが main に残存している限り、新規 worktree 直下には常に前回 Issue の成果物ファイルが最初から存在してしまい、AGENTS.md が定めるディレクトリ構成の不変条件（root 直下の限定）に違反した状態が新規作業のたびに再生産される。

本 Issue は、この現時点で main に存在する4ファイルを削除し、root 直下の構成を AGENTS.md の規定に適合させることを目的とする。これらのファイルをマージ時に恒久的に main へ混入させないための構造的な再発防止策の設計は、本 Issue のスコープ外とし別 Issue で扱う。

## 要求 → 要件 → 受入条件

### 要求

main のリポジトリルート直下から、Issue 毎に作成される一時的なセグメント成果物ファイル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）を削除し、AGENTS.md §ディレクトリ構成が定める root 直下の構成（`AGENTS.md`・`CLAUDE.md`・`README.md`・`docs/`・`.github/`・`.worktrees/` のみ）に適合させたい、というメンテナ（進行役）からの要求。

### 要件

- 要件1: main のリポジトリルート直下に存在する `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の4ファイルを削除すること。
- 要件2: 削除対象は root 直下の4ファイルのみとし、`.agent-skill-chain/templates/issue/` 配下の雛形ファイル（`SPEC.md` 等の同名テンプレート）や、`.worktrees/` 配下・他 Issue の worktree 内に存在する同名ファイルは削除対象に含めないこと。
- 要件3: 削除後も既存の CI（lint・test・ビルド等の既存ワークフロー）が問題なく通過すること。すなわち、これら4ファイルの存在を前提とした CI 上の参照・チェックが存在しないことを確認すること。

### 受入条件（Acceptance Criteria）

#### AC-1: root 直下の stray な成果物ファイルが削除されている

- Given: main のリポジトリルート直下に `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` が存在する状態
- When: 本 Issue の変更を適用する
- Then: リポジトリルート直下（`.agent-skill-chain/` 配下や `.worktrees/` 配下を除く）に `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` のいずれも存在しない
- 検証方法見込み: `automated`（`git ls-files` またはファイル存在チェックによりルート直下の対象ファイル不在を確認する）

#### AC-2: 削除後もCIが正常に通過する

- Given: AC-1 の削除を適用した変更が本 PR のブランチに反映されている
- When: 本 PR に対して既存の CI ワークフロー（lint・test・ビルド等）が実行される
- Then: 既存の CI ワークフローが全て成功（green）で完了する。すなわち、削除した4ファイルの存在を前提とした CI 上の失敗が発生しない
- 検証方法見込み: `automated`（GitHub Actions の Check Run 結果を確認する）

## スコープ外

- 「PR マージ後にセグメント成果物ファイルが main へ恒久的に混入する」という、より一般的な構造的原因（マージ時にこれらのファイルを main から除外する仕組みが存在しないこと）の恒久的解決策の設計・実装。別 Issue で検討する。
- `.agent-skill-chain/templates/issue/` 配下の雛形ファイル自体の変更。
- `.worktrees/` 配下に存在する他 Issue の作業中 worktree の内容変更。
