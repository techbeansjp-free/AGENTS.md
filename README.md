# agent-skill-chain

agent-skill-chainは、人とAI agentが同じ手順で使える、安全側に倒す軽量な開発ワークフローです。要求から実装、検証、レビュー、PRまでをStep契約でつなぎ、権限や証拠が不明な操作は実行しません。

このREADMEは初めて利用する人のための非規範的な公開入口です。規則や製品仕様はここで再定義せず、後述する正本を参照してください。

## 前提条件

- Node.js 20以上
- npm

## 導入と利用

対象directoryを省略した場合は現在directoryを使います。対象を明示するときは`--root=.`を指定します。

`install`、`update`、`delete`は何も書き換えないpreviewが既定です。表示された変更を確認し、同じcommandへ`--apply`を付けた場合だけ変更します。`doctor`は読み取り専用です。

| 操作 | previewまたは診断 | 変更の適用 |
|---|---|---|
| 導入 | `npx agent-skill-chain install --root=.` | `npx agent-skill-chain install --root=. --apply` |
| 更新 | `npx agent-skill-chain update --root=.` | `npx agent-skill-chain update --root=. --apply` |
| 削除 | `npx agent-skill-chain delete --root=.` | `npx agent-skill-chain delete --root=. --apply` |
| 診断 | `npx agent-skill-chain doctor --root=.` | 変更なし |

詳しいowner境界、更新時に保持される資産、各Stepの使い方は[中央利用案内](.agent-skill-chain/00_利用案内.md)から確認できます。

## Claude CodeとCodexとの連携

`install`と`update`は、Claude Code用の`.claude/skills/asc-step/SKILL.md`とCodex用の`.agents/skills/asc-step/SKILL.md`を管理します。各hostはこの登録アダプターから、開発ワークフローと現在のStep契約へ到達できます。配置や内容は`doctor`で診断できます。

## 正本と仕様

- リポジトリでの入口: [AGENTS.md](AGENTS.md)
- package全体の案内: [中央利用案内](.agent-skill-chain/00_利用案内.md)
- 権限と所有権: [運用ポリシー](.agent-skill-chain/docs/00_運用ポリシー.md)
- Step 0〜11の順序: [開発ワークフロー](.agent-skill-chain/docs/01_開発ワークフロー.md)
- 開発、テスト、レビュー、安全gate: [品質基準](.agent-skill-chain/docs/02_品質基準.md)
- 現在の製品仕様: [製品仕様利用案内](docs/specs/00_利用案内.md)

困ったときや不具合を見つけたときは、[GitHub Issues](https://github.com/techbeansjp-free/AGENTS.md/issues)で相談・報告してください。
