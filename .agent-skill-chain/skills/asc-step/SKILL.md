---
name: asc-step
description: agent-skill-chainの開発作業で各Stepの開始時に、現在の工程を特定して対応するStep skill正本を読み込む。Step 0の開始時だけでなくStepごとに読み込む。
---

# agent-skill-chain Step選択

1. Step 0の開始時だけ、`agent-skill-chain doctor`でこのadapterが正本とhash一致することを確かめ、`workflowReadiness`でtrusted検証command宣言とPR ruleの観測対応を確認してから、[開発ワークフロー正本](../../../.agent-skill-chain/docs/01_開発ワークフロー.md)の「モード」「モード判定質問」「ステップ0〜11」の3節を読み、modeと開始Stepを確定する。正本の他の節は、選択したStep skillが節linkで参照したときにその節だけ読む。正本を全文読まない。
2. Step 1以降の開始時は、`agent-skill-chain workflow advance --staging=<staging path>`を`--apply`なし（preview）で実行し、出力の`targetStep`を次に着手するStepとする。会話を持たない新しいcontextで再開するときは、同じ出力の`resume`（再開状態）を起点にし、そこが指すpath・SHA・digestだけを読む。`resume`はadvisoryであり、gateの照合を置き換えない。**journal/steps.jsonlを自分で解析しない。** 旧journalに残る`reconfirmation: true`の再確定entryの除外や、quick→full昇格時のStep 0/1特例はCLI（`inspectWorkflowStaging`・`planWorkflowAdvance`）が持ち、SKILL.md側で再実装すると特例を落とす危険がある（Issue #1423 DISC-002・F2）。ワークフロー正本を再読しない。CLIが`state: blocked`を返す場合は、1.の3節へ戻らず停止する。
   `ASC_EXECUTION_CONTEXT_MODE=short-lived`のcoordinatorは、previewが返す`agentDispatch`をAgent toolの引数へそのまま渡し、担当をfresh workerへ委譲する。`prompt`は既に文字列化されているため手組みしない。再reviewは`agentDispatchAlternatives`を使う。通常の単発調査は自然言語のAgentで並走できるが、ASC工程担当を通常taskへ格下げしない。起動が拒否されたら理由を修正して再委譲し、mainが実装・是正を代行しない。復旧不能なら理由を利用者へ返す。
3. 特定したStepの`.agent-skill-chain/skills/step-NN-*/SKILL.md`の実fileを読む。Step skillの読む範囲は開発ワークフロー正本の「読取と書込の量」節に従う。どのStep skillが存在するかは[Step skill利用案内](../../../.agent-skill-chain/skills/00_利用案内.md)から辿れる。この案内は索引であってStepの選択根拠にしない。
4. 選択したStep skill内の相対linkは、そのStep skillの実directoryを基点に解決する。このadapterのdirectoryを基点にしない。
5. Step契約と、そこから参照される正本・templateに従って作業する。読む量と書く量は開発ワークフロー正本の「読取と書込の量」節に従う。

host設定を求められた場合は、継続利用する導入先のCLIの`doctor`が返す`hooks.agentLifecycle.configuration`を使う。modeを推測で変更せず、short-lived指定時は同じ環境変数をdoctorへ渡す。既存settings.local.jsonの他のhook・permissionsを保持し、同じhookを二重登録しない。登録後は新規sessionで動作を確認する。

このadapterはhostから正本への登録口であり、Stepの順序・実行契約・成果物書式を複製しない。内容が食い違う場合は開発ワークフローと各Step skillを優先する。

`workflowReadiness.ready=false`は導入健全性とは別の配送前提不足である。欠落したverificationは利用projectの実検証commandをownerが確認して既定branchへ先行導入する。未対応のPR ruleは実観測adapterまたはpolicyの適用境界を是正する。検証宣言・rule種別を推測で書き換えず、`gh pr create`への自動迂回や`04_レビュー.md`による正式証跡の代替をしない。ユーザーがASC工程を省略した場合も、実施していない検証・承認を実施済みとして記録しない。
