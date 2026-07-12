---
document_id: "272accfb-a3e1-400d-8746-4ccd90b4df8c"
---

# F03: enforcement 機構

enforcement は「理解させる」のではなく**「逸脱できないようにする」**ことを目的とする。経路を限定し、違反操作を止め、正しい I/O のみを通し、完了を証跡で縛る。正本は [enforcement/README.md](../../../.agent-skill-chain/source/enforcement/README.md)、設計は [enforcement/DESIGN.md](../../../.agent-skill-chain/source/enforcement/DESIGN.md)。本ドキュメントは俯瞰に留める。

## F03.1 強制の 4 層

| 層 | 担い手 | 役割 |
| -- | ------ | ---- |
| Layer1 プラットフォーム権限 | 実行環境 | ロール別のツール許可・拒否（プラットフォーム依存） |
| Layer2 Tool hook | `PreToolUse.sh` | ツール実行前に違反なら exit 2（block）。メタデータが渡る環境で有効、渡らなければ案内のみ exit 0 |
| Layer3 Wrapper command | `write-workflow-log.sh` | DB 書込はラッパー経由のみ（sqlite3 直接禁止） |
| Layer4 CI audit | `audit.sh` | 証跡・順序・品質・整合性を push/merge 前に事後検知し reject |

runtime（Layer1/2）は「その場で reject」、CI（Layer4）は「事後に reject」の二段構えであり、PreToolUse は完全物理強制ではない（Hook が取得できるメタデータ範囲でのみ有効）という限界を CI audit が補完する。

## F03.2 主要な強制事項（俯瞰）

- **サブ委譲の絶対強制**: メイン（orchestrator）の直接実作業を禁止。runtime で reject できない環境は audit.sh #25 等で事後補完する。
- **書記経路の一本化**: `workflow.db` への書込は書記ラッパーのみ（Layer3）。
- **レビュー成果物の強制**: verify-and-close 実行時は issue 直下に `04_review.md` を必ず作成（未作成は audit 失敗条件 #3）。
- **継続追随ゲート**: `docs/` 採用プロジェクトでは実装変更 issue の close 前にシステム仕様書の as-built 同期を必須化（audit #31/#32）。本リポジトリは `docs/` 採用済みのため以後発動する（[00_review](../../00_review/README.md)）。

## F03.3 audit.sh（Layer4）

`audit.sh` は失敗条件（#3・#25・#31・#32 等）を検査し、違反時に FAIL する。失敗条件の定義と実装の所在は [enforcement/README.md §失敗条件と差し戻し](../../../.agent-skill-chain/source/enforcement/README.md) を正本とする。本リポジトリでは issue が `docs/maintainer/workflow/` 配下にあるため、self-enforce.yml から audit.sh を非ブロッキングで呼ぶ運用である（詳細は [CI_リリースパイプライン](../CI_リリースパイプライン/README.md)）。

## F03.4 抽象仕様（未実装）

系統 A（モデルティア切り下げ検知）・系統 C（過大読込抑制）・系統 E（SubagentStop 記録強制）は**抽象仕様のみ**であり、hook スクリプトの実装・配備は将来の別 issue に委ねる（正本: [enforcement/README.md](../../../.agent-skill-chain/source/enforcement/README.md) §系統 A・C・E）。本仕様書ではこれらを「実装済み」と記載しない。

---

## 参考資料

- [enforcement/README.md](../../../.agent-skill-chain/source/enforcement/README.md) — 強制の正本
- [enforcement/DESIGN.md](../../../.agent-skill-chain/source/enforcement/DESIGN.md) — 4 層の設計
- [03 データ設計](../../03_データ設計/README.md) — Layer3 が書く `workflow_log`
- [05 エラー処理と外部通知](../../05_エラー処理と外部通知/README.md) — 失敗時の差し戻し方針

---

**最終更新**: 2026 年 07 月 13 日
