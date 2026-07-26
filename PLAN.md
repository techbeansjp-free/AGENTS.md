# PLAN: verify gate-reportがprotected base checkoutではなくtarget_shaのGit objectを見るべき

- Issue: `ISSUE-316`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `GateReport`インターフェースへ`target_sha`追加 | `src/commands/verify.ts` | `AC-1`〜`AC-3` | なし |
| 2 | 成果物検証ロジックを`git show`ベースへ差し替え | `fs.existsSync`+`digestOfFile`を`git show`+`digestOf`へ | `AC-1`〜`AC-3` | `#1` |
| 3 | 回帰テスト追加 | worktreeファイルシステムに無いがtarget_sha上に存在/digest一致/digest不一致/target_sha上にも無い、の4パターンを検証するテストを追加 | `AC-1`〜`AC-4` | `#1, #2` |
| 4 | 検証 | `npm run build`・`npm test` | `AC-1`〜`AC-4` | `#1, #2, #3` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
