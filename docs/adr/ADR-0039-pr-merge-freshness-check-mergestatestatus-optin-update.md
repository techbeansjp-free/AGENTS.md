# ADR

```yaml
id: ADR-0039
status: proposed
title: pr merge のPRブランチ最新性チェックはGitHubのmergeStateStatus判定とオプトイン最新化で行う
tags: [pr-merge, branch-protection, toctou]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

Issue #493（SPEC.md）が示す通り、`agent-skill-chain pr merge`（`src/commands/pr.ts` の `merge()`）は受け取った引数を検証・加工せず `gh pr merge` へ透過するだけであり、対象PRのhead branchがbase branch（`main`）に対して最新（behind=0）かどうかを事前確認しない。GitHub ruleset側の `strict_required_status_checks_policy` はこれを本来防ぐ機構だが、本リポジトリで定着している `gh pr merge --admin` 常用運用（ブランチ保護を管理者権限でバイパス）の前では無力であり、CLIツール側での独立したチェックが唯一の実効的な防御線になる。

最新性判定の実現方式として次を検討した。

- (a) GitHub PRの `mergeStateStatus`（`gh pr view --json mergeStateStatus` で取得できる `BEHIND`/`CLEAN`/`DIRTY`/`BLOCKED`/`UNSTABLE`/`UNKNOWN` 等の列挙値）を判定根拠に使う（本決定で採用）: GitHub自身がruleset側の `strict_required_status_checks_policy` と同じ「head branchがbaseの最新コミットに対して最新か」を判定しており、CLIツール側で ahead/behind をコミット数計算により再実装するより、GitHub側の判定と食い違うリスクが低い。
- (b) `gh api repos/{owner}/{repo}/compare/{base}...{head}` の `behind_by` を自前で計算する: GitHub UIの「Nコミット遅れています」表示と同じ値が取れるが、`strict_required_status_checks_policy` が実際に参照する判定（必須チェックの再実行要否を含む）とは独立した計算であり、値が一致しない場面（例: base側の必須チェックが未完了なだけでコミット自体はbehindでない状態）でも `BLOCKED` 等をこちらは検知できない。要求が求めるのは「rulesetが守ろうとしている性質」であり、rulesetと同じ判定源を使う(a)の方が要求に忠実である。
- (c) 進行役がPRマージ前に手動で `git fetch`・目視確認する運用のみに留める: 機械的検査可能性（AGENTS.md 不変条件の要件）を満たさず、`--admin` 常用運用下での見落としを防げないため採らない。

最新化（要件2・3・AC-2）の実現方式として次を検討した。

- (x) `PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch`（GitHub REST API、PR画面の「Update branch」ボタンと同一操作）を使う（本決定で採用）: 対象PRのhead branchへ書き込み権限があれば、ローカルにPRブランチをcheckoutせず進行役のmain worktreeから完結する。非同期実行（202 Accepted）のため、完了確認には `checkFreshness()` の再呼び出しによるポーリングを要する。
- (y) ローカルで対象PRブランチをfetchし `git merge`/`git rebase` してpushする: 進行役のmain worktreeは通常default branchをチェックアウトしており、対象PRブランチを一時的にcheckoutする追加の状態遷移が必要になり、失敗時のロールバック（作業ツリーの後始末）が複雑になる。(x)はGitHub側で完結するAPI呼び出し1つであり、UNIXの「1スクリプト1状態遷移」の精神にも合う。

SPEC.md 要件2は、いずれの最新化手段を採る場合であっても既定は無効（オプトイン）とすることを明示的に要求している。

失敗原因の切り分け（要件7・AC-6・AC-7）は、`gh pr merge` が返す標準エラー文言を解析して「最新性と明らかに無関係」（権限不足・既にマージ済み・既にクローズ済み等）を判定する必要があるが、`gh` CLIの出力文言は将来のバージョンアップで変わりうる。SPEC.md 未決事項は「失敗原因の切り分けが実装上困難な場合は安全側としてAC-7の挙動を優先してよい」と明示している。

## Decision

1. 最新性判定は `gh pr view <target> --json number,state,baseRefName,headRefName,mergeStateStatus` の `mergeStateStatus` フィールドを判定根拠とする。`BEHIND` を「最新でない」、それ以外（`UNKNOWN` を除く）を「最新」とみなす。`UNKNOWN` は短いポーリング（上限回数付き）で解決を待ち、解決しなければチェック失敗（AC-4）として扱う。対象PRの `state` が `OPEN` でない場合はチェック自体を適用不要と判定し、既存の `gh pr merge` 呼び出しにその後の判定（成功/失敗）を委ねる。
2. 最新化は既定で無効とする。`.agent-skill-chain/config/agent-skill-chain.yaml` の新設任意フィールド `merge.auto_update_branch`（既定 false 相当・未設定時は無効）を進行役が明示的に true にした場合のみ、`gh api -X PUT repos/:owner/:repo/pulls/{number}/update-branch` を試み、成功後に `mergeStateStatus` を再確認する。再確認で `BEHIND`/`UNKNOWN` のままか、API自体が失敗した場合は最新化失敗としてマージを中断する。
3. `gh pr merge` 失敗時のエラー原因分類は、既知の「明らかに無関係」なパターンのみをホワイトリストとして許可し、一致しない失敗はすべて安全側で「要件7が扱う失敗」として日本語エラーメッセージを付加する。ホワイトリストにのみ一致した場合は、本Issue対応前と完全に同一の出力（`gh` の生の標準エラー出力のみ）を維持する。

## Consequences

- 利点: GitHub ruleset側の判定ロジックと同じ情報源（`mergeStateStatus`）を使うため、CLIツール側の独自計算とrulesetの実際の挙動が食い違う余地が小さい。最新化は既定無効のため、既存の「確認して人間判断へ委ねる」安全側運用を壊さない。エラー分類はホワイトリスト方式かつ不一致時は安全側（要件7扱い）に倒すため、`gh` の出力文言が将来変わっても「無関係な失敗を誤って見逃す」方向には壊れない。
- 欠点・フォローアップ: `mergeStateStatus` が `UNKNOWN` から解決するまでポーリング待機が発生し、`gh pr merge` 実行までの体感時間がわずかに伸びる。ホワイトリストに載っていない「実際には無関係な失敗」は、AC-6ではなくAC-7の挙動（追加の日本語メッセージ付与）になるが、終了コード・`gh` の生の標準エラー出力自体は変更しないため実害は軽微であり、実運用で誤分類が観測された場合はホワイトリストを拡充する形で個別に対処する。
- スコープ外の扱い: SPEC.mdのスコープ外節に記載の各項目（`strict_required_status_checks_policy` 自体の見直し、`--admin` 運用ルールの是非、`gh pr merge --auto` の既定化、`release.ts`/`root-cleanup.ts` 等の他の `gh pr merge` 呼び出し箇所、ローカルモードでの同等保証）は本決定の対象外とする。
