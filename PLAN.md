<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: リリースworkflowのbumpステップがgit author identity未設定で失敗するバグの修正

- Issue: `ISSUE-198`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `isIdentityConfigured()` の実装 | `src/commands/release.ts` に非公開ヘルパーを追加。`git(['config', key], root)` の実行結果が `status === 0` かつ `stdout.trim()` が非空であれば真を返す（副作用なし） | `AC-1`（要件2の非破壊判定の土台） | なし |
| 2 | `ensureGitIdentity()` の実装 | 同ファイルに非公開関数を追加。`user.name`/`user.email` それぞれについて `#1` で判定し、未解決の場合のみ `git(['config', 'user.name', 'github-actions[bot]'], root)` / `git(['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], root)` を実行（`--global` は使わない）。いずれかの `git config` 書き込みが失敗した場合はそのエラーを呼び出し元へ伝播させる | `AC-1` | `#1` |
| 3 | `bump()` への組み込み | `git(['checkout', '-b', branch], root)` 成功直後・`writeBumpedVersionFiles()` 呼び出し前に `ensureGitIdentity(root)` を呼び出す。書き込み失敗時は既存の `fail()` パターンに合わせてエラーメッセージ付きで早期returnする | `AC-1` | `#2` |
| 4 | AC-1の自動テスト追加 | `test/integration/release.test.ts`（または新規ヘルパー）に、identityを設定していない一時repoに対して `release bump` を実行し `git commit` が成功することを確認するテストケースを追加する。`createTmpRepo()` 自体は変更せず、当該テスト内でidentity未設定の状態を別途用意する（例: 専用の一時repoに対し `git config` を意図的に行わない、または `HOME`/`GIT_CONFIG_GLOBAL` を退避した環境で実行する） | `AC-1` | `#3` |
| 5 | 既存テストの回帰確認 | `npm test`（単体・統合テスト全体）を実行し、`test/integration/release.test.ts` を含む既存テストが全て変更前と同じ結果で通過することを確認する（新規失敗が発生しないこと） | `AC-2` | `#3`, `#4` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのもの（修正箇所をCLI側に置く方針・fallback identityの値・非破壊判定の方式）を変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

AC-3（実環境でのリリース完走確認）は本Issueのマージ後、`agent-skill-chain / release` workflowの実run結果を人手で確認する検証セグメントの範囲であり、実装セグメントの変更単位には含まない。
