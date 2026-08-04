# SPEC: bugfix: resumeしたsegment workerがPR/Issueのレビューフィードバックを一切参照せず静的completion checklistだけで完了と自己判定する

- Issue: `ISSUE-446`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/446-worker-resume-review-context`

## 目的・背景

`segment start`（`src/commands/segment.ts`）が組み立てるworker起動プロンプト（role_contract）は、`.agent-skill-chain/config/roles.yaml` の `role_contracts.<role>` が持つ静的な内容（inputs/outputs/rules/completion/forbidden）のみで構成される。GitHubモードでは、対象Issueの本文・タイトル・進行中のPRレビュー・Issueコメントのいずれも自動的にはプロンプトへ含まれない（`buildIssueBlock` はlocal backendのstate.yamlからのみ構築され、GitHubモードでは常に未使用）。

2026-08-04、本リポジトリ自身でIssue #441のdesign segmentにおいて以下が3回連続で再現した。

1. design-gate（strict、独立2レビュア）で両レビュアが一致してblocking findingを検出した。
2. 進行役がPR側へ具体的な修正依頼をコメントとして投稿し、`worker-launch.sh ISSUE-441 design` でdesign_workerを再起動した。
3. workerは `git status` と既存ファイルの構造確認のみを行い、「DESIGN.md/PLAN.md/ADRが存在し、commit済みでテンプレート構造に適合している」という静的completion checklistだけを根拠に「作業完了、追加対応不要」と自己判定して終了した。PRコメント・レビュー内容には一切言及がなかった。
4. 進行役がさらに対象Issueへ同内容を直接コメントとして追記し再度workerを起動しても、結果は同一だった（Issueコメントも一切参照されなかった）。

worker自身の作業ログには、PRコメント一覧やレビュー取得コマンドを呼び出した形跡が無い。`role_contract` の `rules`/`completion` にレビュー結果の確認を促す記述が一切無いため、workerは「ファイルが存在しcommit済みであれば完了」という表面的な基準だけで停止してしまう。この結果、ゲートでblocking findingが出てresumeが必要になった場合、進行役がコメントで修正依頼を出しても自動では反映されず、fully-autonomousなfind→fix→re-reviewサイクルがこの時点で必ず停止する。

本Issueは、resumeされたセグメント作業ワーカーが対象Issue/PRの既存レビューフィードバックを確実に確認したうえで完了を自己判定するよう、worker起動プロンプトの構成に関する要求・要件・受入条件を定める。

## 要求 → 要件 → 受入条件

### 要求

resumeされたセグメント作業ワーカーは、対象Issueに紐づくPRの既存レビュー状態（未対応のレビュー・レビューコメント・Issueコメント等）を確認しないまま、ファイル存在やcommit済みかどうかだけの静的completion checklistのみを根拠として完了を自己判定してはならない。

### 要件

- 全セグメント作業ワーカー（spec_worker/design_worker/implementation_worker/validation_worker）のrole_contractは、backend（GitHubモード／ローカルモード）を問わず、「作業再開時は対象Issue/PRの最新レビュー・コメントを確認すること」という指示を常に含むこと（完全自動検出が技術的に困難な場合でも成立する最小対応）。
- GitHubモードでresumeされたworkerに対しては、対象PRに未対応（`CHANGES_REQUESTED`等）のレビューまたは未対応のコメントが存在する場合、その存在をworker起動プロンプトの構築時点で機械的に検出し、判別可能な形でプロンプトへ含めること。
- 未対応のレビュー・コメントが実際には存在しない場合、存在するかのような虚偽の通知をプロンプトへ含めないこと（誤検出の禁止）。
- レビュー・コメントの検出処理自体が失敗した場合（API呼び出し失敗・認証欠如等）、失敗を握りつぶして「レビュー無し」と誤って伝えないこと。検出失敗時も上記の最小対応（常時含まれる確認指示）が機能し続けること。
- ローカルモードにおいても、対象Issue/segmentの直近ゲートに記録された未解決のblocking finding（`reviews/` 配下の当該ゲートのレポートファイル、origin付き）がある場合、同様に判別可能な形でworker起動プロンプトへ含めること。
- 本対応は進行役（orchestrator）による成果物内容の著述・取り込みを新設しない。プロンプトへ含める内容は、Coordination Backend側（GitHub Review API・Issueコメント・ローカルのgate-report）が既に保持する調整状態の転記に限り、進行役自身が判断・加筆した文章を新たに混入させない（AGENTS.md I5）。

### 受入条件（Acceptance Criteria）

#### AC-1: 全セグメント作業ワーカーのrole_contractに再開時レビュー確認ルールが明記される

- Given: `.agent-skill-chain/config/roles.yaml` の `role_contracts`（spec_worker/design_worker/implementation_worker/validation_worker）
- When: `segment start` が該当segmentのrole_contractを組み立てる
- Then: 出力されるrole_contract本文の `rules` に、作業再開時は対象Issue/PRの最新レビュー・コメントを確認しなければならない旨の指示が、GitHubモード・ローカルモードのいずれでも常に含まれる
- 検証方法見込み: `automated`

#### AC-2: GitHubモードでresumeされたworkerに、対象PRの未対応レビュー状態が伝わる

- Given: GitHubモードで、対象Issueに紐づくPRに `CHANGES_REQUESTED` 状態のレビューが存在する
- When: 進行役が当該Issue/segmentに対し `segment start` を呼び出す（＝workerの起動・再起動）
- Then: 返却されるrole_contract（プロンプト全文）に、当該レビューが存在すること、およびその内容（本文または要約）が判別可能な形で含まれる
- 検証方法見込み: `automated`

#### AC-3: 対象Issue/PRの未対応コメントも同様に検出される

- Given: GitHubモードで、対象Issueまたは対象PRに進行役からの修正依頼コメントが、レビュー承認状態とは別に単純なコメントとして投稿されている
- When: `segment start` を呼び出す
- Then: role_contractに当該コメントの存在（内容または要約）が判別可能な形で含まれる
- 検証方法見込み: `automated`

#### AC-4: 未対応のレビュー・コメントが存在しない場合は誤検出しない

- Given: GitHubモードで、対象PRのレビューが全て `APPROVED` であり、未対応のコメントも存在しない
- When: `segment start` を呼び出す
- Then: role_contractに「対応が必要な既存レビューが存在する」旨の虚偽の通知が含まれない
- 検証方法見込み: `automated`

#### AC-5: レビュー・コメント検出処理の失敗時に安全側で処理が継続する

- Given: GitHubレビュー・コメントの取得処理（API呼び出し等）が失敗する、または認証情報が無い
- When: `segment start` がレビュー状態の検出を試みる
- Then: 検出失敗が「レビュー無し」として握りつぶされることなく、かつAC-1の最小対応（確認指示）を含むrole_contractの返却自体は妨げられない
- 検証方法見込み: `automated`

#### AC-6: ローカルモードでも既存gate-report上のblocking findingが同様にworkerへ伝わる

- Given: ローカルモードで、対象Issue/segmentの直近ゲートについて `reviews/` 配下の当該ゲートのレポートファイル上に未解決のorigin付きblocking findingが記録されている
- When: `segment start` を呼び出す
- Then: role_contractに当該blocking findingの存在（内容または要約）が判別可能な形で含まれる
- 検証方法見込み: `automated`

#### AC-7: 実際の再現シナリオでresumeされたworkerがレビュー内容へ言及したうえで完了判定する

- Given: 本Issueの実害再現手順（design-gateでblocking findingが検出され、対象PRへ進行役が修正依頼コメントを投稿した状態）と同様の状況を用意する
- When: 進行役が `worker-launch.sh` で該当segmentのworkerを再起動する
- Then: workerの完了報告・作業ログに、当該blocking findingまたはレビューコメントの内容への具体的な言及が含まれ、「ファイルが存在しcommit済みである」ことのみを根拠とした完了自己判定では終了しない
- 検証方法見込み: `hybrid`

## スコープ外

- PRレビュー本文・コメント本文の要約・翻訳・NLP処理（既存Coordination Backendの出力をそのまま、または機械的な整形のみでプロンプトへ転記する範囲に留める）。
- 進行役（orchestrator）の判断ロジックの変更（次セグメント起動・差し戻し先決定は引き続き進行役がゲート状態のみを読んで行う。AGENTS.md I5）。
- ゲートレビュアの起動プロセス自体（`gate-review.sh`・`gate-reconcile.sh`等）の変更。
- Issue #442（worker-launchが対象worktreeへcdしない疑い）の調査・対応。本Issueの調査結果を踏まえて#442側で再確認する。
- role_contractへ埋め込む情報量が増えることに伴うトークン量・長大化のトリミング戦略の確定（設計判断）。
- 既存の `buildIssueBlock`（ローカルモードのtitle/request同梱、Issue #183 AC-5）自体の変更。
- worker-report schema（`.agent-skill-chain/schemas/worker-report.schema.yaml`）へのフィールド追加要否の確定（設計判断）。
