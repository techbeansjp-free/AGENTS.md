# DESCRIPTION_BUDGET.md — スキル説明文の文字数実測結果

`.agent-skill-chain/scripts/skill-description-budget.sh` の実行結果（生データ）。各 `SKILL.md` の
YAMLフロントマターにおける `description`・`when_to_use` の文字数と、その合計を示す。特定モデルの
文脈長数値やその分母を用いた比率計算はここでは行わない（ADR-0023実装Issueの要件8）。任意のモデル
文脈長を分母として比率を計算する場合は、下表の `total_chars` 合計をそのモデルの文脈長予算（既定で
モデル文脈長の1%等）で割って比較する。

| skill | description_chars | when_to_use_chars | total_chars |
|---|---|---|---|
| `cleanup` | 148 | 115 | 263 |
| `gate-review` | 172 | 137 | 309 |
| `issue-start` | 163 | 212 | 375 |
| `pr-merge` | 143 | 128 | 271 |
| `segment-work` | 194 | 212 | 406 |
| **合計** | 820 | 804 | 1624 |

再実測: `.agent-skill-chain/scripts/skill-description-budget.sh` を実行し、本ファイルの表を出力結果へ差し替える。
