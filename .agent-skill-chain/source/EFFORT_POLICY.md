---
document_id: "165b969b-5bc7-40d1-a404-6bc4432cb375"
---

# EFFORT_POLICY.md — サブ委譲時の reasoning effort（推論深度）の役割別制御（抽象原則）

**責務**: サブ委譲時の reasoning effort（推論深度）の役割別静的割当の**抽象原則のみ**を規定する。具体的な role×effort 対応表・モデル名・閾値は**コアに置かず** `.agent-skill-chain/project/` に委ねる（PF 中立性・CORE.md §ルールの優先順位）。model ティア選定（[MODEL_SELECTION.md](MODEL_SELECTION.md)）とは**独立した別次元**の軸であることを本ファイルで明記する。

---

## 1 適用条件

本ファイルの原則は、**reasoning effort を選択・指定できるランタイム（Claude ランタイム等）でサブ委譲を行うときのみ**適用する。effort の概念が存在しない・解決できない環境は**対象外環境**であり、その場合は**そのランタイムのデフォルト動作**に従う（本ファイルの強制は発火しない）。対象外環境を明記することでマルチ PF 中立性との緊張を緩和する（[MODEL_SELECTION.md §1 適用条件](MODEL_SELECTION.md#1-適用条件)と同型のフォールバック）。

---

## 2 ティア明記義務との別次元性

reasoning effort は、サブ委譲時に選定する **model ティア**（[MODEL_SELECTION.md](MODEL_SELECTION.md) が規定）とは**独立した別次元の軸**である。ティア選定は「どの model で実行するか」、effort 制御は「同一 model 上でどれだけ深く推論させるか」を扱い、両者を混同しない。委譲時に**ティアを明記する義務**（MODEL_SELECTION.md §2 ティア明記義務）と、委譲時に**effort を明記する義務**（本ファイルが規定）は**別々に**満たす必要があり、一方を満たしたことで他方の明記を省略してよいことにはならない。**role×effort の具体対応表・モデル名・閾値は本ファイルに記載しない**（コアへの具体値混入禁止）。具体対応表は `.agent-skill-chain/project/` の定義に従う。

### 記録・検証の非対称性と実装範囲の切り分け

model_tier には ledger（`ledger/schema.sql` の `model_tier`/`tier_rationale`/`tier_exception` 列）と audit 検査（enforcement 側のティア記録検査）が整備されているのに対し、本ファイルが課す effort 明記義務には対応する記録欄・audit 検査が存在せず、義務が事後検証不能なまま「明記したことになっている」だけの状態になりうる。model_tier と対称化する（`effort`/`effort_rationale` 相当の記録欄を ledger に追加し audit 検査対象に含める）ことが望ましいが、その実装対象（`ledger/schema.sql`・`scripts/write-workflow-log.sh`・`enforcement/ci/audit.sh`）はいずれも本ファイルの非所有物であり、既存 `workflow.db` のスキーマ移行判断も伴う。したがって**本ファイルおよび project 側 role×effort 受け皿の方針確定までを本パッケージのスコープとし、ledger 記録欄の追加・audit 検査対象化の実装は当該ファイルの所有パッケージへ委譲する**（本ファイルでは着手しない）。それまでの間も §2 の effort 明記義務（委譲パケットへの明記）そのものは変わらず有効である。

---

## 3 品質ゲート非劣化原則

**品質ゲート相当の役割**（監査・verify-and-close 等）へサブ委譲するときの effort は、**コスト都合で切り下げない**。ティア選定における品質ゲート最上位固定（MODEL_SELECTION.md §3 品質ゲート最上位固定）と同型の原則を effort 次元にも適用し、品質ゲート相当役割の effort は**非劣化（定義済みの effort 以上を選定する）**ことを原則とする。具体対応表が `.agent-skill-chain/project/` に未定義の場合であっても、**具体値の欠如を理由に非劣化原則の適用を省略しない**。

---

## 4 対象外環境のフォールバック

effort フィールドを**解決できないランタイム**では、本ファイルの強制は発火せず、当該ランタイムの**既定動作をそのまま用いる**（§1 適用条件）。対象外環境で effort 指定を強制しようとした場合は、本ファイルの適用条件外として**無視**する（エラーにしない。MODEL_SELECTION.md と同型の扱い）。

---

## 5 参照

- [MODEL_SELECTION.md](MODEL_SELECTION.md)（model ティア選定の抽象原則。本ファイルとは独立した別次元）
- [REVIEW_DUAL_LENS.md §5 参照](REVIEW_DUAL_LENS.md#5-参照)（レビューの実効性とモデル階層。品質ゲート非劣化の関連文脈）

---

## 汎用/固有境界

- **コア（本ファイル）**: 適用条件・ティア明記義務との別次元性・品質ゲート非劣化原則・対象外環境のフォールバック（抽象原則）。
- **`.agent-skill-chain/project/`（採用先で定義）**: 具体 role×effort 対応表・モデル名・閾値。**対応表はコアに置かない（PF 中立性）。** 本リポでは [`../project/MODEL_TIER_TABLE.md` §role×effort 対応表（受け皿）](../project/MODEL_TIER_TABLE.md#roleeffort-対応表受け皿) がこの受け皿を兼ねる（role→ティア対応表と併記）。
