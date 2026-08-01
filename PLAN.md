# PLAN: verify gate-reportがprotected base checkoutではなくtarget_shaのGit objectを見るべき

- Issue: `ISSUE-316`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `GateReport`インターフェースへ`id`・`target_sha`追加 | `src/commands/verify.ts` | `AC-1`〜`AC-3`, `AC-5`, `AC-6` | なし |
| 2 | 成果物検証ロジックを`git show`ベースへ差し替え | `fs.existsSync`+`digestOfFile`を`git show`+`digestOf`へ | `AC-1`〜`AC-3`, `AC-7` | `#1` |
| 3 | `ABSENT_ARTIFACT_DIGEST`のexport・sentinel分岐追加 | `gate.ts`で`export const ABSENT_ARTIFACT_DIGEST`とし、`verify.ts`でimportして`report.gate.id === 'implementation'`限定のsentinel例外分岐を実装 | `AC-5`, `AC-6` | `#1, #2` |
| 4 | 既存テストの改訂 | `verify gate-report`統合テストをSPEC.md commit前提へ改訂し、ISSUE-176 AC-4テスト（working-tree削除検知）を退役・削除する | `AC-4` | `#2` |
| 5 | 回帰テスト追加 | worktreeファイルシステムに無いがtarget_sha上に存在/digest一致/digest不一致/target_sha上にも無い/implementation gateでsentinel許容/implementation以外でsentinel拒否、の6パターンを検証するテストを追加。うちtarget_sha上にも無いパターン（`AC-2`）とdigest不一致パターン（`AC-3`）は、ローカルモードでの未commit・commit後編集済み成果物（`AC-7`）の検証意図を兼ねる（backend種別による分岐が無いため、追加のローカル専用テストは設けない） | `AC-1`〜`AC-3`, `AC-5`〜`AC-7` | `#2, #3, #4` |
| 6 | 検証 | `npm run build`・`npm test` | `AC-1`〜`AC-7` | `#1〜#5` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
