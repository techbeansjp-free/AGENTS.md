# PLAN: verify gate-reportがprotected base checkoutではなくtarget_shaのGit objectを見るべき

- Issue: `ISSUE-316`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `GateReport`インターフェースへ`id`・`target_sha`追加 | `src/commands/verify.ts` | `AC-1`〜`AC-3`, `AC-5`, `AC-6` | なし |
| 2 | 成果物検証ロジックを`git show`ベースへ差し替え | `fs.existsSync`+`digestOfFile`を`git show`+`digestOf`へ | `AC-1`〜`AC-3`, `AC-7` | `#1` |
| 3 | `target_sha`前提検査の追加 | 成果物検証ループへ入る前に`git rev-parse --verify ${target_sha}^{commit}`の成功、かつ40桁16進数パターン`/^[0-9a-f]{40}$/`との一致を要求する前提検査を追加する。空文字列・`HEAD`等のref名・無効な値のいずれかで検査失敗した場合、成果物検証ループを一切実行せず専用エラーでfail-closedに拒否する（GitHubモード・ローカルモード双方の呼び出し経路に等しく適用、backend分岐なし） | `AC-1`, `AC-2`, `AC-7`（前提条件） | `#1, #2` |
| 4 | `ABSENT_ARTIFACT_DIGEST`のexport・sentinel分岐追加 | `gate.ts`で`export const ABSENT_ARTIFACT_DIGEST`とし、`verify.ts`でimportして`report.gate.id === 'implementation'`限定のsentinel例外分岐を実装 | `AC-5`, `AC-6` | `#1, #2` |
| 5 | 既存テストの改訂 | `verify gate-report`統合テストをSPEC.md commit前提へ改訂し、ISSUE-176 AC-4テスト（working-tree削除検知）を退役・削除する | `AC-4` | `#2` |
| 6 | 回帰テスト追加 | worktreeファイルシステムに無いがtarget_sha上に存在/digest一致/digest不一致/target_sha上にも無い/implementation gateでsentinel許容/implementation以外でsentinel拒否、の6パターンを検証するテストを追加。うちtarget_sha上にも無いパターン（`AC-2`）とdigest不一致パターン（`AC-3`）は、ローカルモードでの未commit・commit後編集済み成果物（`AC-7`）の検証意図を兼ねる（backend種別による分岐が無いため、追加のローカル専用テストは設けない）。加えて`target_sha`が(a)空文字列、(b)`HEAD`等の解決可能なref名、(c)存在しない・完全に無効な文字列、の各ケースについて、成果物検証ループへ到達せずfail-closed（検証成功させない）で拒否されることを検証する回帰テストケースを追加する | `AC-1`〜`AC-3`, `AC-5`〜`AC-7` | `#2, #3, #4, #5` |
| 7 | 検証 | `npm run build`・`npm test` | `AC-1`〜`AC-7` | `#1〜#6` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
