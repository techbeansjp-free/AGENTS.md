---
document_id: "62252cf7-da71-4fa1-b172-ebea2495c6eb"
---

# F01: CLI（agents-md）

`agents-md` は npm 配布用の**薄い CLI ラッパ**である。ロジックを持たず、採用先プロジェクトのルート（既定 `process.cwd()`）を引数に各スクリプトへ委譲する。正本は [src/agents-md.ts](../../../src/agents-md.ts)（ビルド後 `bin/agents-md.js`）、利用者向けの使い方は [README.md](../../../README.md)。

## F01.1 コマンド一覧

| コマンド | 概要 | 委譲先（正本） |
| -------- | ---- | -------------- |
| `init` | 採用先へ正本を配備し各ツール向け生成・`workflow.db` 初期化を行う。新規配備（`.agent-skill-chain/` 未配備）では enforcement を既定 on で自動配線する | `scripts/setup.sh` |
| `upgrade` | `init` と同等（既存配備の再同期を意図）。既存配備・本パッケージ自己適用では enforcement 配線を touch しない | `scripts/setup.sh` |
| `uninstall` | setup/init が配備した成果物のみ除去（ユーザー資産は既定で保持） | CLI 内処理 |
| `enforce on\|off\|status` | enforcement フックを `.claude/settings.json` に着脱する。サブコマンド自体は on/off/status 不変（新規配備は `init`/`upgrade` が既定で `on` を自動実行し、`off` で opt-out できる） | `platforms/claude/settings.enforce.json` |
| `doctor` | 配備前提の存在確認＋証跡健全性診断（hash チェーン・integrity） | `scripts/gen-entry-hash.sh` |
| `audit [dir]` | CI 監査の薄ラッパー（終了コード透過） | `enforcement/ci/audit.sh` |
| `export [dir]` | `workflow.db` を NDJSON で書き出す（read-only） | `scripts/export-ndjson.sh` |
| `version` / `--version` / `-v` | `package.json` の version を表示 | — |
| `help` / `--help` / `-h` / (既定) | 使い方を表示 | — |

## F01.2 設計方針

- **薄ラッパの徹底**: CLI は判断・配備・監査の実処理を持たず、`setup.sh`・`audit.sh`・`export-ndjson.sh` 等へ委譲する。正本を `.agent-skill-chain/source/` に一元化するため。
- **非破壊**: `uninstall` はユーザー資産を既定で保持する（`--purge` 等のオプションで挙動を制御）。
- **enforcement は新規配備で既定 on・opt-out 可**: 新規配備（`ASC_MODE=new`）では `init`/`upgrade` が `enforce on` 相当を自動実行する。既存配備・本パッケージ自己適用では touch しない。フック着脱時に注入印を付け、着脱の可逆性を保つ（`enforce off` で明示的に opt-out できる）。

## F01.3 入出力

- **入力**: サブコマンド・対象ディレクトリ（省略時 `process.cwd()`）・オプション。
- **出力**: 配備/生成された成果物、標準出力（診断・監査結果・NDJSON）、終了コード（`audit` は監査結果を透過）。

## F01.4 エラー処理

CLI/スクリプトの失敗時挙動（exit code・fail-fast）の方針は [05 エラー処理と外部通知](../../05_エラー処理と外部通知/README.md) を参照。

---

## 参考資料

- [src/agents-md.ts](../../../src/agents-md.ts) — CLI 実装（正本）
- [README.md](../../../README.md) — 利用者向けの使い方（正本）
- [04 機能設計/スクリプト群](../スクリプト群/README.md) — 委譲先スクリプト群

---

**最終更新**: 2026 年 07 月 13 日
