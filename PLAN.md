# PLAN: trusted gate recorder導入後、新規PRのレビュー証跡を生成する経路がCIに存在しない

- Issue: `ISSUE-300`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 実地検証（先行） | 本Issue自身のPR（PR #311、Issue #300はrisk未分類のためstrict profile）のspec gateを対象に、Issue #303・#312の修正込みの最新main（`8cb1710`）をbase_shaとして`gate-local-review.sh`を実行する。完了条件は「終了コード`0`」「`run_id`・`slot`が異なる独立2件のレビュー証跡がGitHub PR Reviewへ実際に投稿されている」「`repository_dispatch`（`event_type: agent-skill-chain-gate-record`）が発行されている」の3点であり、`trusted gate recorder`ワークフローがCheck Runを実際に記録できるかは対象に含めない（専用GitHub Appの認証情報が未登録であり、その整備は人間の対話的操作を要するインフラ設定として別Issueで扱う） | `AC-2`, `AC-3` | なし |
| 2 | 運用手順文書の新設 | `.agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md`を、#1で実際に成功したコマンド・手順を基に作成する。#1で判明した運用上の制約（target_shaの明示fetchが必要、`base.sha`のキャッシュ遅延、レビュアCLI出力の非決定性）も併せて記載する | `AC-1` | `#1` |
| 3 | 新設文書のAGENTS.mdへの登録 | `AGENTS.md`のディレクトリ構成の`standards/`列挙へ`GATE_REVIEW_OPERATIONS`を追加し、あわせてゲート運用を述べる本文から本文書を証跡生成手順の正本として明示する。リポジトリの正本文書からの参照経路を作り、個人の記憶に依存しない発見可能性を担保する | `AC-1` | `#2` |
| 4 | 検証 | `verify doc-length`（AGENTS.md 150行上限を含む）・`lint vocab`・`lint references`・`npm test` | `AC-1`〜`AC-3` | `#1, #2, #3` |

## 実装順序の見直しについて

#1（実地検証）を先に行う理由は、文書化する内容（コマンド・引数・capability要件）を推測ではなく実際に成功した手順から転記するため。#3を#2の後に置く理由は、登録対象の文書が確定してから正本への参照を追加するため。実装中に作業順序のみを見直す場合は本ファイルのみを更新する。
