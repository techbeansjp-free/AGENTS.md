# PLAN: bugfix: PRマージ後もworktreeが自動クリーンアップされず放置され続ける

- Issue: `ISSUE-351`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `integration-status.ts` 新設 | `src/lib/integration-status.ts` を新設し、`resolveIntegrationStatus(entry, issueNumber, config, root): 'merged_or_closed' \| 'open' \| 'undetermined'` を実装する（DESIGN.mdの判定基準表どおり、github/local双方に対応）。単体テストで三値判定の分岐を網羅する（gh非0終了・0件・MERGED/CLOSED混在・OPENのみ・localのstatus各値・ファイル不在） | `AC-1, AC-2, AC-3` | なし |
| 2 | `cleanup.ts` リファクタ | `src/commands/cleanup.ts` の既存インラインPR/Integration Record判定を `resolveIntegrationStatus()` 呼び出しへ置換し、`state === 'merged_or_closed'` のみを許可条件とする。既存の `cleanup` 結合テスト（test/integration/cleanup系）を全件再実行し、挙動が変化していないことを確認する | なし（既存挙動の維持確認） | `#1` |
| 3 | `issueIdFromEntry()` 追加 | `src/lib/worktree.ts` に `issueIdFromEntry(entry, config): string \| undefined` を追加する（`branch.pattern` にキャプチャグループを与えた正規表現でbranch名からIssue番号を抽出）。branch名規約に適合しない場合・branch未設定の場合は `undefined` を返す単体テストを追加する | `AC-1` | なし |
| 4 | `doctor` 新規検査追加 | `src/commands/doctor.ts` に新規チェック「マージ済みworktree残存」を追加する。`listWorktrees(root).slice(1)` の各エントリについて `issueIdFromEntry()` → （取得できたら）`resolveIntegrationStatus()` を呼び、`merged_or_closed` の全件をIssue ID付きで列挙するNG理由文字列を組み立てる。対象0件はOK | `AC-1, AC-2, AC-3` | `#1, #3` |
| 5 | 結合テスト追加 | `test/integration/doctor.test.ts` に以下を追加する: (a) merged状態のPRに対応するworktreeが残存 → NG・Issue ID含む（AC-1）、(b) 複数件残存時に全件列挙されること（AC-1）、(c) open状態のPRに対応するworktreeは警告対象に含まれない（AC-2）、(d) `gh`呼び出し失敗（stub化）時は警告対象に含まれない（AC-3）、(e) 対象worktreeが0件（主worktreeのみ）ならOK | `AC-1, AC-2, AC-3` | `#4` |
| 6 | 標準手順の明記 | `.agent-skill-chain/standards/GIT_CONVENTIONS.md` §worktreeの削除に、進行役向け標準手順（PRマージ完了直後に対象Issueへ `cleanup <issue_id>` を実行すること、およびdoctorの本検査が手順漏れの安全網であること）を追記する | `AC-4` | なし |
| 7 | dogfooding先への反映 | `.agent-skill-chain/project/自己拡張ワークフロー.md` の `## close` 節に、#6と同内容（マージ完了直後の`cleanup`実行）を反映する | `AC-4` | `#6` |
| 8 | 実地検証 | 本リポジトリ自身に対し `doctor` を実行し、意図的に「マージ済みPRに対応するworktreeが残存する」状態を用意した上で期待通りの警告が出力されることを実測確認する（SPEC.md AC-1検証方法見込み: hybrid） | `AC-1` | `#4, #5` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
