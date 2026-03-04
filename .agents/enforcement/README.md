# enforcement - ルールが破れない仕組み

> **AI 向け**: 「ルールが存在する」ではなく**「ルールが破れない仕組み」**にするための、プラットフォーム別の強制手段を置く。

---

## 方針

- **Claude Code**: PreToolUse 等のフックで、書記は workflow.db のみ Write 可能、それ以外は Write を許可しない。→ [claude/pretooluse_write_guard.md](./claude/pretooluse_write_guard.md)
- **Cursor**: 入口一本化（delegate_to_sub のみ）＋役割別サブ定義＋書記以外は readonly 寄せ。→ [cursor/README.md](./cursor/README.md)

---

## 参照

- 唯一の入口: [skills/agent/delegate_to_sub](../skills/agent/delegate_to_sub.md)
- 最小読込保証: [boot/SUBAGENT_MINIMUM](../boot/SUBAGENT_MINIMUM.md)
- 書記の書く範囲: [capabilities/POLICY](../capabilities/POLICY.md)、[scribe/書記役とログ委譲](../scribe/書記役とログ委譲.md)
