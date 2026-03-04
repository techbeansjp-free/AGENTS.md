# Cursor 側の強制方針（プロジェクト内完結）

Cursor は物理フックが弱い場合があるため、以下で強制する。

1. **サブエージェントは役割別に分離** — [agents/](./agents/) の workflow-*.md を**採用先プロジェクトの** `.cursor/agents/` にコピーして配置する。ユーザーホーム等リポジトリ外へはコピーしない。
2. **書記以外は readonly** — 可能な設定がある場合は「書かない」を定義に明記する。
3. **書記のみ workflow.db に書く** — 書記サブだけが workflow.db に Write 可能（`.workflow/**/logs/` は廃止・使用禁止）。
4. **CI で「入口抜かし」「ログ不正」を検知して落とす** — [.workflow/templates/github/workflows/subagent-guard.yml](../../../.workflow/templates/github/workflows/subagent-guard.yml) を有効化する。

---

## agents/ の役割別定義

- **書記以外**（implementer, reviewer, tester, auditor）: 「書かない」「ログを作らない」を明記。結果は親に返すのみ。
- **書記**（scribe）: **workflow.db にのみ** 1 件記録する。[scribe/CONTRACT](../../scribe/CONTRACT.md) のスキーマに従う。`.workflow/**/logs/` は廃止・使用禁止。

採用先では、プロジェクトルートの `.cursor/agents/` に workflow-*.md を配置し、Cursor のサブエージェント定義で**そのプロジェクトの** `.cursor/agents/` を参照する。

---

## 参照

- [delegate_to_sub](../../skills/agent/delegate_to_sub.md)
- [scribe/CONTRACT](../../scribe/CONTRACT.md)
- [サブエージェント抜かし防止 4.5](../rules/サブエージェント抜かし防止.md)
