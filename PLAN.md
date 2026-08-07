<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: upgrade が配布元で廃止されたファイルを導入先から削除しない（過去の負債が残留する）

- Issue: `ISSUE-492`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `src/lib/ownership-record.ts` 新設 | `.agent-skill-chain/.owned-files.json` の読み取り（破損時は空扱い＋警告メッセージ返却）・アトミック書き込み・相対パス正規化 | `AC-1` | なし |
| 2 | `src/lib/stale-assets.ts` 新設 | 削除候補差分計算（`AC-4`,`AC-9`）、候補ファイルの分類（`Absent`/`Unreadable`/`TypeChanged`/`ContentMatch`/`ContentChanged`）、削除実行（dry-run分岐）、次回所有権記録エントリの算出 | `AC-2, AC-3, AC-4, AC-5, AC-8, AC-9, AC-10` | `#1` |
| 3 | `src/commands/init.ts` 修正 | 初回コピー完了後、コピー結果パス一覧から所有権記録を新規作成 | `AC-1` | `#1` |
| 4 | `src/commands/upgrade.ts` 修正 | 所有権記録読込 → `stale-assets.ts` で候補算出・（非dry-runなら）削除実行 → 結果を `summary` へ追記 → 削除失敗があれば成功結果を先に出力してから非ゼロ終了 → 所有権記録を更新 | `AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11` | `#1, #2` |
| 5 | 単体テスト `test/unit/ownership-record.test.ts`、`test/unit/stale-assets.test.ts` 新設 | `#1`・`#2` の純粋ロジック（読み取り破損時の安全側扱い、5分類の判定、差分計算、記録更新算出）を検証 | `AC-1, AC-2, AC-3, AC-4, AC-5, AC-8, AC-9, AC-10` | `#1, #2` |
| 6 | 結合テスト `test/integration/upgrade.test.ts` 拡張、`test/integration/init.test.ts` 確認 | AC-1〜AC-11 の受入シナリオ（削除・dry-run一覧一致・削除失敗時の異常終了と結果非隠蔽・project/不可侵・既存の通常上書き非退行）を実ファイルシステムで検証 | `AC-1〜AC-11` すべて | `#3, #4` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
