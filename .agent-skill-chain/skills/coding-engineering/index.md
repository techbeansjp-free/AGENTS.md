# Coding Engineeringの短い索引

[Step 9の軽量routing](../step-09-implement/SKILL.md#実装時のcoding-engineering)が読む量を決める。local・明白・low-risk変更ではこの索引も不要。risky・cross-boundaryに該当しないbounded変更は本文を読まず、未解決の論点がなければ0 Lensで実装する。通常は0〜2 Lens、boundedは0〜1件が目安で、数合わせで読まない。

影響がboundedでも、境界・riskが不明、またはrisky/cross-boundaryだと判明したら[本文](SKILL.md)へ進み、該当Lens 1〜3件を目安に選ぶ。下表は選択用であり、一括読込するchecklistやGateではない。

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

探索のsoft budgetと終了目安はStep 9に従う。既存部品を必要な範囲で検索し、scope内の通常問題を自律修正する。実装中はtargeted feedback、最後は既存Verification Set・project policyを満たす。新しい停止条件や専用報告は追加しない。
