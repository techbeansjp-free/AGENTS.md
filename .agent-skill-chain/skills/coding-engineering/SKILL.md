---
name: coding-engineering
description: Step 9 implementerが必要な情報と品質観点だけを選び、既存実装の再利用、実装中の検証、自律修正を行うために使う。独立reviewや工程管理は担当しない。
---

# Step 9内部のCoding Engineering

入力は既存Step 9の計画・AC・仕様・Verification Set・project policy。出力は要求を満たす最小変更と既存Step 9が要求するEvidenceであり、専用の報告書は作らない。開始条件、停止条件、authority、工程遷移、review収束、PR・merge、project modeを変更しない。既存契約と判断が衝突したら[Step 9正本](../step-09-implement/SKILL.md)に従う。新しいASC Step、Fast Path、staging、workflow state、severity体系を追加しない。

## 必要最小限の理解と探索

Step 9入力 → Issue・AC → 対象file → 直接依存 → 関連test → 関連仕様 → 選択Lensの順で不足分だけ取得する。既知で変化のない情報を読み直さず、全repository・全docs・全historyを読まない。上流計画を再設計せず、責務と境界、成立させる契約、副作用・失敗・data risk、既存設計を保つ最小変更の4点を確認する。

**Search Before Createを行う。** component、validator、helper、model、test utility、token等を作る前に、対象と直接依存の範囲で既存実装を検索する。独立した検索・読取はまとめ、有力候補を数件読む。類似実装、局所pattern、直接依存のいずれかを十分に把握できたら終了する。追加探索で判断が変わらないときも終了し、「存在しない証明」のため全体へ広げない。

## 必要なLensだけ選ぶ

次表は読取の索引でありchecklistやGateではない。通常は変更に必要な1〜3件程度だけ読む。全Lensの一括読込と1 Lens 1 subagentは禁止する。Lensを多数要するように見えても該当論点から絞る。既存routing・role・独立性契約は維持する。

| 変更の特徴 | 読むLens |
|---|---|
| domain・business rule・責務境界 | [UNIX・DDD](lenses/unix-ddd.md) |
| AC・business behavior・重要回帰のtest | [BDD・Testing](lenses/bdd-testing.md) |
| API・event・CLI・data・schema・migration | [Contract・Data](lenses/contract-data.md) |
| write・retry・queue・webhook・二重操作 | [冪等性・Concurrency](lenses/idempotency-concurrency.md) |
| auth・permission・PII・secret・file/path・process・dependency/build/release | [Security・Privacy](lenses/security-privacy.md) |
| shared・common・refactor・共通化 | [保守性・再利用](lenses/maintainability-reuse.md) |
| UI・component・操作状態 | [UI・UX・Accessibility](lenses/ui-ux-accessibility.md) |
| style・意味を共有するdesign decision | [Design・Layout Token](lenses/design-layout-token.md) |
| hot path・batch・query・log・telemetry・外部障害 | [観測性・性能・耐障害性](lenses/observability-performance-resilience.md) |

project固有のarchitecture、Gherkin、accessibility、token、security、performance、migrationの規約があれば判断に使う。共通部から特定framework、checker、方式、新しいhard gateを強制しない。

## 小さく実装して実行結果で補正する

十分な理解を得たら最小の正しい変更を実装する。容易に実行で確認できることを長時間推論しない。将来だけのextension point、汎用framework、便乗refactor、不自然なtest用abstraction、不要なloggingを足さない。file行数、method数、類似箇所数だけを理由に分割・共通化しない。

実装中は変更behaviorのtest → 関連unit/integration → 必要なstatic/type checkの順を目安に、最も安く早く要求を観測する。unitで十分ならunit、境界interactionならintegration、end-to-endでしか立証できないときはe2eを選ぶ。小修正ごとにfull verificationを反復しない。**これは途中のfeedback戦略であり、最終Verification Setを生成し直したり縮小したりしない。**

## 通常の問題を自律修正する

失敗を検知 → 原因を診断 → scope内で修正 → 関連feedbackを再実行する。type/test failure、null guard、validation、内部API不整合、自分の回帰、既存validator再利用漏れ、local duplicate、error handling、命名、small refactor、fixture調整は通常の実装判断として前進する。helper/class/test構成の選択だけで人間判断を要求しない。

AC・目的・invariant・scope、公開/外部契約、security境界、不可逆操作、authorityの問題が判明したら、[Step 9の既存の発見処理](../step-09-implement/SKILL.md)へ渡す。新しい停止条件を作らず、既存停止条件の拡大も無視もしない。

同じ原因の失敗、diffの急拡大、Critical/High riskの増加、scope逸脱、同じabstractionへの条件の積み増し、ACからの乖離が見えたら同じ修正を繰り返さない。単純な設計・既存patternへ戻す、abstractionを減らす、変更範囲を縮める。固定修正回数や時間超過だけで停止しない。

## 差分を自己確認して既存完了条件へ戻る

Self Inspectionは自分のdiff、直接影響、選択Lens、対応testだけを軽く確認する。repository全体を再reviewしない。問題があれば修正し、なければPASS理由・守った原則・全判断履歴・Lens報告を生成しない。Gitから分かる内容を複写しない。

自己確認は独立reviewではない。Step 10、そのseverity・round・Medium/Lowの扱いを変えず、代替・省略しない。最後は既存Verification Set、project policy、Step 9完了条件の検証とEvidenceを満たす。

## 評価時だけ観測する

low-riskは5〜15分、通常は15〜30分、中規模は30〜45分を設計目標とし、hard timeoutにしない。high-risk・migration・securityは必要時間を許容する。通常taskが継続して60分を超えたら、実装難度・context取得・探索・test・subagent調整・repair・ASC overheadへ原因を分類する。時間やtokenの削減を理由に最終検証やsecurity境界確認を省略しない。

既存log/EvidenceからStep 9 elapsed time、input/output token、tool call、file read、search、selected Lens、targeted/full verification、autonomous repair、repair loop、不要な再読、Step 10 findings、regressionを取得する。取得できない値は未計測とし、毎taskの重いartifactは追加しない。比較の方法と反例は必要な評価時だけ[隔離評価](evaluation.md)を読む。
