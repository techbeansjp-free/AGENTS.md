# Cursor 側の強制方針

Cursor は物理フックが弱い場合があるため、以下で強制する。

1. **サブエージェントは役割別に分離** — [agents/](./agents/) の workflow-*.md を参照・配置する。
2. **書記以外は readonly** — 可能な設定がある場合は「書かない」を定義に明記する。
3. **書記のみ logs/ に書く** — 書記サブだけが `.workflow/**/logs/` に Write 可能。
4. **CI で「入口抜かし」「ログ不正」を検知して落とす** — [.workflow/templates/github/workflows/subagent-guard.yml](../../../.workflow/templates/github/workflows/subagent-guard.yml) を有効化する。

---

## agents/ の役割別定義

- **書記以外**（implementer, reviewer, tester, auditor）: 「書かない」「ログを作らない」を明記。結果は親に返すのみ。
- **書記**（scribe）: `.workflow/**/logs/` にのみ 1 ファイル書く。[scribe/CONTRACT](../../scribe/CONTRACT.md) のフロントマターに従う。

採用先の Cursor で、サブエージェント定義として [agents/](./agents/) 内の workflow-*.md を参照またはコピーして配置する。

---

## 参照

- [delegate_to_sub](../../skills/agent/delegate_to_sub.md)
- [scribe/CONTRACT](../../scribe/CONTRACT.md)
- [サブエージェント抜かし防止 4.5](../rules/サブエージェント抜かし防止.md)
