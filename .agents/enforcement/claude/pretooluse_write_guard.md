# Claude Code: PreToolUse Write ガード（仕様）

> **狙い**: 書記サブは **workflow.db のみ** Write 許可。それ以外のサブは Write を原則禁止。`.workflow/**/logs/` は廃止・使用禁止。

---

## 仕様（プロジェクト側で実装する）

1. ツール呼び出し（Write / Edit / Bash）の直前で検査する。
2. **Write**: **書記サブ**は **workflow.db のみ**許可。`.workflow/**/logs/**` は廃止・拒否。**書記以外**は Write 原則拒否。
3. **Edit**: 原則拒否（allow 空・deny 全）。
4. **Bash**: **sqlite3 のみ**許可（書記が workflow.db に INSERT するため）。それ以外のコマンドは拒否。実装で「sqlite3 の第一引数が workflow.db に限定」とすればより厳格にできる。

---

## 参照

- [scribe/書記役とログ委譲](../../scribe/書記役とログ委譲.md)
- [capabilities/POLICY](../../capabilities/POLICY.md)
- [scribe/CONTRACT](../../scribe/CONTRACT.md)
