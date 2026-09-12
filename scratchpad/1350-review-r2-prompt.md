# 独立review依頼（Issue #1350、round 2＝既定branch追随に対する取り直し、exact HEAD a17ab1d9e88f9637711fc300ab65bcc7793a5f9d）

あなたはimplementerとは別contextの独立reviewerである。対象差分を変更せず、read-onlyで肯定・敵対の両観点をreviewする。指摘を無理に作らない。Medium/Lowはblockingにしない。

## このroundが開いた理由

round 1（HEAD `36109d44`）で0 findingのapprovedを得たあと、既定branchが3本のPR（#1353・#1355・#1359）のmergeで`3b6dcb88`へ前進した。追随merge `c1de4268` と、下記の漏れを直す `a17ab1d9` でHEADが動いたため、同sessionのround 2として再reviewする。

## 追随中に見つけた漏れ（implementer申告）

`01_要件定義.md` §11が「公開契約変更: あり。…変更履歴へ記録する」、`03_実装計画.md` §7が「変更履歴1行」を計画していたが、**実装commit `36109d44` は `docs/specs/15_要件追跡/01_変更履歴.md` を1行も触っていなかった。** round 1のreviewもこれを検出していない。追随mergeの後の通常commit `a17ab1d9` で1行を追加した。**この行の内容が実装と一致しているかを確認してほしい。**

## 受け入れ条件と不変条件（anchor。round 1から不変）
| AC-01 | `--provider=claude`は終了値1で、`reasons`に`codex`だけを受理する旨と未指定の互換検証の案内を含む | SCN-UNIT-TIERPROV-001 | unit | CLI `main`の出力 |
| AC-02 | 未指定経路でworking treeへkeyを足した場合の成功出力に`provenance.source`（`filesystem`）と`usage: "compatibility-only"`が含まれる | SCN-UNIT-TIERPROV-002 | unit | CLI `main`の出力 |
| AC-03 | 未指定経路の失敗出力に`provenance`が含まれ、`next`に「trusted」の語が無く`requiredAuthority`が「不要」 | SCN-UNIT-TIERPROV-003 | unit | CLI `main`の出力 |
| AC-04 | `codex`経路の出力に`provenance.source: "git"`（`ref`はtrusted commit SHA）と`usage: "codex-adoption"`が加わり、既存field（`selector`、`observedAt`等）と判定が不変 | SCN-E2E-AM-001（既存、公式観測stubつきの実CLI経路） | unit | 既存codex-launch fixtureでの終了値と出力 |

- INV-01: `routing tier`が**tier判定の結果を返すとき**、その出力は判定の信頼源（`provenance`）と用途（`usage`）を必ず含む。入力検証で判定へ到達せず拒否する場合（受理外のprovider値など）は、policyを読んでいないため信頼源を持たず、`ASC-CLI-VALIDATION-001`の構造化診断だけを返す
- INV-02: `--provider`の受理値は仕様06の`codex`だけである
- INV-03: `codex`経路の判定と既存出力fieldは変わらない

## 最優先で見てほしい点

1. **追随mergeがmainの内容を巻き戻していないか。** 取り込んだのは#1349（SCN ID文法）・#1335（workflow advance）・#1336（review並行進捗証跡）で、衝突は0件だった。衝突が無くても意味的な巻き戻しは起こりうる。
2. **意味的衝突。** #1336が`src/adapters/review-session.ts`と`src/domain/staging.ts`へ、#1335が`src/cli.ts`へ触れている。本Issueも`src/cli.ts`と`src/cli-usage.ts`を変える。gitは衝突を報告せず型検査も通るため、この種の欠陥はコードを読まないと出ない。
3. **追加した変更履歴の行**が実装（`--provider=claude`の拒否、`provenance`・`usage`の出力）と一致し、互換性欄が正しいか。
4. AC-01〜AC-04とINV-01〜INV-03が追随後も成立しているか。

## implementer申告（信用せず再実行してよい）
- 追随後に lint / format:check / typecheck / docs:format / test:format / trace:check / architecture:check / workflow:check がすべて終了値0
- `npm run audit:check` は「H_impl..currentの差分pathがdocs/reviews/配下ではない」だけを返す（review artifactを未commitのため想定どおり）。**merge commitの損失検知tokenのerrorは0件**
- `npm test`と`conformance:check`は本HEADで実行中
- read-only sandboxでtestを実行できない場合は、実行できなかった事実を書き、合格したと書かない

## 出力形式（厳守）
1. `## 肯定的評価` と `## 敵対的評価` の表（観点 | 判定 pass/finding/not-applicable | 根拠）
2. `## findings` にJSON配列だけ。schema: `{"id":"REV-01","severity":"Critical|High|Medium|Low","status":"valid","source":"review","relation":"acceptance-violation|invariant-violation|fix-regression|improvement|out-of-scope","evidence":"file:line と反例","path":"src/...","contractId":"AC-0N または INV-0N","causedByFindingId":null}`。指摘なしなら `[]`
3. `## 判定` approved / rejected

## (A) branchの正味の寄与（`origin/main`＝`3b6dcb88` → `a17ab1d9`、`dist/`除く）

```diff
diff --git "a/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md" "b/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
index 9e42e51e..97d77df0 100644
--- "a/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
+++ "b/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
@@ -10,7 +10,7 @@
 | REQ-WF-004 | 機能 | Step 0〜11を機械正本とjournalで順序検証する | 必須 | Issue #877 | AC-WF-004 | 合意 |
 | REQ-WF-005 | 機能 | 肯定・敵対reviewとexact-head証拠を有限に検証する | 必須 | Issue #824、#834 | AC-WF-005 | 合意 |
 | REQ-WF-006 | 機能 | Gherkinの一意ID・構造・層・仕様追跡を検証する | 必須 | Issue #824、#881、#1349 | AC-WF-006 | 合意 |
-| REQ-WF-007 | 機能 | role・独立性と公式推奨Codex・trusted採用tierを解決し実行へ接続する | 必須 | Issue #830、#836、#1257 | AC-WF-007 | 合意 |
+| REQ-WF-007 | 機能 | role・独立性と公式推奨Codex・trusted採用tierを解決し実行へ接続する | 必須 | Issue #830、#836、#1257、#1350 | AC-WF-007 | 合意 |
 | REQ-WF-008 | 機能 | package conformanceをprojectの適用宣言へ安全にbindingする | 必須 | Issue #834、#837 | AC-WF-008 | 合意 |
 | REQ-WF-009 | 機能 | subcommand単位のusageと不足必須flagの全件報告を1回の実行で返す | 必須 | Issue #886 | AC-WF-009 | 合意 |
 | REQ-WF-014 | 機能 | review roundの入力雛形を実Gitとsessionから生成しstaging外へ書く | 必須 | Issue #1323 | AC-WF-014 | 合意 |
diff --git "a/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md" "b/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
index a238cc15..f5b81930 100644
--- "a/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
+++ "b/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
@@ -148,12 +148,12 @@ project choiceのdialect・test layer・禁止suffixに従い、全Scenarioへ
 
 Codex taskを起動するたびに公式model/listを観測し、現在の利用環境の一意のrecommended defaultでhigh対応のmodelを選択する。発売日・名称順・最高性能を推測しない。trusted tierMappingの論理key `codex:provider_recommended_default:high:default` が示すproject採用tierを必要tierと比較し、model slugの手書き追加を要求しない。公式のisDefaultはproject独自tierの性能保証ではなく、採用tierは操作authorityを付与しない。
 
-`routing launch`はこの選択を具体model・high・service tier defaultのCodex起動へ接続する。trusted設定、role/context、task入力、公式観測が不成立なら起動しない。旧model・別providerへの自動代替と起動後の自動再送を禁止する。成功、失敗、結果不明を区別し、選択根拠とdispatchしたmodelを秘密本文なしで返す。dispatchの記録をproviderが実際に処理したmodelのattestationとは扱わない。既存`routing resolve`のfallback結果は互換照会として保持し、launchはpreferred Codex以外を拒否する。
+`routing launch`はこの選択を具体model・high・service tier defaultのCodex起動へ接続する。trusted設定、role/context、task入力、公式観測が不成立なら起動しない。旧model・別providerへの自動代替と起動後の自動再送を禁止する。成功、失敗、結果不明を区別し、選択根拠とdispatchしたmodelを秘密本文なしで返す。dispatchの記録をproviderが実際に処理したmodelのattestationとは扱わない。既存`routing resolve`のfallback結果は互換照会として保持し、launchはpreferred Codex以外を拒否する。**`routing tier`は判定の信頼源と用途を出力へ必ず含め、`--provider`は`codex`だけを受理する。** provider未指定はworking treeの既存台帳による互換検証であり、trusted側の定義を要求する診断を返さない。**この契約を回帰として検出するのは`SCN-UNIT-TIERPROV-001`と`SCN-UNIT-TIERPROV-002`と`SCN-UNIT-TIERPROV-003`である。**
 
 公式観測の`runJsonlSession`はstdin書込errorを固定された安全な理由付きの失敗へ反映し、後続の終了値0で成功へ戻さない。`allowFailure=true`は非0の結果、falseは例外を返し、入力本文や元errorの秘密を診断へ追加しない。
 
 - 受け入れ条件: AC-WF-007。公式推奨Aから未登録Bへ変わった次回起動でBを使用する。候補自身の採用設定、推奨不定、high非対応、入力不正では起動0回。起動timeout・失敗・成功を区別し、promptやraw出力を結果に含めない。
-- 根拠: Issue #830、#836、#1257、#1265。Issue #1265のREQ-PIO-001〜003、AC-PIO-001〜003は観測失敗と検証fixtureの詳細化として本要件へ統合する。Issue #1257のREQ-AM-001〜008、AC-AM-001〜006は本要件・受け入れ条件の詳細化として統合する。
+- 根拠: Issue #830、#836、#1257、#1265、#1350。Issue #1265のREQ-PIO-001〜003、AC-PIO-001〜003は観測失敗と検証fixtureの詳細化として本要件へ統合する。Issue #1257のREQ-AM-001〜008、AC-AM-001〜006は本要件・受け入れ条件の詳細化として統合する。
 - 実装: `src/domain/routing.ts`、`src/domain/role.ts`、`src/adapters/codex-launch.ts`、`src/adapters/codex-execution.ts`
 
 ### REQ-WF-008 conformance適用宣言を検証する
diff --git "a/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md" "b/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
index 4f184c55..a67cbb53 100644
--- "a/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
+++ "b/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
@@ -140,7 +140,7 @@ squash/rebaseの終端検証は、固定base..headからsource commit数を1〜2
 | `routing resolve`           | `--root --scope --coordinator --implementer --reviewer --evaluator-ref`                                                                                                                          | project choice、trusted mapping、provider観測からroleとmodelを解決する。resolvedは0、pendingまたはrejectedは理由、確認済み入口、安全なfallback候補、必要authority、停止点、再開条件を含めて非0                                                                                     |
 | `routing launch`            | `--root --scope --coordinator --implementer --reviewer --implementer-context --reviewer-context --risk --mode --prompt-file [--sandbox=read-only\|workspace-write]`                              | trusted policyのselector採用tierと起動ごとの公式推奨を検証してCodex taskを実行する。rootは現在directory、sandboxはread-onlyが既定。workspace-writeだけを追加選択できる。成功は0、拒否・失敗・結果不明は非0。任意model・provider・shell・追加argv・trusted-ref overrideを受理しない |
 | `routing roles`             | `--scope --assignments=<JSON>`                                                                                                                                                                   | 6 roleの重複、未知role、coordinator欠落、implementerとreviewerのidentity・context兼務を検証する。違反は日本語構造化診断と非0                                                                                                                                                       |
-| `routing tier`              | `--risk --mode --scope --model --selected [--provider=codex] [--justification]`                                                                                                                  | provider=codexはtrusted selector採用tierと新しい公式観測で具体modelを照合する。未指定は既存台帳の互換検証でありCodex自動起動の認可に使わない。必要tier不足・mapping不明・不一致を非0で拒否する                                                                                     |
+| `routing tier`              | `--risk --mode --scope --model --selected [--provider=codex] [--justification]`                                                                                                                  | provider=codexはtrusted selector採用tierと新しい公式観測で具体modelを照合する。未指定は既存台帳の互換検証でありCodex自動起動の認可に使わない。必要tier不足・mapping不明・不一致を非0で拒否する 出力は判定の信頼源を`provenance`（`source`はtrusted読みで`git`、互換検証で`filesystem`、`ref`はtrusted commitまたはproject policy manifestのpath）、用途を`usage`（`codex-adoption`／`compatibility-only`）として必ず含める。`--provider`は`codex`だけを受理し、それ以外の値は拒否する。互換検証の失敗診断はworking treeへの定義を案内し、必要authorityは不要とする |
 | `routing ceiling`           | `--provider --selection --issue --scope [--override=<JSON>]`                                                                                                                                     | provider自律選択上限とIssue・scope拘束の人間overrideを検証し、alias・自動routing・失効・自己発行を非0で拒否する                                                                                                                                                                    |
 | `routing independence`      | `--implementer --reviewer --candidate-paths --trusted-ref --candidate-head --evaluator-ref`                                                                                                      | identity分離とcandidate自己評価を検査する。independentは0、violatedまたはpendingは構造化診断付きで非0                                                                                                                                                                              |
 | `routing evidence issue`    | store設定と`--base-sha --issue --scope --role --route-mode --provider --model --model-selection --routing-reason --mapping-version --reasoning-effort --service-tier --identity --evaluator-ref` | 無指定は発行preview、`--apply`はCodex優先またはClaude fallbackを拘束した書換不能なrouting evidenceを排他的に1件発行する                                                                                                                                                            |
diff --git "a/docs/specs/10_\343\202\273\343\202\255\343\203\245\343\203\252\343\203\206\343\202\243/01_\344\277\241\351\240\274\345\242\203\347\225\214.md" "b/docs/specs/10_\343\202\273\343\202\255\343\203\245\343\203\252\343\203\206\343\202\243/01_\344\277\241\351\240\274\345\242\203\347\225\214.md"
index 2a0d811a..e617c3db 100644
--- "a/docs/specs/10_\343\202\273\343\202\255\343\203\245\343\203\252\343\203\206\343\202\243/01_\344\277\241\351\240\274\345\242\203\347\225\214.md"
+++ "b/docs/specs/10_\343\202\273\343\202\255\343\203\245\343\203\252\343\203\206\343\202\243/01_\344\277\241\351\240\274\345\242\203\347\225\214.md"
@@ -90,6 +90,6 @@ validate、file migration、deliveryは同じmatcherへtrusted sourceを配送
 
 ## Codex自動起動の境界
 
-`routing launch`は`loadOperationPolicy`がorigin/HEADの既定branchから固定したpolicyだけを採用判定に使う。candidate worktreeの新しいtierMapping keyは同candidateの認可根拠にしない。selector `codex:provider_recommended_default:high:default` は既存の非空key→tier契約内の採用条件であり、schema fieldの追加や入力文法の自己拡張を必要としない。keyの配送と当該実行への適用を分離し、起動直前にtrusted commitが変化していないことを再検証する。
+`routing launch`は`loadOperationPolicy`がorigin/HEADの既定branchから固定したpolicyだけを採用判定に使う。candidate worktreeの新しいtierMapping keyは同candidateの認可根拠にしない。**`routing tier`のprovider未指定経路は候補側worktreeのproject choiceを読む互換検証であり、認可に使わない。** 出力の`provenance`と`usage`が判定の信頼源と用途を示し、診断はtrusted側の定義を要求しない。`--provider`は`codex`だけを受理する。selector `codex:provider_recommended_default:high:default` は既存の非空key→tier契約内の採用条件であり、schema fieldの追加や入力文法の自己拡張を必要としない。keyの配送と当該実行への適用を分離し、起動直前にtrusted commitが変化していないことを再検証する。
 
 公式catalogの観測ではconfig/readで`model_catalog_json`を検査し、選択関連設定だけを固定する。利用者の認証・安全設定全体を消さない。実行argvは固定し、任意model/provider/shell/危険flagを受け取らない。promptはroot内の通常fileをcontainment、symlink、size、open前後のfile identityで検証してstdinへ渡す。promptとraw stdout/stderrを結果証跡へ転記しない。selector採用tierはsandboxやGitHub操作のauthorityを与えず、hostの既存制御を迂回しない。
diff --git "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md" "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
index 2248f811..b42b8cd8 100644
--- "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
+++ "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
@@ -124,6 +124,7 @@ REQ-SQ-027に対応する案件受け入れ条件AC-1024-14は、offline下で
 | REQ-WF-003 | AC-WF-003 | SCN-UNIT-POC-001、SCN-UNIT-POC-002、SCN-UNIT-POC-003、SCN-UNIT-POC-004、SCN-UNIT-POC-005、SCN-UNIT-POC-006、SCN-UNIT-POC-007、SCN-UNIT-POC-008、SCN-UNIT-POC-009、SCN-UNIT-POC-010、SCN-UNIT-POC-011 | unit | `test/features/unit/poc-mode.feature` | `src/domain/mode.ts`、`src/domain/issue.ts`、`src/domain/poc-observation.ts`、`src/adapters/poc-execution.ts`、`.agent-skill-chain/schemas/poc-observation.schema.json`、`.agent-skill-chain/schemas/workflow-mode-decision.schema.json` | 作業treeで正常3件・異常8件の計11件合格 |
 | REQ-SQ-003 | AC-SQ-003 | SCN-UNIT-CHOICE-009、SCN-UNIT-CHOICE-010、SCN-UNIT-CHOICE-011、SCN-UNIT-CHOICE-012、SCN-UNIT-CHOICE-013、SCN-UNIT-CHOICE-014、SCN-UNIT-CHOICE-015、SCN-UNIT-CHOICE-016、SCN-UNIT-CHOICE-017、SCN-UNIT-CHOICE-018、SCN-UNIT-CHOICE-019 | unit | `test/features/unit/project-choice-diff.feature` | `src/domain/project-choice-shrink.ts`、`src/domain/enforcement.ts` | 本作業treeで合格 |
 | REQ-SQ-003 | AC-SQ-003 | SCN-UNIT-CHOICE-001、SCN-UNIT-CHOICE-002、SCN-UNIT-CHOICE-003、SCN-UNIT-CHOICE-004、SCN-UNIT-CHOICE-005、SCN-UNIT-CHOICE-006、SCN-UNIT-CHOICE-007、SCN-UNIT-CHOICE-008 | unit | `test/features/unit/project-choice-diff.feature` | `src/domain/project-choice-diff.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
+| REQ-WF-007 | AC-WF-007 | SCN-UNIT-TIERPROV-001、SCN-UNIT-TIERPROV-002、SCN-UNIT-TIERPROV-003 | unit | `test/features/unit/routing-tier-provenance.feature` | `src/cli.ts`、`src/cli-usage.ts` | 3 scenarios合格・作業tree |
 | REQ-WF-007 | AC-WF-007 | SCN-UNIT-ROUTING-003 | unit | `test/features/unit/project-choice-routing.feature` | `src/domain/routing.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-WF-008 | AC-WF-008 | SCN-UNIT-SAT-001、SCN-UNIT-SAT-002、SCN-UNIT-SAT-003、SCN-UNIT-SAT-004、SCN-UNIT-SAT-005、SCN-UNIT-SAT-006、SCN-UNIT-SAT-007、SCN-UNIT-SAT-008、SCN-UNIT-SAT-009、SCN-UNIT-SAT-010、SCN-UNIT-SAT-014、SCN-UNIT-SAT-015 | unit | `test/features/unit/project-policy-satisfiability.feature` | `src/domain/conformance.ts`、`src/domain/enforcement.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-WF-008 | AC-WF-008 | SCN-UNIT-SAT-021、SCN-UNIT-SAT-022、SCN-UNIT-SAT-023、SCN-UNIT-SAT-024、SCN-UNIT-SAT-025、SCN-UNIT-SAT-026 | unit | `test/features/unit/project-policy-satisfiability.feature` | `src/domain/conformance.ts`、`.agent-skill-chain/schemas/project-conformance-binding.schema.json` | 合格・作業treeで対象実行済み |
diff --git "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md" "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
index 6a277f07..a89f5fca 100644
--- "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
+++ "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
@@ -2,6 +2,7 @@
 
 | 日付 | 変更 | 要件・SCN | 用語ID | 更新文書 | Issue・PR | 互換性 | 判断者 | HEAD SHA |
 |---|---|---|---|---|---|---|---|---|
+| 2026-09-12 | `routing tier`が未指定経路の結果をtrustedと表示しないよう判定の信頼源（`provenance`）と用途（`usage`）を出力し、仕様外の`--provider=claude`を拒否する | REQ-WF-007、AC-WF-007、SCN-UNIT-TIERPROV-001〜003 | なし | `02_要件/`、`06_外部インターフェース/`、`10_セキュリティ/`、`15_要件追跡/` | Issue #1350 | `--provider=claude`を新たに拒否する（#1257で仕様外に入った互換alias）。出力へ`provenance`・`usage`を追加。`codex`経路の判定と終了値は不変 | package owner | 実装commitで確定 |
 | 2026-09-12 | review入力を固定したまま判定非依存の進捗だけを専用digest chainへ追記し、read-only表示する安全な並行経路を追加 | REQ-WF-021、AC-WF-021、SCN-INT/UNIT/E2E-PROGRESS-001〜021 | TERM-ASC-107 | `01_システム概要/02_用語・略語.md`、`02_要件/`、`06_外部インターフェース/`、`07_データ/`、`11_非機能/`、`15_要件追跡/`、配布03 template | Issue #1336 | 専用journalだけをstaging digestから分離し、review入力treeへの投影applyとgateからjournalを読むedgeを禁止する。progress失敗は従来reviewを停止しない | repository ownerの指示とClaude Opus反例探索2回 | 作業tree、base `8e7405b9` |
 | 2026-09-12 | SCN IDの文法を`src/domain/scenario-id.ts`の単一正本にし、`issue validate`のscenario行検出へ末尾境界と文法外IDの名指し診断を加える。delivery証跡検査は同じ述語を参照し、工程の入口と終端の受理集合を一致させる | REQ-WF-006、AC-WF-006、SCN-UNIT-SCNID-001〜004 | TERM-ASC-105 | `01_システム概要/`、`02_要件/`、`06_外部インターフェース/`、`15_要件追跡/` | Issue #1349 | `issue validate`は文法外のSCN ID（小文字枝番等）を新たに拒否する。正規IDの判定は不変 | package owner | 実装commitで確定 |
 | 2026-09-12 | `workflow advance`で保存済みstateから次の1 Stepを導出し、既定preview、Step別成果物検証・journal記録、外部書込み直前のIssue本文競合検査、Step 4・8の生成本文同期と実測Evidence、公開済み同期の重複送信を避けるjournal復旧、Step 9成果物のexact HEAD拘束、Step 10・11の専用gate委譲を提供する | REQ-WF-020、AC-WF-020、SCN-UNIT-ADVANCE-001〜005、SCN-E2E-ADVANCE-001〜013 | TERM-ASC-106追加 | `01_システム概要/02_用語・略語.md`、`02_要件/01_ワークフロー要件.md`、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`15_要件追跡/`、`dist/` | Issue #1335 | 公開subcommand追加。既存個別command、journal形式、review・delivery authorityは不変 | package owner | 実装commitで確定 |
diff --git a/src/cli-usage.ts b/src/cli-usage.ts
index f4801449..db1631bd 100644
--- a/src/cli-usage.ts
+++ b/src/cli-usage.ts
@@ -206,9 +206,9 @@ export const COMMAND_USAGE: readonly CommandUsage[] = Object.freeze([
     optionalFlags: [
       optional(
         "provider",
-        "text",
-        "codexは公式selectorとtrusted tierを検証、claudeは旧台帳",
-        "旧台帳互換",
+        "codex",
+        "codexだけを受理する。trusted selector採用tierと公式観測で照合し、出力はprovenance sourceがgitでusageがcodex-adoptionになる",
+        "未指定はworking treeの既存台帳による互換検証（provenance sourceはfilesystem、usageはcompatibility-only）。認可には使わない",
       ),
       ROOT_FLAG,
       optional("justification", "text", "上位tierを選ぶ根拠", "根拠なし"),
diff --git a/src/cli.ts b/src/cli.ts
index 0a0a0b9a..6fd7f016 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -3897,6 +3897,24 @@ function routingFailure(
   });
 }
 
+/**
+ * policy loaderが観測した信頼源を出力用へ写す。**handlerで信頼源を推測しない。**
+ * `source`はloaderの語彙（`filesystem` / `filesystem-legacy` / `git`）をそのまま使い、
+ * `ref`は読んだcommit SHA（trusted）またはproject policy manifestのpathとする。
+ */
+function tierProvenance(provenance: Record<string, unknown>): {
+  source: string;
+  ref: string;
+} {
+  const source = typeof provenance.source === "string" ? provenance.source : "";
+  const commitSha =
+    typeof provenance.commitSha === "string" ? provenance.commitSha : undefined;
+  return {
+    source,
+    ref: commitSha ?? ".agent-skill-chain/project-policy.json",
+  };
+}
+
 function roleTierFailure(
   ruleId: string,
   purpose: string,
@@ -4317,14 +4335,18 @@ export async function main(
     const mode = required(flags, "mode");
     const scope = required(flags, "scope");
     const model = required(flags, "model");
-    if (
-      flags.provider !== undefined &&
-      flags.provider !== "codex" &&
-      flags.provider !== "claude"
-    )
-      throw new Error("--providerはcodexまたはclaudeが必要です");
+    /**
+     * **受理値は仕様の`codex`と未指定だけである**（Issue #1350）。`claude`は仕様外の
+     * 互換aliasとして加わっていたが、未指定と同じworking tree判定を行いながら
+     * 診断がtrustedを主張するため、trusted検査を受けたと誤読させていた。
+     */
+    if (flags.provider !== undefined && flags.provider !== "codex")
+      throw new Error(
+        "--providerはcodexだけを受理します。未指定は既存台帳の互換検証であり、Codex自動起動の認可には使いません",
+      );
     const selected = modelTier(required(flags, "selected"), "selected");
-    const choices = loadProjectPolicySet(root).choices[0];
+    const projectSet = loadProjectPolicySet(root);
+    const choices = projectSet.choices[0];
     const configured =
       choices?.modelMapping && typeof choices.modelMapping !== "string"
         ? choices.modelMapping
@@ -4382,6 +4404,8 @@ export async function main(
         model,
         selector: CODEX_ADOPTION_SELECTOR,
         observedAt: observation.observedAt,
+        provenance: tierProvenance(trustedSet.provenance),
+        usage: "codex-adoption",
       });
       return result.valid ? 0 : 1;
     }
@@ -4395,19 +4419,37 @@ export async function main(
           ? flags.justification
           : undefined,
     });
-    const output = { ...result, required: requiredMinimum, selected, model };
+    /**
+     * **未指定経路は候補側のworking treeを読む互換検証である。** 仕様どおり
+     * Codex自動起動の認可に使わないため、判定の信頼源と用途を出力へ明示し、
+     * 診断からtrustedの主張を外す（Issue #1350）。
+     */
+    const compatibility = {
+      provenance: tierProvenance(projectSet.provenance),
+      usage: "compatibility-only" as const,
+    };
+    const output = {
+      ...result,
+      required: requiredMinimum,
+      selected,
+      model,
+      ...compatibility,
+    };
     print(
       result.valid
         ? output
-        : roleTierFailure(
-            "ASC-MODEL-TIER-001",
-            "risk・mode・scopeに必要な能力tierを単調に保証する",
-            risk,
-            result.errors,
-            scope,
-            "trusted project choiceへmodel mappingを定義するか、必要tier以上を選択してください",
-            "model mapping owner",
-          ),
+        : {
+            ...(roleTierFailure(
+              "ASC-MODEL-TIER-001",
+              "risk・mode・scopeに必要な能力tierを単調に保証する",
+              risk,
+              result.errors,
+              scope,
+              "working treeのmodelMapping.tierMappingへmodelを定義するか、必要tier以上を選択してください。本判定は互換検証であり認可には使いません",
+              "不要",
+            ) as Record<string, unknown>),
+            ...compatibility,
+          },
     );
     return result.valid ? 0 : 1;
   }
diff --git a/test/features/unit/routing-tier-provenance.feature b/test/features/unit/routing-tier-provenance.feature
new file mode 100644
index 00000000..726711db
--- /dev/null
+++ b/test/features/unit/routing-tier-provenance.feature
@@ -0,0 +1,17 @@
+@unit
+Feature: routing tierは判定の信頼源と用途を出力し仕様外のprovider値を拒否する
+
+  Scenario: SCN-UNIT-TIERPROV-001 codex以外のprovider値を拒否する
+    Given trusted policyを持つ隔離repositoryがある
+    When routing tierをcodex以外のprovider値で実行する
+    Then すべてcodexだけを受理する案内つきで拒否される
+
+  Scenario: SCN-UNIT-TIERPROV-002 未指定経路の成功出力はfilesystemの信頼源と互換検証の用途を持つ
+    Given trusted policyを持つ隔離repositoryのworking treeへtierMappingのkeyを未commitで足す
+    When routing tierをprovider未指定で実行する
+    Then 成功出力はfilesystemの信頼源とcompatibility-onlyの用途を含む
+
+  Scenario: SCN-UNIT-TIERPROV-003 未指定経路の失敗診断はtrustedを主張しない
+    Given trusted policyを持つ隔離repositoryがある
+    When routing tierを未定義のmodelでprovider未指定で実行する
+    Then 失敗出力は信頼源を含みtrustedの語が無く必要authorityは不要である
diff --git a/test/steps/codex-launch.steps.ts b/test/steps/codex-launch.steps.ts
index 5486105b..101b18ca 100644
--- a/test/steps/codex-launch.steps.ts
+++ b/test/steps/codex-launch.steps.ts
@@ -205,6 +205,13 @@ When("公式推奨をAからBへ変更して公開CLIを2回起動する", funct
         expectedStatus,
         tierResult.stdout + tierResult.stderr,
       );
+      // codex経路はtrusted refを読む。判定の信頼源と用途を出力から観測する（Issue #1350）
+      const tierOutput: unknown = JSON.parse(tierResult.stdout);
+      assert.ok(isRecord(tierOutput), tierResult.stdout);
+      assert.equal(tierOutput.usage, "codex-adoption");
+      assert.ok(isRecord(tierOutput.provenance), tierResult.stdout);
+      assert.equal(tierOutput.provenance.source, "git");
+      assert.match(String(tierOutput.provenance.ref), /^[0-9a-f]{40}$/u);
     }
   }
 });
diff --git a/test/steps/routing-tier-provenance.steps.ts b/test/steps/routing-tier-provenance.steps.ts
new file mode 100644
index 00000000..f7e4f261
--- /dev/null
+++ b/test/steps/routing-tier-provenance.steps.ts
@@ -0,0 +1,179 @@
+import assert from "node:assert/strict";
+import fs from "node:fs";
+import path from "node:path";
+import { spawnSync, type SpawnSyncReturns } from "node:child_process";
+import { WorkflowWorld, stepDefinitions } from "../support/world.js";
+import { git } from "../../src/lib/process.js";
+import { isRecord } from "../../src/types.js";
+
+interface TierProvenanceWorld extends WorkflowWorld {
+  tierRoot: string;
+  results: Array<{ label: string; result: SpawnSyncReturns<string> }>;
+}
+
+const { Given, When, Then } = stepDefinitions<TierProvenanceWorld>();
+const cli = path.resolve("dist/bin/agent-skill-chain.js");
+
+/** trusted refを持つ隔離repository。既定branchのpolicyだけをcommitする */
+function trustedRoot(world: TierProvenanceWorld): string {
+  const root = world.initRepo();
+  const namespace = path.join(root, ".agent-skill-chain");
+  fs.mkdirSync(namespace);
+  for (const relative of ["project", "policy"])
+    fs.cpSync(
+      path.resolve(".agent-skill-chain", relative),
+      path.join(namespace, relative),
+      { recursive: true },
+    );
+  fs.copyFileSync(
+    path.resolve(".agent-skill-chain/project-policy.json"),
+    path.join(namespace, "project-policy.json"),
+  );
+  git(["add", ".agent-skill-chain"], root);
+  git(["commit", "-q", "-m", "trusted fixture", "--allow-empty"], root);
+  git(["update-ref", "refs/remotes/origin/main", "HEAD"], root);
+  git(
+    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
+    root,
+  );
+  return root;
+}
+
+function tier(root: string, extra: string[]): SpawnSyncReturns<string> {
+  return spawnSync(
+    process.execPath,
+    [
+      cli,
+      "routing",
+      "tier",
+      `--root=${root}`,
+      "--risk=path",
+      "--mode=full",
+      "--scope=issue-1350",
+      "--selected=critical",
+      ...extra,
+    ],
+    { cwd: root, encoding: "utf8" },
+  );
+}
+
+function output(result: SpawnSyncReturns<string>): Record<string, unknown> {
+  const parsed: unknown = JSON.parse(result.stdout);
+  assert.ok(isRecord(parsed), result.stdout);
+  return parsed;
+}
+
+function diagnosticOf(
+  result: SpawnSyncReturns<string>,
+): Record<string, unknown> {
+  const parsed = output(result);
+  const inner = isRecord(parsed.result) ? parsed.result : parsed;
+  const diagnostic = isRecord(inner.diagnostic) ? inner.diagnostic : undefined;
+  assert.ok(diagnostic, result.stdout);
+  return diagnostic;
+}
+
+Given("trusted policyを持つ隔離repositoryがある", function () {
+  this.tierRoot = trustedRoot(this);
+});
+
+Given(
+  "trusted policyを持つ隔離repositoryのworking treeへtierMappingのkeyを未commitで足す",
+  function () {
+    this.tierRoot = trustedRoot(this);
+    const choice = path.join(
+      this.tierRoot,
+      ".agent-skill-chain/project/choices/development.json",
+    );
+    const document = JSON.parse(fs.readFileSync(choice, "utf8")) as {
+      modelMapping: { tierMapping: Record<string, string> };
+    };
+    document.modelMapping.tierMapping["candidate-only-model"] = "critical";
+    fs.writeFileSync(choice, `${JSON.stringify(document, null, 2)}\n`);
+    // 既定branchには存在しない。trustedと誤読させないことがこのscenarioの対象である
+    assert.match(
+      git(["status", "--porcelain"], this.tierRoot).stdout,
+      /development\.json/u,
+    );
+  },
+);
+
+When("routing tierをcodex以外のprovider値で実行する", function () {
+  this.results = ["claude", "CODEX", "", "codex-preview"].map((provider) => ({
+    label: provider === "" ? "(空)" : provider,
+    result: tier(this.tierRoot, [
+      "--model=claude-opus-5",
+      `--provider=${provider}`,
+    ]),
+  }));
+});
+
+When("routing tierをprovider未指定で実行する", function () {
+  this.results = [
+    {
+      label: "unspecified",
+      result: tier(this.tierRoot, ["--model=candidate-only-model"]),
+    },
+  ];
+});
+
+When("routing tierを未定義のmodelでprovider未指定で実行する", function () {
+  this.results = [
+    {
+      label: "undefined-model",
+      result: tier(this.tierRoot, ["--model=absent-model"]),
+    },
+  ];
+});
+
+Then("すべてcodexだけを受理する案内つきで拒否される", function () {
+  for (const { label, result } of this.results) {
+    assert.equal(result.status, 1, `${label}: ${result.stdout}`);
+    const reasons = diagnosticOf(result).reasons;
+    assert.ok(Array.isArray(reasons), result.stdout);
+    assert.equal(
+      reasons.filter(
+        (reason) =>
+          typeof reason === "string" &&
+          reason.includes("--providerはcodexだけを受理します") &&
+          reason.includes("互換検証"),
+      ).length,
+      1,
+      `${label}: ${reasons.join("; ")}`,
+    );
+  }
+});
+
+Then(
+  "成功出力はfilesystemの信頼源とcompatibility-onlyの用途を含む",
+  function () {
+    const [entry] = this.results;
+    assert.equal(entry?.result.status, 0, entry?.result.stdout);
+    const parsed = output(entry!.result);
+    assert.equal(parsed.valid, true);
+    assert.deepEqual(parsed.provenance, {
+      source: "filesystem",
+      ref: ".agent-skill-chain/project-policy.json",
+    });
+    assert.equal(parsed.usage, "compatibility-only");
+  },
+);
+
+Then(
+  "失敗出力は信頼源を含みtrustedの語が無く必要authorityは不要である",
+  function () {
+    const [entry] = this.results;
+    assert.equal(entry?.result.status, 1, entry?.result.stdout);
+    const parsed = output(entry!.result);
+    assert.deepEqual(parsed.provenance, {
+      source: "filesystem",
+      ref: ".agent-skill-chain/project-policy.json",
+    });
+    assert.equal(parsed.usage, "compatibility-only");
+    const diagnostic = diagnosticOf(entry!.result);
+    assert.equal(diagnostic.requiredAuthority, "不要");
+    assert.match(String(diagnostic.next), /working tree/u);
+    assert.doesNotMatch(String(diagnostic.next), /trusted/u);
+    assert.doesNotMatch(entry!.result.stdout, /trusted project choice/u);
+  },
+);
```
