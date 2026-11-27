# 回答の目印の照合

開発時の検証資料であり、配布対象に含めない。`shared-harness/calibrate.mjs --md`がこの設定の`calibration.json`と依頼の設定（cases.json）から作る（手で直さない）。これまでの評価で採点した回答と、落ちるべき回答（雛形そのまま等）に、この設定の目印（`answerQuota`・`answerNone`）と書いたfileの照合（`writes`）を当て、これまでの採点と比べる。観点の列は「採点/目印」。

- **#1828の「これまでの採点」の合否は、#1828の判定ではない。** 目印と同じ観点の選び方（`report: true`の観点を除く）と同じ`min`を、#1828の採点者が付けた観点ごとの0/1の点に当てて、この表が作ったものである。#1829・#1832の行は、それぞれの評価の記録（`00_評価.md`・`00_比較.md`）の合否である。
- 形：`回答`は回答の文に目印を当てる。`書いたfile`は回答を試行が書いたfileとして扱い、回答と書いたfileの和に当てる（`markerText: answer+writes`）。導入した雛形（`base`）と同じ行は、目印を当てる前に除く（依頼の設定の`markerBase`）。`落ちるべき`は雛形をそのまま写した等の回答で、目印で不合格になることを確かめる。
- 「行を除かない場合」は、雛形と同じ行を除かずに当てた結果（除く仕組みの効果を見るためのもの）。

| 依頼 | 形 | 回答 | 条件 | これまでの採点 | 目印 | 一致 | 行を除かない場合 | 観点（採点/目印） | 落ちた点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| w-1 | 回答 | `1828-warranty-scope/adopted/G3.md` T1 | tplA | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/adopted/H8.md` T1 | skillD | 合格 | 合格 | 一致 | - | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 回答 | `1828-warranty-scope/adopted/J1.md` T1 | tplB(T1-T4のみ) | 合格 | 不合格 | 不一致 | - | T1-1 1/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/adopted/K6.md` T1 | none | 不合格 | 不合格 | 一致 | - | T1-1 1/0、T1-4 0/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/adopted/L4.md` T1 | skillC | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/final/M5.md` T1 | none1 | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 0/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/final/N2.md` T1 | tpl2 | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/final/P7.md` T1 | tpl1 | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/final/R4.md` T1 | skillB | 合格 | 合格 | 一致 | - | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 回答 | `1828-warranty-scope/final/S9.md` T1 | skillA | 合格 | 合格 | 一致 | - | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 回答 | `1828-warranty-scope/round2/A4.md` T1 | none1 | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 0/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/round2/B8.md` T1 | tpl2 | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/round2/C1.md` T1 | tpl1 | 不合格 | 不合格 | 一致 | - | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 回答 | `1828-warranty-scope/round2/D6.md` T1 | skill1 | 合格 | 合格 | 一致 | - | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 回答 | `1828-warranty-scope/round2/E3.md` T1 | skill2 | 合格 | 合格 | 一致 | - | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-2 | 回答 | `1828-warranty-scope/adopted/G3.md` T3 | tplA | 不合格 | 不合格 | 一致 | - | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | 回答 | `1828-warranty-scope/adopted/H8.md` T3 | skillD | 合格 | 合格 | 一致 | - | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 回答 | `1828-warranty-scope/adopted/J1.md` T3 | tplB(T1-T4のみ) | 不合格 | 不合格 | 一致 | - | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | 回答 | `1828-warranty-scope/adopted/K6.md` T3 | none | 不合格 | 不合格 | 一致 | - | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | 回答 | `1828-warranty-scope/adopted/L4.md` T3 | skillC | 合格 | 合格 | 一致 | - | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 回答 | `1828-warranty-scope/final/M5.md` T3 | none1 | 不合格 | 不合格 | 一致 | - | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | 回答 | `1828-warranty-scope/final/N2.md` T3 | tpl2 | 不合格 | 不合格 | 一致 | - | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | 回答 | `1828-warranty-scope/final/P7.md` T3 | tpl1 | 不合格 | 不合格 | 一致 | - | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | 回答 | `1828-warranty-scope/final/R4.md` T3 | skillB | 合格 | 合格 | 一致 | - | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 回答 | `1828-warranty-scope/final/S9.md` T3 | skillA | 不合格 | 合格 | 不一致 | - | T3-1 1/1、T3-4 0/1 | - |
| w-2 | 回答 | `1828-warranty-scope/round2/A4.md` T3 | none1 | 不合格 | 不合格 | 一致 | - | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | 回答 | `1828-warranty-scope/round2/B8.md` T3 | tpl2 | 不合格 | 不合格 | 一致 | - | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | 回答 | `1828-warranty-scope/round2/C1.md` T3 | tpl1 | 不合格 | 不合格 | 一致 | - | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | 回答 | `1828-warranty-scope/round2/D6.md` T3 | skill1 | 合格 | 合格 | 一致 | - | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 回答 | `1828-warranty-scope/round2/E3.md` T3 | skill2 | 不合格 | 不合格 | 一致 | - | T3-1 0/0、T3-4 1/1 | copy-3s、copy-100、copy-ie11 |
| w-3 | 回答 | `1828-warranty-scope/adopted/G3.md` T4 | tplA | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/adopted/H8.md` T4 | skillD | 合格 | 合格 | 一致 | - | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 回答 | `1828-warranty-scope/adopted/J1.md` T4 | tplB(T1-T4のみ) | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/adopted/K6.md` T4 | none | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/adopted/L4.md` T4 | skillC | 合格 | 合格 | 一致 | - | T4-1 1/1、T4-2 1/1、T4-3 0/0、T4-5 0/0 | T4-3、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/final/M5.md` T4 | none1 | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/final/N2.md` T4 | tpl2 | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/final/P7.md` T4 | tpl1 | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/final/R4.md` T4 | skillB | 合格 | 合格 | 一致 | - | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 回答 | `1828-warranty-scope/final/S9.md` T4 | skillA | 合格 | 合格 | 一致 | - | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 回答 | `1828-warranty-scope/round2/A4.md` T4 | none1 | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/round2/B8.md` T4 | tpl2 | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/round2/C1.md` T4 | tpl1 | 不合格 | 不合格 | 一致 | - | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 1/0 | T4-1、T4-2、T4-5 |
| w-3 | 回答 | `1828-warranty-scope/round2/D6.md` T4 | skill1 | 合格 | 合格 | 一致 | - | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 回答 | `1828-warranty-scope/round2/E3.md` T4 | skill2 | 合格 | 合格 | 一致 | - | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 1/1 | - |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/before.md` R1 | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | R1-1-war、R1-1-version、減点:free-before-check |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/db1e623d-1.md` R1 | version db1e623d | 不合格 | 不合格 | 一致 | - | - | 減点:free-before-check |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/db1e623d-2.md` R1 | version db1e623d | 合格 | 合格 | 一致 | - | - | - |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-1.md` R1 | version 59b1c4b2 | 記録なし | 合格 | - | - | - | - |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-2.md` R1 | version 59b1c4b2 | 不合格 | 不合格 | 一致 | - | - | 減点:free-before-check |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-1.md` R1 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - | - |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-2.md` R1 | version 2a3ad6fe | 不合格 | 不合格 | 一致 | - | - | 減点:free-direction |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/ff065b28-1.md` R1 | version ff065b28 | 記録なし | 合格 | - | - | - | - |
| m-r1 | 回答 | `59ad479f:1829-estimate-warranty/answers/ff065b28-2.md` R1 | version ff065b28 | 記録なし | 合格 | - | - | - | - |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/before.md` R2 | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | R2-1-war、R2-1-version |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/db1e623d-1.md` R2 | version db1e623d | 合格 | 合格 | 一致 | - | - | - |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/db1e623d-2.md` R2 | version db1e623d | 合格 | 合格 | 一致 | - | - | - |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-1.md` R2 | version 59b1c4b2 | 記録なし | 合格 | - | - | - | - |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-2.md` R2 | version 59b1c4b2 | 記録なし | 不合格 | - | - | - | R2-1-version |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-1.md` R2 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - | - |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-2.md` R2 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - | - |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/ff065b28-1.md` R2 | version ff065b28 | 記録なし | 合格 | - | - | - | - |
| m-r2 | 回答 | `59ad479f:1829-estimate-warranty/answers/ff065b28-2.md` R2 | version ff065b28 | 記録なし | 合格 | - | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/before.md` R7 | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | R7-1-war |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/db1e623d-1.md` R7 | version db1e623d | 合格 | 合格 | 一致 | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/db1e623d-2.md` R7 | version db1e623d | 合格 | 合格 | 一致 | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-1.md` R7 | version 59b1c4b2 | 記録なし | 合格 | - | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-2.md` R7 | version 59b1c4b2 | 記録なし | 合格 | - | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-1.md` R7 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-2.md` R7 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/ff065b28-1.md` R7 | version ff065b28 | 記録なし | 合格 | - | - | - | - |
| m-r7 | 回答 | `59ad479f:1829-estimate-warranty/answers/ff065b28-2.md` R7 | version ff065b28 | 記録なし | 合格 | - | - | - | - |
| s-1 | 回答 | `98aabea2:1832-spec-writing-rules/outputs/before.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | history-old-value、history-before、history-change、history-only |
| s-1 | 回答 | `98aabea2:1832-spec-writing-rules/outputs/before2.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | history-old-value、history-before、history-change、history-reason、history-only |
| s-1 | 回答 | `98aabea2:1832-spec-writing-rules/outputs/after.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | - | status-approved |
| s-1 | 回答 | `98aabea2:1832-spec-writing-rules/outputs/after2.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | - | status-approved |
| s-1 | 回答 | `98aabea2:1832-spec-writing-rules/outputs/after3.md` | version f080c937 | 合格 | 合格 | 一致 | - | - | - |
| s-1 | 回答 | `98aabea2:1832-spec-writing-rules/outputs/after4.md` | version f080c937 | 合格 | 合格 | 一致 | - | - | - |
| w-1 | 書いたfile | `1828-warranty-scope/adopted/G3.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tplA | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/adopted/H8.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillD | 合格 | 合格 | 一致 | 合格 | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 書いたfile | `1828-warranty-scope/adopted/J1.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tplB(T1-T4のみ) | 合格 | 不合格 | 不一致 | 不合格 | T1-1 1/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/adopted/K6.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none | 不合格 | 不合格 | 一致 | 不合格 | T1-1 1/0、T1-4 0/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/adopted/L4.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillC | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/final/M5.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none1 | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 0/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/final/N2.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl2 | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/final/P7.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl1 | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/final/R4.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillB | 合格 | 合格 | 一致 | 合格 | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 書いたfile | `1828-warranty-scope/final/S9.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillA | 合格 | 合格 | 一致 | 合格 | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 書いたfile | `1828-warranty-scope/round2/A4.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none1 | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 0/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/round2/B8.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl2 | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/round2/C1.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl1 | 不合格 | 不合格 | 一致 | 不合格 | T1-1 0/0、T1-4 1/0、T1-2 1/1、T1-3 1/1 | T1-1、T1-4 |
| w-1 | 書いたfile | `1828-warranty-scope/round2/D6.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skill1 | 合格 | 合格 | 一致 | 合格 | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-1 | 書いたfile | `1828-warranty-scope/round2/E3.md` T1 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skill2 | 合格 | 合格 | 一致 | 合格 | T1-1 1/1、T1-4 1/1、T1-2 1/1、T1-3 1/1 | - |
| w-2 | 書いたfile | `1828-warranty-scope/adopted/G3.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tplA | 不合格 | 不合格 | 一致 | 不合格 | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | 書いたfile | `1828-warranty-scope/adopted/H8.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillD | 合格 | 合格 | 一致 | 合格 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 書いたfile | `1828-warranty-scope/adopted/J1.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tplB(T1-T4のみ) | 不合格 | 不合格 | 一致 | 不合格 | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | 書いたfile | `1828-warranty-scope/adopted/K6.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none | 不合格 | 不合格 | 一致 | 不合格 | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | 書いたfile | `1828-warranty-scope/adopted/L4.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillC | 合格 | 合格 | 一致 | 合格 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 書いたfile | `1828-warranty-scope/final/M5.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none1 | 不合格 | 不合格 | 一致 | 不合格 | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | 書いたfile | `1828-warranty-scope/final/N2.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl2 | 不合格 | 不合格 | 一致 | 不合格 | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | 書いたfile | `1828-warranty-scope/final/P7.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl1 | 不合格 | 不合格 | 一致 | 不合格 | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | 書いたfile | `1828-warranty-scope/final/R4.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillB | 合格 | 合格 | 一致 | 合格 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 書いたfile | `1828-warranty-scope/final/S9.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillA | 不合格 | 合格 | 不一致 | 合格 | T3-1 1/1、T3-4 0/1 | - |
| w-2 | 書いたfile | `1828-warranty-scope/round2/A4.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none1 | 不合格 | 不合格 | 一致 | 不合格 | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | 書いたfile | `1828-warranty-scope/round2/B8.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl2 | 不合格 | 不合格 | 一致 | 不合格 | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | 書いたfile | `1828-warranty-scope/round2/C1.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl1 | 不合格 | 不合格 | 一致 | 不合格 | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | 書いたfile | `1828-warranty-scope/round2/D6.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skill1 | 合格 | 合格 | 一致 | 合格 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | 書いたfile | `1828-warranty-scope/round2/E3.md` T3 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skill2 | 不合格 | 不合格 | 一致 | 不合格 | T3-1 0/0、T3-4 1/1 | copy-3s、copy-100、copy-ie11 |
| w-3 | 書いたfile | `1828-warranty-scope/adopted/G3.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tplA | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/adopted/H8.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillD | 合格 | 合格 | 一致 | 合格 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/adopted/J1.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tplB(T1-T4のみ) | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/adopted/K6.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/adopted/L4.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillC | 合格 | 合格 | 一致 | 合格 | T4-1 1/1、T4-2 1/1、T4-3 0/0、T4-5 0/0 | T4-3、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/final/M5.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none1 | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/final/N2.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl2 | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/final/P7.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl1 | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/final/R4.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillB | 合格 | 合格 | 一致 | 合格 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/final/S9.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skillA | 合格 | 合格 | 一致 | 合格 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/round2/A4.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | none1 | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/round2/B8.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl2 | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/round2/C1.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | tpl1 | 不合格 | 不合格 | 一致 | 不合格 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 1/0 | T4-1、T4-2、T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/round2/D6.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skill1 | 合格 | 合格 | 一致 | 合格 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | 書いたfile | `1828-warranty-scope/round2/E3.md` T4 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | skill2 | 合格 | 合格 | 一致 | 合格 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 1/1 | - |
| w-1 | 落ちるべき | 品質保証範囲の雛形を写しただけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | 雛形そのまま（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2、T1-3 |
| w-1 | 落ちるべき | 品質保証範囲の雛形を写しただけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | 雛形そのまま（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2、T1-3 |
| w-1 | 落ちるべき | 雛形の見出しと表の行だけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | 見出しと表だけ（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2、T1-3 |
| w-1 | 落ちるべき | 雛形の見出しと表の行だけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | 見出しと表だけ（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2、T1-3 |
| w-1 | 落ちるべき | 雛形の利用案内を写しただけ → `docs/specs/00_利用案内.md`（雛形R） | 利用案内だけ（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2、T1-3 |
| w-1 | 落ちるべき | 雛形の利用案内を写しただけ → `docs/specs/00_利用案内.md`（雛形C） | 利用案内だけ（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2、T1-3 |
| w-3 | 落ちるべき | 品質保証範囲の雛形を写しただけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | 雛形そのまま（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-3 | 落ちるべき | 品質保証範囲の雛形を写しただけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | 雛形そのまま（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-3 | 落ちるべき | 雛形の見出しと表の行だけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | 見出しと表だけ（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-3 | 落ちるべき | 雛形の見出しと表の行だけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | 見出しと表だけ（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-3 | 落ちるべき | 雛形の利用案内を写しただけ → `docs/specs/00_利用案内.md`（雛形R） | 利用案内だけ（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-3 | 落ちるべき | 雛形の利用案内を写しただけ → `docs/specs/00_利用案内.md`（雛形C） | 利用案内だけ（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-1 | 落ちるべき | 責任分界の外部APIの行だけを決済代行で埋めた雛形 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | 決済の1行だけ埋めた雛形（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2 |
| w-1 | 落ちるべき | 責任分界の外部APIの行だけを決済代行で埋めた雛形 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | 決済の1行だけ埋めた雛形（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T1-1、T1-4、T1-2 |
| w-3 | 落ちるべき | 条件が変わったときの分類の互換性対応の行だけを埋めた雛形 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | 互換性の1行だけ埋めた雛形（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-3 | 落ちるべき | 条件が変わったときの分類の互換性対応の行だけを埋めた雛形 → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | 互換性の1行だけ埋めた雛形（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | T4-1、T4-2、T4-3、T4-5 |
| w-2 | 落ちるべき | 品質保証範囲の雛形を写しただけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | 雛形そのまま（雛形R） | 不合格 | 不合格 | 一致 | 不合格 | - | ref-REQ-PERF-001、ref-CON-003、open-items、open-decider |
| w-2 | 落ちるべき | 品質保証範囲の雛形を写しただけ → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | 雛形そのまま（雛形C） | 不合格 | 不合格 | 一致 | 不合格 | - | ref-REQ-PERF-001、ref-CON-003、open-items、open-decider |
| w-2 | 落ちるべき | WAR-001の行の正本の参照だけをREQ-PERF-001・CON-003で埋めた雛形（未決・判断者は雛形の行だけ） → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形R） | IDの1行だけ埋めた雛形（雛形R） | 不合格 | 不合格 | 一致 | 合格 | - | open-decider |
| w-2 | 落ちるべき | WAR-001の行の正本の参照だけをREQ-PERF-001・CON-003で埋めた雛形（未決・判断者は雛形の行だけ） → `docs/specs/details/02_要件/03_品質保証範囲.md`（雛形C） | IDの1行だけ埋めた雛形（雛形C） | 不合格 | 不合格 | 一致 | 合格 | - | open-decider |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/before.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | history-old-value、history-before、history-change、history-only |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/before.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md`・`docs/specs/details/15_要件追跡/01_変更履歴.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | history-old-value、history-before、history-change、history-only、本文の外（報告だけ）:history-old-value・history-change・history-reason |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/before2.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | history-old-value、history-before、history-change、history-reason、history-only |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/before2.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md`・`docs/specs/details/15_要件追跡/01_変更履歴.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | - | history-old-value、history-before、history-change、history-reason、history-only、本文の外（報告だけ）:history-old-value・history-change・history-reason |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | - | status-approved |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md`・`docs/specs/details/15_要件追跡/01_変更履歴.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | - | status-approved、本文の外（報告だけ）:history-old-value・history-change・history-reason |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after2.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | - | status-approved |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after2.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md`・`docs/specs/details/15_要件追跡/01_変更履歴.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | - | status-approved、本文の外（報告だけ）:history-old-value・history-change・history-reason |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after3.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md` | version f080c937 | 合格 | 合格 | 一致 | - | - | - |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after3.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md`・`docs/specs/details/15_要件追跡/01_変更履歴.md` | version f080c937 | 合格 | 合格 | 一致 | - | - | 本文の外（報告だけ）:history-old-value・history-change・history-reason |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after4.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md` | version f080c937 | 合格 | 合格 | 一致 | - | - | - |
| s-1 | 書いたfile | `98aabea2:1832-spec-writing-rules/outputs/after4.md` → `docs/specs/details/04_機能/FN-003_会員登録.md`・`docs/specs/details/05_画面/SCR-005_会員登録.md`・`docs/specs/details/15_要件追跡/01_変更履歴.md` | version f080c937 | 合格 | 合格 | 一致 | - | - | 本文の外（報告だけ）:history-old-value・history-change・history-reason |

## 依頼ごと（形：回答）

| 依頼 | 回答 | 合否の一致（記録のある回答） | 観点ごとの一致 | Skillありの回答で目印が合格（全部） | Skillありで記録のある回答：これまでの採点が合格 | 同：目印が合格 | Skillなしの回答で目印が合格 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| w-1 | 15 | 14/15 | T1-1 13/15、T1-4 8/15、T1-2 15/15、T1-3 15/15 | 5/6 | 5/6 | 5/6 | 0/9 |
| w-2 | 15 | 14/15 | T3-1 15/15、T3-4 11/15 | 5/6 | 4/6 | 5/6 | 0/9 |
| w-3 | 15 | 15/15 | T4-1 15/15、T4-2 15/15、T4-3 12/15、T4-5 14/15 | 6/6 | 6/6 | 6/6 | 0/9 |
| m-r1 | 9 | 6/6 | - | 5/8 | 2/5 | 2/5 | 0/1 |
| m-r2 | 9 | 5/5 | - | 7/8 | 4/4 | 4/4 | 0/1 |
| m-r7 | 9 | 5/5 | - | 8/8 | 4/4 | 4/4 | 0/1 |
| s-1 | 6 | 6/6 | - | 2/4 | 2/4 | 2/4 | 0/2 |

## 依頼ごと（形：書いたfile。回答と書いたfileの和、雛形と同じ行を除く）

| 依頼 | 回答 | 合否の一致（記録のある回答） | 観点ごとの一致 | Skillありの回答で目印が合格（全部） | Skillありで記録のある回答：これまでの採点が合格 | 同：目印が合格 | Skillなしの回答で目印が合格 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| w-1 | 15 | 14/15 | T1-1 13/15、T1-4 8/15、T1-2 15/15、T1-3 15/15 | 5/6 | 5/6 | 5/6 | 0/9 |
| w-2 | 15 | 14/15 | T3-1 15/15、T3-4 11/15 | 5/6 | 4/6 | 5/6 | 0/9 |
| w-3 | 15 | 15/15 | T4-1 15/15、T4-2 15/15、T4-3 12/15、T4-5 14/15 | 6/6 | 6/6 | 6/6 | 0/9 |
| s-1 | 12 | 12/12 | - | 4/8 | 4/8 | 4/8 | 0/4 |

## 落ちるべき回答

落ちるべき回答20件のうち、目印・書いたfileの照合で不合格は20件（雛形と同じ行を除かない場合の不合格は18件）。

## 観点ごとの当たる率（形：回答）

Skillあり・なしは、これまでの評価の条件（#1828の`skill*`、#1829・#1832の`version`がSkillあり。#1828の`tpl*`（雛形だけ）と`none`、変更前の版がSkillなし）。「数える」が「報告だけ」の観点は合否の数に入れない（Skillの有無を分けられない、または雛形の語に当たる）。雛形の行は、条件ごとの雛形（R：`c9288126`、C：`98aabea2`の`v05/templates/specs/`）のうち、その目印に合う行の数。

| 依頼 | 観点 | 数える | Skillあり：目印 | Skillなし：目印 | Skillあり：採点1 | Skillなし：採点1 | 雛形の行（R/C） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| w-1 | T1-1 | 数える | 5/6 | 0/9 | 5/6 | 2/9 | 0/0 |
| w-1 | T1-4 | 数える | 5/6 | 0/9 | 6/6 | 6/9 | 0/0 |
| w-1 | T1-2 | 報告だけ | 6/6 | 9/9 | 6/6 | 9/9 | 17/17 |
| w-1 | T1-3 | 報告だけ | 6/6 | 9/9 | 6/6 | 9/9 | 0/0 |
| w-2 | T3-1 | 数える | 5/6 | 3/9 | 5/6 | 3/9 | 0/0 |
| w-2 | T3-4 | 数える | 6/6 | 3/9 | 5/6 | 0/9 | 15/19 |
| w-3 | T4-1 | 数える | 6/6 | 0/9 | 6/6 | 0/9 | 0/0 |
| w-3 | T4-2 | 数える | 6/6 | 0/9 | 6/6 | 0/9 | 0/0 |
| w-3 | T4-3 | 報告だけ | 5/6 | 9/9 | 5/6 | 6/9 | 5/5 |
| w-3 | T4-5 | 報告だけ | 1/6 | 0/9 | 1/6 | 1/9 | 1/1 |
| m-r1 | R1-1-war（R1-1） | 数える | 8/8 | 0/1 | - | - | 0/0 |
| m-r1 | R1-1-version（R1-1） | 数える | 8/8 | 0/1 | - | - | 0/0 |
| m-r1 | R1-2 | 数える | 8/8 | 1/1 | - | - | 0/0 |
| m-r2 | R2-1-war（R2-1） | 数える | 8/8 | 0/1 | - | - | 1/1 |
| m-r2 | R2-1-version（R2-1） | 数える | 7/8 | 0/1 | - | - | 0/0 |
| m-r2 | R2-2 | 数える | 8/8 | 1/1 | - | - | 23/23 |
| m-r7 | R7-1-war（R7-1） | 数える | 8/8 | 0/1 | - | - | 0/0 |
| m-r7 | R7-1-open（R7-1） | 数える | 8/8 | 1/1 | - | - | 11/14 |
| m-r7 | R7-2 | 数える | 8/8 | 1/1 | - | - | 0/0 |
