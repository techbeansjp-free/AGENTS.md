# 権限境界（Capability Policy）

> **AI 向け**: 「誰が何を書けるか」の仕様。**ログは workflow.db（SQLite）への保存を強制する。** 書記一任を **運用** ではなく **仕組み** で担保するため、hooks 等で強制する際の基準とする。
> **責務**: **capabilities/POLICY.md = どの能力を、いつ、どの条件で使うか**。誰が何を書けるか・ログ保存先の強制を定義する。**定義しない**: 絶対制約（CORE）、判断観点・チェックリスト（RULES）、ワークフロー・成果物（WORKFLOW）。

---

## 1. 書記以外の人格

- **MUST NOT**: `.workflow/**/logs/` への書き込みをしてはならない。
- **MUST NOT**: `workflow.db` に対する `sqlite3` 等の書き込み（INSERT/UPDATE/DELETE）を実行してはならない。
- 実装・テスト・ドキュメントの編集は、Task で指定された範囲に限り許可する。

---

## 2. 書記

- **MUST**: 書き込みは `workflow.db`（SQLite）**のみ**に限る。`.workflow/**/logs/**` への書き込みは禁止（廃止・使用禁止）。
- **MUST NOT**: 上記以外のパス（ソースコード、02_設計.md 等）への書き込みをしてはならない。
- ログ項目はメインから受け取ったペイロードのみを記録する。

---

## 3. 全人格

- **MUST NOT**: 削除系操作（`rm` で成果物削除、`git clean -fd` 等）を、Task で明示されていない限り実行してはならない。事故防止のため。

---

## 4. 実装（Cursor / Claude Code）

- Cursor を使う場合: **preToolUse** フックで、書記以外の Write が `workflow.db` を指しているときは拒否する。書記の Write が `workflow.db` 以外を指しているときは拒否する。`.workflow/**/logs/` への書き込みは禁止。
- Claude Code を使う場合: 書記サブに PreToolUse で「書き込み先が workflow.db 以外なら拒否」をかける。他サブに「書き込み先が workflow.db なら拒否」をかける（任意）。

詳細は各環境の Hooks ドキュメントを参照。

---

## 5. 参照

- 書記役: [書記役とログ委譲](../scribe/書記役とログ委譲.md)
- スキーマ: [ワークフローログ_SQLiteスキーマ](../ledger/ワークフローログ_SQLiteスキーマ.md)
