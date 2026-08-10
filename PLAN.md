<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: root-cleanup runが生成するPRのbase branchが'main'にハードコードされておりdefault branchが異なるリポジトリで必ず失敗する

- Issue: `ISSUE-588`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した設計要素を、どの順序で・どの単位に分割して実装するかを記述する。各変更単位は対応する AC-ID を明示する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `root-cleanup.ts: defaultBranch()への置き換え` | `src/commands/root-cleanup.ts` へ `import { defaultBranch } from '../lib/worktree.js';` を追加し、`run()` 内 `if (!pr) { ... }` ブロックの先頭（`git checkout -b branch` より前）で `const base = defaultBranch(root);` を呼び出す。既存の `const base = 'main';`（PR作成直前の行）は削除し、`gh pr create` へはこの `base` をそのまま渡す。例外は捕捉せず `guard()` へ伝播させる（AC-3はguard()の既存整形挙動で満たす） | `AC-1, AC-2, AC-3` | なし |
| 2 | `既存回帰テストの確認（AC-2）` | `test/integration/root-cleanup.test.ts` の既存テスト（`--base main` を検証する箇所を含む）が変更単位1適用後も無修正で成功することを確認する。`createTmpRepo()` はdefault branch `main` のリポジトリを作るため、`defaultBranch()` は従来どおり `'main'` を返す想定 | `AC-2` | `#1` |
| 3 | `default branchがmain以外のケースのテスト追加（AC-1）` | `test/integration/root-cleanup.test.ts` へ新規テストを追加する。手順: `createTmpRepo()` 後、ローカルで `git checkout -b develop`・`git push origin develop`・リモート（`remoteDir`、bare repo）側で `git symbolic-ref HEAD refs/heads/develop` を実行してリモートのdefault branchを切り替え、ローカルの `main` ブランチと `origin/main` を削除したうえで `git remote set-head origin -a` を実行し `refs/remotes/origin/HEAD` を `develop` へ向ける。この状態で `root-cleanup run` を実行し、`gh pr create` へ渡された引数に `--base develop` が含まれること（`main` ではないこと）をgh-stubの `prCreateCalls` から検証する | `AC-1` | `#1` |
| 4 | `default branch解決不能時のテスト追加（AC-3）` | `test/integration/root-cleanup.test.ts` へ新規テストを追加する。手順: `createTmpRepo()` 後、ローカルの `main` ブランチを別名へ退避（`git checkout -b tmp-hold` 等でHEADを逃がしてから `git branch -D main`）し `origin/HEAD` のsymbolic-refも未設定のままにして、`main`/`master` いずれのブランチも存在せず `GITHUB_BASE_REF` 環境変数も未設定の状態を作る。`root-cleanup run` を実行し、終了コードが0以外であること、標準エラー出力に `デフォルトブランチを特定できません` を含むこと、`stub.readState().prCreateCalls` が0件であること（PR作成を試みる前に失敗していること）を検証する | `AC-3` | `#1` |
| 5 | `ビルド・既存テストスイート全体の実行` | `npm run build` と `npm test`（既存スイート全体）を実行し、変更単位1〜4がroot-cleanup以外の既存テスト（`issue.ts`・`pr.ts`・`verify.ts` が使う `defaultBranch()` 呼び出し箇所を含む）に副作用を与えていないことを確認する | `AC-1, AC-2, AC-3` | `#1, #2, #3, #4` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
