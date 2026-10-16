# 標準worktree Reviewerのシナリオ評価（2026-10-17）

変更対象は標準Skill。snapshot backendや外部サービスを起動しない。通常の独立Reviewer一つの責務に、元要求からのシナリオ導出・反証・未確認事項の区別を加えた。専用Gateや必須成果物は追加していない。

比較条件: baselineはv0.5.0-alpha.3（c958ef8066cca4f5c2559ce87a8cde7761555249）のskills/asc/SKILL.md、candidateは本変更。双方gpt-6-sol / medium、fresh Context、同じ入力。各評価Agentは指定armのSkillと入力のみを読み、他arm、正解、以前の結果を渡していない。これは指示による入力分離であり専用OS sandboxを追加した実験ではない。モデル実装の内部versionは取得していない。

初回は既存authorization 4件・persistence 5件の計9件を各arm一回。両者とも欠陥5件中4件を検出、誤指摘0、正常4件を合格とし、custom row equalityによる再試行欠陥（case-8）を見逃した。時間・tokensは取得できずnull。この結果を受けた指示変更は行っていない。

二回目は上記9件と、指示調整に使っていないAPI/文書・元要求・呼出し元防御の4件を各arm一回。生回答はbaseline.jsonとcandidate.json。ケース内の複数指摘は意味で既知の欠陥へ対応付けて採点した（文字一致だけで採点していない）。

| 指標 | baseline | candidate |
|---|---:|---:|
| 起動数（二回目） | 1 | 1 |
| 既知欠陥の検出 | 7/8 | 7/8 |
| 検出率 | 87.5% | 87.5% |
| 指摘適合率 | 7/7 | 7/7 |
| 正常ケースの誤指摘 | 0/6 | 0/6 |
| 明示P1のテナント・所有者違反の見逃し | 0/2 | 0/2 |
| Agentが開始・終了時刻から報告した経過秒 | 47 | 59 |
| tokens | null（未取得） | null（未取得） |

権限の追加ケースcase-12も両者検出。severity定義を渡していない他ケースでP1件数を水増ししない。case-10は呼出し元と文書の2欠陥。case-8の見逃しは両回とも残る。Reviewerにはcustom row factoryの実装やoracleを与えておらず、完全な実repo探索ではない。品質向上・tokens削減・CodeRabbit同等性は未証明。二回目の12秒差は1試行の観測であり性能回帰率とは断定しない。既存9件は二回、新規4件は一回のみであり、広い未知ケースへの一般化はできない。

採用理由は標準Reviewerの必須責務を明確にし、一般的な漏れを実評価で確認したこと。検出性能が向上したからという主張ではない。重大な未確認事項は実案件で追加調査し、Skillだけで網羅性を保証しない。CodeRabbit実行環境はなく未比較。実行済みoracleはtest/test_review_corpus.mjsとtest/test_scenario_corpus.mjs。これらは欠陥の実在を検証し、AIが発見したことの証明とは分ける。

再現入力: baseline Skillを上記commitから取得し、`node scripts/prepare-review-scenarios.mjs <new-output-directory> <baseline-skill> skills/asc/SKILL.md`。Reviewerへ渡すのは該当arm directoryのみ。evaluator/answers.jsonとソース内oracleは評価側に保持する。入力とSkillのhashはinputs.jsonに記録。出力の意味評価では発生条件・コード根拠・影響を正解と照合し、未知の妥当な指摘は誤検知と決めつけず別途検証する。
