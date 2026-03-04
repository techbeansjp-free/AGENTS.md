# Claude Code 強制ガード（PreToolUse）

**目的**

- 書記以外の workflow.db への書き込みを物理的に拒否する
- 書記の **workflow.db 以外**への Write を拒否する（`.workflow/**/logs/` は廃止・使用禁止）

---

## 適用方法（プロジェクト内完結）

1. **採用先プロジェクト**では、本ディレクトリの [pretooluse_write_guard.json](./pretooluse_write_guard.json) を **プロジェクトルートの** `.claude/hooks/pretooluse_write_guard.json` にコピーする。ユーザーホーム（`~/.claude/hooks/`）へはコピーしない。
2. Claude Code の **PreToolUse フック**で、**そのプロジェクトの** `.claude/hooks/pretooluse_write_guard.json` を指定する。
3. **動作確認**: 書記サブに「workflow.db 以外に書け」と指示し、**拒否される**ことを 1 回確認する（スモークテスト ケース C）。

---

## 効果

- 書記の **workflow.db 以外**への Write を即拒否
- 書記以外の Edit を拒否
- **Bash**: **sqlite3 のみ**許可（書記が workflow.db に INSERT するため）。それ以外のコマンドは拒否
- 人為ミスでも書けない（＝壊れない）

---

## 参照

- 実設定: [pretooluse_write_guard.json](./pretooluse_write_guard.json)
- 設計・仕様: [pretooluse_write_guard.md](./pretooluse_write_guard.md)
- 書記契約: [scribe/CONTRACT](../../scribe/CONTRACT.md)
