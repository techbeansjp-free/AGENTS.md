# 独立review依頼（Issue #1342、round 1、exact HEAD 36260ca796bb94f2faccc9af2781276b2bd63c24）

あなたはimplementerとは別contextの独立reviewerである。対象差分を変更せず、read-onlyで肯定・敵対の両観点をreviewする。指摘を無理に作らない。Medium/Lowはblockingにしない。

## 前提: これは先行PR #1354の作り直しである

先行branchは既定branch追随を2回行い、いずれも**用語IDの採番し直しをmerge commitの中で行った**ため、`audit:check`のmerge不変条件（`src/domain/merge-integrity.ts`。merge commitはどちらの親の内容も失ってはならず、消す操作はmergeの後の通常commitで行う）に違反した。merge commitの内容は後から直せないため、**追随mergeを一切持たない単一の実装commit**として現在のmain上へ置き直した。**実装内容は1文字も変えていない。**

先行branchでは独立reviewをround 1〜3まで回し、すべてapproved、最終roundは0 findingだった。**その過程で解消した指摘を下に全件示す。再発していないかを確認してほしい。**

| ID | 重大度 | 指摘 | 是正 |
|---|---|---|---|
| REV-01 | Medium | 配布する`workflow-step-journal.schema.json`が`additionalProperties: false`でありながら`reconfirmation`を定義せず、runtimeの正規出力を拒否する。同型の欠落は既存の`postTerminalIntake`にもあった | 2 fieldを`const: true`で定義し、Step制約を`allOf`でruntimeへ一致させた。ajvで9件の受理・拒否を実測 |
| REV-02 | Medium | `validateStepJournal`が`reconfirmation`の位置を検査せず、Step 0〜11の後へ手編集で再確定entryを足すと`valid: true`になる。書込み経路の`appendStepJournal`はStep 11後をpost-terminal intakeのStep 10だけに限っている | `postTerminalIntake`の位置検査と対称な条件を同じ関数へ追加し、SCN-UNIT-RECONFIRM-006で拒否と受理を両方向に固定 |
| REV-03 | Low | `07_データ/01_管理データ.md`のjournal記述が任意fieldとしてHumanOverride行だけを説明しており、2 fieldをデータ仕様から導出できない | 任意fieldが行に現れることと値域を追記 |
| REV-05 | Medium | 先行entry判定が`humanOverride`を除外しておらず、**一度も実施していないStepを「再確定」できた**。Step 0〜4、Step 5のhumanOverride、Step 5の再確定entryという並びが`valid: true`になる | `!candidate.humanOverride`を追加し、SCN-UNIT-RECONFIRM-007を追加。**当初のscenarioは単一Stepしか見ておらず、除外条件をStep 3だけに狭める変異Rが生存した。** Step 3とStep 7の2通りを検査する形へ直してkillした |
| REV-06 | Low | 追跡表の証拠欄が6 scenarioを列挙しながら「5 scenarios合格」と記録 | 7 scenariosへ直した |
| REV-04 | High | REV-03の是正がREQ-WF-004の位置条件だけを複製し先行entry条件を複製しなかったため、同一契約が不均等に分岐した | **下流で条件を書き直すのをやめ、正本を指す形へ直した** |

## 対象Issue（要約）
`validateStepJournal`は各Stepの最後のentryの位置で単調性を判定するため、Step 8記録後にStep 3を追記すると後続Stepが`outOfOrder`になり`workflow record`が拒否する。上流再確定（実装中に上流の矛盾を見つけて再確定する正規経路）を記録できない。是正: 既存の`postTerminalIntake`（Step 10専用、順序判定から外す）と同型の`reconfirmation: true` entryを追加し、`workflow record --step=<1..9> --reconfirm`で追記する。**順序判定そのものの緩和は採らない**（後付け受理の抜け道になるため）。

## 受け入れ条件と不変条件
- AC-01: Step 0〜8記録済みstagingで`--step=3 --reconfirm`が受理され、`workflow verify`が`valid: true`・completedSteps 0..8を返す
- AC-02: 追記entryが`reconfirmation: true`を持ち、journal行で通常entryと区別できる
- AC-03: `--reconfirm`無しの`--step=3`は従来どおり`outOfOrder`で拒否され、journalは変わらない
- AC-04: 先行entryの無いStep 5への`--reconfirm`、`--step=10 --reconfirm`はそれぞれ理由を名指しして拒否され、journalは変わらない
- AC-05: journal本文の`reconfirmation`は`true`かつStep 1〜9だけを受理し、`true`以外やStep 10の行は`parseStepJournal`が理由を名指しして拒否する
- AC-06: Step 11より後に置かれた上流再確定entryを、読取り側の順序検査も理由を名指しして拒否する。Step 11より前に置かれた同じentryは受理する
- INV-01: `reconfirmation`を持たないentryの順序判定は変わらない / INV-02: 同じStepの通常entryが先行する場合にだけ受理 / INV-03: Step 10・11は対象外で、Step 11より後に置けない

## 特に見てほしい点
1. **mainが持ち込んだ`workflow advance`（#1335）と`review progress`（#1336）との意味的衝突。** どちらも`src/domain/workflow.ts`・`src/adapters/review-session.ts`・`src/domain/staging.ts`へ触れている。gitは衝突を報告せず型検査も通る。
2. 用語IDが`TERM-ASC-108`で、mainの`TERM-ASC-106`（workflow advance）・`TERM-ASC-107`（parallel progress evidence）と衝突していないか。
3. **flagだけで過去Stepを後付けできる抜け道が残っていないか。** 先行entry検査の実効性（`reconfirmation`付きentryが自分より前の`reconfirmation`付きentryを先行entryとして数えないか）。
4. 上の4指摘が再発していないか。

## implementer申告（信用せず再実行してよい。dist build済み）
- `npm test` 1,906 scenarios（1,890 passed / 16 skipped / **0 failed**）、`conformance:check` 87 scenarios全pass。いずれも本HEADで実測
- `SCN-UNIT-RECONFIRM-001`〜`007` 7 scenarios合格。post-terminal intakeとの併走を含む16 scenariosも合格
- 変異試験7件: L・M・N・PをSCN-UNIT-RECONFIRM-006が、Q（humanOverride除外の削除）・R（除外をStep 3だけに狭める）をSCN-UNIT-RECONFIRM-007がkill。O（`reconfirmation`への限定を外し全entryへ当てる）は既存のpost-terminal intake scenario 3件がkill
- `git log --merges --oneline origin/main..HEAD` は0件
- read-only sandboxでtestを実行できない場合は、実行できなかった事実を書き、合格したと書かない

## 出力形式（厳守）
1. `## 肯定的評価` と `## 敵対的評価` の表（観点 | 判定 pass/finding/not-applicable | 根拠）
2. `## findings` にJSON配列だけ。schema: `{"id":"REV-05","severity":"Critical|High|Medium|Low","status":"valid","source":"review","relation":"acceptance-violation|invariant-violation|fix-regression|improvement|out-of-scope","evidence":"file:line と反例","path":"src/...","contractId":"AC-0N または INV-0N","causedByFindingId":null}`。指摘なしなら `[]`
3. `## 判定` approved / rejected

## 対象差分（`origin/main`＝`3b6dcb88` → `36260ca7`、`dist/`除く）

```diff
diff --git "a/.agent-skill-chain/docs/01_\351\226\213\347\231\272\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274.md" "b/.agent-skill-chain/docs/01_\351\226\213\347\231\272\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274.md"
index ef8686a4..731836f5 100644
--- "a/.agent-skill-chain/docs/01_\351\226\213\347\231\272\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274.md"
+++ "b/.agent-skill-chain/docs/01_\351\226\213\347\231\272\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274.md"
@@ -104,7 +104,7 @@ Issue同期時のtrackerはrepositoryとIssue番号を拘束するabsolute GitHu
 
 `workflow record`の汎用追記はStep 1〜10だけに使用する。Step 11はdelivery終端専用であり、固定済みPRまたはmerge observationからdelivery経路が記録し、genericな`workflow record --step=11`は拒否する。
 
-Step定義の機械正本は`src/domain/workflow.ts`とし、この文書のStep表4列とモード節のStep列は`npm run workflow:check`で完全一致させる。表とモード節の一方だけを変更しない。Step 0は`00_モード判定.json`と`journal/steps.jsonl`を生成し、各Step完了時は`workflow record`で成果物と証拠を追記する。`pr create`はStep 10まで、特にStep 4と10、および`sync-verified`を検証する。quickでもStep 4は省略対象ではない。
+Step定義の機械正本は`src/domain/workflow.ts`とし、この文書のStep表4列とモード節のStep列は`npm run workflow:check`で完全一致させる。表とモード節の一方だけを変更しない。Step 0は`00_モード判定.json`と`journal/steps.jsonl`を生成し、各Step完了時は`workflow record`で成果物と証拠を追記する。`pr create`はStep 10まで、特にStep 4と10、および`sync-verified`を検証する。quickでもStep 4は省略対象ではない。後続Stepを記録した後に上流Step 1〜9を再確定した場合は`workflow record --step=<N> --reconfirm`で上流再確定entryとして追記し、後続Stepを順序違反にしない。同じStepの通常記録が先行しているときだけ受理する。
 
 無条件の欠落迂回を設けない。人間が欠落を明示承認する場合は対象Issue、`workflow.pr.create` scope、指示者、理由、指示日時、失効日時をjournalへ記録し、AI・roleの自己発行、別Issue、失効、欠落以外の不整合を拒否する。
 
diff --git a/.agent-skill-chain/schemas/workflow-step-journal.schema.json b/.agent-skill-chain/schemas/workflow-step-journal.schema.json
index de2f1e1f..6fdb4259 100644
--- a/.agent-skill-chain/schemas/workflow-step-journal.schema.json
+++ b/.agent-skill-chain/schemas/workflow-step-journal.schema.json
@@ -87,9 +87,29 @@
     },
     "humanOverride": {
       "$ref": "#/$defs/humanOverride"
+    },
+    "postTerminalIntake": {
+      "const": true
+    },
+    "reconfirmation": {
+      "const": true
     }
   },
   "allOf": [
+    {
+      "if": {
+        "properties": { "step": { "const": 10 } },
+        "required": ["step"]
+      },
+      "else": { "not": { "required": ["postTerminalIntake"] } }
+    },
+    {
+      "if": {
+        "properties": { "step": { "minimum": 1, "maximum": 9 } },
+        "required": ["step"]
+      },
+      "else": { "not": { "required": ["reconfirmation"] } }
+    },
     {
       "if": { "properties": { "step": { "const": 9 } } },
       "else": { "not": { "required": ["implementationHeadSha"] } }
diff --git "a/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md" "b/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md"
index 710337cb..0e5de9a5 100644
--- "a/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md"
+++ "b/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md"
@@ -78,6 +78,7 @@ agent-skill-chainで現在有効なドメイン用語台帳である。開発工
 | TERM-ASC-105 | SCN ID | `SCN-`に大文字英数字とハイフン（`[A-Z0-9-]`）だけを1文字以上続けた、Scenarioを一意に識別する安定ID。Issue成果物検証とdelivery証跡検査が`src/domain/scenario-id.ts`の同一の述語で判定する | system | Issue成果物検証 / Delivery証跡検証 | `SCN-69-001`、`SCN-UNIT-TRACE-001`は成立する。`SCN-69-001a`（小文字枝番）、`SCN-69_001`（下線）、`SCN-`（本体なし）は該当しない | シナリオIDと表記しない。scenario name（IDに続く説明文）と混同しない。正規化・読み替えを行わない | REQ-WF-006、Issue #1349 | package owner | active、v0.3.1、なし |
 | TERM-ASC-106 | workflow advance | 保存済みjournalから次のStepを導出し、検証・記録・同期または専用gateへの委譲を1操作で計画し、明示apply時だけ次の1 Stepを適用するCLI | system | Workflow | Step 1を1件記録する、Step 4本文を同期して記録する場合は成立する。reviewを自動承認する、PRを作成・mergeする場合は成立しない | 自動承認、自動merge、複数Step連続実行は禁止 | REQ-WF-020、Issue #1335 | package owner | active、v0.3.2、なし |
 | TERM-ASC-107 | parallel progress evidence | H_impl固定後にimplementerが専用journalへappendし、review・test・PR・merge・releaseの成否判定には使用されない、閉じたfieldだけの進捗証跡 | system | Review Evidence | 宣言済みtask IDの状態追記は成立する。test成功、review承認、自由記述、既存entry改変は該当しない | review evidence、approval、delivery authorityと同一視しない | REQ-WF-021、Issue #1336 | package owner | active、v0.3.2、なし |
+| TERM-ASC-108 | 上流再確定entry | 後続Stepを記録した後に上流Step（1〜9）を再実施した事実を、順序判定から外して追記するstep journalのentry。`reconfirmation: true`を持ち、同じStepの通常entryが先行していることを要する | system | Workflow | Step 8記録後の`workflow record --step=3 --reconfirm`は成立する。先行entryの無いStep、Step 10・11、`--reconfirm`無しの後付けは該当しない | 再記録・後付けと混同しない。post-terminal intake（Step 10専用）とは別 | REQ-WF-004、Issue #1342 | package owner | active、v0.3.1、なし |
 
 ## 更新規則
 
diff --git "a/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md" "b/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
index 9e42e51e..ca5cd877 100644
--- "a/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
+++ "b/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
@@ -7,7 +7,7 @@
 | REQ-WF-001 | 機能 | riskに応じてfull・quick・pocを安全側に判定する | 必須 | Issue #824、#827 | AC-WF-001 | 合意 |
 | REQ-WF-002 | 機能 | Issue計画を原子的にstagingし耐久トラッカーへ同期する | 必須 | Issue #824、#860 | AC-WF-002 | 合意 |
 | REQ-WF-003 | 機能 | PoCを正式開発から分離しfullへの単調昇格を管理する | 必須 | Issue #827 | AC-WF-003 | 合意 |
-| REQ-WF-004 | 機能 | Step 0〜11を機械正本とjournalで順序検証する | 必須 | Issue #877 | AC-WF-004 | 合意 |
+| REQ-WF-004 | 機能 | Step 0〜11を機械正本とjournalで順序検証する | 必須 | Issue #877、#1342 | AC-WF-004 | 合意 |
 | REQ-WF-005 | 機能 | 肯定・敵対reviewとexact-head証拠を有限に検証する | 必須 | Issue #824、#834 | AC-WF-005 | 合意 |
 | REQ-WF-006 | 機能 | Gherkinの一意ID・構造・層・仕様追跡を検証する | 必須 | Issue #824、#881、#1349 | AC-WF-006 | 合意 |
 | REQ-WF-007 | 機能 | role・独立性と公式推奨Codex・trusted採用tierを解決し実行へ接続する | 必須 | Issue #830、#836、#1257 | AC-WF-007 | 合意 |
diff --git "a/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md" "b/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
index a238cc15..da5aaad4 100644
--- "a/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
+++ "b/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
@@ -58,10 +58,10 @@ PoCはrelease・自動merge・本番cleanupを拒否する。正式化では不
 
 ### REQ-WF-004 Step順序とjournalを機械検証する
 
-Step 0〜11、mode別列、staging成果物path、共通staging検査を`src/domain/workflow.ts`の単一正本で定義する。journalは行順、必須成果物、evidence、mode単調昇格を検証し、PR作成前にStep 4・10・同期状態を含むStep 10までを要求する。モード判定成果物は`changedFiles`を保存し、再分類でも同じhigh risk判定を再現する。欠落overrideはIssue・scope・主体・理由・期限へ拘束し、承認元をcandidate管理下から分離する。**journal追記経路もStep順序判定と同じ条件で通す。**Step 11記録後の追記とterminal delivery state後のStep 0〜10は、post-terminal intakeのStep 10だけを受理し、それ以外は拒否する。公開CLIは`--post-terminal-intake`を値を取らないflagとして受理する。
+Step 0〜11、mode別列、staging成果物path、共通staging検査を`src/domain/workflow.ts`の単一正本で定義する。journalは行順、必須成果物、evidence、mode単調昇格を検証し、PR作成前にStep 4・10・同期状態を含むStep 10までを要求する。モード判定成果物は`changedFiles`を保存し、再分類でも同じhigh risk判定を再現する。欠落overrideはIssue・scope・主体・理由・期限へ拘束し、承認元をcandidate管理下から分離する。**journal追記経路もStep順序判定と同じ条件で通す。**Step 11記録後の追記とterminal delivery state後のStep 0〜10は、post-terminal intakeのStep 10だけを受理し、それ以外は拒否する。公開CLIは`--post-terminal-intake`を値を取らないflagとして受理する。**後続Step記録後の上流再確定は`workflow record --step=<1..9> --reconfirm`で上流再確定entry（`reconfirmation: true`）として追記し、順序判定から外す。** 同じStepの通常entryが先行する場合にだけ受理する。**先行entryはそのStepを実際に実施した記録に限り、`humanOverride`（欠落を人間が明示承認した記録）と他の再確定entry、post-terminal intakeは数えない。** 先行entryの無い後付け、Step 10・11、`--reconfirm`無しの過去Step追記は拒否する。記録は残り、順序判定だけを外す。**順序判定から外すことと、どこへでも置けることは別である。** 上流再確定entryはStep 11より後に置けず、読取り側の順序検査も書込み経路と同じ条件で拒否する。Step 11記録後に置けるのはpost-terminal intakeのStep 10だけである。
 
 - 受け入れ条件: AC-WF-004
-- 根拠: Issue #877、#1194
+- 根拠: Issue #877、#1194、#1342
 - 実装: `src/domain/workflow.ts`
 
 ### REQ-WF-005 reviewと証拠を独立させる
diff --git "a/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md" "b/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
index 4f184c55..57c71af2 100644
--- "a/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
+++ "b/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
@@ -92,7 +92,7 @@ Step 4・8の`workflow record --evidence`は64桁のhex digestと`sync`語、`pr
 | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
 | `workflow steps`            | 任意の`--mode=<quick｜full｜poc>`                                                                                                                                               | Step定義、mode別列、省略対象、全mode共通の省略不能Stepを機械可読JSONで返す。不明modeは非0                                                                                                                                                                                                                                                                                                                                                                                                        |
 | `workflow advance`          | `--staging`。local applyは`--artifact --evidence --apply`、Step 4・8 applyは`--repo --issue --authorize=approved --expected-body-sha256=<preview値> --apply`。`--recorded-at --synced-at --dry-run`は任意          | journalから次の1 Stepを計画し、既定previewは無変更。local applyは成果物をstage検証して1件だけ記録する。Step 4・8はpreview本文digestへの一致を要求し、生成本文を既存GitHub adapterで同期・読み戻し後、実測digestをEvidenceへ記録する。直接apply、apply直前のstate・本文driftは拒否し、Step 10・11は専用review・delivery commandへdelegateする                                                                                                                                                                                                     |
-| `workflow record`           | `--staging --step`、1件以上の`--artifact`、`--evidence`。`--recorded-at`は任意。Step 10は`--review-session-digest`必須                                                          | Step 1〜10をJSONLへ追記し、順序・省略規則・書込後digestを検証する。Step 10は収束済みreview sessionのlatest digestと実repositoryのexact HEADが一致する場合だけ、session ID・round digest・HEADのbindingを記録する。Step 10のHumanOverride補完と他Stepでのbindingを拒否する。Step 11はdelivery終端専用のため拒否する                                                                                                                                                                               |
+| `workflow record`           | `--staging --step`、1件以上の`--artifact`、`--evidence`。`--recorded-at`は任意。Step 10は`--review-session-digest`必須。`--reconfirm`はStep 1〜9の上流再確定entry | Step 1〜10をJSONLへ追記し、順序・省略規則・書込後digestを検証する。`--reconfirm`付きentryは同じStepの通常entryが先行する場合だけ受理し、順序判定から外す。Step 10は収束済みreview sessionのlatest digestと実repositoryのexact HEADが一致する場合だけ、session ID・round digest・HEADのbindingを記録する。Step 10のHumanOverride補完と他Stepでのbindingを拒否する。Step 11はdelivery終端専用のため拒否する                                                                                                                                                                               |
 | `workflow poc-observation`  | `--staging`、任意の`--root --dry-run --apply`。caller作成`--input`、任意command、任意shellは受理しない                                                                          | defaultは副作用なしのpreflight。`--apply`はcurrent HEADの追跡済みfixtureをHEAD blobから一時copyへ復元し、Linuxの固定Git・bubblewrap・prlimit下で固定Node runnerを宣言argvにより実行する。ASC実測の終了値とstdout/stderr/file digestを期待値へ型別exact比較し、全件合格時だけ`poc-observations/<headSha>.json`へappend-only固定してinventory/digestを更新する。固定tool欠落、dirty/untracked、fixture外実Git差分、非正常終了、timeout、出力超過、不一致は観測前またはpublish前にfail-closedとする |
 | `workflow verify`           | `--staging`、任意の`--up-to=<0..11>`                                                                                                                                            | 欠落、対象外、順序違反、mode conflictをStep番号・skill ID・単一責務付きの日本語structured diagnosticで返す。有効時は0、違反時は非0                                                                                                                                                                                                                                                                                                                                                               |
 | `workflow verification-set` | `--input=<JSON>`。Requirement ID、Acceptance Criteria ID、変更種別、risk、影響境界、security・data loss・不可逆・外部契約・並行振る舞のImpact Analysis                          | 入力を保持したrisk比例Verification SetをJSONで返す。Requirement、AC、影響境界の空配列、型不正、未知fieldは非0                                                                                                                                                                                                                                                                                                                                                                                    |
diff --git "a/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md" "b/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md"
index a8ba8180..2328ad1f 100644
--- "a/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md"
+++ "b/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md"
@@ -35,7 +35,7 @@ GraphDBだけにRequirement、Finding、Evidence、provider事実を書く操作
 
 `poc-observations/<headSha>.json`は`.agent-skill-chain/schemas/poc-observation.schema.json`に従うASC実測Evidenceであり、同じPoC宣言のSHA-256、exact HEAD、UTC観測時刻、HEADから計測したfixture・runner digest、scenarioごとの`exitCode / signal / executionDigest`、宣言順の全observable resultを持つ。各resultはobservable/scenario/kind/target/expected/actual/statusと自己を除く正準JSONのSHA-256を持ち、全体も`evidenceDigest`自身を除く正準JSONのSHA-256を持つ。全scenarioが`exitCode=0`・`signal=null`かつ全resultが`passed`の場合だけ有効である。raw stdout/stderrを保存しない。staging inventory/digestへHEAD別append-onlyで含め、同一HEADの異なる内容を置換せず、Step 9以降のjournal bindingから参照する。
 
-`journal/steps.jsonl`の各行は`.agent-skill-chain/schemas/workflow-step-journal.schema.json`に従い、`step / skillId / mode / recordedAt / artifacts / evidence`を必須とする。未知field、空artifact、空evidence、Stepとskill IDの不一致を拒否する。Step 10だけは`reviewSession` objectの`sessionId / roundDigest / headSha`をすべて必須とし、他Stepでの使用を拒否する。HumanOverride行だけは対象Issueとscopeへ拘束した`humanOverride`を追加できるが、Step 10を補完できない。検証はJSONLの行順だけを使用し、`recordedAt`の前後を実施順判定へ使用しない。staging digestはjournal transaction開始時点の観測であり、markerの`stagingDigestBefore`と`staging-record.json`の`digest`を同じ値へ揃えてから追記する。
+`journal/steps.jsonl`の各行は`.agent-skill-chain/schemas/workflow-step-journal.schema.json`に従い、`step / skillId / mode / recordedAt / artifacts / evidence`を必須とする。未知field、空artifact、空evidence、Stepとskill IDの不一致を拒否する。Step 10だけは`reviewSession` objectの`sessionId / roundDigest / headSha`をすべて必須とし、他Stepでの使用を拒否する。HumanOverride行だけは対象Issueとscopeへ拘束した`humanOverride`を追加できるが、Step 10を補完できない。任意fieldの`postTerminalIntake`と`reconfirmation`も行に現れる。いずれも値`true`だけを受理する。**受理条件と順序判定上の扱いの正本は`02_要件/01_ワークフロー要件.md`のREQ-WF-004であり、ここへ複製しない。**検証はJSONLの行順だけを使用し、`recordedAt`の前後を実施順判定へ使用しない。staging digestはjournal transaction開始時点の観測であり、markerの`stagingDigestBefore`と`staging-record.json`の`digest`を同じ値へ揃えてから追記する。
 
 `review-session.json`は`agent-skill-chain/review-session/v1`で、scope ID、Acceptance Criteria ID、domain invariant ID、Git基点、初回HEAD、初回差分digestからsession IDを再導出する。roundは1から連番で、直前round digest、candidate HEAD、実Gitの修正path、Graph Evidence digest付き隣接path、findingのadmission、blocker、record-only、round digestを保持する。Graph Evidenceの実照合が未実装の間、隣接pathは記録だけに使用し、current blockerのadmission authorityにしない。読取り時は各roundを先頭から再評価し、保存済みadmission・blocker・digest・statusの自己申告をauthorityにしない。`active / converged / budget-exhausted`のみを許可する。`converged`後は前roundと異なるcandidate HEADと実Gitの空でないfixed diffがあるround 2/3だけを同digest chainへ追記できる。同じHEAD、空fixed diff、`budget-exhausted`後、round 1 reset、anchor変更、previous blocker脱落を拒否する。
 
diff --git "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md" "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
index 2248f811..d28afe63 100644
--- "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
+++ "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
@@ -51,6 +51,7 @@ REQ-SQ-027に対応する案件受け入れ条件AC-1024-14は、offline下で
 | REQ-SQ-002 | AC-SQ-002 | SCN-E2E-RISK-001、SCN-E2E-RISK-002、SCN-E2E-RISK-003、SCN-E2E-RISK-004、SCN-E2E-RISK-005、SCN-E2E-RISK-006、SCN-E2E-RISK-007、SCN-E2E-RISK-008 | e2e | `test/features/e2e/risk-policy-cli.feature` | `src/domain/enforcement.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-WF-007 | AC-WF-007 | SCN-E2E-ROLE-001 | e2e | `test/features/e2e/role-tier-cli.feature` | `src/domain/routing.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-LC-007 | AC-LC-007 | SCN-E2E-STAGING-001、SCN-E2E-STAGING-002 | e2e | `test/features/e2e/staging-lifecycle-cli.feature` | `src/domain/staging.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
+| REQ-WF-004 | AC-WF-004 | SCN-UNIT-RECONFIRM-001、SCN-UNIT-RECONFIRM-002、SCN-UNIT-RECONFIRM-003、SCN-UNIT-RECONFIRM-004、SCN-UNIT-RECONFIRM-005、SCN-UNIT-RECONFIRM-006、SCN-UNIT-RECONFIRM-007 | unit | `test/features/unit/workflow-reconfirmation.feature` | `src/domain/workflow.ts`、`src/cli.ts` | 7 scenarios合格・作業tree |
 | REQ-WF-004 | AC-WF-004 | SCN-E2E-WFSTEP-001、SCN-E2E-WFSTEP-002、SCN-E2E-WFSTEP-003、SCN-E2E-WFSTEP-004 | e2e | `test/features/e2e/workflow-step-enforcement-cli.feature` | `src/domain/workflow.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-LC-004 | AC-LC-004 | SCN-E2E-HYGIENE-001、SCN-E2E-HYGIENE-002 | e2e | `test/features/e2e/workspace-hygiene-cli.feature` | `src/domain/hygiene.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-LC-003 | AC-LC-003 | SCN-E2E-WTPLACE-001 | e2e | `test/features/e2e/worktree-placement-cli.feature` | `src/domain/worktree.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
diff --git "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md" "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
index 6a277f07..e059fd76 100644
--- "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
+++ "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
@@ -2,6 +2,7 @@
 
 | 日付 | 変更 | 要件・SCN | 用語ID | 更新文書 | Issue・PR | 互換性 | 判断者 | HEAD SHA |
 |---|---|---|---|---|---|---|---|---|
+| 2026-09-12 | `workflow record --step=<1..9> --reconfirm`で上流再確定entry（`reconfirmation: true`）を追記し、順序判定から外す。同じStepの通常entryが先行するときだけ受理し、先行entryなし・Step 10/11・flag無しの後付けは拒否する | REQ-WF-004、AC-WF-004、SCN-UNIT-RECONFIRM-001〜007 | TERM-ASC-108 | `01_システム概要/`、`02_要件/`、`06_外部インターフェース/`、`15_要件追跡/` | Issue #1342 | journal entryへ任意fieldを追加。fieldを持たない既存journalは不変。旧版CLIは未知fieldとして拒否する | package owner | 実装commitで確定 |
 | 2026-09-12 | review入力を固定したまま判定非依存の進捗だけを専用digest chainへ追記し、read-only表示する安全な並行経路を追加 | REQ-WF-021、AC-WF-021、SCN-INT/UNIT/E2E-PROGRESS-001〜021 | TERM-ASC-107 | `01_システム概要/02_用語・略語.md`、`02_要件/`、`06_外部インターフェース/`、`07_データ/`、`11_非機能/`、`15_要件追跡/`、配布03 template | Issue #1336 | 専用journalだけをstaging digestから分離し、review入力treeへの投影applyとgateからjournalを読むedgeを禁止する。progress失敗は従来reviewを停止しない | repository ownerの指示とClaude Opus反例探索2回 | 作業tree、base `8e7405b9` |
 | 2026-09-12 | SCN IDの文法を`src/domain/scenario-id.ts`の単一正本にし、`issue validate`のscenario行検出へ末尾境界と文法外IDの名指し診断を加える。delivery証跡検査は同じ述語を参照し、工程の入口と終端の受理集合を一致させる | REQ-WF-006、AC-WF-006、SCN-UNIT-SCNID-001〜004 | TERM-ASC-105 | `01_システム概要/`、`02_要件/`、`06_外部インターフェース/`、`15_要件追跡/` | Issue #1349 | `issue validate`は文法外のSCN ID（小文字枝番等）を新たに拒否する。正規IDの判定は不変 | package owner | 実装commitで確定 |
 | 2026-09-12 | `workflow advance`で保存済みstateから次の1 Stepを導出し、既定preview、Step別成果物検証・journal記録、外部書込み直前のIssue本文競合検査、Step 4・8の生成本文同期と実測Evidence、公開済み同期の重複送信を避けるjournal復旧、Step 9成果物のexact HEAD拘束、Step 10・11の専用gate委譲を提供する | REQ-WF-020、AC-WF-020、SCN-UNIT-ADVANCE-001〜005、SCN-E2E-ADVANCE-001〜013 | TERM-ASC-106追加 | `01_システム概要/02_用語・略語.md`、`02_要件/01_ワークフロー要件.md`、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`15_要件追跡/`、`dist/` | Issue #1335 | 公開subcommand追加。既存個別command、journal形式、review・delivery authorityは不変 | package owner | 実装commitで確定 |
diff --git a/src/cli-usage.ts b/src/cli-usage.ts
index f4801449..720b3643 100644
--- a/src/cli-usage.ts
+++ b/src/cli-usage.ts
@@ -539,6 +539,12 @@ export const COMMAND_USAGE: readonly CommandUsage[] = Object.freeze([
         "Step 11記録後に外部reviewer指摘を同じPRで取り込んだroundとして記録する",
         "通常のStep記録",
       ),
+      optional(
+        "reconfirm",
+        "",
+        "後続Step記録後に上流Step 1〜9を再確定した事実を、順序判定から外すentryとして記録する。同じStepの通常記録が先行しているときだけ受理する",
+        "通常のStep記録",
+      ),
     ],
     example:
       "npx agent-skill-chain workflow record --staging=.asc/886 --step=4 --evidence='sync digest 0000000000000000000000000000000000000000000000000000000000000000' --artifact=src/cli-usage.ts",
diff --git a/src/cli.ts b/src/cli.ts
index 0a0a0b9a..8ac0d2cd 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -304,7 +304,12 @@ function workflowArguments(args: string[]): {
 } {
   const flags: Record<string, string> = {};
   const artifacts: string[] = [];
-  const booleanFlags = new Set(["apply", "dry-run", "post-terminal-intake"]);
+  const booleanFlags = new Set([
+    "apply",
+    "dry-run",
+    "post-terminal-intake",
+    "reconfirm",
+  ]);
   for (let index = 0; index < args.length; index += 1) {
     const argument = args[index] ?? "";
     if (!argument.startsWith("--"))
@@ -5294,6 +5299,7 @@ export async function main(
           "recorded-at",
           "review-session-digest",
           "post-terminal-intake",
+          "reconfirm",
         ].includes(flag),
     );
     if (unknown.length > 0)
@@ -5323,6 +5329,14 @@ export async function main(
       artifacts,
       evidence,
     };
+    /**
+     * 上流再確定entry（Issue #1342）。Step 10はreview binding、Step 11はdelivery終端が
+     * 所有するため対象外。先行する通常entryの存在はjournal本体の順序判定が検証する。
+     */
+    const reconfirm = flags.reconfirm !== undefined;
+    if (reconfirm && (step.step < 1 || step.step > 9))
+      throw new Error("--reconfirmはStep 1〜9にだけ指定できます");
+    if (reconfirm) entry = { ...entry, reconfirmation: true };
     const repositoryRoot = path.resolve(staging, "../../../..");
     const needsHeadSha =
       step.step === 9 ||
diff --git a/src/domain/workflow.ts b/src/domain/workflow.ts
index c1aee5cd..08cb30fa 100644
--- a/src/domain/workflow.ts
+++ b/src/domain/workflow.ts
@@ -317,6 +317,14 @@ export interface StepJournalEntry {
    * 封印していたのは記録側だけであり、性質そのものではなかった（Issue #1194）。
    */
   postTerminalIntake?: true;
+  /**
+   * 上流再確定entryであることを示す（TERM-ASC-108、Issue #1342）。**Step 1〜9にだけ許す。**
+   *
+   * 後続Stepを記録した後に上流Stepを再実施した事実を、順序判定から外して追記する。
+   * 同じStepの通常entryが先行していることを要し、先行entryの無い後付けは受理しない。
+   * Step 10はreview session binding、Step 11はdelivery終端が所有するため対象外。
+   */
+  reconfirmation?: true;
 }
 
 export interface ModeDecision {
@@ -342,6 +350,7 @@ const JOURNAL_FIELDS = new Set([
   "reviewSession",
   "humanOverride",
   "postTerminalIntake",
+  "reconfirmation",
 ]);
 const POC_OBSERVATION_BINDING_FIELDS = new Set(["headSha", "evidenceDigest"]);
 const REVIEW_SESSION_BINDING_FIELDS = new Set([
@@ -566,6 +575,14 @@ function parseJournalEntry(
       errors.push(`${label}のpostTerminalIntakeはStep 10にだけ指定できます`);
     else postTerminalIntake = true;
   }
+  let reconfirmation: true | undefined;
+  if (value.reconfirmation !== undefined) {
+    if (value.reconfirmation !== true)
+      errors.push(`${label}のreconfirmationはtrueだけを受理します`);
+    else if (Number(value.step) < 1 || Number(value.step) > 9)
+      errors.push(`${label}のreconfirmationはStep 1〜9にだけ指定できます`);
+    else reconfirmation = true;
+  }
   if (errors.length > 0) return { errors };
   return {
     entry: {
@@ -580,6 +597,7 @@ function parseJournalEntry(
       ...(reviewSession ? { reviewSession } : {}),
       ...(parsedOverride.value ? { humanOverride: parsedOverride.value } : {}),
       ...(postTerminalIntake ? { postTerminalIntake } : {}),
+      ...(reconfirmation ? { reconfirmation } : {}),
     },
     errors,
   };
@@ -667,10 +685,39 @@ export function validateStepJournal(input: {
    * 後に現れる。順序判定へ入れるとStep 11がout-of-orderになる。**外すのは順序の
    * 判定だけであり、記録は残る**（Issue #1194）。
    */
+  /**
+   * **上流再確定entryも順序判定から外す**（Issue #1342）。外すのは順序の判定だけで、
+   * 記録は残る。flagだけで過去Stepを後付けする抜け道にしないため、同じStepの
+   * 通常entryが先行していることを別途要求する。
+   */
   input.entries.forEach((entry, index) => {
-    if (entry.postTerminalIntake) return;
+    if (entry.postTerminalIntake || entry.reconfirmation) return;
     lastByStep.set(entry.step, { entry, index });
   });
+  input.entries.forEach((entry, index) => {
+    if (!entry.reconfirmation) return;
+    /**
+     * **先行entryはそのStepを実際に実施した記録でなければならない。**
+     *
+     * `humanOverride`は欠落を人間が明示承認した記録であって、Stepの実施ではない
+     * （順序判定でも`continue`で除外している）。これを先行entryに数えると、
+     * **一度も実施していないStepを「再確定」できてしまう**（Issue #1342のREV-05）。
+     * `reconfirmation`と`postTerminalIntake`を除くのも同じ理由による。
+     */
+    const preceded = input.entries
+      .slice(0, index)
+      .some(
+        (candidate) =>
+          candidate.step === entry.step &&
+          !candidate.reconfirmation &&
+          !candidate.postTerminalIntake &&
+          !candidate.humanOverride,
+      );
+    if (!preceded)
+      errors.push(
+        `Step ${entry.step}の上流再確定entryに先行する通常entryがありません`,
+      );
+  });
   const terminalIndex = input.entries.findIndex((entry) => entry.step === 11);
   input.entries.forEach((entry, index) => {
     if (!entry.postTerminalIntake) return;
@@ -679,6 +726,22 @@ export function validateStepJournal(input: {
         "post-terminal intakeのStep 10記録はStep 11より後に置いてください",
       );
   });
+  /**
+   * **上流再確定entryはStep 11より後に置けない**（Issue #1342）。
+   *
+   * 順序判定から外すことと、どこへでも置けることは別である。書込み経路の
+   * `appendStepJournal`はStep 11記録後の追記をpost-terminal intakeのStep 10だけに
+   * 限っているが、保存済みjournalを読む側に同じ条件が無いと、**手編集した
+   * journalがStep 11後の再確定entryを載せたまま`workflow verify`を通る。**
+   * 書込み側と読取り側で受理集合が食い違う状態を残さない。
+   */
+  input.entries.forEach((entry, index) => {
+    if (!entry.reconfirmation) return;
+    if (terminalIndex >= 0 && index > terminalIndex)
+      errors.push(
+        "上流再確定entryはStep 11より後に置けません。Step 11記録後に置けるのはpost-terminal intakeのStep 10だけです",
+      );
+  });
   const maximum = errors.length === 0 ? input.upToStep : 11;
   const missingSteps = expected.filter(
     (step) => step <= maximum && !lastByStep.has(step),
diff --git a/test/features/unit/workflow-reconfirmation.feature b/test/features/unit/workflow-reconfirmation.feature
new file mode 100644
index 00000000..a5982529
--- /dev/null
+++ b/test/features/unit/workflow-reconfirmation.feature
@@ -0,0 +1,40 @@
+@unit
+Feature: 上流再確定entryは順序判定から外れ通常entryと区別できる
+
+  Scenario: SCN-UNIT-RECONFIRM-001 Step 8記録後にStep 3を再確定記録できる
+    Given Step 0から8まで記録したfull stagingがある
+    When Step 3を--reconfirm付きで記録する
+    Then 記録は受理されworkflow verifyのoutOfOrderは空である
+
+  Scenario: SCN-UNIT-RECONFIRM-002 再確定entryはreconfirmationで区別できる
+    Given Step 0から8まで記録したfull stagingがある
+    When Step 3を--reconfirm付きで記録する
+    Then 追記entryはreconfirmation trueを持ちjournal行で通常entryと区別できる
+
+  Scenario: SCN-UNIT-RECONFIRM-003 flag無しの後付けは従来どおり拒否する
+    Given Step 0から8まで記録したfull stagingがある
+    When Step 3を--reconfirmなしで記録する
+    Then 記録はoutOfOrderで拒否されjournalは変わらない
+
+  Scenario: SCN-UNIT-RECONFIRM-004 先行entryの無いStepとStep 10は再確定できない
+    Given Step 0から4まで記録したfull stagingがある
+    When Step 5とStep 10を--reconfirm付きで記録する
+    Then 両方とも理由を名指しして拒否されjournalは変わらない
+
+  Scenario: SCN-UNIT-RECONFIRM-005 journal本文のreconfirmationはtrueかつStep 1〜9だけを受理する
+    Given reconfirmationにtrue以外の値とStep 10を持つjournal行がある
+    When journalを構造検査する
+    Then 両方の行が理由を名指しして拒否される
+
+  Scenario: SCN-UNIT-RECONFIRM-006 Step 11より後に置かれた再確定entryを読取り側も拒否する
+    Given Step 0から11まで記録したjournalの末尾にStep 3の再確定entryがある
+    When journalの順序を検査する
+    Then Step 11より後に置けないことを名指しして拒否される
+    And 同じ再確定entryをStep 11の前へ置いた場合は受理される
+
+  Scenario: SCN-UNIT-RECONFIRM-007 humanOverride entryは先行する通常entryに数えない
+    Given humanOverrideだけで記録したStepへ再確定entryを置いたjournalをStep 3とStep 7の2通り用意する
+    When それぞれのjournalの順序を検査する
+    Then どちらもそのStep番号を名指しして先行する通常entryが無いと拒否される
+    And 同じStepの通常entryを先に置いた場合はどちらも受理される
+
diff --git a/test/steps/workflow-reconfirmation.steps.ts b/test/steps/workflow-reconfirmation.steps.ts
new file mode 100644
index 00000000..ebc9efae
--- /dev/null
+++ b/test/steps/workflow-reconfirmation.steps.ts
@@ -0,0 +1,399 @@
+import assert from "node:assert/strict";
+import fs from "node:fs";
+import path from "node:path";
+import { WorkflowWorld, stepDefinitions } from "../support/world.js";
+import { main } from "../../src/cli.js";
+import { createIssueStaging } from "../../src/domain/issue.js";
+import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
+import {
+  WORKFLOW_STEPS,
+  validateStepJournal,
+  type StepJournalEntry,
+  parseStepJournal,
+  STEP_JOURNAL_FILE,
+} from "../../src/domain/workflow.js";
+
+interface ReconfirmationWorld extends WorkflowWorld {
+  staging: string;
+  journalLines: string[];
+  terminalEntries: StepJournalEntry[];
+  terminalResult: ReturnType<typeof validateStepJournal>;
+  overrideJournals: Array<{ target: number; entries: StepJournalEntry[] }>;
+  overrideResults: Array<{
+    target: number;
+    result: ReturnType<typeof validateStepJournal>;
+  }>;
+  parseErrors: string[];
+  journalBefore: string;
+  results: Array<{ label: string; status: number; stdout: string }>;
+}
+
+const { Given, When, Then } = stepDefinitions<ReconfirmationWorld>();
+const SYNC_DIGEST = "1".repeat(64);
+
+function answers(): Record<string, ModeAnswer> {
+  return Object.fromEntries(
+    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の確認根拠` }]),
+  );
+}
+
+async function run(
+  args: string[],
+): Promise<{ status: number; stdout: string }> {
+  const originalWrite = process.stdout.write.bind(process.stdout);
+  let stdout = "";
+  process.stdout.write = ((chunk: string | Uint8Array) => {
+    stdout += String(chunk);
+    return true;
+  }) as typeof process.stdout.write;
+  try {
+    const status = await main(args);
+    return { status, stdout };
+  } catch (error) {
+    return { status: 1, stdout: error instanceof Error ? error.message : "" };
+  } finally {
+    process.stdout.write = originalWrite;
+  }
+}
+
+async function record(
+  staging: string,
+  step: number,
+  extra: string[] = [],
+): Promise<{ status: number; stdout: string }> {
+  const evidence =
+    step === 4 || step === 8
+      ? `sync digest ${SYNC_DIGEST}`
+      : `Step ${step}の証跡`;
+  return run([
+    "workflow",
+    "record",
+    `--staging=${staging}`,
+    `--step=${step}`,
+    "--artifact=00_要求定義.md",
+    `--evidence=${evidence}`,
+    ...extra,
+  ]);
+}
+
+function journalOf(staging: string): string {
+  return fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8");
+}
+
+async function stagingRecordedUpTo(
+  world: ReconfirmationWorld,
+  upTo: number,
+): Promise<string> {
+  const root = world.temp("asc-reconfirm-");
+  fs.mkdirSync(path.join(root, ".agent-skill-chain", "tmp", "issues"), {
+    recursive: true,
+  });
+  const staging = createIssueStaging(root, {
+    title: "reconfirm-test",
+    answers: answers(),
+    now: new Date("2026-09-12T00:00:00Z"),
+    requestedMode: "full",
+  }).path;
+  for (let step = 1; step <= upTo; step += 1) {
+    const result = await record(staging, step);
+    assert.equal(result.status, 0, `Step ${step}: ${result.stdout}`);
+  }
+  world.journalBefore = journalOf(staging);
+  return staging;
+}
+
+Given("Step 0から8まで記録したfull stagingがある", async function () {
+  this.staging = await stagingRecordedUpTo(this, 8);
+});
+
+Given("Step 0から4まで記録したfull stagingがある", async function () {
+  this.staging = await stagingRecordedUpTo(this, 4);
+});
+
+When("Step 3を--reconfirm付きで記録する", async function () {
+  this.results = [
+    {
+      label: "step3",
+      ...(await record(this.staging, 3, [
+        "--reconfirm",
+        "--recorded-at=2026-09-12T01:00:00.000Z",
+      ])),
+    },
+  ];
+});
+
+When("Step 3を--reconfirmなしで記録する", async function () {
+  this.results = [{ label: "step3", ...(await record(this.staging, 3)) }];
+});
+
+When("Step 5とStep 10を--reconfirm付きで記録する", async function () {
+  this.results = [
+    { label: "step5", ...(await record(this.staging, 5, ["--reconfirm"])) },
+    {
+      label: "step10",
+      ...(await record(this.staging, 10, [
+        "--reconfirm",
+        `--review-session-digest=${SYNC_DIGEST}`,
+      ])),
+    },
+  ];
+});
+
+Then("記録は受理されworkflow verifyのoutOfOrderは空である", async function () {
+  const [recorded] = this.results;
+  assert.equal(recorded?.status, 0, recorded?.stdout);
+  const verify = await run([
+    "workflow",
+    "verify",
+    `--staging=${this.staging}`,
+    "--up-to=8",
+  ]);
+  assert.equal(verify.status, 0, verify.stdout);
+  const output = JSON.parse(verify.stdout) as {
+    valid: boolean;
+    completedSteps: number[];
+  };
+  assert.equal(output.valid, true);
+  assert.deepEqual(output.completedSteps, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
+  assert.doesNotMatch(verify.stdout, /outOfOrder/u);
+});
+
+Then(
+  "追記entryはreconfirmation trueを持ちjournal行で通常entryと区別できる",
+  function () {
+    const [recorded] = this.results;
+    assert.equal(recorded?.status, 0, recorded?.stdout);
+    const output = JSON.parse(recorded?.stdout ?? "") as {
+      entry: Record<string, unknown>;
+    };
+    assert.equal(output.entry.step, 3);
+    assert.equal(output.entry.reconfirmation, true);
+    const entries = parseStepJournal(journalOf(this.staging)).entries;
+    const third = entries.filter((entry) => entry.step === 3);
+    assert.equal(third.length, 2);
+    assert.equal(third[0]?.reconfirmation, undefined);
+    assert.equal(third[1]?.reconfirmation, true);
+    assert.equal(entries.filter((entry) => entry.reconfirmation).length, 1);
+  },
+);
+
+Then("記録はoutOfOrderで拒否されjournalは変わらない", function () {
+  const [recorded] = this.results;
+  assert.equal(recorded?.status, 1);
+  assert.match(recorded?.stdout ?? "", /outOfOrder=(?:[0-9]+,)*8/u);
+  assert.equal(journalOf(this.staging), this.journalBefore);
+});
+
+Then("両方とも理由を名指しして拒否されjournalは変わらない", function () {
+  const step5 = this.results.find((item) => item.label === "step5");
+  assert.equal(step5?.status, 1);
+  assert.match(
+    step5?.stdout ?? "",
+    /Step 5の上流再確定entryに先行する通常entryがありません/u,
+  );
+  const step10 = this.results.find((item) => item.label === "step10");
+  assert.equal(step10?.status, 1);
+  assert.match(
+    step10?.stdout ?? "",
+    /--reconfirmはStep 1〜9にだけ指定できます/u,
+  );
+  assert.equal(journalOf(this.staging), this.journalBefore);
+});
+
+function journalLine(step: number, extra: Record<string, unknown>): string {
+  return JSON.stringify({
+    step,
+    skillId: `step-${String(step).padStart(2, "0")}-x`,
+    mode: "full",
+    recordedAt: "2026-09-12T00:00:00.000Z",
+    artifacts: ["00_要求定義.md"],
+    evidence: `Step ${step}の証跡`,
+    ...extra,
+  });
+}
+
+Given(
+  "reconfirmationにtrue以外の値とStep 10を持つjournal行がある",
+  function () {
+    this.journalLines = [
+      journalLine(3, { reconfirmation: "yes" }),
+      journalLine(10, {
+        reconfirmation: true,
+        reviewSession: {
+          sessionId: "a".repeat(64),
+          roundDigest: "b".repeat(64),
+          headSha: "c".repeat(40),
+        },
+      }),
+    ];
+  },
+);
+
+When("journalを構造検査する", function () {
+  this.parseErrors = parseStepJournal(
+    `${this.journalLines.join("\n")}\n`,
+  ).errors;
+});
+
+Then("両方の行が理由を名指しして拒否される", function () {
+  assert.ok(
+    this.parseErrors.some((error) =>
+      error.includes("reconfirmationはtrueだけを受理します"),
+    ),
+    this.parseErrors.join("; "),
+  );
+  assert.ok(
+    this.parseErrors.some((error) =>
+      error.includes("reconfirmationはStep 1〜9にだけ指定できます"),
+    ),
+    this.parseErrors.join("; "),
+  );
+});
+
+/**
+ * **順序判定から外すことと、どこへでも置けることは別である。**
+ *
+ * 書込み経路の`appendStepJournal`はStep 11記録後の追記をpost-terminal intakeの
+ * Step 10だけに限る。読取り側の`validateStepJournal`に同じ条件が無いと、手編集した
+ * journalがStep 11後の再確定entryを載せたまま検証を通る（独立review round 2のREV-02）。
+ */
+function entryOf(
+  step: number,
+  extra: Partial<StepJournalEntry> = {},
+): StepJournalEntry {
+  const skillId = WORKFLOW_STEPS.find((item) => item.step === step)?.skillId;
+  assert.ok(skillId, `Step ${step}のskillIdが見つかりません`);
+  return {
+    step,
+    skillId,
+    mode: "full",
+    recordedAt: "2026-09-12T00:00:00.000Z",
+    artifacts: ["00_要求定義.md"],
+    evidence: `Step ${step}の証跡`,
+    ...(step === 9 ? { implementationHeadSha: "d".repeat(40) } : {}),
+    ...(step === 10
+      ? {
+          reviewSession: {
+            sessionId: "a".repeat(64),
+            roundDigest: "b".repeat(64),
+            headSha: "c".repeat(40),
+          },
+        }
+      : {}),
+    ...extra,
+  } as StepJournalEntry;
+}
+
+Given(
+  "Step 0から11まで記録したjournalの末尾にStep 3の再確定entryがある",
+  function () {
+    this.terminalEntries = [
+      ...Array.from({ length: 12 }, (_unused, step) => entryOf(step)),
+      entryOf(3, { reconfirmation: true }),
+    ];
+  },
+);
+
+When("journalの順序を検査する", function () {
+  this.terminalResult = validateStepJournal({
+    mode: "full",
+    entries: this.terminalEntries,
+    upToStep: 11,
+  });
+});
+
+Then("Step 11より後に置けないことを名指しして拒否される", function () {
+  assert.equal(this.terminalResult.valid, false);
+  assert.ok(
+    this.terminalResult.errors.includes(
+      "上流再確定entryはStep 11より後に置けません。Step 11記録後に置けるのはpost-terminal intakeのStep 10だけです",
+    ),
+    this.terminalResult.errors.join("; "),
+  );
+});
+
+Then("同じ再確定entryをStep 11の前へ置いた場合は受理される", function () {
+  const entries = [
+    ...Array.from({ length: 11 }, (_unused, step) => entryOf(step)),
+    entryOf(3, { reconfirmation: true }),
+    entryOf(11),
+  ];
+  const result = validateStepJournal({ mode: "full", entries, upToStep: 11 });
+  assert.equal(result.valid, true, result.errors.join("; "));
+});
+
+/**
+ * **`humanOverride`はStepの実施ではなく、欠落を人間が明示承認した記録である。**
+ * 先行entryに数えると、一度も実施していないStepを再確定できてしまう（REV-05）。
+ */
+const OVERRIDE: NonNullable<StepJournalEntry["humanOverride"]> = {
+  issue: 1342,
+  scope: "workflow.pr.create",
+  instructedBy: "repository owner",
+  instructedAt: "2026-09-12T00:00:00.000Z",
+  expiresAt: "2026-09-13T00:00:00.000Z",
+  reason: "欠落を明示承認した記録であってStepの実施ではない",
+};
+
+/**
+ * **2つのStepで検査する。** 1 Stepだけを見ると、除外条件を特定のStep番号へ
+ * 狭める変異が生き残る（Issue #1342の変異R）。
+ */
+const OVERRIDE_STEPS = [3, 7] as const;
+
+Given(
+  "humanOverrideだけで記録したStepへ再確定entryを置いたjournalをStep 3とStep 7の2通り用意する",
+  function () {
+    this.overrideJournals = OVERRIDE_STEPS.map((target) => ({
+      target,
+      entries: [
+        ...Array.from({ length: target }, (_unused, step) => entryOf(step)),
+        entryOf(target, { humanOverride: OVERRIDE }),
+        entryOf(target, { reconfirmation: true }),
+      ],
+    }));
+  },
+);
+
+When("それぞれのjournalの順序を検査する", function () {
+  this.overrideResults = this.overrideJournals.map(({ target, entries }) => ({
+    target,
+    result: validateStepJournal({ mode: "full", entries, upToStep: target }),
+  }));
+});
+
+Then(
+  "どちらもそのStep番号を名指しして先行する通常entryが無いと拒否される",
+  function () {
+    assert.equal(this.overrideResults.length, OVERRIDE_STEPS.length);
+    for (const { target, result } of this.overrideResults) {
+      assert.equal(result.valid, false, `Step ${target}が拒否されていない`);
+      assert.ok(
+        result.errors.includes(
+          `Step ${target}の上流再確定entryに先行する通常entryがありません`,
+        ),
+        `Step ${target}: ${result.errors.join("; ")}`,
+      );
+    }
+  },
+);
+
+Then("同じStepの通常entryを先に置いた場合はどちらも受理される", function () {
+  for (const target of OVERRIDE_STEPS) {
+    const entries = [
+      ...Array.from({ length: target + 1 }, (_unused, step) => entryOf(step)),
+      entryOf(target, { humanOverride: OVERRIDE }),
+      entryOf(target, { reconfirmation: true }),
+    ];
+    const result = validateStepJournal({
+      mode: "full",
+      entries,
+      upToStep: target,
+    });
+    assert.equal(
+      result.valid,
+      true,
+      `Step ${target}: ${result.errors.join("; ")}`,
+    );
+  }
+});
```
