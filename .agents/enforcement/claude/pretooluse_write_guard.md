# Claude Code: PreToolUse Write ガード（仕様）

> **狙い**: Write/Edit が `**/logs/` 以外に行こうとしたら即拒否する。書記サブは `**/logs/` のみ許可。それ以外のサブは Write を原則禁止。

---

## 仕様（プロジェクト側で実装する）

1. ツール呼び出し（Write / Edit / ファイル作成）の直前で、対象パスを検査する。
2. **書記サブ**: 許可するのは `.workflow/**/logs/**` および `workflow.db` のみ。それ以外は拒否。
3. **書記以外**: Write/Edit は原則拒否。親が Task で明示した成果物パスのみ許可リストに載せる実装も可。

---

## 参照

- [scribe/書記役とログ委譲](../../scribe/書記役とログ委譲.md)
- [capabilities/POLICY](../../capabilities/POLICY.md)
- [scribe/CONTRACT](../../scribe/CONTRACT.md)
