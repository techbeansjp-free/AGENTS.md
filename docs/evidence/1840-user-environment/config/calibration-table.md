# 回答の目印の照合

開発時の検証資料であり、配布対象に含めない。`shared-harness/calibrate.mjs --md`がこの設定の`calibration.json`と依頼の設定（cases.json）から作る（手で直さない）。これまでの評価で採点した回答に、この設定の目印（`answerQuota`・`answerNone`）と書いたfileの照合（`writes`）を当て、これまでの採点と比べる。観点の列は「採点/目印」。

| 依頼 | 回答 | 条件 | これまでの採点 | 目印 | 一致 | 観点（採点/目印） | 落ちた点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| w-1 | `1828-warranty-scope/adopted/G3.md` T1 | tplA | 合格 | 合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 1/1 | T1-1 |
| w-1 | `1828-warranty-scope/adopted/H8.md` T1 | skillD | 合格 | 合格 | 一致 | T1-1 1/1、T1-2 1/1、T1-3 1/1、T1-4 1/1 | - |
| w-1 | `1828-warranty-scope/adopted/J1.md` T1 | tplB(T1-T4のみ) | 合格 | 合格 | 一致 | T1-1 1/0、T1-2 1/1、T1-3 1/1、T1-4 1/1 | T1-1 |
| w-1 | `1828-warranty-scope/adopted/K6.md` T1 | none | 合格 | 不合格 | 不一致 | T1-1 1/0、T1-2 1/1、T1-3 1/1、T1-4 0/0 | T1-1、T1-4 |
| w-1 | `1828-warranty-scope/adopted/L4.md` T1 | skillC | 合格 | 合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 1/1 | T1-1 |
| w-1 | `1828-warranty-scope/final/M5.md` T1 | none1 | 不合格 | 不合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 0/0 | T1-1、T1-4 |
| w-1 | `1828-warranty-scope/final/N2.md` T1 | tpl2 | 合格 | 合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 1/1 | T1-1 |
| w-1 | `1828-warranty-scope/final/P7.md` T1 | tpl1 | 合格 | 合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 1/1 | T1-1 |
| w-1 | `1828-warranty-scope/final/R4.md` T1 | skillB | 合格 | 合格 | 一致 | T1-1 1/1、T1-2 1/1、T1-3 1/1、T1-4 1/1 | - |
| w-1 | `1828-warranty-scope/final/S9.md` T1 | skillA | 合格 | 合格 | 一致 | T1-1 1/1、T1-2 1/1、T1-3 1/1、T1-4 1/1 | - |
| w-1 | `1828-warranty-scope/round2/A4.md` T1 | none1 | 不合格 | 不合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 0/0 | T1-1、T1-4 |
| w-1 | `1828-warranty-scope/round2/B8.md` T1 | tpl2 | 合格 | 合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 1/1 | T1-1 |
| w-1 | `1828-warranty-scope/round2/C1.md` T1 | tpl1 | 合格 | 合格 | 一致 | T1-1 0/0、T1-2 1/1、T1-3 1/1、T1-4 1/1 | T1-1 |
| w-1 | `1828-warranty-scope/round2/D6.md` T1 | skill1 | 合格 | 合格 | 一致 | T1-1 1/1、T1-2 1/1、T1-3 1/1、T1-4 1/1 | - |
| w-1 | `1828-warranty-scope/round2/E3.md` T1 | skill2 | 合格 | 合格 | 一致 | T1-1 1/1、T1-2 1/1、T1-3 1/1、T1-4 1/1 | - |
| w-2 | `1828-warranty-scope/adopted/G3.md` T3 | tplA | 不合格 | 不合格 | 一致 | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | `1828-warranty-scope/adopted/H8.md` T3 | skillD | 合格 | 合格 | 一致 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | `1828-warranty-scope/adopted/J1.md` T3 | tplB(T1-T4のみ) | 不合格 | 不合格 | 一致 | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | `1828-warranty-scope/adopted/K6.md` T3 | none | 不合格 | 不合格 | 一致 | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | `1828-warranty-scope/adopted/L4.md` T3 | skillC | 合格 | 合格 | 一致 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | `1828-warranty-scope/final/M5.md` T3 | none1 | 不合格 | 不合格 | 一致 | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | `1828-warranty-scope/final/N2.md` T3 | tpl2 | 不合格 | 不合格 | 一致 | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | `1828-warranty-scope/final/P7.md` T3 | tpl1 | 不合格 | 不合格 | 一致 | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | `1828-warranty-scope/final/R4.md` T3 | skillB | 合格 | 合格 | 一致 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | `1828-warranty-scope/final/S9.md` T3 | skillA | 不合格 | 合格 | 不一致 | T3-1 1/1、T3-4 0/1 | - |
| w-2 | `1828-warranty-scope/round2/A4.md` T3 | none1 | 不合格 | 不合格 | 一致 | T3-1 0/0、T3-4 0/0 | open-decider、copy-3s、copy-100、copy-ie11 |
| w-2 | `1828-warranty-scope/round2/B8.md` T3 | tpl2 | 不合格 | 不合格 | 一致 | T3-1 0/0、T3-4 0/1 | copy-3s、copy-100、copy-ie11 |
| w-2 | `1828-warranty-scope/round2/C1.md` T3 | tpl1 | 不合格 | 不合格 | 一致 | T3-1 1/1、T3-4 0/0 | open-decider |
| w-2 | `1828-warranty-scope/round2/D6.md` T3 | skill1 | 合格 | 合格 | 一致 | T3-1 1/1、T3-4 1/1 | - |
| w-2 | `1828-warranty-scope/round2/E3.md` T3 | skill2 | 不合格 | 不合格 | 一致 | T3-1 0/0、T3-4 1/1 | copy-3s、copy-100、copy-ie11 |
| w-3 | `1828-warranty-scope/adopted/G3.md` T4 | tplA | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/adopted/H8.md` T4 | skillD | 合格 | 合格 | 一致 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | `1828-warranty-scope/adopted/J1.md` T4 | tplB(T1-T4のみ) | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/adopted/K6.md` T4 | none | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/adopted/L4.md` T4 | skillC | 合格 | 合格 | 一致 | T4-1 1/1、T4-2 1/1、T4-3 0/0、T4-5 0/0 | T4-3、T4-5 |
| w-3 | `1828-warranty-scope/final/M5.md` T4 | none1 | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/final/N2.md` T4 | tpl2 | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/final/P7.md` T4 | tpl1 | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/final/R4.md` T4 | skillB | 合格 | 合格 | 一致 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | `1828-warranty-scope/final/S9.md` T4 | skillA | 合格 | 合格 | 一致 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | `1828-warranty-scope/round2/A4.md` T4 | none1 | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 0/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/round2/B8.md` T4 | tpl2 | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 0/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/round2/C1.md` T4 | tpl1 | 不合格 | 不合格 | 一致 | T4-1 0/0、T4-2 0/0、T4-3 1/1、T4-5 1/0 | T4-1、T4-2、T4-5 |
| w-3 | `1828-warranty-scope/round2/D6.md` T4 | skill1 | 合格 | 合格 | 一致 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 0/0 | T4-5 |
| w-3 | `1828-warranty-scope/round2/E3.md` T4 | skill2 | 合格 | 合格 | 一致 | T4-1 1/1、T4-2 1/1、T4-3 1/1、T4-5 1/1 | - |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/before.md` R1 | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | R1-1-war、R1-1-version、減点:free-before-check |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/db1e623d-1.md` R1 | version db1e623d | 不合格 | 不合格 | 一致 | - | 減点:free-before-check |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/db1e623d-2.md` R1 | version db1e623d | 合格 | 合格 | 一致 | - | - |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-1.md` R1 | version 59b1c4b2 | 記録なし | 合格 | - | - | - |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-2.md` R1 | version 59b1c4b2 | 不合格 | 不合格 | 一致 | - | 減点:free-before-check |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-1.md` R1 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-2.md` R1 | version 2a3ad6fe | 不合格 | 不合格 | 一致 | - | 減点:free-direction |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/ff065b28-1.md` R1 | version ff065b28 | 記録なし | 合格 | - | - | - |
| m-r1 | `59ad479f:1829-estimate-warranty/answers/ff065b28-2.md` R1 | version ff065b28 | 記録なし | 合格 | - | - | - |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/before.md` R2 | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | R2-1-war、R2-1-version |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/db1e623d-1.md` R2 | version db1e623d | 合格 | 合格 | 一致 | - | - |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/db1e623d-2.md` R2 | version db1e623d | 合格 | 合格 | 一致 | - | - |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-1.md` R2 | version 59b1c4b2 | 記録なし | 合格 | - | - | - |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-2.md` R2 | version 59b1c4b2 | 記録なし | 不合格 | - | - | R2-1-version |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-1.md` R2 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-2.md` R2 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/ff065b28-1.md` R2 | version ff065b28 | 記録なし | 合格 | - | - | - |
| m-r2 | `59ad479f:1829-estimate-warranty/answers/ff065b28-2.md` R2 | version ff065b28 | 記録なし | 合格 | - | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/before.md` R7 | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | R7-1-war |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/db1e623d-1.md` R7 | version db1e623d | 合格 | 合格 | 一致 | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/db1e623d-2.md` R7 | version db1e623d | 合格 | 合格 | 一致 | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-1.md` R7 | version 59b1c4b2 | 記録なし | 合格 | - | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/59b1c4b2-2.md` R7 | version 59b1c4b2 | 記録なし | 合格 | - | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-1.md` R7 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/2a3ad6fe-2.md` R7 | version 2a3ad6fe | 合格 | 合格 | 一致 | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/ff065b28-1.md` R7 | version ff065b28 | 記録なし | 合格 | - | - | - |
| m-r7 | `59ad479f:1829-estimate-warranty/answers/ff065b28-2.md` R7 | version ff065b28 | 記録なし | 合格 | - | - | - |
| s-1 | `98aabea2:1832-spec-writing-rules/outputs/before.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | history-old-value、history-before、history-change、history-only |
| s-1 | `98aabea2:1832-spec-writing-rules/outputs/before2.md` | none (6b987fd1) | 不合格 | 不合格 | 一致 | - | history-old-value、history-before、history-change、history-reason、history-only |
| s-1 | `98aabea2:1832-spec-writing-rules/outputs/after.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | status-approved |
| s-1 | `98aabea2:1832-spec-writing-rules/outputs/after2.md` | version 8177242c | 不合格 | 不合格 | 一致 | - | status-approved |
| s-1 | `98aabea2:1832-spec-writing-rules/outputs/after3.md` | version f080c937 | 合格 | 合格 | 一致 | - | - |
| s-1 | `98aabea2:1832-spec-writing-rules/outputs/after4.md` | version f080c937 | 合格 | 合格 | 一致 | - | - |

| 依頼 | 回答 | 合否の一致（記録のある回答） | 観点ごとの一致 | Skillありの回答で目印が合格（全部） | Skillありで記録のある回答：これまでの採点が合格 | 同：目印が合格 |
| --- | --- | --- | --- | --- | --- | --- |
| w-1 | 15 | 14/15 | T1-1 13/15、T1-2 15/15、T1-3 15/15、T1-4 15/15 | 6/6 | 6/6 | 6/6 |
| w-2 | 15 | 14/15 | T3-1 15/15、T3-4 11/15 | 5/6 | 4/6 | 5/6 |
| w-3 | 15 | 15/15 | T4-1 15/15、T4-2 15/15、T4-3 12/15、T4-5 14/15 | 6/6 | 6/6 | 6/6 |
| m-r1 | 9 | 6/6 | - | 5/8 | 2/5 | 2/5 |
| m-r2 | 9 | 5/5 | - | 7/8 | 4/4 | 4/4 |
| m-r7 | 9 | 5/5 | - | 8/8 | 4/4 | 4/4 |
| s-1 | 6 | 6/6 | - | 2/4 | 2/4 | 2/4 |
