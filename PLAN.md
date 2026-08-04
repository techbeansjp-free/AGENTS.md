# PLAN: bugfix: 期限切れ+credential紛失writer leaseを人間が回収するための正規CLI経路が無い

- Issue: `ISSUE-441`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `github-lease.ts`: 監査コメント生成 | `postLeaseReclaimComment(issueNumber, actor, holder, segment, cwd?)` を新規追加する。既存 `MARKER`（`<!-- agent-skill-chain:lease -->`）とは別の `<!-- agent-skill-chain:lease-reclaim -->` を使い、`postLeaseComment`／`cleanupLeaseComment`（可視性コメント用）とコメント種別が混同されないようにする。本文に回収主体（actor）・回収日時（ISO 8601、呼び出し時の `new Date().toISOString()`）・対象Issue番号・segment・回収前holderを含める。token・credential関連の値は一切含めない。既存 `renderLeaseComment`／`publicLease` は変更しない。 | AC-4 | なし |
| 2 | `lease.ts`: `reclaim()` コマンド実装 | `src/commands/lease.ts` に `RECLAIM_USAGE` 定数と `export async function reclaim(args: string[])` を追加する。処理順序: (1) `isHelp` 判定、(2) 位置引数 `issue_id`・`segment` の必須検査、(3) `config.coordination.backend !== 'github'` なら `lease resume` と同じパターンで早期fail（ローカルモードは対象外、DESIGN.md「要件→設計要素の対応表」参照）、(4) `args.includes('--confirm')` を検査し無ければfail（AC-3、`upgrade.ts` の `--dry-run` 解析パターンを踏襲）、(5) `allLeasesFor(number, root).find(entry => entry.segment === segment)` で対象lease取得、無ければfail、(6) `expires_at > now` ならfail（AC-2）、(7) `releaseLeaseRef(number, segment, root, existing.sha)` を呼び出し、`reason === 'conflict'` なら「検査後にrefが更新されました」旨でfail（AC-5）、それ以外のエラーもfail、(8) actor解決（`--actor <value>` 明示 > `git config user.name`（`root` を cwd として `git` ヘルパー経由で取得）> フォールバック文字列 `unknown-operator`。credential系ヘルパー（`readLeaseCredential`／`resolveCredentialToken`）は一切呼び出さない、AC-7）、(9) `postLeaseReclaimComment` 呼び出し、失敗時はDESIGN.mdの障害モード(d)のメッセージでfail、(10) 成功時は回収したissue_id・segment・回収前holderを標準出力へ返し終了コード0（AC-1）。 | AC-1, AC-2, AC-3, AC-5, AC-7 | `#1` |
| 3 | `cli-routes.ts`: ルート登録 | `'lease reclaim': lease.reclaim` を既存の `'lease acquire'`／`'lease release'`／`'lease renew'`／`'lease resume'` の並びに追加する。 | AC-1 | `#2` |
| 4 | `.agent-skill-chain/scripts/lease-reclaim.sh`: 配布ラッパー新設 | 既存 `lease-acquire.sh`／`lease-release.sh` と同一のCLI解決ロジック（`bin/agents-md.js` → `node_modules/.bin/agent-skill-chain` → PATH上の `agent-skill-chain` の順にフォールバック）をコピーし、末尾を `exec "${CLI[@]}" lease reclaim "$@"` にする。 | AC-1, AC-3 | `#3` |
| 5 | 統合テスト: `test/integration/lease-reclaim.test.ts` 新規作成 | `test/integration/lease-resume.test.ts` の `createTmpRepo({ backend: 'github' })`＋`createGhStub` パターンを踏襲し、AC-1〜AC-7を1テストずつ機械検証する: ①期限切れlease＋`--confirm`で終了コード0・ref削除・新規acquire成功（AC-1, AC-6）、②期限内leaseで終了コード非0・ref存置（AC-2）、③`--confirm`無しで終了コード非0・ref存置（AC-3）、④成功後にstubのIssueコメント一覧へ監査コメントが追加されていること・actor/日時/issue/segment/旧holderを含むこと（AC-4）、⑤`releaseLeaseRef` 呼び出し前に対象refを別途更新（`renewLeaseRef` 直接呼び出しで模擬）してから `reclaim` を実行し、削除が拒否されrefが更新後の値のまま残ることを検証（AC-5）、⑥`credentialDirectory` 配下にcredentialファイルを一切書かない・読まない状態（`writeLeaseCredential` を呼ばず、`readLeaseCredential` が undefined を返す状態）でも回収が成立することを検証（AC-7）。 | AC-1〜AC-7 | `#1, #2, #3, #4` |
| 6 | 単体テスト: `test/unit/github-lease.test.ts` へ追記 | `postLeaseReclaimComment` の本文フォーマット（marker・actor・holder・segment・issue・日時を含み、token文字列を含まないこと）を既存の `renderLeaseComment` 系テストと同じ形式で追加する。 | AC-4 | `#1` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
