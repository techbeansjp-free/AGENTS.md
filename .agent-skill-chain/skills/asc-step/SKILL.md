---
name: asc-step
description: agent-skill-chainの開発作業で各Stepの開始時に、現在の工程を特定して対応するStep skill正本を読み込む。Step 0の開始時だけでなくStepごとに読み込む。
---

# agent-skill-chain Step選択

1. Step 0の開始時だけ、[開発ワークフロー正本](../../../.agent-skill-chain/docs/01_開発ワークフロー.md)の「モード」「モード判定質問」「ステップ0〜11」の3節を読み、modeと開始Stepを確定する。正本の他の節は、選択したStep skillが節linkで参照したときにその節だけ読む。正本を全文読まない。
2. Step 1以降の開始時は、stagingの`00_モード判定.json`（mode）と`journal/steps.jsonl`から現在のStepを特定する。**journalの最終entryをそのまま使わない。** modeのStep列（正本「ステップ0〜11」節）のうち、通常entryが記録済みのStepの集合を完了集合とし、含まれない最初のStepを現在のStepとする。`reconfirmation: true`の再確定entryは既存Stepのdigest再固定の記録であり、完了集合にも順序判定にも使わない。ワークフロー正本を再読しない。journalが無い、読めない、またはmodeのStep列と矛盾する場合は、1.の3節へ戻らず停止する。
3. 特定したStepの`.agent-skill-chain/skills/step-NN-*/SKILL.md`の実fileを全文読む。どのStep skillが存在するかは[Step skill利用案内](../../../.agent-skill-chain/skills/00_利用案内.md)から辿れる。この案内は索引であってStepの選択根拠にしない。
4. 選択したStep skill内の相対linkは、そのStep skillの実directoryを基点に解決する。このadapterのdirectoryを基点にしない。
5. Step契約と、そこから参照される正本・templateに従って作業する。読む量と書く量は開発ワークフロー正本の「読取と書込の量」節に従う。

このadapterはhostから正本への登録口であり、Stepの順序・実行契約・成果物書式を複製しない。内容が食い違う場合は開発ワークフローと各Step skillを優先する。
