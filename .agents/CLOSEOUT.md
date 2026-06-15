---
document_id: "aefb0658-6114-4092-a3de-78a7f43ee0fe"
---

# CLOSEOUT.md — クローズアウト（欠落工程の補完）の抽象形正本

**責務**: implement-feature 完了の検知で起動する不変クローズアウトの**欠落工程（抽象形）**の正本を 1 か所に持つ。既存の重複工程（verify 必須・指摘 0 反復・04_review・90_issues）は**ここに再記述せず**、既存正本（[REVIEW_RULE.md](REVIEW_RULE.md) / [run_command.md §Constraints](skills/agent/run_command.md) / [RULES.md](RULES.md)）へリンクで委譲する（CORE.md §境界）。本ファイルは工程の**抽象形**のみを定め、ブランチ名・CI コマンド・トレーラ等の具体値は `.agents-project/` に委ねる。

---

## commit ステップ

- 1 サブ issue = 1 論理コミットを基本とする。
- 既定ブランチ（main 等）上で作業している場合は feature ブランチを切ってからコミットする。
- **push はユーザーが明示したときのみ**行う（高リスク操作。[RULES.md](RULES.md) §高リスク操作 参照）。

---

## 別セッション引継ぎ

- 作業を別セッションへ引き継ぐ場合は、引継ぎ記録と**再開プロンプト**（次に何をどこから始めるか）を残し、受け手が文脈を再構築できる状態にする。

---

## clear 境界

- **1 feature = 1 コンテキスト**を保つ。feature の区切りで /clear し、無関係な文脈を持ち越さない（safe-clear invariant: clear して安全な境界でのみ clear する）。

---

## fresh サブ分割

- 工程は必要に応じて fresh なサブへ分割する。分割しても**収束を保証**するため、**却下済みの指摘とその理由**を後続サブへ継承し、同じ指摘の蒸し返し・無限反復を防ぐ。

---

## verify-実経路検証

- verify(ii) として、変更が**実際の経路で動く**ことを検証する（机上確認だけで完了としない）。検証様式は [REVIEW_DUAL_LENS.md §3 証跡要求](REVIEW_DUAL_LENS.md#3-証跡要求) の両リストと整合させる。
