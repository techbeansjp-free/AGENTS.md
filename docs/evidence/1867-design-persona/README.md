# ペルソナ調査の工程を持つデザイン作成Skillの評価（#1867）

開発時の検証資料であり、配布対象に含めない。

- `candidate/design-creation/`：評価する候補のSkill（`SKILL.md`と`references/`）。評価の結果とownerの決定の前は`skills/`に置かない。
- `EVAL_PLAN.md`：評価の計画（下書き）。
- `cases/lp-new/`：このIssueで作った新しいLPのケース（依頼文と、利用者についての資料`inquiries.md`）。
- `config/`：生成の測定の、共通の仕組み（`../shared-harness/`）の設定。手順と状態は`config/README.md`。
- `config/layers/`：門の数え・層1・層2・層3の設定（計画とともに固定する）。
- `harness/`：生の記録から、門の数えの盲検の束（`gate-packet.mjs`）と層1の画面（`layer-pages.mjs`）を作る道具と、その試験。

状態：Skillの案、計画の下書き（ownerの決定と独立レビューの指摘を反映）、生成と層1〜3の設定まで（dry runは合格）。計画の固定の前。有料の実行はしていない。
