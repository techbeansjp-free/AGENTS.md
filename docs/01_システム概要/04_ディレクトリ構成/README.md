---
document_id: "2a08d653-b804-4514-9bfa-ed215f6cc90d"
---

# 4. ディレクトリ構成

本リポジトリの主要ディレクトリと役割を示す。パスはリポジトリルートからの相対。git 追跡可否・配布可否の役割分担の正本は [.agent-skill-chain/project/自己拡張ワークフロー.md §名前空間の役割分担](../../../.agent-skill-chain/project/自己拡張ワークフロー.md) にあり、本表はその俯瞰である。

## 4.1 ディレクトリ一覧

| パス | 役割 | git | 配布 |
| ---- | ---- | --- | ---- |
| `src/` | CLI ソース（`agents-md.ts`） | 追跡 | ビルド成果物 `bin/` を配布 |
| `bin/` | ビルド後の CLI（`agents-md.js`） | 生成物 | 配布（`files` allowlist） |
| `.agent-skill-chain/source/` | パッケージ正本（boot/commands/skills/spec/enforcement/ledger/scripts/platforms 等） | 追跡 | 配布 |
| `.agent-skill-chain/runtime/templates/` | 消費者ランタイム向けテンプレート（00〜04・docs 雛形） | 追跡 | 配布 |
| `.agent-skill-chain/project/` | 本リポ固有の最優先ルール（自己拡張ワークフロー） | 追跡 | 非配布 |
| `.agent-skill-chain/runtime/` | 消費者ランタイム生成物（`workflow.db` 等） | 無視（.gitignore） | 非配布 |
| `.github/workflows/` | CI（`release.yml`・`self-enforce.yml`） | 追跡 | 非配布 |
| `test/` | 保守者自己テスト（runner・各 test-*.sh・e2e） | 追跡 | 非配布 |
| `docs/` | 本仕様書群・`AI_CI_CD_VISION.md`・`maintainer/`（開発記録） | 追跡（`memo/` は非追跡） | 非配布 |
| `.claude/`・`.cursor/`・`.adapters/` | setup/build による各ツール向け生成物 | 無視（.gitignore） | 非配布 |

※ 生成物（`node_modules` 等）は一覧から省略する。配布対象の確定は `package.json` の `files` allowlist が単一情報源。

## 4.2 ソースツリー（俯瞰）

```text
.
├── src/agents-md.ts                # CLI 本体（薄いラッパ）
├── bin/agents-md.js                # ビルド成果物
├── .agent-skill-chain/
│   ├── source/                     # 配布正本
│   │   ├── boot/                   # CORE・LOAD_POLICY 等の実行契約
│   │   ├── commands/               # skill chain 定義（design-feature 等）
│   │   ├── skills/                 # capability 定義
│   │   ├── spec/                   # 設計原則・ディレクトリ方針
│   │   ├── enforcement/            # 4層強制・audit.sh
│   │   ├── ledger/                 # workflow.db スキーマ（schema.sql/.md）
│   │   ├── scripts/                # setup/build/write-workflow-log 等
│   │   └── platforms/              # claude / apm 生成定義
│   ├── runtime/templates/          # 消費者向けテンプレート（配布）
│   └── project/                    # 本リポ固有の最優先ルール
├── .github/workflows/              # release.yml / self-enforce.yml
├── test/                           # 自己テスト（run-all.sh ほか）
└── docs/                           # 本仕様書群・AI_CI_CD_VISION・maintainer
```

## 4.3 命名・配置の方針

- **正本と生成物の分離**: 配布正本は `.agent-skill-chain/source/`、各ツール向け生成物は `.claude/`・`.cursor/`・`.adapters/`（非追跡）。二重管理・配布物汚染を防ぐ。
- **issue と memo**: 自己拡張 issue は `docs/maintainer/workflow/<timestamp>_<title>/`（追跡）。`memo/` は非追跡（transient）。詳細は [自己拡張ワークフロー.md](../../../.agent-skill-chain/project/自己拡張ワークフロー.md)。

---

## 参考資料

- [03 アーキテクチャ](../03_アーキテクチャ/README.md)
- [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../.agent-skill-chain/project/自己拡張ワークフロー.md) — 名前空間の役割分担（正本）

---

**最終更新**: 2026 年 07 月 13 日
