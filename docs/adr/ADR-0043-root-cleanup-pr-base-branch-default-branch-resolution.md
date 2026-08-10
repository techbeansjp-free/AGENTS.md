<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0043
status: proposed
title: root-cleanup runが生成するPRのbaseは既存のdefaultBranch()解決ヘルパーへ委譲し固定文字列'main'を廃止する
tags: [root-cleanup, default-branch, github-workflow, gh-cli]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`agent-skill-chain root-cleanup run`（`src/commands/root-cleanup.ts`、ADR-0007で採用されたmain post-merge cleanup自動化）は、repoRoot直下に恒久混入したIssueセグメント成果物を削除するPRを作成する際、`gh pr create --base` へ渡すbase branch名を固定文字列 `'main'` としてハードコードしている。対象リポジトリのdefault branchが `main` 以外（かつ `main` という名前のブランチ自体が存在しない）場合、`gh pr create` は「Base ref must be a branch」等のエラーで必ず失敗し、root-cleanup機能自体が動作不能になる。2026-08-11、別プロジェクトでの運用中にユーザーからこの事象が報告された（ISSUE-588）。

このリポジトリには、リポジトリのdefault branch名を解決する既存の共通ヘルパー `defaultBranch()`（`src/lib/worktree.ts`）が既に存在し、`issue start`（新規worktreeのbase）・`pr merge`（マージ後のローカルbranch同期先）・`verify`（成果物差分検査の比較base）の3箇所から一貫して利用されている。このヘルパーは `origin/HEAD` のsymbolic-ref解決 → ローカル `main`/`master` ブランチの存在確認 → `GITHUB_BASE_REF` 環境変数（`actions/checkout@v4` がshallow checkoutする場合の代替ソース）の順で解決を試み、いずれも失敗すれば `Error` を投げる。

base branch名の解決方法として、以下の選択肢を検討した。

1. **既存の `defaultBranch()` を再利用する案**: 新規ロジックを一切追加せず、`root-cleanup.ts` から4つ目の呼び出し元として利用する。
2. **`gh api repos/:owner/:repo --jq .default_branch` でGitHub APIへ直接問い合わせる案**: `gh` CLIが認証済みであることを前提に、GitHub側が管理するリポジトリ設定を直接取得する。
3. **`root-cleanup` 専用の新規解決ロジックを実装する案**: 本コマンド固有の要件（存在しなければ固定文字列にフォールバックする等）を独自に組み込む。

案2は、`root-cleanup run` が現在git操作のみで完結しておりPR作成・admin merge以外ではGitHub APIへ問い合わせていない構造に、新たなネットワーク依存・認証依存の失敗モードを持ち込む。また同じリポジトリ内で「base branch名の解決方法」が呼び出し元によって異なることになり、`issue start`・`pr merge`・`verify` とは異なるエラーメッセージ・異なる失敗条件を持つ実装が並存してしまう。

案3は、車輪の再発明であり、AGENTS.md UNIX原則（疑わしい機能は追加しない）に反する。既存の `defaultBranch()` は3箇所の既存呼び出し元経由で単体・統合テストの対象になっており、新規ロジックを追加すればテスト対象・保守対象が不必要に増える。

## Decision

案1（既存の `defaultBranch()` を再利用する）を採用する。`root-cleanup.ts` の `run()` 内、PR作成前（`git checkout -b`・`git rm`・`git commit`・`git push` などのgit操作より前）で `const base = defaultBranch(root);` を呼び出し、`gh pr create --base` へその値をそのまま渡す。固定文字列 `'main'` は廃止する。

`defaultBranch()` がdefault branchを解決できず `Error` を投げた場合、`root-cleanup.ts` はこれを捕捉せず、`run()` 全体を包む既存の `guard()`（`src/lib/cli-io.ts`）へそのまま伝播させる。`guard()` は未捕捉の `Error` を `予期しないエラー: <message>` として標準エラー出力へ整形し終了コード1以上を返す既存の共通挙動であり、これは `issue start` が同じ `defaultBranch()` の例外を同様に無捕捉のまま `guard()` に委ねている既存パターンと同一である。base解決をgit操作より前に行うことで、解決不能時は分岐作成・commit・pushのいずれも実行されない（副作用ゼロで失敗する）。

## Consequences

- 対象リポジトリのdefault branchが `main` 以外でも `root-cleanup run` がPR作成に成功するようになる（ISSUE-588 AC-1）。
- default branchが `main` のリポジトリでの既存動作は変わらない（ISSUE-588 AC-2）。`defaultBranch()` は `main`/`master` ブランチが存在すればそれを優先して返すため、既存の全リポジトリで従来と同じ `'main'` が使われ続ける。
- default branchを機械的に特定できない状況（`origin/HEAD` 未設定・`main`/`master` 双方不在・`GITHUB_BASE_REF` 未設定）では、原因が明示された失敗になる（ISSUE-588 AC-3）。これは新規のエラーメッセージを設計するのではなく、既存の `defaultBranch()` のエラーメッセージ・既存の `guard()` の整形処理をそのまま再利用した結果であり、他コマンド（`issue start` 等）と一貫したエラーメッセージ形式になる。
- `defaultBranch()` 自体の解決ロジック（`origin/HEAD` 未設定時にローカル `main`/`master` の存在確認へフォールバックする等の限界）は本決定の対象外であり変更しない。この限界は既存の3呼び出し元と共通であり、本決定によって新たに生じる制約ではない。
- 新規のconfig項目・スキーマ変更は発生しない。

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
