---
name: step-07-design-review
description: 02設計と03実装計画が実装開始可能かを一度確認し、開始不能な契約穴だけを解消する。
---

# ステップ7: 実装readiness check

入力は00〜03のダイジェスト。境界、interface、状態、失敗、rollback、risk比例Verification Set、変更対象、依存順が実装開始に十分かを一度確認する。これはexact-head独立reviewではなく、最大3ラウンド契約を適用しない。開始不能な契約穴だけを02/03へ修正し、改善提案やMedium/Lowで実装開始を止めない。要件変更、停止対象riskの受容、不可逆操作、相反する事業判断だけ対応する上流契約を再確定する。

ローカルまたはユーザー共通のローカルLLM reviewer設定が有効なら、進行役は`routing delegated-review-staging --root=<対象worktreeのroot> --step=7 --staging=<対象staging>`を実行してreviewを委譲する。`state=reviewed`の肯定・敵対評価と対象内finding、差分外として除外された件数を読み、`decision=blocked`の指摘は進行役が根拠を検証し、成立した開始不能な点を是正する。`degraded`をローカルLLMの完了とみなさず、設定・実行条件の修正または別reviewerの証拠で確認を続ける。`disabled`なら利用可能な別reviewerで確認する。実行結果の入力・出力digestと採否をjournal evidenceへ記録し、LLMの自己申告だけを設計変更の権限にしない。

進行役はローカルLLMの結果に加え、利用可能ならCodex SolまたはOpusなど別reviewerの独立したreadiness checkも確認する。ローカル設定がない場合はCodex Solを基本候補とし、利用不能ならOpusなどを選ぶ。PRのCodeRabbit利用枠制限に応じた二者レビューはStep 10で判定する。採否は進行役が出典と反証を確認して決め、追加reviewerを呼べない場合は理由をjournal evidenceへ記録する。

## テンプレート契約

直接使用するテンプレートはない。このステップは02/03の既存構造を保ったまま開始可能性だけを記録し、最終review成果物を生成しない。

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を全文読み、設計・計画による上流の再定義と、計画に潜む未承認の設計判断をfindingにする。

[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)と01確定差分を作業開始前に全文読み、設計上のモデル・境界・interfaceと標準語・用語IDの不一致、未承認の新語をfindingにする。

開始可能性、修正した契約穴、次に許可される工程をjournal evidenceへ記録する。最終品質review用の`04_レビュー.md`はStep 10だけが完成させる。修正する02/03はそれぞれの作成元テンプレート構造を維持する。
