# Claude Code 強制ガード（PreToolUse）

**目的**

- 書記以外の書き込みを物理的に拒否する
- **logs/ 以外**への Write を拒否する

---

## 適用方法（どこに置けば有効か）

1. **実設定ファイル**: 本ディレクトリの [pretooluse_write_guard.json](./pretooluse_write_guard.json) を、Claude Code の **PreToolUse フックが読み込むパス**に登録する。
2. **配置先の例**（採用先の Claude Code ドキュメントで要確認）:
   - `~/.claude/hooks/pretooluse_write_guard.json`
   - または プロジェクトルートの `.claude/hooks/pretooluse_write_guard.json`
3. Claude Code のドキュメントに従い、Write/Edit の path を検査する設定として登録する。
4. **動作確認**: 書記サブに「logs 以外に書け」と指示し、**拒否される**ことを 1 回確認する（スモークテスト ケース C）。

---

## 効果

- **logs/ 以外**への Write を即拒否
- 書記以外の Edit を拒否
- 人為ミスでも書けない（＝壊れない）

---

## 参照

- 実設定: [pretooluse_write_guard.json](./pretooluse_write_guard.json)
- 設計・仕様: [pretooluse_write_guard.md](./pretooluse_write_guard.md)
- 書記契約: [scribe/CONTRACT](../../scribe/CONTRACT.md)
