<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: release tagのgit committer identity未設定バグ修正

- Issue: `ISSUE-204`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `tag()` へのidentity保証呼び出し追加 | `src/commands/release.ts` の `tag()` 内、`git tag -a` 実行直前（冪等スキップ判定より後）に `ensureGitIdentity(root)` を呼び出し、エラー時は `bump()` と同じパターンで `fail()` する（DESIGN.md「呼び出し位置の設計判断」参照） | `AC-1, AC-2, AC-3` | なし |
| 2 | `tag()` 向け新規テスト追加 | `test/integration/release.test.ts` に、既存の `identitylessEnv()` ヘルパー（Issue #198 で `bump()` 向けに導入済み）を再利用し、(a) identity未設定環境で `release tag` が成功しtagger identityがfallback値になること、(b) 既存identity設定済み環境で `release tag` 実行後もidentityが変化せずtagger identityも既存値のままであることを検証する2テストを追加 | `AC-1, AC-3` | `#1` |
| 3 | 既存テストスイート全体の回帰確認 | `test/integration/release.test.ts` 全体（`bump()`・`tag()` 冪等スキップ・`publish()` 関連の既存テストを含む）を実行し、全通過を確認する | `AC-4` | `#1, #2` |

<!-- AC-5（mainマージ後の実release workflow実行での確認）は本Issueの実装・検証セグメントの対象外（manual検証、Issue #204のマージ後に別途実施） -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
