---
name: asc-step
description: agent-skill-chainの開発作業で各Stepの開始時に、現在の工程を特定して対応するStep skill正本を読み込む。Step 0の開始時だけでなくStepごとに読み込む。
---

# agent-skill-chain Step選択

1. Step 0の開始時だけ、[開発ワークフロー正本](../../../.agent-skill-chain/docs/01_開発ワークフロー.md)の「モード」「モード判定質問」「ステップ0〜11」の3節を読み、modeと開始Stepを確定する。正本の他の節は、選択したStep skillが節linkで参照したときにその節だけ読む。正本を全文読まない。
2. Step 1以降の開始時は、`agent-skill-chain workflow advance --staging=<staging path>`を`--apply`なし（preview）で実行し、出力の`targetStep`を次に着手するStepとする。**journal/steps.jsonlを自分で解析しない。** 旧journalに残る`reconfirmation: true`の再確定entryの除外や、quick→full昇格時のStep 0/1特例はCLI（`inspectWorkflowStaging`・`planWorkflowAdvance`）が持ち、SKILL.md側で再実装すると特例を落とす危険がある（Issue #1423 DISC-002・F2）。ワークフロー正本を再読しない。CLIが`state: blocked`を返す場合は、1.の3節へ戻らず停止する。
3. 特定したStepの`.agent-skill-chain/skills/step-NN-*/SKILL.md`の実fileを全文読む。どのStep skillが存在するかは[Step skill利用案内](../../../.agent-skill-chain/skills/00_利用案内.md)から辿れる。この案内は索引であってStepの選択根拠にしない。
4. 選択したStep skill内の相対linkは、そのStep skillの実directoryを基点に解決する。このadapterのdirectoryを基点にしない。
5. Step契約と、そこから参照される正本・templateに従って作業する。読む量と書く量は開発ワークフロー正本の「読取と書込の量」節に従う。

このadapterはhostから正本への登録口であり、Stepの順序・実行契約・成果物書式を複製しない。内容が食い違う場合は開発ワークフローと各Step skillを優先する。
