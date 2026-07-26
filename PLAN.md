# PLAN: trusted gate recorder導入後、新規PRのレビュー証跡を生成する経路がCIに存在しない

- Issue: `ISSUE-300`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 実地検証（先行） | PR #282（Issue #278、strict profile）のspec/designゲートで`gate-local-review.sh`を現在のmain基準で実行し、独立2体レビュアがCheck Runを記録するところまで確認する | `AC-2`, `AC-3` | なし |
| 2 | 運用手順文書の新設 | `.agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md`を、#1で実際に成功したコマンド・手順を基に作成する | `AC-1` | `#1` |
| 3 | 検証 | `verify doc-length`・`lint vocab`・`lint references`・`npm test` | `AC-1`〜`AC-3` | `#1, #2` |

## 実装順序の見直しについて

#1（実地検証）を先に行う理由は、文書化する内容（コマンド・引数・capability要件）を推測ではなく実際に成功した手順から転記するため。実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
