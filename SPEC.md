# SPEC: release bump のbase更新競合を再同期・再試行して自動統合を継続する

- Issue: `ISSUE-266`
- 作成者: `run-1d93272c`
- 対象ブランチ: `bugfix/266-release-bump-base-race-retry`

## 目的・背景

release workflow は版数更新PRを作成してadmin mergeし、その結果のmain SHAへタグとGitHub Releaseを作成する。PR作成直後に別の自動化がmainを更新すると、GitHubは `Base branch was modified` を返してmergeを拒否する。現行実装はその一時競合を失敗として終了するため、版数更新PR・タグ・Releaseの一連の処理が途中で止まる。

このIssueでは、許可された版数台帳のみを更新するPRに限り、現在のmainを再取得して同じPRを安全に再同期し、有限回のadmin merge再試行によって自動統合を継続できるようにする。

## 要求 → 要件 → 受入条件

### 要求

release bump のadmin mergeがbase更新競合で拒否されても、正常な版数台帳更新であれば人手介入なしに統合を完了し、後続のtagとGitHub Release生成へ進めること。

### 要件

- `Base branch was modified` と判定できるadmin merge失敗時だけ、最大1回、現行 `origin/main` 基準で対象bump branchを再構築して同じOPEN PRのmergeを再試行する。
- 再構築前後にPR headと変更ファイル集合を検査し、`package.json` と任意の `package-lock.json` 以外を含むPRは自動処理しない。
- fetch、再構築、force-with-lease push、再試行mergeのいずれかが失敗した場合は、無条件の強制mergeをせず `human_required` で停止する。
- base更新競合以外のmerge失敗は従来どおり再試行せず失敗とする。既存PRの通常再利用、既存の乖離修復、成功時の出力を後退させない。
- 再試行成功時はworkflowがmainの最新版をrelease commit refとして使えるため、tagとGitHub Releaseの後続ステップを継続できる。

### 受入条件（Acceptance Criteria）

#### AC-1: base更新競合を再同期して一度だけ再試行する

- Given: スコープ検査済みの `release/bump-v<version>` OPEN PRがあり、最初のadmin mergeが `Base branch was modified` で失敗する
- When: `release bump <version>` を実行する
- Then: 現行mainを取得し、PRのスコープを再検査した上でbranchを再構築・pushして、同じPR番号へのadmin mergeを一度だけ再試行し成功する
- 検証方法見込み: `automated`

#### AC-2: 失敗時は安全側で停止する

- Given: base更新競合後の再同期でスコープ逸脱、force push競合、または再試行merge失敗が起こる
- When: `release bump <version>` を実行する
- Then: 追加の無条件mergeを行わず `human_required` を出して非0終了する
- 検証方法見込み: `automated`

#### AC-3: release後続処理を妨げない

- Given: base更新競合が再試行で解消される
- When: release workflow がbumpの成功後に `origin/main` を解決する
- Then: tagおよびGitHub Release作成に渡せる最新main SHAを取得できる
- 検証方法見込み: `automated`

#### AC-4: 既存の防御と通常経路を維持する

- Given: base更新競合以外のmerge失敗、または通常の既存PR再利用・スコープ違反
- When: `release bump <version>` を実行する
- Then: 非競合失敗は再試行せず、スコープ違反はhuman_requiredで停止し、通常経路は従来どおり成功する
- 検証方法見込み: `automated`

## スコープ外

- GitHubのbranch protection、PAT権限、またはrelease workflowの並行実行ポリシーの変更。
- base更新競合以外のGitHub API障害を自動再試行すること。
- 競合する版数以外の変更を自動的に解決・強制統合すること。
