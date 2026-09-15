# プロジェクト管理

## 管理の正本

開発作業のWBS、状態、着手順序は[GitHub Project #8](https://github.com/orgs/techbeansjp-free/projects/8/views/1?system_template=kanban)を正本とする。Issue本文は各作業の目的、範囲、受け入れ条件、依存関係を所有し、Projectは作業全体の配置と順序を所有する。

この文書はProject #8の運用規則を所有する。Projectの可変なIssue一覧と順序は文書へ複製しない。

## 用語

- WBS: Project #8上で作業、順序、状態、親子分解を追跡する作業分解構造。単なるIssue一覧ではない。
- 着手順序: `Ready`列に表示された上から下への順序。Issue番号順、作成日順、ラベル順ではない。

## Statusと配置

| Status | 配置する作業 | 移動条件 |
|---|---|---|
| `Backlog` | 判断、依存、外部条件、再検証を待つ作業 | blocking理由と再開条件をIssueへ記録する |
| `Ready` | 依存と開始条件を満たした未着手作業 | 実行可能性を確認する |
| `In progress` | 現在実施している作業 | `Ready`最上位から着手し、ASCの開始条件を満たす |
| `In review` | 実装と検証を終えてreview中の作業 | 提出時は受け入れ条件と検証証拠を揃える。review不合格時は理由をIssueへ記録し、修正可能なら`In progress`、依存・判断・外部条件・再検証を待つなら`Backlog`へ戻す。指摘対応と検証証拠の更新後に再reviewを依頼する |
| `Done` | deliveryを完了した作業 | reviewとmerge、または合意したdelivery終端を読み戻し、Issueをcloseする |

作業を続けられなくなった場合は、blocking理由と再開条件をIssueへ記録して`Backlog`へ戻す。状態を判断できない場合は移動せず、安全側で停止する。

## 着手順序

実行可能な作業は`Ready`へ置き、列の最上位から1件ずつ着手する。着手時に対象を`In progress`へ移す。

順序を変える場合は、作業へ着手する前にProject上の並びを変更する。会話、Issue番号、priorityラベル、ProjectのPriority fieldだけを根拠に下位のIssueを先取りしない。`Ready`が空なら、`Backlog`から推測で選ばず、再開条件またはownerの判断を待つ。

## WBSとしての分解

Issueは、独立に完成、review、merge、rollbackできる成果物を1単位とする。次のいずれかに該当する場合は、着手前に子Issueへの分解を検討する。

- 成果物ごとに独立して完成または先行mergeできる。
- reviewの担当者または観点が異なる。
- 一方の失敗やrollbackから他方を分離する必要がある。
- 調査、設計判断、実装などの完了条件を独立して管理する必要がある。

所要時間が長いことだけを理由に機械的に分割しない。密結合で一体としてreview、merge、rollbackすべき成果物は同じIssueに保つ。

親Issueは全体目標、全体の完了条件、子同士の依存関係、進捗を所有する。子Issueは自身の成果物、受け入れ条件、ASC成果物、PRを所有する。子IssueもProject #8へ追加し、依存順に配置する。

## ラベルとの役割分担

type、risk、priority、待機理由などのラベルは検索と補助判断に使う。StatusはProjectのStatus field、着手順序はProject上の表示順を正本とし、ラベルへ同じ責務を持たせない。

## 完了と整合確認

reviewが終わっただけでは`Done`にしない。受け入れ条件、検証証拠、PR、mergeまたは合意したdelivery終端、Issue、Projectの一致を読み戻した後に、Projectを`Done`へ移してIssueをcloseする。

PR作成、merge、Issue close、branch削除、release、publish、worktree cleanupは別の操作と権限として扱う。今回の作業が許可した操作から、後続操作の権限を推定しない。

外部状態を更新するときは、対象organization、repository、Project、Issue、現在のStatusと並びを事前確認し、更新直後に読み戻す。不一致や成否不明を成功扱いしない。
