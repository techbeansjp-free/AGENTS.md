# Issue 1576: review再利用と計画の拘束（2026-10-14）

## 確認した問題と修正

`d1709849`ではCandidate採用前の正式reviewはQuick Step 4の封印後に限定され、00の直接改変はPlanning Sealで拒否される。一方、ignored stagingでreview収束後にAMDを追加すると、同HEAD・同review digestでCandidate採用、Step 10のadapter記録、配送前の計画世代検査が成立した。独立した一時dummyで再現した。正式fullや実PR提出まで通ったという意味ではない。

review inputとround digestへ、CLIが再計算する`planningDigest`を追加した。要求封印とAMDの計画世代が異なる場合、Candidate採用、Step 10のreview再利用、review export、staging付きEvidence検証（mergeの独立性mode共通）を拒否する。入力作成後に変わった計画も拒否し、Agentの申告で現在値へ上書きしない。

計画変更後は`review round --init`が同HEADでも現在の計画と実装の累積全体を独立検分するroundを作る。固定AC違反は修正path外でもblockerとなる。follow-only・record-layer-onlyでは計画変更を検分済みにできない。旧形式で計画digestがないsessionは、封印のある現在計画を再検分するまで再利用しない。

## 検証

- SCN-INT-CANDIDATE-065: review後AMD追加の採用拒否、journal不変、同HEAD再review後の採用。
- SCN-INT-CANDIDATE-066: review input生成後AMD追加の記録拒否。
- SCN-INT-CANDIDATE-067: review後の封印済み00直接改変の拒否。
- SCN-INT-CANDIDATE-068: 同HEADの計画再reviewでHigh固定AC違反をblocker化。
- SCN-INT-REVEVID-015: AMD追加後のexportとmerge共通Evidence照合の拒否、既存Evidence不変。
- 独立read-only Codex contextでAMD抜け道を再現し、修正後の拒否・旧sessionからの再review復旧を確認。最終差分の未修正High/Medium指摘なし。full/CIの結果は最終PR記録を参照する。

## 保証の境界

この修正が拘束するのは封印済み要求とAMDである。GitHubの一次Issue本文を外部編集者が後から変更・削除した場合の開始時snapshot不変性を新たに保証したとは主張しない。ASCによる同期はmarker前の一次要求を保持し、破損markerを同期時に拒否する。現在の一次要求・封印済み要求・Git差分の意味的照合は独立Reviewerの責務として残る。

追加Workerを通常経路へ増やす変更ではない。計画が変わらない場合は既存reviewを再利用する。性能改善率は本修正から推定せず、隔離比較の実測で評価する。
