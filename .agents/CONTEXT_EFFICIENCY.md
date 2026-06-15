---
document_id: "b24ab361-adaa-468f-bfd1-488bd5a49eaa"
---

# CONTEXT_EFFICIENCY.md — issue 起票時のコンテキスト効率（ISSUE_CREATION）の正本

**責務**: 大規模一括起票時のコンテキスト肥大を防ぐ汎用原理（ISSUE_CREATION）の正本を 1 か所に持つ。具体数値・タグ運用は混入させず `.agents-project/` に委ねる。規模比例で、単一/少数 issue は [CLAUDE.md §issue 作成タスク受領時の標準フロー](../CLAUDE.md) の軽量運用を保つ。

---

## issue 起票時のコンテキスト効率（ISSUE_CREATION）

- **作業単位 = 1 issue**。1 issue は **fresh サブ**で扱い、issue 間で文脈を持ち越さない（issue-persist 境界）。
- **仕様 inventory は一度だけ索引化**し、各サブには必要な**スライスのみ渡す**（全文を毎回渡さない）。
- **確定した起票順序を正本化**し、親は issue 区切りで /clear する。
