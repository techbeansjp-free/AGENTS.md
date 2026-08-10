# SPEC: root-cleanup runが生成するPRのbase branchが'main'にハードコードされておりdefault branchが異なるリポジトリで必ず失敗する

- Issue: `ISSUE-588`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/588-root-cleanup-default-branch`

## 目的・背景

`agent-skill-chain root-cleanup run`（`src/commands/root-cleanup.ts`）は、mainリポジトリのrepoRoot直下に恒久混入したIssueセグメント成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）を検出し、短命ブランチ `chore/root-cleanup-<UTC timestamp>` を作成してgit rm・commit・push・PR作成・admin mergeまでを機械的に実行する（ADR-0007）。

現状の実装は、この短命ブランチから作成するPRの`base`（マージ先ブランチ名）を、対象リポジトリの実際のdefault branch名を確認せず固定文字列 `'main'` として`gh pr create`へ渡している。対象リポジトリのdefault branchが `main` 以外（例: `develop`）であり、かつ `main` という名前のブランチ自体が存在しない場合、`gh pr create`は「Base ref must be a branch」等のエラーで必ず失敗し、root-cleanup機能そのものが動作不能になる。

2026-08-11、別プロジェクトでの運用中にユーザーから本事象が報告された（agent-skill-chain v0.2.78で発生、mainのv0.2.88でも再現を確認済み）。default branchが `main` 以外のリポジトリへ本CLIを配布・利用してもらう前提が既に成立している以上、この失敗は利用者が実際に踏む障害であり修正対象とする。

## 要求 → 要件 → 受入条件

### 要求

`agent-skill-chain root-cleanup run` は、対象リポジトリのdefault branch名が何であっても、root直下混入ファイルの削除PRを正常に作成できる状態にする。

### 要件

- `root-cleanup run` が生成するPRのbaseは、固定文字列 `'main'` を前提とせず、対象リポジトリの実際のdefault branch名に追従する。
- default branchをmainとするリポジトリでの既存の動作（PR作成・スコープ検査・admin mergeまでの一連の成功シーケンス）は変更しない。
- 対象リポジトリの実際のdefault branchを特定できない場合、`root-cleanup run` は誤ったbaseでPR作成を試みて不可解なエラーを出すのではなく、原因を特定できる形で失敗を報告する。

### 受入条件（Acceptance Criteria）

#### AC-1: default branchがmain以外のリポジトリでもPR作成に成功する

- Given: 対象リポジトリのdefault branchが `main` 以外（例: `develop`。`main` という名前のブランチ自体が存在しない）であり、repoRoot直下に対象4ファイルのいずれかが残留している状態
- When: `agent-skill-chain root-cleanup run` を実行する
- Then: 生成されるPRのbaseに対象リポジトリの実際のdefault branch名が使われ、「Base ref must be a branch」等のbase branch不一致に起因するエラーでPR作成が失敗しない
- 検証方法見込み: `automated`

#### AC-2: default branchがmainのリポジトリでの既存動作が変わらない

- Given: 対象リポジトリのdefault branchが従来どおり `main` であり、repoRoot直下に対象4ファイルのいずれかが残留している状態
- When: `agent-skill-chain root-cleanup run` を実行する
- Then: 修正前と同じ手順（短命ブランチ作成・git rm・commit・push・PR作成・スコープ検査・admin merge）で成功し、baseが `main` になる
- 検証方法見込み: `automated`

#### AC-3: default branchを特定できない場合は原因を特定できる形で失敗する

- Given: 対象リポジトリでdefault branchを機械的に特定できない状態（`origin/HEAD` 未設定かつ `main`/`master` ブランチが共に不在）
- When: `agent-skill-chain root-cleanup run` を実行する
- Then: PR作成を試みる前に、原因（default branchを特定できない旨）を含むエラーメッセージとともに失敗を報告する
- 検証方法見込み: `automated`

## スコープ外

- `.github/workflows/agent-skill-chain-root-cleanup.yml` 自体のトリガー条件（`branches: [main]`）およびワークフロー内の `git fetch origin main` / `git checkout -B main origin/main` 等、ワークフローYAML側が独自に持つ `main` 固定記述の変更。本Issueは `src/commands/root-cleanup.ts` 内のPR base決定ロジックのみを対象とする。
- `chore/root-cleanup-*` というブランチ名prefixや、対象4ファイル名（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）のハードコードなど、本Issueの再現手順・報告内容に含まれない他のハードコード箇所の設定可能化。
- ADR-0007が確定したadmin merge実行の権限境界・スコープ検査ロジック自体の変更。
- root-cleanup機能を持たない他コマンドにおけるdefault branch関連の挙動変更。
