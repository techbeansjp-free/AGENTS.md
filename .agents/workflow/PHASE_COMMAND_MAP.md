# PHASE_COMMAND_MAP.md — Phase → Command Mapping

フェーズ判定後の **command 選択を決定的（deterministic）にする**ための対応表。

メインエージェントは phase を判定したら、**必ず本ファイルを参照して command を選択する**。推測や独自判断で command を決めてはならない。

---

## Phase → Command 一覧

| Phase | Command | 説明 |
|------|---------|------|
| 要求 | requirement-discovery | 依頼内容の把握と 00_要求定義.md の作成・更新 |
| 要件 | requirement-discovery | 01_要件定義.md の作成・更新（ユーザーストーリー／受け入れ基準／BDD シナリオ） |
| 設計 | design-feature | 02_設計.md の作成・更新 |
| 実装計画 | design-feature / implement-feature | 03_実装計画.md の作成・更新。必要に応じて implement-feature の入口として扱う |
| 実装 | implement-feature | 実装およびテストコード作成。既存 03_実装計画.md に従う |
| レビュー | verify-and-close | 04_review.md の作成・更新とクローズ判定 |

**証跡の原則**: レビュー phase の証跡は本則として workflow.db に記録する。memo は過渡的・例外運用のみ（scribe/CONTRACT 参照）。

---

## Rule

メインエージェントは次を守る。

1. phase を判定したら、本 PHASE_COMMAND_MAP を開く。
2. 一致する Phase 行から command を選択する。
3. 選択した command を skills/agent/run_command に渡し、サブエージェントへ委譲する。

禁止事項:

- **本表が phase → command の唯一の経路である。本表にない command の起動は禁止。**
- 本表にない command を自由に作ってはいけない。
- 本表と異なる command を「便利そうだから」という理由で選んではいけない。
- PHASES.md と矛盾する対応を作ってはいけない（矛盾がある場合は PHASES.md / 本ファイルを更新して解消する）。

本ファイルは **phase → command の単一の正本** とする。

