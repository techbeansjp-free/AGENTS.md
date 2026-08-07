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

- (x) `PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch`（GitHub REST API、PR画面の「Update branch」ボタンと同一操作）を使う（本決定で採用）: 対象PRのhead branchへ書き込み権限があれば、ローカルにPRブランチをcheckoutせず進行役のmain worktreeから完結する。非同期実行（202 Accepted）のため、完了確認には `checkFreshness()` を固定間隔・上限回数付きで繰り返し呼び出すポーリングを要する（`BEHIND` のまま反映待ちの状態と `UNKNOWN` のまま解決しない状態のどちらも「未反映」として同様にポーリング対象に含め、片方だけを再問い合わせ対象とすることはしない）。
- (y) ローカルで対象PRブランチをfetchし `git merge`/`git rebase` してpushする: 進行役のmain worktreeは通常default branchをチェックアウトしており、対象PRブランチを一時的にcheckoutする追加の状態遷移が必要になり、失敗時のロールバック（作業ツリーの後始末）が複雑になる。(x)はGitHub側で完結するAPI呼び出し1つであり、UNIXの「1スクリプト1状態遷移」の精神にも合う。

SPEC.md 要件2は、いずれの最新化手段を採る場合であっても既定は無効（オプトイン）とすることを明示的に要求している。

失敗原因の切り分け（要件7・AC-6・AC-7）は、`gh pr merge` が返す標準エラー文言を解析して「最新性と明らかに無関係」（権限不足・既にマージ済み・既にクローズ済み等）を判定する必要があるが、`gh` CLIの出力文言は将来のバージョンアップで変わりうる。SPEC.md 未決事項は「失敗原因の切り分けが実装上困難な場合は安全側としてAC-7の挙動を優先してよい」と明示している。

対象PRの特定方式として次を検討した。

- (p) `merge()` に渡された `args` のみを解析して対象（番号／URL／ブランチ）を抽出し、見つからなければ即座にチェック失敗として中断する: 実装が単純だが、`gh pr merge` 自体が標準で持つ「対象省略時は現在のgitブランチから対象PRを暗黙解決する」機能を無視することになる。SPEC.mdの目的・背景節が明記する実運用（`gh pr merge --admin` を都度確認なしで実行する運用が定着している）は、PRブランチ上でPR番号を省略したままこのコマンドを実行するパターンであり、この方式のままでは最も典型的な実運用パターンで常にチェック失敗として中断し、要件6・AC-5が禁じる回帰を設計自体が生む。
- (q) `args` から対象識別子を抽出できない場合、`gh pr view --json number` をcwdで呼び出し、`gh pr merge` と同じ「現在のブランチに紐づくPRを暗黙解決する」処理を明示的に行うフォールバックを追加する（本決定で採用）: `gh pr view`（対象省略時）はGitHub CLI標準のPR自動解決機構であり、`gh pr merge`（対象省略時）が内部で行う解決と同じ情報源（現在のgitブランチ）を使う。これにより「`args` にPR識別子を含まない場合」を「対象PRを特定できない」と混同せず、実運用の主要パターンを回帰させずに済む。この`gh pr view`呼び出し自体が失敗する場合（現在のブランチに紐づくPRが無い等）にのみ、要件5・AC-4の「対象PRを特定できない」中断処理へ流す。

## Decision

1. 対象PRの特定は、まず `merge()` に渡された `args` から番号／URL／ブランチを抽出する。`args` に対象識別子が含まれない場合は、`gh pr view --json number` をcwdで呼び出し、`gh pr merge` 自身が対象省略時に行う「現在のgitブランチに紐づくPRの暗黙解決」と同じ処理を明示的に行うフォールバックを実行する。`args` からの抽出・`gh pr view` フォールバックのいずれによっても対象PRを一意に特定できない場合（`gh pr view` が非0終了する場合を含む）にのみ、対象PRを特定できないとして要件5・AC-4の中断処理へ進む。
2. 最新性判定は `gh pr view <target> --json number,state,baseRefName,headRefName,mergeStateStatus` の `mergeStateStatus` フィールドを判定根拠とする。`BEHIND` を「最新でない」、それ以外（`UNKNOWN` を除く）を「最新」とみなす。`UNKNOWN` は短いポーリング（上限回数付き）で解決を待ち、解決しなければチェック失敗（AC-4）として扱う。対象PRの `state` が `OPEN` でない場合はチェック自体を適用不要と判定し、既存の `gh pr merge` 呼び出しにその後の判定（成功/失敗）を委ねる。
3. 最新化は既定で無効とする。`.agent-skill-chain/config/agent-skill-chain.yaml` の新設任意フィールド `merge.auto_update_branch`（既定 false 相当・未設定時は無効）を進行役が明示的に true にした場合のみ、`gh api -X PUT repos/:owner/:repo/pulls/{number}/update-branch` を試みる。この呼び出し自体が非0終了した場合は即座に最新化失敗とする。呼び出しが成功した場合は、update-branch APIが非同期実行（202 Accepted）であり呼び出し直後には反映が確定しないことを踏まえ、`mergeStateStatus` を固定間隔（3秒）で最大10回（合計最大30秒）まで再確認するポーリングを行う。ポーリング中に得られる `mergeStateStatus` が `BEHIND` のままの場合と `UNKNOWN` のまま解決しない場合はいずれも「まだ未反映」として区別なく次の間隔まで待機し再問い合わせを続ける。ポーリング上限に達しても `mergeStateStatus` が最新（`fresh`）にならない場合は最新化失敗としてマージを中断する。
4. `gh pr merge` 失敗時のエラー原因分類は、既知の「明らかに無関係」なパターンのみをホワイトリストとして許可し、一致しない失敗はすべて安全側で「要件7が扱う失敗」として日本語エラーメッセージを付加する。ホワイトリストにのみ一致した場合は、本Issue対応前と完全に同一の出力（`gh` の生の標準エラー出力のみ）を維持する。

## Consequences

- 利点: GitHub ruleset側の判定ロジックと同じ情報源（`mergeStateStatus`）を使うため、CLIツール側の独自計算とrulesetの実際の挙動が食い違う余地が小さい。対象PRの特定は `gh pr merge` 自身の暗黙解決と同じ情報源（cwdの現在ブランチ）を使う `gh pr view` フォールバックを持つため、対象識別子を省略した実運用パターンでもマージ実行前チェックが機能し回帰しない。最新化は既定無効のため、既存の「確認して人間判断へ委ねる」安全側運用を壊さない。エラー分類はホワイトリスト方式かつ不一致時は安全側（要件7扱い）に倒すため、`gh` の出力文言が将来変わっても「無関係な失敗を誤って見逃す」方向には壊れない。
- 欠点・フォローアップ: `mergeStateStatus` が `UNKNOWN` から解決するまでのポーリング（checkFreshness内部）と、`auto_update_branch` 有効時のupdate-branch API反映確認のポーリング（attemptUpdateBranch、最大30秒）の両方で待機が発生し、`gh pr merge` 実行までの体感時間が伸びうる。ホワイトリストに載っていない「実際には無関係な失敗」は、AC-6ではなくAC-7の挙動（追加の日本語メッセージ付与）になるが、終了コード・`gh` の生の標準エラー出力自体は変更しないため実害は軽微であり、実運用で誤分類が観測された場合はホワイトリストを拡充する形で個別に対処する。
- スコープ外の扱い: SPEC.mdのスコープ外節に記載の各項目（`strict_required_status_checks_policy` 自体の見直し、`--admin` 運用ルールの是非、`gh pr merge --auto` の既定化、`release.ts`/`root-cleanup.ts` 等の他の `gh pr merge` 呼び出し箇所、ローカルモードでの同等保証）は本決定の対象外とする。
