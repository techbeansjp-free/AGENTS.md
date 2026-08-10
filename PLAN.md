<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: AGENTS.mdの`verify-template-sync.sh`パス言及を実在パスへ修正する

- Issue: `ISSUE-553`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した設計要素（AGENTS.md「GitHub配布・マルチAI対応」節の該当1文の修正）を、以下の単一の変更単位で実装する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `AGENTS.mdパス記載修正` | 「GitHub配布・マルチAI対応」節の該当文中、`.agent-skill-chain/scripts/verify-template-sync.sh` を `.agent-skill-chain/ci/verify-template-sync.sh` に置換する。同一文中の `setup-labels.sh`・`setup-ruleset.sh` への言及は変更しない | `AC-1, AC-3` | なし |
| 2 | `矛盾解消の確認` | 修正後の `AGENTS.md` を通読し、「ディレクトリ構成」節の `ci/` 配下ツリー列挙（`verify-template-sync` を含む）と「GitHub配布・マルチAI対応」節の記載が矛盾しないことを確認する | `AC-2` | `#1` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
