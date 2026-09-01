---
name: asc-step
description: agent-skill-chainの開発作業で各Stepの開始時に、現在の工程を特定して対応するStep skill正本を読み込む。Step 0の開始時だけでなくStepごとに読み込む。
---

# agent-skill-chain Step選択

1. [開発ワークフロー正本](../../../.agent-skill-chain/docs/01_開発ワークフロー.md)を全文読む。
2. ワークフロー正本だけを根拠にmodeと現在のStep 0〜11を特定する。
3. ワークフロー正本から対応する`.agent-skill-chain/skills/step-NN-*/SKILL.md`を特定し、その実fileを全文読む。Step番号とskillの対応は[Step skill利用案内](../../../.agent-skill-chain/skills/00_利用案内.md)にある。
4. 選択したStep skill内の相対linkは、そのStep skillの実directoryを基点に解決する。このadapterのdirectoryを基点にしない。
5. Step契約と、そこから参照される正本・templateに従って作業する。

このadapterはhostから正本への登録口であり、Stepの順序・実行契約・成果物書式を複製しない。内容が食い違う場合は開発ワークフローと各Step skillを優先する。
