# skills/requirements — 要求・要件ドメイン

要求抽出から BDD シナリオ執筆までを担当する capability の集合。command **requirement-discovery** の skill chain で順に使用する。

| capability | 目的 |
|------------|------|
| [extract-goals](extract-goals/) | 目的・ゴールの抽出 |
| [identify-assumptions](identify-assumptions/) | 前提・制約の洗い出し |
| [define-constraints](define-constraints/) | 制約の明確化・受け入れ基準候補 |
| [write-bdd](write-bdd/) | BDD シナリオ・01_要件定義の執筆 |

単体で使う場合は LOAD_POLICY に従い該当 capability のみ読む。chain で使う場合は commands/requirement-discovery.md の順序を守ること。
