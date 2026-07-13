---
document_id: "08e43466-209f-43a6-80b6-a59039ba7b85"
---

# 5. エラー処理と外部通知

本リポジトリは CLI・bash スクリプト群・CI で構成され、HTTP サーバー/ワーカーを持たない。したがってテンプレートの HTTP 経路・Rollbar/Slack 通知は**該当なし**とし、本リポジトリ実態に即した「失敗時の挙動と差し戻し」の方針を定義する。

## 5.1 失敗の扱いの原則

- **fail-fast**: スクリプトは `set -euo pipefail` を基本とし、前提不足（`sqlite3` 不在・必須引数欠落・`AGENT_ROLE` 不一致等）を検出したら**非 0 終了コード**で即座に失敗し、標準エラーに理由を出す。
- **終了コードで表現する**: エラーは例外送出ではなく終了コードで伝える。CLI `audit` は監査結果の終了コードを透過する。
- **二重処理をしない**: 証跡書込は書記ラッパー 1 本に限定し、同一記録を複数経路から書かない（[03 データ設計](../03_データ設計/README.md)）。

## 5.2 レイヤ別の失敗時挙動

| レイヤ | 失敗時の挙動 |
| ------ | ------------ |
| CLI（`agents-md`） | 前提不足・不正サブコマンドは非 0 終了。`uninstall` は既定でユーザー資産を保持（非破壊）。 |
| スクリプト群 | `set -euo pipefail`。`write-workflow-log.sh` は必須カラム欠落・`AGENT_ROLE!=scribe`・不正 UUID・不正 ts_utc を検出して exit 1。DB ロック時は最大 5 回リトライ後に exit 1。 |
| enforcement（runtime） | Layer2 PreToolUse は違反を exit 2（block）。メタデータが渡らない環境では案内のみ exit 0（fail-open）。 |
| enforcement（CI） | Layer4 audit.sh は失敗条件該当時に FAIL（reject）。本リポは self-enforce.yml で非ブロッキング運用。 |
| CI（release.yml） | ジョブ失敗で後続ジョブ（`needs`）が停止。`concurrency` で多重実行を防止。 |

## 5.3 差し戻し（enforcement 失敗条件）

実装変更・レビュー・証跡の不整合に対する差し戻し（FAIL）の条件は [enforcement/README.md §失敗条件と差し戻し](../../.agent-skill-chain/source/enforcement/README.md) を正本とする（例: #3 04_review 欠落・#25 メイン直接実作業・#31/#32 システム仕様書レビュー証跡）。本仕様書では再定義しない。

## 5.4 外部通知

- Rollbar/Slack 等の実行時外部通知は**該当なし**（サーバー/ワーカー不在）。
- 外部への作用は「npm publish（release.yml）」であり、CI シークレット（`RELEASE_MAIN_PAT` 等）の名称・役割のみ扱う（値は非記載）。

---

## 参考資料

- [04 機能設計/enforcement](../04_機能設計/enforcement/README.md) — 4 層強制・失敗条件
- [04 機能設計/スクリプト群](../04_機能設計/スクリプト群/README.md) — write-workflow-log.sh の失敗検証
- [03 データ設計](../03_データ設計/README.md) — 排他制御・リトライ

---

**最終更新**: 2026 年 07 月 13 日
