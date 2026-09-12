# 独立review依頼（Issue #1341、round 1（先行する助言reviewの指摘2件を是正済み）、exact HEAD 70aa35622e4276e5a559885580e98e924693ed69）

あなたはimplementerとは別contextの独立reviewerである。対象差分を変更せず、read-onlyで肯定・敵対の両観点をreviewする。指摘を無理に作らない。Medium/Lowはblockingにしない。

## 対象Issue（要約）
`observeProvider`（`src/adapters/provider.ts`）は観測に失敗したとき`entrypoint`がprovider名だけ、`reason`が理由だけで、実行したargvも終了値も出力に無かった。`claude`は`claude models list --json`が`--json`未対応で終了値1になるため必ず`unknown`になるが、利用者は原因を配布物の`dist`を読まないと特定できなかった。是正: `unknownObservation`へ実行argvと終了値を渡し、`entrypoint`を実argv、`reason`へ終了値を添える。仕様06へ「Codex以外に公式catalog入口は定義されておらず`claude`の観測は必ずunknownになる」ことを明示契約として書く。

## 受け入れ条件と不変条件（anchor）
- AC-01: 非0終了で失敗する実行入口を観測すると、`entrypoint`が`<provider> models list --json`、`reason`が終了値を含む（SCN-UNIT-OBSDIAG-001）
- AC-02: 起動できない実行入口を観測すると、`entrypoint`が実行しようとしたargv、`reason`が起動失敗を示す（SCN-UNIT-OBSDIAG-002）
- AC-03: 失敗診断に`stderr`の本文が含まれない（SCN-UNIT-OBSDIAG-003）
- AC-04: `codex`経路の観測結果が変わらない（既存SCN-UNIT-ROUTING-009、SCN-E2E-AM-001）
- INV-01: 観測失敗時の`entrypoint`は、製品が実際に実行したargvを表す
- INV-02: `unknown`の`reason`は終了値（起動できなかった場合はその事実）を含む
- INV-03: `stderr`本文と入力本文を診断へ転記しない

## 明示した対象外（00 §2.2。これらを「足すべき」とする指摘はout-of-scopeとして扱う）
- `state: "unobservable"`の新設。`resolveRouting`は`state !== "available"`で分岐するため状態を分けても採る行動が変わらない
- provider名のenum化とcapability-mappingとのcross-file一致検査
- `resolveRouting`のfallback条件の変更
- provider名を実行fileとして起動する設計の置き換え（adapter registry）
- `stderr`本文の転記

## 先行する助言review（Step 9中、HEAD `1fb0bc23`）の指摘と是正

Step 10の正式reviewの前に同じ形式で1回reviewを回し、2件の指摘を受けて是正した。**これらが正しく解けているかを最優先で見ること。**

- **REV-01（High、AC-02違反）**: 既定executorは`run(..., { allowFailure: true })`を通り、`src/lib/process.ts`がspawn error（ENOENT等）を`status: 1`へ写す。そのため`observeProvider`のcatch枝は既定executorでは到達せず、実在しない実行fileが「read-only観測が失敗しました（終了値1）」と報告されていた。**AC-02の本番経路が成立していなかった。** 是正: `ProcessResult`へoptionalな`launchFailure`を足し、`run`が`result.error`を観測したときだけ立てる。`observeProvider`はこれを`status`より先に判定する。**既定executorを注入しない**SCN-UNIT-OBSDIAG-004を追加
- **REV-02（Medium、INV-01違反）**: `ProviderExecutor`へ`args`配列そのものを渡し同じ参照を診断へ再利用していたため、executorが`splice`すると`entrypoint`が偽の値になった。是正: 複写`[...args]`を渡す。SCN-UNIT-OBSDIAG-005を追加
- **付随（DISC-1341-03）**: `src/lib/process.ts`はIssue #1024の故障注入証跡3件がfile全体SHA-256で束縛しているため`SCN-INT-CONSUMER-005`が落ちた。束縛値を更新し、**追加2箇所を除いた残余byte列が旧束縛commitのfileと完全一致し、残余SHA-256が旧束縛値`1387caca…`そのものになる**ことを実測して3 fileへ記録した。この不変性主張が妥当かも見ること

## 特に見てほしい点
1. **成功経路を変えていないこと。** codexの`entrypoint`は論理入口名`codex app-server model/list`のまま維持した。これが00 §2.3「codex経路の観測結果は不変」と整合するか。逆に、失敗診断だけ実argv（`codex app-server --stdio -c ...`）になる非対称が利用者を誤らせないか
2. **argvに秘密が混ざらないこと。** `CODEX_SELECTION_CONFIG`は固定literalだが、失敗診断へ載る経路が増えている
3. **終了値の表現。** `（終了値N）`をreasonへ後置する形が、既存の診断書式・仕様06の記述と矛盾しないか
4. 仕様5 file（要件一覧、ワークフロー要件、外部インターフェース、追跡表、変更履歴）の記述が実装と一致するか。新規SCNが要件行から到達できるか

## implementer申告（信用せず再実行してよい。dist build済み）
- `SCN-UNIT-OBSDIAG-001〜003` 3 scenario合格、既存`SCN-UNIT-ROUTING-009`・`SCN-UNIT-ROUTING-012`合格
- `npm run conformance:check` 87 scenarios全pass
- 変異試験8件すべてkilled（生存0）。復旧後も合格:

| 変異 | 内容 | 対象scenario | 結果 |
|---|---|---|---|
| A | 削除: 非0終了経路の attempt を落とす | SCN-UNIT-OBSDIAG-001 | killed |
| B | 削除: 起動失敗経路の attempt を落とす | SCN-UNIT-OBSDIAG-002 | killed |
| C | 狭める: argv 連結を先頭1要素だけにする | SCN-UNIT-OBSDIAG-001 | killed |
| D | 値の空洞化: 終了値を定数1へ固定する | SCN-UNIT-OBSDIAG-001 | killed |
| E | 消したものへの変異: 成功経路の entrypoint を実 argv へ変える | SCN-UNIT-ROUTING-009 | killed |
| F | 狭める: 非 codex の argv から --json を落とす | SCN-UNIT-OBSDIAG-001 | killed |
| G | 安全条件の破壊: stderr 本文を reason へ転記する | SCN-UNIT-OBSDIAG-003 | killed |
| H | 狭める: 終了値を載せる条件を反転させる | SCN-UNIT-OBSDIAG-001 | killed |

- 変異は11件へ拡張し全kill（I: `launchFailure`判定枝の削除、J: 複写を外す、K: 起動失敗判定を到達不能へ狭める、を追加）
- `npm test` 1,882 scenarios を `90114714` で実測。1 failedはSCN-INT-CONSUMER-005の束縛hashのみで、`70aa3562`の証跡更新後にSCN-INT-CONSUMER 15 scenario合格を確認。全体の再実行は進行中
- **訂正**: Step 9 journalのevidence本文に誤った短縮SHA `70aa35628f0a` を書いた。正しくは `70aa35622e42` であり、同entryの`implementationHeadSha`は正しい
- read-only sandboxでtestを実行できない場合は、実行できなかった事実を書き、合格したと書かない
- 単独実行: `node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-UNIT-OBSDIAG'`

## 評価観点
肯定: 正しさ、価値、実現可能性、整合性、保守性。
敵対: 反例、失敗経路、境界値、悪用、安全性、データ損失、ロールバック、範囲漏れ。**変異試験が全killでも、assertionが名指ししていない性質を壊す変異を自分で構成して試すこと。**

## 出力形式（厳守）
1. `## 肯定的評価` と `## 敵対的評価` の表（観点 | 判定 pass/finding/not-applicable | 根拠）
2. `## findings` にJSON配列だけ。schema: `{"id":"REV-01","severity":"Critical|High|Medium|Low","status":"valid","source":"review","relation":"acceptance-violation|invariant-violation|fix-regression|improvement|out-of-scope","evidence":"file:line と反例","path":"src/...","contractId":"AC-0N または INV-0N","causedByFindingId":null}`。指摘なしなら `[]`
3. `## 判定` approved / rejected

## 対象差分（`origin/main`＝8e7405b9 → 70aa3562、`dist/`除く）

```diff
diff --git a/.agent-skill-chain/schemas/review-progress-record.schema.json b/.agent-skill-chain/schemas/review-progress-record.schema.json
deleted file mode 100644
index e3399a10..00000000
--- a/.agent-skill-chain/schemas/review-progress-record.schema.json
+++ /dev/null
@@ -1,72 +0,0 @@
-{
-  "$schema": "https://json-schema.org/draft/2020-12/schema",
-  "$id": "https://example.invalid/agent-skill-chain/review-progress-record.schema.json",
-  "title": "Parallel progress evidence record",
-  "oneOf": [
-    {
-      "type": "object",
-      "additionalProperties": false,
-      "required": [
-        "schemaVersion",
-        "sequence",
-        "entryId",
-        "sessionId",
-        "implementationHeadSha",
-        "taskId",
-        "state",
-        "recordedAt",
-        "previousDigest",
-        "entryDigest"
-      ],
-      "properties": {
-        "schemaVersion": {
-          "const": "agent-skill-chain/review-progress-entry/v1"
-        },
-        "sequence": { "type": "integer", "minimum": 1, "maximum": 256 },
-        "entryId": { "$ref": "#/$defs/sha256" },
-        "sessionId": { "$ref": "#/$defs/sha256" },
-        "implementationHeadSha": { "$ref": "#/$defs/gitOid" },
-        "taskId": { "type": "string", "pattern": "^[A-Z][A-Z0-9._-]{1,63}$" },
-        "state": {
-          "enum": ["planned", "started", "completed", "blocked"]
-        },
-        "recordedAt": { "type": "string", "format": "date-time" },
-        "previousDigest": {
-          "oneOf": [{ "$ref": "#/$defs/sha256" }, { "type": "null" }]
-        },
-        "entryDigest": { "$ref": "#/$defs/sha256" }
-      }
-    },
-    {
-      "type": "object",
-      "additionalProperties": false,
-      "required": [
-        "schemaVersion",
-        "sessionId",
-        "implementationHeadSha",
-        "previousDigest",
-        "sealedAt",
-        "sealDigest"
-      ],
-      "properties": {
-        "schemaVersion": {
-          "const": "agent-skill-chain/review-progress-seal/v1"
-        },
-        "sessionId": { "$ref": "#/$defs/sha256" },
-        "implementationHeadSha": { "$ref": "#/$defs/gitOid" },
-        "previousDigest": {
-          "oneOf": [{ "$ref": "#/$defs/sha256" }, { "type": "null" }]
-        },
-        "sealedAt": { "type": "string", "format": "date-time" },
-        "sealDigest": { "$ref": "#/$defs/sha256" }
-      }
-    }
-  ],
-  "$defs": {
-    "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
-    "gitOid": {
-      "type": "string",
-      "pattern": "^(?:[a-f0-9]{40}|[a-f0-9]{64})$"
-    }
-  }
-}
diff --git "a/.agent-skill-chain/templates/issue/03_\345\256\237\350\243\205\350\250\210\347\224\273.md" "b/.agent-skill-chain/templates/issue/03_\345\256\237\350\243\205\350\250\210\347\224\273.md"
index 5914bfe6..f979cb99 100644
--- "a/.agent-skill-chain/templates/issue/03_\345\256\237\350\243\205\350\250\210\347\224\273.md"
+++ "b/.agent-skill-chain/templates/issue/03_\345\256\237\350\243\205\350\250\210\347\224\273.md"
@@ -178,11 +178,9 @@ Bug Fixは可能なら`再現 → failing regression test → 修正 → regress
 
 ## 10. 進捗
 
-<!-- asc:parallel-progress:start -->
 | タスク | 状態 | コミット | テスト結果 | 仕様 | 備考 |
 |---|---|---|---|---|---|
 | T01 | 未着手 / 進行中 / 完了 | （SHA） | （結果） | （更新先） | （内容） |
-<!-- asc:parallel-progress:end -->
 
 ## 11. 実装中の発見と対処
 
diff --git a/docs/evidence/1024-consumer-acceptance/mechanism-1-git-dependency.md b/docs/evidence/1024-consumer-acceptance/mechanism-1-git-dependency.md
index 90043229..b678540d 100644
--- a/docs/evidence/1024-consumer-acceptance/mechanism-1-git-dependency.md
+++ b/docs/evidence/1024-consumer-acceptance/mechanism-1-git-dependency.md
@@ -5,7 +5,7 @@
 | path | SHA-256 |
 |---|---|
 | `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
-| `src/lib/process.ts` | `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2` |
+| `src/lib/process.ts` | `99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614` |
 
 この2件を記録するのは、consumer acceptanceの判定とprocess出力上限という、この証跡が主張する振る舞いの実体だからである。**`scripts/check_package_contents.ts`は含めない。** 同fileは`checkConsumerAcceptance`を`mechanisms: ["packed-bin", "scale-output"]`で呼んでおり、**この機構は接続経路に存在しない**（Issue #1221）。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。
 
@@ -98,3 +98,14 @@ PR #1263の補正で`JsonlSessionOptions`と`runJsonlSession`だけを変更し
 2026-09-07、旧束縛`06013f66a9aaf57b2cb9efc261b812730beccfd65366431b4b71faf0d35caf85`に一致するcommit `2931acc5acf4164b25c5e59f2ef431ec081eff9f`の`src/lib/process.ts`と修正後sourceを実読した。変更は`runJsonlSession`のstdin errorを既存の失敗処理へ接続する部分だけである。前節と同じTypeScript ASTの2宣言除外手順で残余の元byte列を比較し、完全一致とSHA-256 `fa1b2ec07ff06c7ab0f89d854c9231d2dfbdf4c178e540a89717f9ac1582748d`を再計測した。同期`run`・`git`、定数、import、module初期化は未変更であり、consumerの接続先は同期`run`と型だけである。`check_consumer_acceptance.ts`の全体SHA-256 `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc`も未変更だった。
 
 上表は修正後file全体のSHA-256 `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`へ再拘束する。これは非同期session変更から独立した同期consumer経路のbyte同一性による再拘束であり、既存の#1024時点の実npm・pnpm故障注入を再実行したという主張ではない。旧注入結果、artifact、distribution digest、束縛集合、検証器、SHA節からartifact節への解析境界を保持する。統合後sourceのconsumer全31 scenarioは別途coordinatorが検証し、その結果をIssue #1265のレビュー証拠へ記録する。
+
+## 2026-09-12 `src/lib/process.ts`の束縛更新（Issue #1341）
+
+Issue #1341が`ProcessResult`へoptionalな`launchFailure`を追加し、`run`が`result.error`を観測したときだけ立てるようにしたため、対象製品fileの全体SHA-256を`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`から`99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614`へ更新した。
+
+**主張する振る舞いは変わっていない。** 追加は次の2箇所だけである。
+
+1. `ProcessResult`interfaceへ`launchFailure?: true`とそのTSDoc
+2. `run`の戻り値objectへ`...(failure === undefined ? {} : { launchFailure: true as const }),`の1行
+
+現在fileからこの2箇所を除いた残余byte列は、旧束縛`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`に一致するcommit（`origin/main` = `8e7405b9`）の`src/lib/process.ts`と**完全一致**し、その残余のSHA-256は`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`だった。`maxBuffer`既定、`MAX_PROCESS_OUTPUT_BYTES`、`failure`の算出、`status`・`stdout`・`stderr`の写像、`allowFailure`のthrow条件、import、module初期化はこの一致範囲に含まれる。**この証跡が主張するprocess出力上限の振る舞いは1 byteも変わっていない。** 追加fieldは既に算出済みの`failure`から導く旗であり、既存の呼び出しはこのoptional fieldを読まない。
diff --git a/docs/evidence/1024-consumer-acceptance/mechanism-2-packed-bin.md b/docs/evidence/1024-consumer-acceptance/mechanism-2-packed-bin.md
index 82f4b11c..b10b3591 100644
--- a/docs/evidence/1024-consumer-acceptance/mechanism-2-packed-bin.md
+++ b/docs/evidence/1024-consumer-acceptance/mechanism-2-packed-bin.md
@@ -6,7 +6,7 @@
 |---|---|
 | `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
 | `scripts/check_package_contents.ts` | `798027a8cfb21f8fe22540919fae0e35d1226634d42bb10b625f115785d553d6` |
-| `src/lib/process.ts` | `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2` |
+| `src/lib/process.ts` | `99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614` |
 
 この3件を記録するのは、consumer acceptanceの判定、package検査への接続、process出力上限という、この証跡が主張する振る舞いの実体だからである。**束縛対象は機構別に宣言する。** 本機構は`scripts/check_package_contents.ts`が`checkConsumerAcceptance`へ渡す`mechanisms`に含まれるため接続経路上にあり、同fileを含める（Issue #1221）。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。
 
@@ -77,3 +77,14 @@ PR #1263の補正で`JsonlSessionOptions`と`runJsonlSession`だけを変更し
 2026-09-07、旧束縛`06013f66a9aaf57b2cb9efc261b812730beccfd65366431b4b71faf0d35caf85`に一致するcommit `2931acc5acf4164b25c5e59f2ef431ec081eff9f`の`src/lib/process.ts`と修正後sourceを実読した。変更は`runJsonlSession`のstdin errorを既存の失敗処理へ接続する部分だけである。前節と同じTypeScript ASTの2宣言除外手順で残余の元byte列を比較し、完全一致とSHA-256 `fa1b2ec07ff06c7ab0f89d854c9231d2dfbdf4c178e540a89717f9ac1582748d`を再計測した。同期`run`・`git`、定数、import、module初期化は未変更であり、consumerの接続先は同期`run`と型だけである。`check_consumer_acceptance.ts`の全体SHA-256 `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc`も未変更だった。
 
 上表は修正後file全体のSHA-256 `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`へ再拘束する。これは非同期session変更から独立した同期consumer経路のbyte同一性による再拘束であり、既存の#1024時点の実npm・pnpm故障注入を再実行したという主張ではない。旧注入結果、artifact、distribution digest、束縛集合、検証器、SHA節からartifact節への解析境界を保持する。統合後sourceのconsumer全31 scenarioは別途coordinatorが検証し、その結果をIssue #1265のレビュー証拠へ記録する。
+
+## 2026-09-12 `src/lib/process.ts`の束縛更新（Issue #1341）
+
+Issue #1341が`ProcessResult`へoptionalな`launchFailure`を追加し、`run`が`result.error`を観測したときだけ立てるようにしたため、対象製品fileの全体SHA-256を`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`から`99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614`へ更新した。
+
+**主張する振る舞いは変わっていない。** 追加は次の2箇所だけである。
+
+1. `ProcessResult`interfaceへ`launchFailure?: true`とそのTSDoc
+2. `run`の戻り値objectへ`...(failure === undefined ? {} : { launchFailure: true as const }),`の1行
+
+現在fileからこの2箇所を除いた残余byte列は、旧束縛`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`に一致するcommit（`origin/main` = `8e7405b9`）の`src/lib/process.ts`と**完全一致**し、その残余のSHA-256は`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`だった。`maxBuffer`既定、`MAX_PROCESS_OUTPUT_BYTES`、`failure`の算出、`status`・`stdout`・`stderr`の写像、`allowFailure`のthrow条件、import、module初期化はこの一致範囲に含まれる。**この証跡が主張するprocess出力上限の振る舞いは1 byteも変わっていない。** 追加fieldは既に算出済みの`failure`から導く旗であり、既存の呼び出しはこのoptional fieldを読まない。
diff --git a/docs/evidence/1024-consumer-acceptance/mechanism-3-scale-output.md b/docs/evidence/1024-consumer-acceptance/mechanism-3-scale-output.md
index 39b82e43..0838131f 100644
--- a/docs/evidence/1024-consumer-acceptance/mechanism-3-scale-output.md
+++ b/docs/evidence/1024-consumer-acceptance/mechanism-3-scale-output.md
@@ -6,7 +6,7 @@
 |---|---|
 | `scripts/check_consumer_acceptance.ts` | `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc` |
 | `scripts/check_package_contents.ts` | `798027a8cfb21f8fe22540919fae0e35d1226634d42bb10b625f115785d553d6` |
-| `src/lib/process.ts` | `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2` |
+| `src/lib/process.ts` | `99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614` |
 
 この3件を記録するのは、consumer acceptanceの判定、package検査への接続、process出力上限という、この証跡が主張する振る舞いの実体だからである。**束縛対象は機構別に宣言する。** 本機構は`scripts/check_package_contents.ts`が`checkConsumerAcceptance`へ渡す`mechanisms`に含まれるため接続経路上にあり、同fileを含める（Issue #1221）。`package.json`はmainの自動releaseでversionが変わり、主張する振る舞いが同じでもhashが変わるため対象に含めない。
 
@@ -75,3 +75,14 @@ PR #1263の補正で`JsonlSessionOptions`と`runJsonlSession`だけを変更し
 2026-09-07、旧束縛`06013f66a9aaf57b2cb9efc261b812730beccfd65366431b4b71faf0d35caf85`に一致するcommit `2931acc5acf4164b25c5e59f2ef431ec081eff9f`の`src/lib/process.ts`と修正後sourceを実読した。変更は`runJsonlSession`のstdin errorを既存の失敗処理へ接続する部分だけである。前節と同じTypeScript ASTの2宣言除外手順で残余の元byte列を比較し、完全一致とSHA-256 `fa1b2ec07ff06c7ab0f89d854c9231d2dfbdf4c178e540a89717f9ac1582748d`を再計測した。同期`run`・`git`、定数、import、module初期化は未変更であり、consumerの接続先は同期`run`と型だけである。`check_consumer_acceptance.ts`の全体SHA-256 `08cbde239552af94f97485a09e3173fb6e72855e7f4cffbc80629122f5bff5fc`も未変更だった。
 
 上表は修正後file全体のSHA-256 `1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`へ再拘束する。これは非同期session変更から独立した同期consumer経路のbyte同一性による再拘束であり、既存の#1024時点の実npm・pnpm故障注入を再実行したという主張ではない。旧注入結果、artifact、distribution digest、束縛集合、検証器、SHA節からartifact節への解析境界を保持する。統合後sourceのconsumer全31 scenarioは別途coordinatorが検証し、その結果をIssue #1265のレビュー証拠へ記録する。
+
+## 2026-09-12 `src/lib/process.ts`の束縛更新（Issue #1341）
+
+Issue #1341が`ProcessResult`へoptionalな`launchFailure`を追加し、`run`が`result.error`を観測したときだけ立てるようにしたため、対象製品fileの全体SHA-256を`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`から`99ee2f31dacc759fd67b16c5737f03a023f6591fc3929ed4214c31fdbffa9614`へ更新した。
+
+**主張する振る舞いは変わっていない。** 追加は次の2箇所だけである。
+
+1. `ProcessResult`interfaceへ`launchFailure?: true`とそのTSDoc
+2. `run`の戻り値objectへ`...(failure === undefined ? {} : { launchFailure: true as const }),`の1行
+
+現在fileからこの2箇所を除いた残余byte列は、旧束縛`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`に一致するcommit（`origin/main` = `8e7405b9`）の`src/lib/process.ts`と**完全一致**し、その残余のSHA-256は`1387cacafc2927d175157fcc7d49654310a236300588fbb197cb337dc989a8e2`だった。`maxBuffer`既定、`MAX_PROCESS_OUTPUT_BYTES`、`failure`の算出、`status`・`stdout`・`stderr`の写像、`allowFailure`のthrow条件、import、module初期化はこの一致範囲に含まれる。**この証跡が主張するprocess出力上限の振る舞いは1 byteも変わっていない。** 追加fieldは既に算出済みの`failure`から導く旗であり、既存の呼び出しはこのoptional fieldを読まない。
diff --git "a/docs/reviews/200_\350\252\262\351\241\2141336review\344\270\246\350\241\214\351\200\262\346\215\227\350\250\274\350\267\241\343\203\254\343\203\223\343\203\245\343\203\274.md" "b/docs/reviews/200_\350\252\262\351\241\2141336review\344\270\246\350\241\214\351\200\262\346\215\227\350\250\274\350\267\241\343\203\254\343\203\223\343\203\245\343\203\274.md"
deleted file mode 100644
index 808587b9..00000000
--- "a/docs/reviews/200_\350\252\262\351\241\2141336review\344\270\246\350\241\214\351\200\262\346\215\227\350\250\274\350\267\241\343\203\254\343\203\223\343\203\245\343\203\274.md"
+++ /dev/null
@@ -1,216 +0,0 @@
-# 04 レビュー
-
-## 0. レビュー識別情報
-
-| 項目 | 内容 |
-|---|---|
-| 対象 | Issue #1336 の実装・test・仕様 |
-| ラウンド | 1 |
-| 対象SHA・文書ダイジェスト | 731642154e7afc5f89e0c2e20f7b7219943cb1c2 |
-| 比較基点 | `8e7405b9ee632ef93e5bccae515e1b4a39f7ac2b` |
-| H_impl | `731642154e7afc5f89e0c2e20f7b7219943cb1c2` |
-| 対象差分 | 34 path、2058追加・9削除 |
-| 対象外 | 比較基点に存在し変更されていない範囲 |
-| 残り予算 | 2ラウンド |
-| ラウンド数 | 1（肯定・敵対reviewを実施し収束） |
-| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260912_073708_Step10-review並行進捗証跡` |
-| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md` REQ-WF-021、`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` |
-| 成果物行数 | 34 path、2058追加・9削除。source 9、生成dist 9、schema 1、template 1、仕様8、test 6 path |
-| 縮小の先行評価 | 任意staging差分のdigest除外は採用せず、閉じた専用journalとread-only projectionだけを追加した。既存review・delivery gateは変更せず依存edge 0を静的検査する |
-| 実施者・日時 | implementer: root session、reviewer: context-isolated review session、2026-09-12T08:53:32+09:00 |
-
-### 0.1 routing入力契約
-
-| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
-|---|---|---|---|---|---|---|
-| reviewer | 肯定・敵対review、finding分類 | advanced | Codex / Claude Code（助言のみ） | provider推奨 / Opus 5 effort high | Critical/High未解決なら停止 | session `3b4720170b220aa0f26bfb7b27393cf8f4e4f9e74b9b431140ba2200940d70fc`、対象差分変更なし。Claudeは承認authorityではない |
-
-## 1. 入力証拠
-
-| 証拠 | 参照先 | 観測結果 | 根拠種別 |
-|---|---|---|---|
-| 要求・受け入れ条件 | Issue #1336、staging `01_要件定義.md` | FR-1336-01〜06、AC-1336-01〜06、INV-1336-01〜06 | 要件文書 |
-| 差分 | `8e7405b9ee632ef93e5bccae515e1b4a39f7ac2b..731642154e7afc5f89e0c2e20f7b7219943cb1c2` | 34 path、2058追加・9削除 | Git観測 |
-| テスト | 対象test、full suite、静的gate | 最終H_implで対象21 scenarios・105 steps成功、typecheck・lint・format・trace成功。source同等の先行H_implでfull 1899 scenarios中1883成功・16 skip、9953 steps中9903成功・50 skip、conformance 87 scenarios・468 steps成功 | テスト出力 |
-| 仕様 | `docs/specs/` | 用語・要件・CLI契約・管理データ・品質・追跡・変更履歴を更新 | 既存文書 |
-| commit前candidate | 上記34 path | H_impl `731642154e7afc5f89e0c2e20f7b7219943cb1c2` | Git観測 |
-| Phase A artifact | 本file | artifact-only commit後にGit blobとして観測する | Git観測 |
-| review session | staging `journal/review-session.json` | session `3b4720170b220aa0f26bfb7b27393cf8f4e4f9e74b9b431140ba2200940d70fc`、round 1 `87e6b73a5036b66c8f5f872d0e676eb2ab99caa9254be67952e5a4619399e758` | Git観測 |
-
-- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: conformance、差分監査、reviewでpass
-- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: 本fileのcommit後にauditで検証する
-- reviewerの独立性: exact H_implを固定した別review sessionで肯定・敵対評価を行い対象差分を変更していないためpass
-- Phase BのPR・CI・review一致: PR作成後にtrusted providerから観測する
-- 既定branch追随後の基点と監査表: 比較基点はmain `8e7405b9`で、34 pathを同基点から再生成済み
-
-### 1.1 変更ファイル個別監査
-
-| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
-|---|---|---|---|---|---|---|---|---|
-| `.agent-skill-chain/schemas/review-progress-record.schema.json` | A | package | schema | entry契約 | runtime参照 | AC-01/03 | strict追加 | pass |
-| `.agent-skill-chain/templates/issue/03_実装計画.md` | M | package | template | task ID宣言 | runtime非依存 | AC-01 | additive | pass |
-| `docs/specs/01_システム概要/02_用語・略語.md` | M | spec | glossary | TERM-ASC-107 | 要件へ追跡 | 全AC | revert可 | pass |
-| `docs/specs/02_要件/00_要件一覧.md` | M | spec | requirements | 要件索引 | workflow参照 | 全AC | revert可 | pass |
-| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec | requirements | progress契約 | testへ追跡 | 全AC | fail-closed | pass |
-| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | spec | interface | CLI契約 | domain参照 | AC-01〜05 | read-only既定 | pass |
-| `docs/specs/07_データ/01_管理データ.md` | M | spec | data | journal形式 | schema参照 | AC-01/03 | 上限・digest | pass |
-| `docs/specs/11_非機能/01_品質要件.md` | M | spec | quality | 非依存条件 | gate参照 | AC-04/06 | gate不変 | pass |
-| `docs/specs/15_要件追跡/00_追跡表.md` | M | spec | trace | 21 SCN対応 | 一方向 | 全SCN | revert可 | pass |
-| `docs/specs/15_要件追跡/01_変更履歴.md` | M | spec | history | #1336記録 | 依存なし | #1336 | revert可 | pass |
-| `scripts/check_conformance.ts` | M | package | gate | 禁止edge検査 | source参照 | AC-04 | CI拒否 | pass |
-| `src/adapters/review-progress.ts` | A | package | adapter | filesystem境界 | domain依存 | AC-01/03 | identity・lock | pass |
-| `src/adapters/review-session.ts` | M | package | adapter | inventory固定 | domain依存 | AC-01 | exact HEAD | pass |
-| `src/cli-usage.ts` | M | package | interface | 公開help | 非依存 | AC-05 | additive | pass |
-| `src/cli.ts` | M | package | application | command合成 | domain→adapter | AC-01〜05 | apply拒否 | pass |
-| `src/domain/review-convergence.ts` | M | package | domain | gate入力隔離 | adapter非依存 | AC-04 | journal非参照 | pass |
-| `src/domain/review-progress.ts` | A | package | domain | parse・chain・projection | adapter非依存 | 全AC | pure/fail-closed | pass |
-| `src/domain/staging.ts` | M | package | domain | 専用path除外 | domain内 | AC-01 | exact match | pass |
-| `src/lib/atomic.ts` | M | package | lib | descriptor公開 | 上位非依存 | AC-03 | identity再検証 | pass |
-| `test/features/e2e/review-progress-cli.feature` | A | test | e2e | 実CLI | production観測 | 018〜020 | 一時fixture | pass |
-| `test/features/integration/review-progress.feature` | A | test | integration | 実repo/filesystem | production観測 | 001〜003/009〜014/021 | 一時repo | pass |
-| `test/features/unit/atomic-write.feature` | M | test | unit | descriptor回帰 | production観測 | 010〜014 | 一時file | pass |
-| `test/features/unit/review-progress.feature` | A | test | unit | pure契約 | production観測 | 004〜008/015〜017 | pure fixture | pass |
-| `test/steps/atomic-write.steps.ts` | M | test | steps | descriptor fixture | production観測 | atomic回帰 | 一時file | pass |
-| `test/steps/project-rule-ledger.steps.ts` | M | test | steps | staging fixture | production観測 | 回帰 | 一時repo | pass |
-| `test/steps/review-progress.steps.ts` | A | test | steps | 21 SCN実装 | production観測 | 全SCN | 一時repo/CLI | pass |
-
-- 生成済みdist 8 pathを除く基準SHAとの差分26 pathと表のpath集合が完全一致し、distは配布物影響で監査する: pass
-- package、spec、testの責務方向を維持しprogressからreview/delivery gateへのedgeは0件: pass
-- finding修正後はprojection、review gate、test layerと隣接CLI・adapter・traceを再監査した: pass
-
-## 2. 受け入れ条件の確認
-
-### 2.0 実装中に発見した事実と前向きな対処
-
-| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
-|---|---|---|---|---|---|---|---|
-| DISC-1336-001 | tree projectionはjournal由来byteをreview入力へ逆流させる | INV-04、AC-02 | 安全境界縮小 | read-only限定、`--apply`拒否 | 対象SCN・隔離検査 | updated | pass |
-| DISC-1336-002 | gateのjournal参照はreviewのdeny channelになる | INV-05、AC-04 | edge削除 | review・delivery gateから完全除去 | conformance 87/468 | updated | pass |
-| DISC-1336-003 | 全SCNがunit featureではintegration/E2Eを過大表示する | AC-01/03/05/06 | test配置訂正 | 3 layerへ分割し実repo・adapter・CLI実行 | 21/105・trace成功 | updated | pass |
-
-### 2.1 受け入れ条件とシナリオ
-
-| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
-|---|---|---|---|---|---|
-| AC-1336-01 | SCN-INT-PROGRESS-001〜003 | inventory固定・append | 成功 | pass | integration feature |
-| AC-1336-02 | SCN-UNIT-PROGRESS-004〜008 | read-only projection | 成功 | pass | unit feature |
-| AC-1336-03 | SCN-INT-PROGRESS-009〜014 | race・link・prefix拒否 | 成功 | pass | integration feature |
-| AC-1336-04 | SCN-UNIT-PROGRESS-015〜017 | 禁止edge検査 | 成功 | pass | unit・conformance |
-| AC-1336-05 | SCN-E2E-PROGRESS-018〜020 | 実CLI・fallback | 成功 | pass | e2e feature |
-| AC-1336-06 | SCN-INT-PROGRESS-021 | critical path model | 成功 | pass | integration feature |
-
-### 2.2 開発考慮事項の適用判定（必須）
-
-| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
-|---|---|---|---|---|
-| DC-PRIVACY | Privacy/Security by Design | applicable | staging filesystemがtrust boundary | 自由記述禁止、file・mode・link・digest・HEAD検証、秘密fieldなし |
-| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | append-only再開証拠 | sequence・digest chain・UTC時刻・read-back・seal・上限 |
-| DC-UX | Human-Centered UI/UX・アクセシビリティ | applicable | CLI状態/error契約 | preview既定、apply拒否、fallback診断。GUI対象なし |
-| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI・layout変更なし | UI資産変更なし |
-
-## 3. 肯定的評価
-
-| 観点 | 確認内容 | 判定 | 根拠 |
-|---|---|---|---|
-| 正しさ | 入力固定中に進捗append | pass | 21 SCN・digest/HEAD検査 |
-| 価値 | review待ち中の閉じた進捗を並行化 | pass | 専用journal・fallback |
-| 実現可能性 | 現行Node・filesystemで成立 | pass | build・実repo integration |
-| 整合性 | source・dist・schema・test・仕様 | pass | trace・conformance |
-| 保守性 | domain・adapter・CLI・gateを分離 | pass | 禁止edge静的検査 |
-
-## 4. 敵対的評価
-
-| 観点 | 確認内容 | 判定 | 根拠 |
-|---|---|---|---|
-| 反例 | 未宣言task・未知field・改変chain | pass | SCN-009〜017 |
-| 失敗経路 | crash・競合・部分append | pass | lock・再検証・read-back |
-| 境界値 | 0/1/上限entry・size・sequence | pass | strict parser・上限SCN |
-| 悪用 | symlink・hardlink・path脱出・自由記述 | pass | identity・mode検査 |
-| 安全性 | progressがauthorityへ昇格しない | pass | gate非参照・禁止edge |
-| データ損失 | prefix上書き・tree更新 | pass | append-only・apply拒否 |
-| ロールバック | journal absent経路 | pass | E2E-018〜020 |
-| 範囲漏れ | 配布物・文書・test | pass | 34 path監査 |
-
-## 5. 指摘
-
-| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
-|---|---|---|---|---|---|---|---|
-| R1336-C01 | Critical | projectionをreview入力treeへ書くと入力固定を迂回できる | Claude敵対助言・差分再監査 | projection・review tree | read-only限定、apply拒否 | resolved before formal round | なし |
-| R1336-H02 | High | gateのjournal参照がdeny channelを作る | Claude敵対助言・依存graph | review/delivery gate | journal依存0と静的検査 | resolved before formal round | なし |
-| R1336-H03 | High | test層がunitだけでintegration/E2Eを過大表示 | trace・fixture監査 | test・追跡 | 3 layer分割・実repo/CLI化 | resolved before formal round | なし |
-
-未解決Critical/Highはない。
-
-## 6. ラウンド固有の確認
-
-### ラウンド1
-
-- 全評価基準を確認した: はい
-- pre-roundのCritical 1件・High 2件は最終H_implで解消、formal roundの未解決findingなし
-- レビューセッション: `3b4720170b220aa0f26bfb7b27393cf8f4e4f9e74b9b431140ba2200940d70fc`
-- round digest: `87e6b73a5036b66c8f5f872d0e676eb2ab99caa9254be67952e5a4619399e758`
-
-### ラウンド2
-
-- 未実施。PR公開後の具体的findingがあれば同一PRで再開する
-
-### ラウンド3
-
-- 未実施。最大3ラウンドの回復予算として保持する
-
-## 7. テスト結果
-
-- 最終H_impl: 対象Cucumber 21 scenarios・105 steps、typecheck、lint、format、traceがすべて成功
-- source同等の先行H_impl `738d277d`: `npm run verify:distribution`で1899 scenarios（1883成功・16 skip）、9953 steps（9903成功・50 skip）、build・format・trace・architecture成功、conformance 87 scenarios・468 steps成功。artifact未作成段階のauditだけが旧artifactを拒否
-- 最終H_implとの差分はtest featureの物理分割と実repo/CLI fixture強化で製品source・distは不変。H_final exact HEADのfull suiteはPR CIで再実行する
-- runner・Gherkin方言: cucumber-js、en
-
-## 8. 配布物影響
-
-| 変更path | 配布境界に入るか | 影響 |
-|---|---|---|
-| `.agent-skill-chain/schemas/review-progress-record.schema.json` | 入る | strict journal契約 |
-| `.agent-skill-chain/templates/issue/03_実装計画.md` | 入る | task ID契約 |
-| `src/adapters/review-progress.ts` | 入る | journal filesystem境界 |
-| `src/adapters/review-session.ts` | 入る | review input inventory固定 |
-| `src/cli.ts`・`src/cli-usage.ts` | 入る | progress公開CLI |
-| `src/domain/review-convergence.ts` | 入る | review gateのjournal非依存 |
-| `src/domain/review-progress.ts` | 入る | strict entry・digest chain・read-only projection |
-| `src/domain/staging.ts` | 入る | 専用journal pathだけをdigestから除外 |
-| `src/lib/atomic.ts` | 入る | append時のfile identity再検証 |
-| `dist/src/` | 入る | source変更の生成済み配布物 |
-| `docs/specs/` 8 path | 入る | 用語・要件・CLI・data・品質・追跡 |
-
-判断: 配布物を更新した
-
-根拠: package manifestの配布対象であるsource、dist、schema、template、利用者向け仕様を同じH_implへ固定した。
-
-## 9. 独立reviewの成立
-
-| 項目 | 内容 |
-|---|---|
-| 適用した独立性モード | context-isolated |
-| その要求を満たすこと | はい |
-| reviewerとimplementerのidentity・context比較 | implementer rootに対しreview session `3b472017...`はexact H_impl固定の別context。Claude Opus 5/highは匿名化read-only助言で承認authorityではない |
-| reviewerが対象差分を変更していないこと | はい。対象34 pathの変更なし |
-
-外部への不可逆配布ではないため独立review例外は使用しない。
-
-## 10. 仕様整合性
-
-- 判定: updated
-- 更新した仕様: 用語、要件一覧、workflow要件、CLI契約、管理データ、品質要件、追跡表、変更履歴
-- ドメイン用語台帳: TERM-ASC-107を確定しREQ-WF-021へ一方向追跡
-- 未定義語・重複定義・根拠なしの変更・表記揺れ・置換先なし廃止: なし
-- 追跡: REQ-WF-021 → AC-1336-01〜06 → SCN-PROGRESS-001〜021 → unit/integration/e2e
-- UI・token: CLI状態/errorはDC-UXで検証、UI tokenはnot-applicable
-
-## 11. 総合判定と再開地点
-
-- 未解決Critical/High: なし
-- Medium/Lowの記録: なし
-- 判定: approved
-- 新しい権限が必要な事項: なし。PR作成・mergeはrepository ownerの自走指示で許可済み
-- 残存リスク: journalは進捗表示専用。H_final exact full検証と外部reviewはStep 11で観測する
-- 次に許可される操作: artifact-only commit、artifact/audit/package検証、Step 10記録、PR作成、CI・外部review、merge
-- 次回の再開地点: Step 10 terminal記録後のStep 11
diff --git "a/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md" "b/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md"
index 710337cb..86e1b4d9 100644
--- "a/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md"
+++ "b/docs/specs/01_\343\202\267\343\202\271\343\203\206\343\203\240\346\246\202\350\246\201/02_\347\224\250\350\252\236\343\203\273\347\225\245\350\252\236.md"
@@ -77,7 +77,6 @@ agent-skill-chainで現在有効なドメイン用語台帳である。開発工
 | TERM-ASC-104 | low-risk短縮行 | Verification Set riskがlowのときだけ、02 §4.2・§8・§9または03 §5.2の対象外理由を固定接頭辞付き1行で保持する記述 | system | Issue成果物検証 | `対象外: UI変更なし`は成立する。空理由、複数行、medium/high/criticalは成立しない | 省略、同上、空欄は禁止 | REQ-WF-018、Issue #1334 | package owner | active、v0.3.2、なし |
 | TERM-ASC-105 | SCN ID | `SCN-`に大文字英数字とハイフン（`[A-Z0-9-]`）だけを1文字以上続けた、Scenarioを一意に識別する安定ID。Issue成果物検証とdelivery証跡検査が`src/domain/scenario-id.ts`の同一の述語で判定する | system | Issue成果物検証 / Delivery証跡検証 | `SCN-69-001`、`SCN-UNIT-TRACE-001`は成立する。`SCN-69-001a`（小文字枝番）、`SCN-69_001`（下線）、`SCN-`（本体なし）は該当しない | シナリオIDと表記しない。scenario name（IDに続く説明文）と混同しない。正規化・読み替えを行わない | REQ-WF-006、Issue #1349 | package owner | active、v0.3.1、なし |
 | TERM-ASC-106 | workflow advance | 保存済みjournalから次のStepを導出し、検証・記録・同期または専用gateへの委譲を1操作で計画し、明示apply時だけ次の1 Stepを適用するCLI | system | Workflow | Step 1を1件記録する、Step 4本文を同期して記録する場合は成立する。reviewを自動承認する、PRを作成・mergeする場合は成立しない | 自動承認、自動merge、複数Step連続実行は禁止 | REQ-WF-020、Issue #1335 | package owner | active、v0.3.2、なし |
-| TERM-ASC-107 | parallel progress evidence | H_impl固定後にimplementerが専用journalへappendし、review・test・PR・merge・releaseの成否判定には使用されない、閉じたfieldだけの進捗証跡 | system | Review Evidence | 宣言済みtask IDの状態追記は成立する。test成功、review承認、自由記述、既存entry改変は該当しない | review evidence、approval、delivery authorityと同一視しない | REQ-WF-021、Issue #1336 | package owner | active、v0.3.2、なし |
 
 ## 更新規則
 
diff --git "a/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md" "b/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
index 9e42e51e..8c105f52 100644
--- "a/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
+++ "b/docs/specs/02_\350\246\201\344\273\266/00_\350\246\201\344\273\266\344\270\200\350\246\247.md"
@@ -10,7 +10,7 @@
 | REQ-WF-004 | 機能 | Step 0〜11を機械正本とjournalで順序検証する | 必須 | Issue #877 | AC-WF-004 | 合意 |
 | REQ-WF-005 | 機能 | 肯定・敵対reviewとexact-head証拠を有限に検証する | 必須 | Issue #824、#834 | AC-WF-005 | 合意 |
 | REQ-WF-006 | 機能 | Gherkinの一意ID・構造・層・仕様追跡を検証する | 必須 | Issue #824、#881、#1349 | AC-WF-006 | 合意 |
-| REQ-WF-007 | 機能 | role・独立性と公式推奨Codex・trusted採用tierを解決し実行へ接続する | 必須 | Issue #830、#836、#1257 | AC-WF-007 | 合意 |
+| REQ-WF-007 | 機能 | role・独立性と公式推奨Codex・trusted採用tierを解決し実行へ接続する | 必須 | Issue #830、#836、#1257、#1341 | AC-WF-007 | 合意 |
 | REQ-WF-008 | 機能 | package conformanceをprojectの適用宣言へ安全にbindingする | 必須 | Issue #834、#837 | AC-WF-008 | 合意 |
 | REQ-WF-009 | 機能 | subcommand単位のusageと不足必須flagの全件報告を1回の実行で返す | 必須 | Issue #886 | AC-WF-009 | 合意 |
 | REQ-WF-014 | 機能 | review roundの入力雛形を実Gitとsessionから生成しstaging外へ書く | 必須 | Issue #1323 | AC-WF-014 | 合意 |
@@ -20,7 +20,6 @@
 | REQ-WF-018 | 機能 | Verification Set riskがlowの02/03短縮形式を安全に検証する | 必須 | Issue #1334 | AC-WF-018 | 合意 |
 | REQ-WF-019 | 機能 | 配布02/03 templateがlow限定の短縮契約と強制主体を示す | 必須 | Issue #1334 | AC-WF-019 | 合意 |
 | REQ-WF-020 | 機能 | 保存済みstateから次の1 Stepを検証・記録し専用gateへ安全に委譲する | 必須 | Issue #1335 | AC-WF-020 | 合意 |
-| REQ-WF-021 | 機能 | review入力を固定したまま判定非依存の進捗証跡だけを安全に並行更新する | 必須 | Issue #1336 | AC-WF-021 | 合意 |
 | REQ-WF-011 | 制約 | モード判定Q-01〜Q-08の質問文を正本へ定義し、quick失格分類と1対1で対応させる | 必須 | Issue #957 | AC-WF-011 | 合意 |
 | REQ-WF-010 | 機能 | 正しさと開発速度の定義と両立の命題と観測基準を規範的正本が保持する | 必須 | Issue #949 | AC-WF-010 | 合意 |
 | REQ-WF-012 | 機能 | 実装中の発見を前向きに記録し契約変更時だけ影響成果物を再確定する | 必須 | ASC一部刷新 | AC-WF-012 | 合意 |
diff --git "a/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md" "b/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
index a238cc15..1bc1cd23 100644
--- "a/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
+++ "b/docs/specs/02_\350\246\201\344\273\266/01_\343\203\257\343\203\274\343\202\257\343\203\225\343\203\255\343\203\274\350\246\201\344\273\266.md"
@@ -152,9 +152,11 @@ Codex taskを起動するたびに公式model/listを観測し、現在の利用
 
 公式観測の`runJsonlSession`はstdin書込errorを固定された安全な理由付きの失敗へ反映し、後続の終了値0で成功へ戻さない。`allowFailure=true`は非0の結果、falseは例外を返し、入力本文や元errorの秘密を診断へ追加しない。
 
+**観測が`unknown`になったときの診断は、製品が組み立てた実行argvと終了値を示す。** `entrypoint`へ実際に実行したargvを空白区切りで、`reason`へ終了値を添えた理由を返す。起動できなかった場合は終了値を持たないため、実行しようとしたargvと起動失敗の事実だけを返す。**Codex以外に公式catalog入口は定義されておらず、`claude`の観測は`claude models list --json`が非0で終了するため必ず`unknown`になる。** これは欠陥ではなく契約である。診断へ載せるのは製品が組み立てたargvと整数の終了値だけであり、stderr本文と入力本文は転記しない（SCN-UNIT-OBSDIAG-001〜005）。**起動できなかった場合と、起動して非0で終わった場合を区別する。** `run`は`allowFailure`指定時に起動失敗も終了値1へ写すため、`ProcessResult.launchFailure`で判別する。終了値のない失敗へ終了値を書かない。**`ProviderExecutor`へ渡すargvは複写し、executorの書き換えが診断へ波及しないようにする。**
+
 - 受け入れ条件: AC-WF-007。公式推奨Aから未登録Bへ変わった次回起動でBを使用する。候補自身の採用設定、推奨不定、high非対応、入力不正では起動0回。起動timeout・失敗・成功を区別し、promptやraw出力を結果に含めない。
-- 根拠: Issue #830、#836、#1257、#1265。Issue #1265のREQ-PIO-001〜003、AC-PIO-001〜003は観測失敗と検証fixtureの詳細化として本要件へ統合する。Issue #1257のREQ-AM-001〜008、AC-AM-001〜006は本要件・受け入れ条件の詳細化として統合する。
-- 実装: `src/domain/routing.ts`、`src/domain/role.ts`、`src/adapters/codex-launch.ts`、`src/adapters/codex-execution.ts`
+- 根拠: Issue #830、#836、#1257、#1265、#1341。Issue #1265のREQ-PIO-001〜003、AC-PIO-001〜003は観測失敗と検証fixtureの詳細化として本要件へ統合する。Issue #1341は観測失敗診断の行動可能性として本要件へ統合する。Issue #1257のREQ-AM-001〜008、AC-AM-001〜006は本要件・受け入れ条件の詳細化として統合する。
+- 実装: `src/domain/routing.ts`、`src/domain/role.ts`、`src/adapters/codex-launch.ts`、`src/adapters/codex-execution.ts`、`src/adapters/provider.ts`
 
 ### REQ-WF-008 conformance適用宣言を検証する
 
@@ -251,13 +253,3 @@ Step 10・11はそれぞれ独立reviewとdeliveryの専用commandを案内し
 - 受け入れ条件: AC-WF-020。previewはjournalを変更せず、同期対象と本文digestを表示する。local applyは検証済みの次Stepを1件だけ記録し、未完成のStep 1要求成果物またはStep 5設計成果物は記録しない。Step 4同期は不正な入力時刻を外部書込み前に拒否し、成功時は書込後読み戻しdigestをEvidenceへ含める。Step 10は無変更でreviewへ委譲する。
 - 根拠: Issue #1335
 - 実装: `src/domain/workflow.ts`、`src/cli.ts`、`src/cli-usage.ts`
-
-### REQ-WF-021 review入力を固定したまま進捗証跡だけを並行更新する
-
-`review round --init`は、03実装計画にparallel progress markerが正確に1組ある場合だけ、対象path、baseline・prefix・suffixのSHA-256、mode 100644、宣言済みtask IDをoptional inventoryとしてreview session anchorへ固定する。`review progress`は同じsession IDとH_implへ結び付く閉じたtask/state/UTCだけを、最大256件・256 KiBの専用JSONLへdigest chainで追記する。専用journalだけを一般staging成果物digestから除外し、任意path・任意section・自由記述は除外しない。
-
-projectionはmarker内だけをpure functionでread-only表示し、review入力treeへ書き込まない。review、test、PR、merge、releaseのgateは専用journalもprojectionも読まず、progressの失敗を拒否理由にしない。progress操作自身はbaseline、file identity・mode、session・H_impl、journal chainを再検証し、inventory欠落、HEAD移動、改変、競合、上限超過ではその操作だけを停止して既存の直列経路を維持する。
-
-- 受け入れ条件: AC-WF-021
-- 根拠: Issue #1336
-- 実装: `src/domain/review-progress.ts`、`src/adapters/review-progress.ts`、`src/adapters/review-session.ts`、`src/cli.ts`
diff --git "a/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md" "b/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
index 4f184c55..d4ece3c0 100644
--- "a/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
+++ "b/docs/specs/06_\345\244\226\351\203\250\343\202\244\343\203\263\343\202\277\343\203\274\343\203\225\343\202\247\343\203\274\343\202\271/01_\343\202\263\343\203\236\343\203\263\343\203\211\343\203\273GitHub\345\245\221\347\264\204.md"
@@ -9,7 +9,7 @@ CLIは引数を構造化入力として受け、適用を伴う操作は既定
 | review証拠            | exact repositoryと明示したH_impl/H_final/PR/run/review ID、H_implからreview artifact 1件だけを加えた単一親H_final                                                                                                                                                                                                 | read-only                                                                                                                                                                                                                                                                       | commit author、PR current head/author、Actions event/head/conclusion/関連PR、immutable review commit/user/submittedAt/stateを再読取し、artifact path/digest・CI run ID・review ID・`reviewEvidenceId`を同じH_finalへ固定する                                                        |
 | policy authority      | exact repositoryと明示したPR ID、base SHA/ref、default branch/tip、trusted policy commit                                                                                                                                                                                                                          | read-only                                                                                                                                                                                                                                                                       | PR baseRefName/baseRefOid/headRefOidとrepository defaultBranchRef name/tip OIDをtrusted providerから再読取し、同一tupleへ固定                                                                                                                                                       |
 | merge                 | PR作成時と同じstagingの`pr-bound`、Step 0〜10・`sync-verified`・PoCでないこと、provider default branch tip・PR base SHA・trusted policy commitの一致、base branchに対する`branchMethods`の積集合、base/headの長命branch判定、mergeを保護するclassic protectionまたはruleset、成功check、固定H_finalの独立approval | Git・gh最低versionを副作用前検査し、method、認可head/base/ref、trusted policy commit、H_impl、固定review Evidence、intent IDを`merge-prepared`へ耐久化してprovider merge直前にone-shot `dispatchClaimedAt`をfsyncする。claim取得後だけ1回、許可methodとexact HEAD CASで実行する | auto-merge・queue・merged状態と固定identityを再読取する。requestが消失した即時完了も含め、merge commit SHA、期待tree、method別commit topology、ancestryを立証した後だけ`outcome=merged`のStep 11を記録する                                                                          |
-| provider availability | provider名の許可文字と実行入口                                                                                                                                                                                                                                                                                    | Codexは`codex app-server --stdio`をinitializeして`model/list`、その他はprovider固有の`models list --json`をread-only実行                                                                                                                                                        | stdoutだけを厳密に解析し、available、unavailable、unknown、model一覧、recommended default、対応reasoning effort、観測時刻、確認済み入口を返す。10秒以内に完了しない、起動失敗、非0終了、解釈不能、未取得pageありはunknownとし、stderr本文を転記しない                               |
+| provider availability | provider名の許可文字と実行入口                                                                                                                                                                                                                                                                                    | Codexは`codex app-server --stdio`をinitializeして`model/list`、その他はprovider固有の`models list --json`をread-only実行                                                                                                                                                        | stdoutだけを厳密に解析し、available、unavailable、unknown、model一覧、recommended default、対応reasoning effort、観測時刻、確認済み入口を返す。10秒以内に完了しない、起動失敗、非0終了、解釈不能、未取得pageありはunknownとし、stderr本文を転記しない。unknownの`entrypoint`は製品が組み立てた実行argvを空白区切りで示し、`reason`は終了値を含む。起動できなかった場合は終了値を持たず起動失敗の事実だけを示し、終了値1で終了した場合と区別する。Codex以外に公式catalog入口は定義されておらず、`claude`の観測は必ずunknownになる                               |
 
 GitHubエラーの機械diagnosticは表示言語に依存せず、秘密情報の伏字化と行動可能な根拠・次行動を保持する。表示言語はproject choiceを読むcaller adapterが選択する。
 
@@ -77,7 +77,6 @@ design相当の検証で02 §4.2・§8・§9または03 §5.2に`対象外: <理
 | `review evidence` | `--repo --pr --run-id --review-id`と`H_impl/H_final`、artifact path                                                                                                                                                                                                                                                                                        | Gitと唯一のGitHub adapterから観測した二段階証拠。caller actor option、任意JSON、別PR run、不一致・未完了・自己reviewは非承認                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
 | `review validate` | tracked review file                                                                                                                                                                                                                                                                                                                                        | rubricと構造だけを検証する。file内のGitHub metadataをauthorityにせず、承認はtrusted provider観測待ちのpending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
 | `review round`    | `--staging --file`、任意の`--apply`。fileはanchor、candidate HEAD、previous round digest、focus、findingの厳密JSON（構造と例は`--help`の`inputContract`）。`--init --out=<staging外の新規path> --head=<sha>`（round 1は`--base --scope --ac`、任意`--invariant`）で次roundの雛形を`--out`へ書き、stagingとsessionは書かない。`--file`・`--apply`と併用不可 | 無指定はpreview、`--apply`は`review-session.json`へ永続化する。Git実差分、scope/AC/invariant/diff anchor、round digest chain、finding admissionを再導出する。収束後は異なるHEADと空でない実fixed diffのround 2/3だけを追加でき、同じHEAD・reset・anchor変更・blocker脱落・budget終了後・3round超過を非0で拒否する                                                                                                                                                                                                                                                                                                                                                                                                                                        |
-| `review progress` | `--staging --operation=append|seal|project|verify`。appendは`--task --state`、append/sealの適用は`--apply` | review sessionへ固定したH_impl・inventoryと専用journal chainを照合する。preview既定で、project/verifyは常にread-onlyでありreview入力treeへ書かない。baseline、mode、identity、digest競合、上限、未宣言taskをprogress操作内で拒否するが、review・test・delivery gateはjournalを読まず判定へ使用しない |
 | `review reanchor` | `--staging --new-head --new-base --reason`、任意の`--root`、`--dry-run`または`--apply`                                                                                                                                                                                                                                                                     | PR作成前の収束済みreview sessionをanchorにする。previewはapplyと同じread-only evaluatorで入力、anchor、chain、冪等性、完全diff、二層の等価性を検証し、成功時は`willAppend`と実効HEADを返す。`--apply`はmutation lock内で最新stateへ再評価し、成功時だけ再固定chainを追記してread-backする                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
 | `pr reanchor`     | `--staging --new-head --new-base --reason`、任意の`--root`、`--dry-run`または`--apply`                                                                                                                                                                                                                                                                     | PR作成後の`step11-recorded` delivery stateをanchorにする。previewとapplyの判定、出力、適用境界は`review reanchor`と同じである。previewはmutation lock、transaction復旧、再固定chain、staging digestを含む永続書込みを行わない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
 | `trace validate`  | project adapterが作成した`--evidence` JSONとproject choices                                                                                                                                                                                                                                                                                                | runner・file形式・表示言語・Gherkin方言を所有せず、stable ID、canonical step role、選択層、禁止file証拠を検証                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
diff --git "a/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md" "b/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md"
index a8ba8180..e0b891ff 100644
--- "a/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md"
+++ "b/docs/specs/07_\343\203\207\343\203\274\343\202\277/01_\347\256\241\347\220\206\343\203\207\343\203\274\343\202\277.md"
@@ -39,8 +39,6 @@ GraphDBだけにRequirement、Finding、Evidence、provider事実を書く操作
 
 `review-session.json`は`agent-skill-chain/review-session/v1`で、scope ID、Acceptance Criteria ID、domain invariant ID、Git基点、初回HEAD、初回差分digestからsession IDを再導出する。roundは1から連番で、直前round digest、candidate HEAD、実Gitの修正path、Graph Evidence digest付き隣接path、findingのadmission、blocker、record-only、round digestを保持する。Graph Evidenceの実照合が未実装の間、隣接pathは記録だけに使用し、current blockerのadmission authorityにしない。読取り時は各roundを先頭から再評価し、保存済みadmission・blocker・digest・statusの自己申告をauthorityにしない。`active / converged / budget-exhausted`のみを許可する。`converged`後は前roundと異なるcandidate HEADと実Gitの空でないfixed diffがあるround 2/3だけを同digest chainへ追記できる。同じHEAD、空fixed diff、`budget-exhausted`後、round 1 reset、anchor変更、previous blocker脱落を拒否する。
 
-markerを持つ03実装計画ではreview session anchorへoptionalなparallel progress inventoryを加える。inventoryは対象を`03_実装計画.md`、modeを100644へ閉じ、baseline全体とmarker外prefix/suffixのSHA-256、宣言済task IDを固定する。`journal/review-progress.jsonl`はsession ID、H_impl、連番、task ID、`planned / started / completed / blocked`、UTC時刻、previous/entry digestだけを持つappend-only記録である。最大256 entry・256 KiBとし、末尾seal後の追記、未知field、自由記述、digest chain不一致を拒否する。このjournalは判定用staging成果物ではなく一般staging digestへ含めない。progress adapterだけが読み、review・test・delivery gateは読まない。projectionはread-only出力でありreview入力treeへ永続化しない。
-
 ## delivery状態
 
 squash/rebaseのsource commit数は固定base..headの線形historyから導出し、squashは単一結果、rebaseは導出件数の1-parent chainとして検証する。sourceが1件でprovider requestが消失したときは、固定methodは保持しつつsquash/rebaseの結果同値性を明示する。
diff --git "a/docs/specs/11_\351\235\236\346\251\237\350\203\275/01_\345\223\201\350\263\252\350\246\201\344\273\266.md" "b/docs/specs/11_\351\235\236\346\251\237\350\203\275/01_\345\223\201\350\263\252\350\246\201\344\273\266.md"
index 2e6d07ae..ef67f27d 100644
--- "a/docs/specs/11_\351\235\236\346\251\237\350\203\275/01_\345\223\201\350\263\252\350\246\201\344\273\266.md"
+++ "b/docs/specs/11_\351\235\236\346\251\237\350\203\275/01_\345\223\201\350\263\252\350\246\201\344\273\266.md"
@@ -82,7 +82,6 @@
 | QLT-STEP-001 正本整合性 | 規範文書のStep表4列とmode別Step列がコード正本と完全一致し、片側だけの変更を許可しない | `npm run workflow:check`、build、prepack、SCN-INT-WFSTEP-006〜008 |
 | QLT-STEP-002 決定性 | journal順序は行順だけで判定し、domain内で現在時刻・乱数を取得しない | SCN-UNIT-WFJRNL-012、typecheck、source review |
 | QLT-STEP-003 監査可能性 | Stepごとに1件以上のartifactと空でないevidenceを追記し、重複再実行は最後の記録を採用する | workflow journal schema、SCN-UNIT-WFJRNL-006・013、SCN-INT-WFSTEP-001 |
-| QLT-PROGRESS-001 安全性・性能 | parallel progressはreview/test/delivery gateからjournalへのedgeとreview入力treeへのwriteを0件とし、digest chain、H_impl/session bindingをprogress操作内で再検証する。固定durationモデルで並行critical path `max(review, progress)` が直列和を超えないことを立証し、成立しない場合も従来reviewを停止しない | SCN-INT-PROGRESS-001〜014・021、SCN-UNIT-PROGRESS-004〜017、SCN-E2E-PROGRESS-018〜020 |
 | QLT-GR-001 決定性 | 同じ意味sourceからcanonical node・edge順とgraph content hashが一致し、BFS・Kahn・Tarjan・Dijkstraの同距離結果が挿入順に依存しない | REQ-GR-003、007〜009のproperty・differential test |
 | QLT-GR-002 可用性・復旧 | Graph runtimeはworktreeごとに隔離し、missing・corrupt・drift時もGit・text・provider耐久stateを変えず完全rebuildで収束する | 隔離疑似projectのworktree A/B・破損・source変更復旧scenario |
 | QLT-GR-003 性能・安全性 | 全探索はdepth、node、edge、result、operationのhard budgetを持ち、上限時はcanonical部分結果を`budget-exceeded`として返す。GraphQLiteは固定digest assetとparameterized queryだけを使う | 上限・deep cycle・negative weight・query injection・digest不一致反例 |
diff --git "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md" "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
index 2248f811..7c778c6f 100644
--- "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
+++ "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/00_\350\277\275\350\267\241\350\241\250.md"
@@ -6,9 +6,6 @@ REQ-SQ-027に対応する案件受け入れ条件AC-1024-14は、offline下で
 
 | 要件ID | 受け入れ条件 | SCN ID | テスト層 | Feature | 実装 | 結果・HEAD SHA |
 |---|---|---|---|---|---|---|
-| REQ-WF-021 | AC-WF-021 | SCN-UNIT-PROGRESS-004、SCN-UNIT-PROGRESS-005、SCN-UNIT-PROGRESS-006、SCN-UNIT-PROGRESS-007、SCN-UNIT-PROGRESS-008、SCN-UNIT-PROGRESS-015、SCN-UNIT-PROGRESS-016、SCN-UNIT-PROGRESS-017 | unit | `test/features/unit/review-progress.feature` | `src/domain/review-progress.ts`、`scripts/check_conformance.ts` | 8 scenarios合格・作業tree |
-| REQ-WF-021 | AC-WF-021 | SCN-INT-PROGRESS-001、SCN-INT-PROGRESS-002、SCN-INT-PROGRESS-003、SCN-INT-PROGRESS-009、SCN-INT-PROGRESS-010、SCN-INT-PROGRESS-011、SCN-INT-PROGRESS-012、SCN-INT-PROGRESS-013、SCN-INT-PROGRESS-014、SCN-INT-PROGRESS-021 | integration | `test/features/integration/review-progress.feature` | `src/domain/review-progress.ts`、`src/adapters/review-progress.ts`、`src/adapters/review-session.ts` | 10 scenarios合格・作業tree |
-| REQ-WF-021 | AC-WF-021 | SCN-E2E-PROGRESS-018、SCN-E2E-PROGRESS-019、SCN-E2E-PROGRESS-020 | E2E | `test/features/e2e/review-progress-cli.feature` | `src/cli.ts`、`src/domain/review-convergence.ts` | 3 scenarios合格・作業tree |
 | REQ-WF-020 | AC-WF-020 | SCN-UNIT-ADVANCE-001、SCN-UNIT-ADVANCE-002、SCN-UNIT-ADVANCE-003、SCN-UNIT-ADVANCE-004、SCN-UNIT-ADVANCE-005 | unit | `test/features/unit/workflow-step-enforcement.feature` | `src/domain/workflow.ts` | 5 scenarios合格・作業tree |
 | REQ-WF-020 | AC-WF-020 | SCN-E2E-ADVANCE-001、SCN-E2E-ADVANCE-002、SCN-E2E-ADVANCE-003、SCN-E2E-ADVANCE-004、SCN-E2E-ADVANCE-005、SCN-E2E-ADVANCE-006、SCN-E2E-ADVANCE-007、SCN-E2E-ADVANCE-008、SCN-E2E-ADVANCE-009、SCN-E2E-ADVANCE-010、SCN-E2E-ADVANCE-011、SCN-E2E-ADVANCE-012、SCN-E2E-ADVANCE-013 | E2E | `test/features/e2e/workflow-step-enforcement-cli.feature` | `src/domain/workflow.ts`、`src/cli.ts`、`src/cli-usage.ts`、`src/adapters/github.ts`、`src/adapters/workflow-journal.ts` | 13 scenarios合格・作業tree |
 | REQ-WF-018、REQ-WF-019 | AC-WF-018、AC-WF-019 | SCN-WF-1334-001、SCN-WF-1334-002、SCN-WF-1334-003、SCN-WF-1334-004、SCN-WF-1334-005、SCN-WF-1334-006、SCN-WF-1334-007、SCN-WF-1334-008、SCN-WF-1334-009、SCN-WF-1334-010、SCN-WF-1334-011 | unit | `test/features/unit/issue-risk-short-form.feature` | `src/domain/issue.ts`、`.agent-skill-chain/templates/issue/02_設計.md`、`.agent-skill-chain/templates/issue/03_実装計画.md` | 16 examples合格・作業tree |
@@ -129,6 +126,7 @@ REQ-SQ-027に対応する案件受け入れ条件AC-1024-14は、offline下で
 | REQ-WF-008 | AC-WF-008 | SCN-UNIT-SAT-021、SCN-UNIT-SAT-022、SCN-UNIT-SAT-023、SCN-UNIT-SAT-024、SCN-UNIT-SAT-025、SCN-UNIT-SAT-026 | unit | `test/features/unit/project-policy-satisfiability.feature` | `src/domain/conformance.ts`、`.agent-skill-chain/schemas/project-conformance-binding.schema.json` | 合格・作業treeで対象実行済み |
 | REQ-SQ-004 | AC-SQ-004 | SCN-UNIT-LEDGER-001、SCN-UNIT-LEDGER-002、SCN-UNIT-LEDGER-003、SCN-UNIT-LEDGER-004、SCN-UNIT-LEDGER-005、SCN-UNIT-LEDGER-006、SCN-UNIT-LEDGER-007、SCN-UNIT-LEDGER-008、SCN-UNIT-LEDGER-009 、SCN-UNIT-LEDGER-010、SCN-UNIT-LEDGER-011、SCN-UNIT-LEDGER-012、SCN-UNIT-LEDGER-013、SCN-UNIT-LEDGER-014、SCN-UNIT-LEDGER-015、SCN-UNIT-LEDGER-016、SCN-UNIT-LEDGER-017| unit | `test/features/unit/project-rule-ledger.feature` | `src/domain/conformance.ts`、`src/domain/enforcement.ts`、`src/domain/project-rule-retirement.ts`、`src/domain/policy.ts`、`src/domain/migration.ts`、`src/domain/delivery.ts`、`src/cli.ts` | [課題1211の共通証拠](01_変更履歴.md#issue-1211-evidence) |
 | REQ-WF-007 | AC-WF-007 | SCN-UNIT-ROUTING-009、SCN-UNIT-ROUTING-012 | unit | `test/features/unit/provider-adapter-routing.feature` | `src/domain/routing.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
+| REQ-WF-007 | AC-WF-007 | SCN-UNIT-OBSDIAG-001、SCN-UNIT-OBSDIAG-002、SCN-UNIT-OBSDIAG-003、SCN-UNIT-OBSDIAG-004、SCN-UNIT-OBSDIAG-005 | unit | `test/features/unit/provider-observation-diagnostic.feature` | `src/adapters/provider.ts`、`src/lib/process.ts` | 実装commitで合格 |
 | REQ-WF-007 | AC-WF-007 | SCN-UNIT-ROUTING-002 | unit | `test/features/unit/provider-capability-routing.feature` | `src/domain/routing.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-GH-002 | AC-GH-002 | SCN-UNIT-RELEASE-001、SCN-UNIT-RELEASE-002、SCN-UNIT-RELEASE-003、SCN-UNIT-RELEASE-004、SCN-UNIT-RELEASE-005、SCN-UNIT-RELEASE-006、SCN-UNIT-RELEASE-007、SCN-UNIT-RELEASE-008 | unit | `test/features/unit/release-plan.feature` | `src/domain/release.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
 | REQ-WF-005、REQ-SQ-005、REQ-SQ-008、REQ-SQ-009 | AC-WF-005、AC-SQ-005、AC-SQ-008、AC-SQ-009 | SCN-UNIT-REVIEW-001、SCN-UNIT-REVIEW-002、SCN-UNIT-REVIEW-003、SCN-UNIT-REVIEW-004、SCN-UNIT-REVIEW-005、SCN-UNIT-REVIEW-006、SCN-UNIT-REVIEW-007、SCN-UNIT-REVIEW-008、SCN-UNIT-REVIEW-009、SCN-UNIT-REVIEW-010、SCN-UNIT-REVIEW-011、SCN-UNIT-REVIEW-012、SCN-UNIT-REVIEW-013、SCN-UNIT-REVIEW-014、SCN-UNIT-REVIEW-030、SCN-UNIT-REVIEW-031、SCN-UNIT-POLICY-001、SCN-UNIT-POLICY-002、SCN-UNIT-POLICY-003、SCN-UNIT-POLICY-004、SCN-UNIT-POLICY-005、SCN-UNIT-PACKAGE-001、SCN-UNIT-PACKAGE-002、SCN-UNIT-PACKAGE-003、SCN-UNIT-PACKAGE-004、SCN-UNIT-PACKAGE-005、SCN-UNIT-PACKAGE-006、SCN-UNIT-PACKAGE-007、SCN-UNIT-PACKAGE-008、SCN-UNIT-PACKAGE-009、SCN-UNIT-PACKAGE-010、SCN-UNIT-PACKAGE-011、SCN-UNIT-PACKAGE-012、SCN-UNIT-PACKAGE-013、SCN-UNIT-PACKAGE-014、SCN-UNIT-PACKAGE-015、SCN-UNIT-PACKAGE-016、SCN-UNIT-PACKAGE-017、SCN-UNIT-PACKAGE-018、SCN-UNIT-PACKAGE-019 | unit | `test/features/unit/review-policy-package.feature` | `src/domain/review.ts`、`scripts/check_package_contents.ts`、`src/domain/spec.ts`、`src/domain/conformance.ts`、`scripts/check_skill_templates.ts` | 基準commitで合格・本作業treeの全体実行は環境制約 |
@@ -189,7 +187,7 @@ REQ-SQ-027に対応する案件受け入れ条件AC-1024-14は、offline下で
 | REQ-WF-005 | AC-WF-005 | SCN-UNIT-REANCHOR-001、SCN-UNIT-REANCHOR-002、SCN-UNIT-REANCHOR-003、SCN-UNIT-REANCHOR-004、SCN-UNIT-REANCHOR-005、SCN-UNIT-REANCHOR-006、SCN-UNIT-REANCHOR-007、SCN-UNIT-REANCHOR-008、SCN-UNIT-REANCHOR-009、SCN-UNIT-REANCHOR-010、SCN-UNIT-REANCHOR-011、SCN-UNIT-REANCHOR-012、SCN-UNIT-REANCHOR-013、SCN-UNIT-REANCHOR-014、SCN-UNIT-REANCHOR-015、SCN-UNIT-REANCHOR-016、SCN-UNIT-REANCHOR-017、SCN-UNIT-REANCHOR-018、SCN-UNIT-REANCHOR-019、SCN-UNIT-REANCHOR-020、SCN-UNIT-REANCHOR-021、SCN-UNIT-REANCHOR-022、SCN-UNIT-REANCHOR-023、SCN-UNIT-REANCHOR-024、SCN-UNIT-REANCHOR-025、SCN-UNIT-REANCHOR-026、SCN-UNIT-REANCHOR-027、SCN-UNIT-REANCHOR-028、SCN-UNIT-REANCHOR-029、SCN-UNIT-REANCHOR-030、SCN-UNIT-REANCHOR-031 | unit | `test/features/unit/evidence-reanchor.feature` | `src/domain/evidence-reanchor.ts`、`src/adapters/evidence-reanchor.ts`、`src/adapters/delivery-state.ts` | 本作業treeで合格 |
 | REQ-WF-005 | AC-WF-005 | SCN-INT-REANCHOR-001、SCN-INT-REANCHOR-002、SCN-INT-REANCHOR-003、SCN-INT-REANCHOR-004、SCN-INT-REANCHOR-005、SCN-INT-REANCHOR-006、SCN-INT-REANCHOR-007、SCN-INT-REANCHOR-008、SCN-INT-REANCHOR-009、SCN-INT-REANCHOR-010、SCN-INT-REANCHOR-011、SCN-INT-REANCHOR-012、SCN-INT-REANCHOR-013、SCN-INT-REANCHOR-014、SCN-INT-REANCHOR-015 | integration | `test/features/integration/evidence-reanchor.feature` | `src/cli.ts`、`src/adapters/evidence-reanchor.ts`、`src/adapters/delivery-state.ts` | 本作業treeで合格 |
 | REQ-WF-005 | AC-WF-005 | SCN-INT-REVIEWCONV-001、SCN-INT-REVIEWCONV-002 | integration | `test/features/integration/review-convergence.feature` | `src/domain/review-convergence.ts`、`src/adapters/review-session.ts`、`src/domain/workflow.ts`、`src/cli.ts` | 作業treeで2件合格 |
-| REQ-SQ-001 | AC-SQ-001 | SCN-UNIT-ATOMIC-001、SCN-UNIT-ATOMIC-002、SCN-UNIT-ATOMIC-003、SCN-UNIT-ATOMIC-004、SCN-UNIT-ATOMIC-005 | unit | `test/features/unit/atomic-write.feature` | `src/lib/atomic.ts` | 合格・作業treeで対象実行済み |
+| REQ-SQ-001 | AC-SQ-001 | SCN-UNIT-ATOMIC-001、SCN-UNIT-ATOMIC-002、SCN-UNIT-ATOMIC-003、SCN-UNIT-ATOMIC-004 | unit | `test/features/unit/atomic-write.feature` | `src/lib/atomic.ts` | 合格・作業treeで対象実行済み |
 | REQ-SQ-001 | AC-SQ-001 | SCN-UNIT-WTIGN-001、SCN-UNIT-WTIGN-002、SCN-UNIT-WTIGN-003、SCN-UNIT-WTIGN-004、SCN-UNIT-WTIGN-005、SCN-UNIT-WTIGN-006 | unit | `test/features/unit/worktree-ignored-artifacts.feature` | `src/domain/worktree.ts` | 合格・作業treeで対象実行済み |
 | REQ-SQ-001 | AC-SQ-001 | SCN-INT-WTIGN-001 | integration | `test/features/integration/worktree-ignored-artifacts.feature` | `src/cli.ts` | 合格・作業treeで対象実行済み |
 | REQ-SQ-001 | AC-SQ-001 | SCN-UNIT-POLICYFILE-001、SCN-UNIT-POLICYFILE-002、SCN-UNIT-POLICYFILE-003、SCN-UNIT-POLICYFILE-004、SCN-UNIT-POLICYFILE-005、SCN-UNIT-POLICYFILE-006 | unit | `test/features/unit/project-policy-file-target.feature` | `src/domain/policy.ts` | 合格・作業treeで対象実行済み |
diff --git "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md" "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
index 6a277f07..51d70dde 100644
--- "a/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
+++ "b/docs/specs/15_\350\246\201\344\273\266\350\277\275\350\267\241/01_\345\244\211\346\233\264\345\261\245\346\255\264.md"
@@ -2,7 +2,7 @@
 
 | 日付 | 変更 | 要件・SCN | 用語ID | 更新文書 | Issue・PR | 互換性 | 判断者 | HEAD SHA |
 |---|---|---|---|---|---|---|---|---|
-| 2026-09-12 | review入力を固定したまま判定非依存の進捗だけを専用digest chainへ追記し、read-only表示する安全な並行経路を追加 | REQ-WF-021、AC-WF-021、SCN-INT/UNIT/E2E-PROGRESS-001〜021 | TERM-ASC-107 | `01_システム概要/02_用語・略語.md`、`02_要件/`、`06_外部インターフェース/`、`07_データ/`、`11_非機能/`、`15_要件追跡/`、配布03 template | Issue #1336 | 専用journalだけをstaging digestから分離し、review入力treeへの投影applyとgateからjournalを読むedgeを禁止する。progress失敗は従来reviewを停止しない | repository ownerの指示とClaude Opus反例探索2回 | 作業tree、base `8e7405b9` |
+| 2026-09-12 | provider観測が`unknown`になったときの`entrypoint`へ製品が組み立てた実行argvを、`reason`へ終了値を載せる。Codex以外に公式catalog入口が無く`claude`の観測が必ず`unknown`になることを仕様の明示契約にする | REQ-WF-007、AC-WF-007、SCN-UNIT-OBSDIAG-001〜005 | なし | `02_要件/`、`06_外部インターフェース/`、`15_要件追跡/` | Issue #1341 | 観測失敗時の`entrypoint`・`reason`の内容が変わる。`ProcessResult`へoptionalな`launchFailure`を追加する（既存の呼び出しは読まないため不変）。`state`値域、終了値、`codex`経路の観測結果は不変 | package owner | 実装commitで確定 |
 | 2026-09-12 | SCN IDの文法を`src/domain/scenario-id.ts`の単一正本にし、`issue validate`のscenario行検出へ末尾境界と文法外IDの名指し診断を加える。delivery証跡検査は同じ述語を参照し、工程の入口と終端の受理集合を一致させる | REQ-WF-006、AC-WF-006、SCN-UNIT-SCNID-001〜004 | TERM-ASC-105 | `01_システム概要/`、`02_要件/`、`06_外部インターフェース/`、`15_要件追跡/` | Issue #1349 | `issue validate`は文法外のSCN ID（小文字枝番等）を新たに拒否する。正規IDの判定は不変 | package owner | 実装commitで確定 |
 | 2026-09-12 | `workflow advance`で保存済みstateから次の1 Stepを導出し、既定preview、Step別成果物検証・journal記録、外部書込み直前のIssue本文競合検査、Step 4・8の生成本文同期と実測Evidence、公開済み同期の重複送信を避けるjournal復旧、Step 9成果物のexact HEAD拘束、Step 10・11の専用gate委譲を提供する | REQ-WF-020、AC-WF-020、SCN-UNIT-ADVANCE-001〜005、SCN-E2E-ADVANCE-001〜013 | TERM-ASC-106追加 | `01_システム概要/02_用語・略語.md`、`02_要件/01_ワークフロー要件.md`、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`15_要件追跡/`、`dist/` | Issue #1335 | 公開subcommand追加。既存個別command、journal形式、review・delivery authorityは不変 | package owner | 実装commitで確定 |
 | 2026-09-11 | Verification Set risk=`low`のとき02 §4.2・§8・§9と03 §5.2を`対象外: <理由>`の理由付き1行へ縮め、`issue validate`がstrict risk入力と節を突合する | REQ-WF-018、REQ-WF-019、SCN-WF-1334-001、SCN-WF-1334-002、SCN-WF-1334-003、SCN-WF-1334-004、SCN-WF-1334-005、SCN-WF-1334-006、SCN-WF-1334-007、SCN-WF-1334-008、SCN-WF-1334-009、SCN-WF-1334-010、SCN-WF-1334-011、SCN-INT-WF-1334-001、SCN-INT-WF-1334-002 | TERM-ASC-104追加 | `01_システム概要/02_用語・略語.md`、`02_要件/01_ワークフロー要件.md`、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`15_要件追跡/`、配布02/03 template | Issue #1334 | lowへ後方互換な短縮形式を追加。medium/high/critical、既存詳細形式、Q-01〜Q-08は不変 | package owner | 実装commitで確定 |
diff --git a/scripts/check_conformance.ts b/scripts/check_conformance.ts
index 01121dc6..c86c854b 100644
--- a/scripts/check_conformance.ts
+++ b/scripts/check_conformance.ts
@@ -463,61 +463,6 @@ export interface RepositoryRuleLedgerResult {
   };
 }
 
-export function checkParallelProgressSourceIsolation(
-  sources: Readonly<Record<string, string>>,
-): string[] {
-  const errors: string[] = [];
-  const journalReaders = new Set([
-    "src/domain/staging.ts",
-    "src/adapters/review-progress.ts",
-  ]);
-  for (const [relative, source] of Object.entries(sources)) {
-    if (
-      !journalReaders.has(relative) &&
-      (source.includes("REVIEW_PROGRESS_JOURNAL_FILE") ||
-        source.includes("journal/review-progress.jsonl"))
-    )
-      errors.push(
-        `parallel progress journalを許可外sourceが読んでいます: ${relative}`,
-      );
-    if (
-      /(?:^|\/)delivery[^/]*\.ts$/u.test(relative) &&
-      /from\s+["'][^"']*review-progress\.js["']/u.test(source)
-    )
-      errors.push(`deliveryがparallel progressへ依存しています: ${relative}`);
-  }
-  const reviewSession = sources["src/adapters/review-session.ts"] ?? "";
-  for (const forbidden of [
-    "parseReviewProgressRecords",
-    "projectReviewProgressTarget",
-    "verifyReviewProgressTarget",
-    "REVIEW_PROGRESS_JOURNAL_FILE",
-  ])
-    if (reviewSession.includes(forbidden))
-      errors.push(
-        `review gateがparallel progress evidenceを読みます: ${forbidden}`,
-      );
-  const adapter = sources["src/adapters/review-progress.ts"] ?? "";
-  if (
-    adapter.includes("refreshStoredStagingDigest") ||
-    /writeFileAtomic\(\s*(?:current|observed)\.target/u.test(adapter)
-  )
-    errors.push("parallel progressがreview入力treeへ書き込みます");
-  return errors;
-}
-
-export function checkParallelProgressIsolation(root: string): string[] {
-  const sources = Object.fromEntries(
-    assetFiles(path.join(root, "src"))
-      .filter((file) => file.endsWith(".ts"))
-      .map((file) => [
-        path.relative(root, file).split(path.sep).join("/"),
-        fs.readFileSync(file, "utf8"),
-      ]),
-  );
-  return checkParallelProgressSourceIsolation(sources);
-}
-
 export function checkRepositoryRuleLedger(
   root: string,
 ): RepositoryRuleLedgerResult {
@@ -600,7 +545,6 @@ export function checkRepositoryRuleLedger(
   errors.push(...checkDistributionGateReachability(root));
   errors.push(...checkModeQuestionText(root));
   errors.push(...checkLifecycleIgnore(root));
-  errors.push(...checkParallelProgressIsolation(root));
   errors.push(...checkWorktreeContract(root).errors);
   errors.push(...checkRequirementIdScheme(root).errors);
   errors.push(...checkCanonicalScopeAlignment(root));
diff --git a/src/adapters/provider.ts b/src/adapters/provider.ts
index 3e6e92fe..d13b8a5f 100644
--- a/src/adapters/provider.ts
+++ b/src/adapters/provider.ts
@@ -228,19 +228,32 @@ function isLegacyProviderCatalog(
   return value.available ? models.length > 0 : models.length === 0;
 }
 
+/**
+ * 観測に到達できなかったときの結果を組み立てる。**実行した入口と終了値を残す**（Issue #1341）。
+ *
+ * 旧版は`entrypoint`がprovider名だけ、`reason`が理由だけだったため、利用者は
+ * 「何を実行して何が返ったか」を配布物の`dist`を読むまで特定できなかった。
+ * `stderr`本文と入力本文は載せない（仕様06）。載せるのは製品が組み立てたargvと
+ * 整数の終了値だけである。
+ */
 function unknownObservation(
   provider: string,
   observedAt: string,
   reason: string,
+  attempt: { args: readonly string[]; exitCode?: number } = { args: [] },
 ): ProviderAvailabilityObservation {
+  const entrypoint = [provider, ...attempt.args].join(" ");
   return {
     provider,
     state: "unknown",
     models: [],
     modelMetadata: [],
     observedAt,
-    entrypoint: provider === "codex" ? "codex app-server model/list" : provider,
-    reason,
+    entrypoint,
+    reason:
+      attempt.exitCode === undefined
+        ? reason
+        : `${reason}（終了値${attempt.exitCode}）`,
   };
 }
 
@@ -257,41 +270,61 @@ export async function observeProvider(
       observedAt,
       "provider実行入口の名前が不正です",
     );
+  const args =
+    provider === "codex"
+      ? [
+          "app-server",
+          "--stdio",
+          ...(options.official ? CODEX_SELECTION_CONFIG : []),
+        ]
+      : ["models", "list", "--json"];
   let result: ProcessResult;
   try {
     const observer =
       options.official && execute === defaultExecutor
         ? (
             file: string,
-            args: string[],
+            args_: string[],
             cwd: string,
             processOptions: ProcessOptions,
-          ) => runCodexSession(file, args, cwd, processOptions, true)
+          ) => runCodexSession(file, args_, cwd, processOptions, true)
         : execute;
-    result = await observer(
-      provider,
-      provider === "codex"
-        ? [
-            "app-server",
-            "--stdio",
-            ...(options.official ? CODEX_SELECTION_CONFIG : []),
-          ]
-        : ["models", "list", "--json"],
-      options.cwd ?? process.cwd(),
-      { allowFailure: true, timeoutMs: PROVIDER_TIMEOUT_MS },
-    );
+    /**
+     * **argsは複写して渡す。** 同じ配列参照を診断へ再利用すると、executorが
+     * 配列を書き換えた場合に「製品が実際に実行したargv」ではない値を報告する
+     * （Issue #1341のREV-02）。
+     */
+    result = await observer(provider, [...args], options.cwd ?? process.cwd(), {
+      allowFailure: true,
+      timeoutMs: PROVIDER_TIMEOUT_MS,
+    });
   } catch {
     return unknownObservation(
       provider,
       observedAt,
       "provider実行入口を起動できません",
+      { args },
     );
   }
+  /**
+   * **起動できなかった場合は終了値を載せない。** `run`は`allowFailure=true`のとき
+   * 起動失敗も終了値1へ写すため、`status`だけでは区別できない（Issue #1341のREV-01）。
+   * 「終了値1で終わった」と報告すると、利用者は引数を疑って実際の原因（pathが無い）へ
+   * 到達できない。
+   */
+  if (result.launchFailure)
+    return unknownObservation(
+      provider,
+      observedAt,
+      "provider実行入口を起動できません",
+      { args },
+    );
   if (result.status !== 0)
     return unknownObservation(
       provider,
       observedAt,
       "provider実行入口のread-only観測が失敗しました",
+      { args, exitCode: result.status },
     );
   let catalog: ProviderCatalog | undefined;
   try {
@@ -313,6 +346,7 @@ export async function observeProvider(
             provider,
             observedAt,
             "公式catalogのconfig/read応答を確認できません",
+            { args, exitCode: result.status },
           );
         const config = configuration.result.config;
         if (
@@ -326,6 +360,7 @@ export async function observeProvider(
             provider,
             observedAt,
             "公式catalogを確認できません。model_catalog_json指定を解除しOpenAI providerで再実行してください",
+            { args, exitCode: result.status },
           );
         if (
           responses.filter(
@@ -336,6 +371,7 @@ export async function observeProvider(
             provider,
             observedAt,
             "model/list応答が一意ではありません",
+            { args, exitCode: result.status },
           );
       }
       catalog = codexCatalog(result.stdout);
@@ -360,6 +396,7 @@ export async function observeProvider(
       provider,
       observedAt,
       "provider model catalogを解釈できません",
+      { args, exitCode: result.status },
     );
   }
   if (!catalog)
@@ -367,6 +404,7 @@ export async function observeProvider(
       provider,
       observedAt,
       "provider model catalogの構造が不正です",
+      { args, exitCode: result.status },
     );
   return {
     provider,
diff --git a/src/adapters/review-progress.ts b/src/adapters/review-progress.ts
deleted file mode 100644
index df3c5569..00000000
--- a/src/adapters/review-progress.ts
+++ /dev/null
@@ -1,220 +0,0 @@
-import crypto from "node:crypto";
-import fs from "node:fs";
-import path from "node:path";
-import {
-  latestReviewProgressDigest,
-  makeReviewProgressEntry,
-  makeReviewProgressSeal,
-  parseReviewProgressRecords,
-  projectReviewProgressTarget,
-  type ReviewProgressRecord,
-  type ReviewProgressState,
-} from "../domain/review-progress.js";
-import {
-  REVIEW_PROGRESS_JOURNAL_FILE,
-  withStagingMutationLock,
-} from "../domain/staging.js";
-import { writeFileAtomic } from "../lib/atomic.js";
-import { git } from "../lib/process.js";
-import { stableJson } from "../lib/security.js";
-import { assertWorkflowStaging } from "./workflow-journal.js";
-import { readStoredReviewSession } from "./review-session-store.js";
-
-function context(stagingInput: string) {
-  const staging = assertWorkflowStaging(stagingInput);
-  const session = readStoredReviewSession(staging);
-  if (!session?.anchor.progressInventory)
-    throw new Error(
-      "review sessionにparallel progress inventoryがありません。従来の直列経路を使用してください",
-    );
-  const root = path.resolve(staging, "../../../..");
-  const head = git(
-    ["rev-parse", "--verify", "HEAD^{commit}"],
-    root,
-  ).stdout.trim();
-  if (head !== session.latestCandidateHeadSha)
-    throw new Error("progress bindingのH_implがcurrent HEADと一致しません");
-  const journal = path.join(staging, REVIEW_PROGRESS_JOURNAL_FILE);
-  const records = fs.existsSync(journal)
-    ? readJournal(journal)
-    : ([] as readonly ReviewProgressRecord[]);
-  for (const record of records)
-    if (
-      record.sessionId !== session.sessionId ||
-      record.implementationHeadSha !== head
-    )
-      throw new Error(
-        "progress journalのreview sessionまたはH_impl bindingが不正です",
-      );
-  const target = path.join(
-    staging,
-    session.anchor.progressInventory.targetPath,
-  );
-  const targetStat = fs.lstatSync(target);
-  if (
-    targetStat.isSymbolicLink() ||
-    !targetStat.isFile() ||
-    targetStat.nlink !== 1 ||
-    (targetStat.mode & 0o777) !== session.anchor.progressInventory.fileMode ||
-    fs.realpathSync(target) !== target
-  )
-    throw new Error("parallel progress targetのidentityまたはmodeが不正です");
-  const targetDigest = crypto
-    .createHash("sha256")
-    .update(fs.readFileSync(target))
-    .digest("hex");
-  if (targetDigest !== session.anchor.progressInventory.baselineDigest)
-    throw new Error(
-      "parallel progress targetがreview開始時点から変化しました。従来の直列経路を使用してください",
-    );
-  return {
-    staging,
-    session,
-    head,
-    journal,
-    records,
-    inventory: session.anchor.progressInventory,
-    target,
-  };
-}
-
-function readJournal(file: string): readonly ReviewProgressRecord[] {
-  const stat = fs.lstatSync(file);
-  if (
-    stat.isSymbolicLink() ||
-    !stat.isFile() ||
-    stat.nlink !== 1 ||
-    (stat.mode & 0o777) !== 0o600 ||
-    fs.realpathSync(file) !== file
-  )
-    throw new Error(
-      "progress journalはmode 100600の単一link通常fileが必要です",
-    );
-  return parseReviewProgressRecords(fs.readFileSync(file, "utf8"));
-}
-
-function writeJournal(
-  file: string,
-  records: readonly ReviewProgressRecord[],
-): void {
-  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
-  writeFileAtomic(
-    file,
-    records.map((record) => stableJson(record)).join("\n") + "\n",
-    { temporaryDirectory: path.dirname(path.dirname(file)) },
-  );
-  const reread = readJournal(file);
-  if (stableJson(reread) !== stableJson(records))
-    throw new Error("progress journalのwrite後read-backが一致しません");
-}
-
-export function appendReviewProgress(input: {
-  staging: string;
-  taskId: string;
-  state: ReviewProgressState;
-  recordedAt: string;
-  expectedDigest: string | null;
-  apply: boolean;
-}) {
-  const observed = context(input.staging);
-  if (latestReviewProgressDigest(observed.records) !== input.expectedDigest)
-    throw new Error("progress journal digestがpreview時点から変化しました");
-  const duplicate = observed.records.find(
-    (record) =>
-      "taskId" in record &&
-      record.taskId === input.taskId &&
-      record.state === input.state &&
-      record.recordedAt === input.recordedAt,
-  );
-  if (duplicate)
-    return {
-      applied: input.apply,
-      idempotent: true,
-      entry: duplicate,
-      journalDigest: latestReviewProgressDigest(observed.records),
-    };
-  if (!observed.inventory.allowedTaskIds.includes(input.taskId))
-    throw new Error(
-      "progress taskIdは03_実装計画.mdに宣言済みでなければなりません",
-    );
-  const entry = makeReviewProgressEntry({
-    previous: observed.records,
-    sessionId: observed.session.sessionId,
-    implementationHeadSha: observed.head,
-    taskId: input.taskId,
-    state: input.state,
-    recordedAt: input.recordedAt,
-  });
-  if (!input.apply)
-    return { applied: false, entry, journalDigest: entry.entryDigest };
-  return withStagingMutationLock(observed.staging, () => {
-    const current = context(observed.staging);
-    if (latestReviewProgressDigest(current.records) !== input.expectedDigest)
-      throw new Error("progress journal digestがapply直前に変化しました");
-    writeJournal(current.journal, [...current.records, entry]);
-    return { applied: true, entry, journalDigest: entry.entryDigest };
-  });
-}
-
-export function sealReviewProgress(input: {
-  staging: string;
-  sealedAt: string;
-  expectedDigest: string | null;
-  apply: boolean;
-}) {
-  const observed = context(input.staging);
-  if (latestReviewProgressDigest(observed.records) !== input.expectedDigest)
-    throw new Error("progress journal digestがpreview時点から変化しました");
-  const seal = makeReviewProgressSeal({
-    previous: observed.records,
-    sessionId: observed.session.sessionId,
-    implementationHeadSha: observed.head,
-    sealedAt: input.sealedAt,
-  });
-  if (!input.apply)
-    return { applied: false, seal, journalDigest: seal.sealDigest };
-  return withStagingMutationLock(observed.staging, () => {
-    const current = context(observed.staging);
-    if (latestReviewProgressDigest(current.records) !== input.expectedDigest)
-      throw new Error("progress journal digestがapply直前に変化しました");
-    writeJournal(current.journal, [...current.records, seal]);
-    return { applied: true, seal, journalDigest: seal.sealDigest };
-  });
-}
-
-export function projectReviewProgress(input: {
-  staging: string;
-  apply: boolean;
-}) {
-  if (input.apply)
-    throw new Error(
-      "parallel progress projectionはread-onlyです。review入力treeへ書き込めません",
-    );
-  const observed = context(input.staging);
-  const source = fs.readFileSync(observed.target, "utf8");
-  const targetDigest = crypto.createHash("sha256").update(source).digest("hex");
-  const projected = projectReviewProgressTarget({
-    inventory: observed.inventory,
-    source,
-    records: observed.records,
-  });
-  return { applied: false, projected, targetDigest };
-}
-
-export function verifyStoredReviewProgress(staging: string) {
-  const observed = context(staging);
-  const source = fs.readFileSync(observed.target, "utf8");
-  const projected = projectReviewProgressTarget({
-    inventory: observed.inventory,
-    source,
-    records: observed.records,
-  });
-  return {
-    verified: true,
-    sessionId: observed.session.sessionId,
-    implementationHeadSha: observed.head,
-    journalDigest: latestReviewProgressDigest(observed.records),
-    targetDigest: crypto.createHash("sha256").update(source).digest("hex"),
-    projected,
-  };
-}
diff --git a/src/adapters/review-session.ts b/src/adapters/review-session.ts
index 1bb972e2..36f95d6d 100644
--- a/src/adapters/review-session.ts
+++ b/src/adapters/review-session.ts
@@ -1,4 +1,3 @@
-import fs from "node:fs";
 import path from "node:path";
 import {
   advanceReviewSession,
@@ -16,11 +15,6 @@ import {
 import { writeFileAtomic } from "../lib/atomic.js";
 import { git } from "../lib/process.js";
 import { stableJson } from "../lib/security.js";
-import {
-  buildReviewProgressInventory,
-  PROGRESS_END,
-  PROGRESS_START,
-} from "../domain/review-progress.js";
 import {
   assertWorkflowStaging,
   readWorkflowJournal,
@@ -148,19 +142,6 @@ export function buildReviewRoundDraft(input: {
       );
     const baseSha = resolveCommit(root, "--base", input.baseSha);
     const observed = observeReviewDiff(root, baseSha, headSha);
-    const progressTarget = path.join(staging, "03_実装計画.md");
-    const progressSource = fs.existsSync(progressTarget)
-      ? fs.readFileSync(progressTarget, "utf8")
-      : undefined;
-    const progressInventory =
-      progressSource?.includes(PROGRESS_START) &&
-      progressSource.includes(PROGRESS_END)
-        ? buildReviewProgressInventory(
-            "03_実装計画.md",
-            progressSource,
-            fs.lstatSync(progressTarget).mode & 0o777,
-          )
-        : undefined;
     round = {
       round: 1,
       previousRoundDigest: null,
@@ -172,7 +153,6 @@ export function buildReviewRoundDraft(input: {
         diffBaseSha: baseSha,
         initialHeadSha: headSha,
         initialDiffDigest: observed.digest,
-        ...(progressInventory ? { progressInventory } : {}),
       },
       candidateHeadSha: headSha,
       focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
@@ -265,28 +245,6 @@ export function previewReviewRound(input: {
       throw new Error(
         "review roundのinitial diff digestがGit観測値と一致しません",
       );
-    const inventory = input.round.anchor.progressInventory;
-    if (inventory) {
-      const target = path.join(staging, inventory.targetPath);
-      const targetStat = fs.lstatSync(target);
-      if (
-        targetStat.isSymbolicLink() ||
-        !targetStat.isFile() ||
-        targetStat.nlink !== 1 ||
-        (targetStat.mode & 0o777) !== inventory.fileMode ||
-        fs.realpathSync(target) !== target
-      )
-        throw new Error("review roundのprogress target identityが不正です");
-      const observedInventory = buildReviewProgressInventory(
-        inventory.targetPath,
-        fs.readFileSync(target, "utf8"),
-        targetStat.mode & 0o777,
-      );
-      if (stableJson(observedInventory) !== stableJson(inventory))
-        throw new Error(
-          "review roundのprogress inventoryが実targetと一致しません",
-        );
-    }
   } else {
     /**
      * **前round headは再固定chainから導出した実効HEADである。**
diff --git a/src/cli-usage.ts b/src/cli-usage.ts
index f4801449..b3a9e7f4 100644
--- a/src/cli-usage.ts
+++ b/src/cli-usage.ts
@@ -838,37 +838,6 @@ export const COMMAND_USAGE: readonly CommandUsage[] = Object.freeze([
       },
     },
   },
-  {
-    command: "review",
-    subcommand: "progress",
-    summary:
-      "固定review入力treeへ影響しない進捗をpreview・追記・read-only表示・検証する",
-    requiredFlags: [
-      flag("staging", "path", "対象Issue staging"),
-      flag("operation", "append|seal|project|verify", "進捗操作"),
-    ],
-    conditionalFlags: [
-      conditional("task", "ID", "宣言済みtask ID", "operation=append"),
-      conditional(
-        "state",
-        "planned|started|completed|blocked",
-        "進捗state",
-        "operation=append",
-      ),
-    ],
-    optionalFlags: [
-      optional("recorded-at", "ISO8601", "記録時刻", "実行時刻"),
-      optional(
-        "expected-journal-digest",
-        "sha256",
-        "直前journal digest。初回は省略",
-        "null",
-      ),
-      optional("apply", "", "append・sealだけを永続化する", "preview"),
-    ],
-    example:
-      "npx agent-skill-chain review progress --staging=.agent-skill-chain/tmp/issues/20260912_change --operation=append --task=T01 --state=completed",
-  },
   {
     command: "review",
     subcommand: "validate",
diff --git a/src/cli.ts b/src/cli.ts
index 0a0a0b9a..7eebaebe 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -20,12 +20,6 @@ import {
 } from "./domain/spec.js";
 import { buildReviewEvidence, evaluateReview } from "./domain/review.js";
 import { parseReviewRoundInput } from "./domain/review-convergence.js";
-import {
-  appendReviewProgress,
-  projectReviewProgress,
-  sealReviewProgress,
-  verifyStoredReviewProgress,
-} from "./adapters/review-progress.js";
 import {
   isReviewArtifactParentContained,
   isReviewArtifactStagingDirectChild,
@@ -6436,86 +6430,6 @@ export async function main(
     print({ applied: apply, ...state });
     return 0;
   }
-  if (command === "review" && subcommand === "progress") {
-    const { flags, positionals } = parse(rest);
-    const allowed = [
-      "staging",
-      "operation",
-      "task",
-      "state",
-      "recorded-at",
-      "expected-journal-digest",
-      "apply",
-    ];
-    const unknown = Object.keys(flags).filter(
-      (flag) => !allowed.includes(flag),
-    );
-    if (unknown.length > 0)
-      throw new Error(
-        `review progressの未知optionです: --${unknown.join(", --")}`,
-      );
-    if (positionals.length > 0)
-      throw new Error("review progressに位置引数は使用できません");
-    const staging = required(flags, "staging");
-    const operation = required(flags, "operation");
-    const apply = flags.apply === true;
-    if (flags.apply !== undefined && !apply)
-      throw new Error("review progress --applyに値は指定できません");
-    const expectedJournalDigest =
-      typeof flags["expected-journal-digest"] === "string"
-        ? flags["expected-journal-digest"]
-        : null;
-    if (operation === "append") {
-      const state = required(flags, "state");
-      if (!["planned", "started", "completed", "blocked"].includes(state))
-        throw new Error("review progress --stateが不正です");
-      print(
-        appendReviewProgress({
-          staging,
-          taskId: required(flags, "task"),
-          state: state as "planned" | "started" | "completed" | "blocked",
-          recordedAt:
-            typeof flags["recorded-at"] === "string"
-              ? flags["recorded-at"]
-              : new Date().toISOString(),
-          expectedDigest: expectedJournalDigest,
-          apply,
-        }),
-      );
-      return 0;
-    }
-    if (operation === "seal") {
-      print(
-        sealReviewProgress({
-          staging,
-          sealedAt:
-            typeof flags["recorded-at"] === "string"
-              ? flags["recorded-at"]
-              : new Date().toISOString(),
-          expectedDigest: expectedJournalDigest,
-          apply,
-        }),
-      );
-      return 0;
-    }
-    if (operation === "project") {
-      print(
-        projectReviewProgress({
-          staging,
-          apply,
-        }),
-      );
-      return 0;
-    }
-    if (operation === "verify") {
-      if (apply) throw new Error("review progress verifyはread-onlyです");
-      print(verifyStoredReviewProgress(staging));
-      return 0;
-    }
-    throw new Error(
-      "review progress --operationはappend|seal|project|verifyが必要です",
-    );
-  }
   if (command === "review" && subcommand === "evidence") {
     const { flags } = parse(rest);
     if (flags.external !== undefined)
diff --git a/src/domain/review-convergence.ts b/src/domain/review-convergence.ts
index 5ca05320..a2dbfc79 100644
--- a/src/domain/review-convergence.ts
+++ b/src/domain/review-convergence.ts
@@ -1,10 +1,6 @@
 import crypto from "node:crypto";
 import { stableJson } from "../lib/security.js";
 import { isRecord } from "../types.js";
-import {
-  parseReviewProgressInventory,
-  type ReviewProgressInventory,
-} from "./review-progress.js";
 
 /**
  * 通常のreviewラウンド予算。round 1で全scopeを見て、2と3で未解決blockerを追う。
@@ -48,7 +44,6 @@ export interface ReviewSessionAnchor {
   diffBaseSha: string;
   initialHeadSha: string;
   initialDiffDigest: string;
-  progressInventory?: ReviewProgressInventory;
 }
 
 export interface ReviewAdjacentScope {
@@ -185,28 +180,14 @@ function oneOf<const Values extends readonly string[]>(
 }
 
 function parseAnchor(value: unknown): ReviewSessionAnchor {
-  if (!isRecord(value)) throw new Error("review anchorはobjectが必要です");
-  const fields = [
+  const anchor = exactObject(value, "review anchor", [
     "scopeIds",
     "acceptanceCriteriaIds",
     "invariantIds",
     "diffBaseSha",
     "initialHeadSha",
     "initialDiffDigest",
-    "progressInventory",
-  ];
-  const required = fields.filter((field) => field !== "progressInventory");
-  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
-  const missing = required.filter((field) => !(field in value));
-  if (unknown.length > 0)
-    throw new Error(
-      `review anchorの未知fieldを拒否しました: ${unknown.join(", ")}`,
-    );
-  if (missing.length > 0)
-    throw new Error(
-      `review anchorの必須fieldがありません: ${missing.join(", ")}`,
-    );
-  const anchor = value;
+  ]);
   const scopeIds = stableStrings(anchor.scopeIds, "review anchor.scopeIds");
   const acceptanceCriteriaIds = stableStrings(
     anchor.acceptanceCriteriaIds,
@@ -231,13 +212,6 @@ function parseAnchor(value: unknown): ReviewSessionAnchor {
     diffBaseSha: String(anchor.diffBaseSha),
     initialHeadSha: String(anchor.initialHeadSha),
     initialDiffDigest: String(anchor.initialDiffDigest),
-    ...(anchor.progressInventory === undefined
-      ? {}
-      : {
-          progressInventory: parseReviewProgressInventory(
-            anchor.progressInventory,
-          ),
-        }),
   });
 }
 
diff --git a/src/domain/review-progress.ts b/src/domain/review-progress.ts
deleted file mode 100644
index 9fd325f3..00000000
--- a/src/domain/review-progress.ts
+++ /dev/null
@@ -1,378 +0,0 @@
-import crypto from "node:crypto";
-import { stableJson } from "../lib/security.js";
-import { isRecord } from "../types.js";
-
-export const PROGRESS_START = "<!-- asc:parallel-progress:start -->";
-export const PROGRESS_END = "<!-- asc:parallel-progress:end -->";
-const SHA256 = /^[a-f0-9]{64}$/u;
-const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
-const TASK_ID = /^[A-Z][A-Z0-9._-]{1,63}$/u;
-const STATES = ["planned", "started", "completed", "blocked"] as const;
-
-export type ReviewProgressState = (typeof STATES)[number];
-
-export interface ReviewProgressInventory {
-  targetPath: "03_実装計画.md";
-  baselineDigest: string;
-  prefixDigest: string;
-  suffixDigest: string;
-  fileMode: 420;
-  allowedTaskIds: readonly string[];
-}
-
-export interface ReviewProgressEntry {
-  schemaVersion: "agent-skill-chain/review-progress-entry/v1";
-  sequence: number;
-  entryId: string;
-  sessionId: string;
-  implementationHeadSha: string;
-  taskId: string;
-  state: ReviewProgressState;
-  recordedAt: string;
-  previousDigest: string | null;
-  entryDigest: string;
-}
-
-export interface ReviewProgressSeal {
-  schemaVersion: "agent-skill-chain/review-progress-seal/v1";
-  sessionId: string;
-  implementationHeadSha: string;
-  previousDigest: string | null;
-  sealedAt: string;
-  sealDigest: string;
-}
-
-export type ReviewProgressRecord = ReviewProgressEntry | ReviewProgressSeal;
-
-function sha256(value: string | Buffer): string {
-  return crypto.createHash("sha256").update(value).digest("hex");
-}
-
-function splitTarget(source: string): {
-  prefix: string;
-  body: string;
-  suffix: string;
-} {
-  const start = source.indexOf(PROGRESS_START);
-  const end = source.indexOf(PROGRESS_END);
-  if (
-    start < 0 ||
-    end < 0 ||
-    source.indexOf(PROGRESS_START, start + 1) >= 0 ||
-    source.indexOf(PROGRESS_END, end + 1) >= 0 ||
-    end <= start
-  )
-    throw new Error("parallel progress markerは正確に1組必要です");
-  const bodyStart = start + PROGRESS_START.length;
-  return {
-    prefix: source.slice(0, bodyStart),
-    body: source.slice(bodyStart, end),
-    suffix: source.slice(end),
-  };
-}
-
-export function buildReviewProgressInventory(
-  targetPath: string,
-  source: string,
-  fileMode: number,
-): ReviewProgressInventory {
-  if (targetPath !== "03_実装計画.md")
-    throw new Error("parallel progress targetは03_実装計画.mdだけを許可します");
-  if (fileMode !== 0o644)
-    throw new Error("parallel progress targetはmode 100644が必要です");
-  const { prefix, suffix } = splitTarget(source);
-  const allowedTaskIds = [
-    ...new Set(
-      [...source.matchAll(/^\|\s*([A-Z][A-Z0-9._-]{1,63})\s*\|/gmu)].map(
-        (match) => match[1]!,
-      ),
-    ),
-  ].sort();
-  if (allowedTaskIds.length === 0)
-    throw new Error("parallel progress targetにtask IDが必要です");
-  return Object.freeze({
-    targetPath,
-    baselineDigest: sha256(source),
-    prefixDigest: sha256(prefix),
-    suffixDigest: sha256(suffix),
-    fileMode: 0o644,
-    allowedTaskIds: Object.freeze(allowedTaskIds),
-  });
-}
-
-export function parseReviewProgressInventory(
-  value: unknown,
-): ReviewProgressInventory {
-  if (!isRecord(value)) throw new Error("progress inventoryはobjectが必要です");
-  const fields = [
-    "targetPath",
-    "baselineDigest",
-    "prefixDigest",
-    "suffixDigest",
-    "fileMode",
-    "allowedTaskIds",
-  ];
-  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
-  const missing = fields.filter((field) => !(field in value));
-  if (unknown.length || missing.length)
-    throw new Error("progress inventoryのfieldが不正です");
-  if (
-    value.targetPath !== "03_実装計画.md" ||
-    !SHA256.test(String(value.baselineDigest ?? "")) ||
-    !SHA256.test(String(value.prefixDigest ?? "")) ||
-    !SHA256.test(String(value.suffixDigest ?? "")) ||
-    value.fileMode !== 0o644 ||
-    !Array.isArray(value.allowedTaskIds) ||
-    value.allowedTaskIds.length === 0 ||
-    value.allowedTaskIds.some(
-      (task) => typeof task !== "string" || !TASK_ID.test(task),
-    ) ||
-    stableJson(value.allowedTaskIds) !==
-      stableJson([...new Set(value.allowedTaskIds as string[])].sort())
-  )
-    throw new Error("progress inventoryの値が不正です");
-  return Object.freeze({
-    targetPath: value.targetPath,
-    baselineDigest: String(value.baselineDigest),
-    prefixDigest: String(value.prefixDigest),
-    suffixDigest: String(value.suffixDigest),
-    fileMode: 0o644,
-    allowedTaskIds: Object.freeze([...(value.allowedTaskIds as string[])]),
-  });
-}
-
-function exactInstant(value: unknown, label: string): string {
-  if (typeof value !== "string") throw new Error(`${label}が不正です`);
-  const parsed = Date.parse(value);
-  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
-    throw new Error(`${label}はISO 8601 UTC日時が必要です`);
-  return value;
-}
-
-function digestRecord(value: Record<string, unknown>): string {
-  return sha256(stableJson(value));
-}
-
-export function makeReviewProgressEntry(input: {
-  previous: readonly ReviewProgressRecord[];
-  sessionId: string;
-  implementationHeadSha: string;
-  taskId: string;
-  state: ReviewProgressState;
-  recordedAt: string;
-}): ReviewProgressEntry {
-  if (input.previous.length >= 256)
-    throw new Error("progress journalは256 entry以下が必要です");
-  const previousDigest = latestReviewProgressDigest(input.previous);
-  if (!SHA256.test(input.sessionId) || !OID.test(input.implementationHeadSha))
-    throw new Error("progress entryのreview bindingが不正です");
-  if (!TASK_ID.test(input.taskId)) throw new Error("progress taskIdが不正です");
-  if (!STATES.includes(input.state))
-    throw new Error("progress stateが不正です");
-  exactInstant(input.recordedAt, "progress recordedAt");
-  if (input.previous.some((record) => "sealDigest" in record))
-    throw new Error("sealed progress journalへ追記できません");
-  const sequence = input.previous.length + 1;
-  const identity = {
-    sessionId: input.sessionId,
-    implementationHeadSha: input.implementationHeadSha,
-    taskId: input.taskId,
-    state: input.state,
-    recordedAt: input.recordedAt,
-    sequence,
-  };
-  const entryId = digestRecord(identity);
-  const withoutDigest = {
-    schemaVersion: "agent-skill-chain/review-progress-entry/v1" as const,
-    entryId,
-    ...identity,
-    previousDigest,
-  };
-  return Object.freeze({
-    ...withoutDigest,
-    entryDigest: digestRecord(withoutDigest),
-  });
-}
-
-export function makeReviewProgressSeal(input: {
-  previous: readonly ReviewProgressRecord[];
-  sessionId: string;
-  implementationHeadSha: string;
-  sealedAt: string;
-}): ReviewProgressSeal {
-  if (input.previous.length > 256)
-    throw new Error("progress journalの上限を超えました");
-  if (input.previous.some((record) => "sealDigest" in record))
-    throw new Error("progress journalは既にsealedです");
-  if (!SHA256.test(input.sessionId) || !OID.test(input.implementationHeadSha))
-    throw new Error("progress sealのreview bindingが不正です");
-  exactInstant(input.sealedAt, "progress sealedAt");
-  const withoutDigest = {
-    schemaVersion: "agent-skill-chain/review-progress-seal/v1" as const,
-    sessionId: input.sessionId,
-    implementationHeadSha: input.implementationHeadSha,
-    previousDigest: latestReviewProgressDigest(input.previous),
-    sealedAt: input.sealedAt,
-  };
-  return Object.freeze({
-    ...withoutDigest,
-    sealDigest: digestRecord(withoutDigest),
-  });
-}
-
-export function latestReviewProgressDigest(
-  records: readonly ReviewProgressRecord[],
-): string | null {
-  const latest = records.at(-1);
-  return latest
-    ? "entryDigest" in latest
-      ? latest.entryDigest
-      : latest.sealDigest
-    : null;
-}
-
-export function parseReviewProgressRecords(
-  source: string,
-): readonly ReviewProgressRecord[] {
-  if (Buffer.byteLength(source, "utf8") > 256 * 1024)
-    throw new Error("progress journalは256 KiB以下が必要です");
-  const lines = source === "" ? [] : source.trimEnd().split("\n");
-  if (lines.length > 257) throw new Error("progress journalの上限を超えました");
-  const records: ReviewProgressRecord[] = [];
-  for (const [index, line] of lines.entries()) {
-    let value: unknown;
-    try {
-      value = JSON.parse(line);
-    } catch {
-      throw new Error(`progress journal ${index + 1}行目がJSONではありません`);
-    }
-    if (!isRecord(value)) throw new Error("progress recordはobjectが必要です");
-    const isSeal =
-      value.schemaVersion === "agent-skill-chain/review-progress-seal/v1";
-    const expectedFields = isSeal
-      ? [
-          "schemaVersion",
-          "sessionId",
-          "implementationHeadSha",
-          "previousDigest",
-          "sealedAt",
-          "sealDigest",
-        ]
-      : [
-          "schemaVersion",
-          "sequence",
-          "entryId",
-          "sessionId",
-          "implementationHeadSha",
-          "taskId",
-          "state",
-          "recordedAt",
-          "previousDigest",
-          "entryDigest",
-        ];
-    if (
-      Object.keys(value).some((field) => !expectedFields.includes(field)) ||
-      expectedFields.some((field) => !(field in value))
-    )
-      throw new Error("progress recordのfieldが不正です");
-    if (value.previousDigest !== latestReviewProgressDigest(records))
-      throw new Error("progress journalのdigest chainが不正です");
-    const digestField = isSeal ? "sealDigest" : "entryDigest";
-    const claimed = String(value[digestField] ?? "");
-    const withoutDigest = Object.fromEntries(
-      Object.entries(value).filter(([field]) => field !== digestField),
-    );
-    if (!SHA256.test(claimed) || digestRecord(withoutDigest) !== claimed)
-      throw new Error("progress record digestが不正です");
-    if (isSeal) {
-      if (
-        !SHA256.test(String(value.sessionId ?? "")) ||
-        !OID.test(String(value.implementationHeadSha ?? ""))
-      )
-        throw new Error("progress sealのreview bindingが不正です");
-      exactInstant(value.sealedAt, "progress sealedAt");
-      if (index !== lines.length - 1)
-        throw new Error("seal後のrecordを拒否しました");
-      records.push(value as unknown as ReviewProgressSeal);
-    } else {
-      if (value.schemaVersion !== "agent-skill-chain/review-progress-entry/v1")
-        throw new Error("progress entry schemaVersionが不正です");
-      if (
-        value.sequence !== index + 1 ||
-        !TASK_ID.test(String(value.taskId ?? "")) ||
-        !SHA256.test(String(value.entryId ?? "")) ||
-        !SHA256.test(String(value.sessionId ?? "")) ||
-        !OID.test(String(value.implementationHeadSha ?? ""))
-      )
-        throw new Error("progress entry identityが不正です");
-      if (!STATES.includes(value.state as ReviewProgressState))
-        throw new Error("progress entry stateが不正です");
-      exactInstant(value.recordedAt, "progress recordedAt");
-      const expectedEntryId = digestRecord({
-        sessionId: value.sessionId,
-        implementationHeadSha: value.implementationHeadSha,
-        taskId: value.taskId,
-        state: value.state,
-        recordedAt: value.recordedAt,
-        sequence: value.sequence,
-      });
-      if (value.entryId !== expectedEntryId)
-        throw new Error("progress entryIdがidentityと一致しません");
-      records.push(value as unknown as ReviewProgressEntry);
-    }
-  }
-  return Object.freeze(records);
-}
-
-export function renderReviewProgress(
-  records: readonly ReviewProgressRecord[],
-  taskIds?: readonly string[],
-): string {
-  const latest = new Map<string, ReviewProgressState>();
-  for (const taskId of taskIds ?? []) latest.set(taskId, "planned");
-  for (const record of records)
-    if ("taskId" in record) latest.set(record.taskId, record.state);
-  const rows = [...latest]
-    .sort(([left], [right]) => left.localeCompare(right))
-    .map(([task, state]) => `| ${task} | ${state} |`);
-  return `\n\n| タスク | 並行進捗 |\n|---|---|\n${rows.join("\n")}\n\n`;
-}
-
-export function verifyReviewProgressTarget(input: {
-  inventory: ReviewProgressInventory;
-  source: string;
-  records: readonly ReviewProgressRecord[];
-}): void {
-  const { prefix, body, suffix } = splitTarget(input.source);
-  if (
-    sha256(prefix) !== input.inventory.prefixDigest ||
-    sha256(suffix) !== input.inventory.suffixDigest
-  )
-    throw new Error("parallel progress marker外のbyteがbaselineと一致しません");
-  if (
-    sha256(input.source) !== input.inventory.baselineDigest &&
-    body !== renderReviewProgress(input.records, input.inventory.allowedTaskIds)
-  )
-    throw new Error(
-      "parallel progress sectionがjournalの純粋projectionと一致しません",
-    );
-}
-
-export function projectReviewProgressTarget(input: {
-  inventory: ReviewProgressInventory;
-  source: string;
-  records: readonly ReviewProgressRecord[];
-}): string {
-  verifyReviewProgressTarget(input);
-  const { prefix, suffix } = splitTarget(input.source);
-  return `${prefix}${renderReviewProgress(input.records, input.inventory.allowedTaskIds)}${suffix}`;
-}
-
-export function parallelCriticalPath(
-  reviewDuration: number,
-  progressDuration: number,
-): number {
-  if (reviewDuration < 0 || progressDuration < 0)
-    throw new Error("durationは0以上が必要です");
-  return Math.max(reviewDuration, progressDuration);
-}
diff --git a/src/domain/staging.ts b/src/domain/staging.ts
index 1b056cf1..7319733e 100644
--- a/src/domain/staging.ts
+++ b/src/domain/staging.ts
@@ -58,12 +58,6 @@ export interface StoredStagingRecord {
 export const STAGING_RECORD_FILE = "staging-record.json";
 export const STAGING_PROMOTION_TRANSACTION_FILE =
   ".full-promotion-transaction.json";
-/**
- * Review中の進捗は判定用staging成果物ではなく、固定review入力へ結び付く
- * append-only evidenceである。内容の正当性はreview progress verifierが
- * review-session anchorから再導出するため、一般成果物digestへ混ぜない。
- */
-export const REVIEW_PROGRESS_JOURNAL_FILE = "journal/review-progress.jsonl";
 const ISSUE_STAGING_PREFIX = ".agent-skill-chain/tmp/issues";
 const STORED_FIELDS = new Set([
   "schemaVersion",
@@ -426,11 +420,7 @@ function inventory(directory: string): StagingInventory {
           mtimeMs: stat.mtimeMs,
           digest,
         });
-        if (
-          relative !== STAGING_RECORD_FILE &&
-          relative !== REVIEW_PROGRESS_JOURNAL_FILE
-        )
-          artifacts.push(relative);
+        if (relative !== STAGING_RECORD_FILE) artifacts.push(relative);
       } else {
         unsafe.push(
           `${relative}は通常fileまたはdirectoryではないため保持します`,
diff --git a/src/lib/atomic.ts b/src/lib/atomic.ts
index b6a2b893..cb0564e4 100644
--- a/src/lib/atomic.ts
+++ b/src/lib/atomic.ts
@@ -3,8 +3,6 @@ import path from "node:path";
 import crypto from "node:crypto";
 
 interface AtomicWriteOptions {
-  /** Exact permission bits for the published regular file. Defaults to 0600. */
-  fileMode?: number;
   /**
    * Keep an interrupted temporary file outside a digest-controlled target
    * directory. The directory must be on the same filesystem as destination.
@@ -279,9 +277,6 @@ export function writeFileAtomic(
   contents: string,
   options: AtomicWriteOptions = {},
 ): void {
-  const fileMode = options.fileMode ?? 0o600;
-  if (!Number.isInteger(fileMode) || fileMode < 0 || fileMode > 0o777)
-    throw new Error("atomic writeのfile modeが不正です");
   const resolvedDestination = path.resolve(destination);
   const destinationDirectory = path.dirname(resolvedDestination);
   fs.mkdirSync(destinationDirectory, { recursive: true });
@@ -317,9 +312,8 @@ export function writeFileAtomic(
         fs.constants.O_CREAT |
         fs.constants.O_EXCL |
         fs.constants.O_NOFOLLOW,
-      fileMode,
+      0o600,
     );
-    fs.fchmodSync(temporaryDescriptor, fileMode);
     writeFully(temporaryDescriptor, expected);
     fs.fsyncSync(temporaryDescriptor);
     fs.closeSync(temporaryDescriptor);
diff --git a/src/lib/process.ts b/src/lib/process.ts
index 75d38c5d..6b495fb0 100644
--- a/src/lib/process.ts
+++ b/src/lib/process.ts
@@ -12,6 +12,15 @@ export interface ProcessResult {
   status: number;
   stdout: string;
   stderr: string;
+  /**
+   * **processを起動できなかったことを示す**（ENOENT、timeout、ENOBUFS等。Issue #1341）。
+   *
+   * `allowFailure=true`の呼び出しでは起動失敗も終了値1へ写されるため、`status`だけでは
+   * 「起動できなかった」と「起動して1で終わった」を区別できない。診断が次に採る行動
+   * （pathを直す／引数を直す）を示すにはこの区別が要る。**内容はstderrにあり、
+   * この旗は区別のためだけに持つ。**
+   */
+  launchFailure?: true;
 }
 
 export interface JsonlSessionOptions extends Omit<
@@ -61,6 +70,7 @@ export function run(
     status: failure === undefined ? (result.status ?? 1) : 1,
     stdout: failure === undefined ? (result.stdout ?? "") : "",
     stderr: failure ?? redactSecrets(result.stderr ?? ""),
+    ...(failure === undefined ? {} : { launchFailure: true as const }),
   };
   if (!options.allowFailure && output.status !== 0) {
     throw new Error(
diff --git a/test/features/e2e/review-progress-cli.feature b/test/features/e2e/review-progress-cli.feature
deleted file mode 100644
index dcda796b..00000000
--- a/test/features/e2e/review-progress-cli.feature
+++ /dev/null
@@ -1,17 +0,0 @@
-@e2e
-Feature: parallel progress evidenceのCLI入口と従来経路
-
-  Scenario: SCN-E2E-PROGRESS-018 marker無しは直列経路へ戻る
-    Given parallel progressの純粋fixtureがある
-    When "absent" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-E2E-PROGRESS-019 journal無しの既存anchorを読める
-    Given parallel progressの純粋fixtureがある
-    When "legacy" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-E2E-PROGRESS-020 公開CLI入口にprogress操作がある
-    Given parallel progressの純粋fixtureがある
-    When "cli" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
diff --git a/test/features/integration/review-progress.feature b/test/features/integration/review-progress.feature
deleted file mode 100644
index a0920678..00000000
--- a/test/features/integration/review-progress.feature
+++ /dev/null
@@ -1,52 +0,0 @@
-@integration
-Feature: parallel progress evidenceのadapter境界
-
-  Scenario: SCN-INT-PROGRESS-001 固定H_implへ実adapterで進捗を追記する
-    Given parallel progressの実adapter fixtureがある
-    When review入力を変えずcompleted進捗を実際にappendする
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-002 digest chainで改変を検出する
-    Given parallel progressの純粋fixtureがある
-    When "digest-chain" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-003 review bindingを固定する
-    Given parallel progressの純粋fixtureがある
-    When "binding" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-009 target path traversalを拒否する
-    Given parallel progressの純粋fixtureがある
-    When "traversal" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-010 Unicode制御taskを拒否する
-    Given parallel progressの純粋fixtureがある
-    When "unicode" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-011 stale digest競合を検出する
-    Given parallel progressの純粋fixtureがある
-    When "stale" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-012 途中JSONを拒否する
-    Given parallel progressの純粋fixtureがある
-    When "partial" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-013 seal後追記を拒否する
-    Given parallel progressの純粋fixtureがある
-    When "sealed" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-014 journal上限を拒否する
-    Given parallel progressの純粋fixtureがある
-    When "limit" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-INT-PROGRESS-021 並行critical pathは直列時間を超えない
-    Given parallel progressの純粋fixtureがある
-    When "critical-path" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
diff --git a/test/features/unit/atomic-write.feature b/test/features/unit/atomic-write.feature
index cfe83dd1..93cda954 100644
--- a/test/features/unit/atomic-write.feature
+++ b/test/features/unit/atomic-write.feature
@@ -30,9 +30,3 @@ Feature: 耐久性のある原子的なfile公開
     And sibling一時directoryを外部directoryへのsymlinkへ差し替える
     When 偽装した一時directoryからrecordをatomic更新しようとする
     Then 一時directory境界を拒否して旧recordを維持する
-
-  @SCN-UNIT-ATOMIC-005
-  Scenario: SCN-UNIT-ATOMIC-005 公開前に指定したfile modeを一時fileへ固定する
-    Given digest管理directoryと既存recordがある
-    When mode 0644を指定してrecordをatomic更新する
-    Then recordは完全な新版とmode 0644を保持する
diff --git a/test/features/unit/provider-observation-diagnostic.feature b/test/features/unit/provider-observation-diagnostic.feature
new file mode 100644
index 00000000..f06083d4
--- /dev/null
+++ b/test/features/unit/provider-observation-diagnostic.feature
@@ -0,0 +1,34 @@
+@unit
+Feature: provider観測の失敗診断は実行入口と終了値を示す
+
+  観測に失敗したとき、利用者が配布物のdistを読まずに「何を実行して何が返ったか」を
+  出力だけで特定できるようにする。診断へ載せるのは製品が組み立てたargvと整数の
+  終了値だけであり、標準エラーの本文は転記しない。
+
+  Scenario: SCN-UNIT-OBSDIAG-001 非0終了の観測は実行argvと終了値を返す
+    Given 終了値3で終了する実行入口を持つproviderがある
+    When 失敗診断のためにproviderを観測する
+    Then entrypointは"provider-fixture models list --json"である
+    And reasonは"provider実行入口のread-only観測が失敗しました（終了値3）"である
+
+  Scenario: SCN-UNIT-OBSDIAG-002 起動できない入口は起動失敗として実行argvを返す
+    Given 起動に失敗する実行入口を持つproviderがある
+    When 失敗診断のためにproviderを観測する
+    Then entrypointは"provider-fixture models list --json"である
+    And reasonは"provider実行入口を起動できません"である
+
+  Scenario: SCN-UNIT-OBSDIAG-003 診断にstderrの本文を含めない
+    Given stderrへ秘密を書いて終了値3で終了する実行入口を持つproviderがある
+    When 失敗診断のためにproviderを観測する
+    Then 観測結果のどのfieldにもstderrの本文が現れない
+
+  Scenario: SCN-UNIT-OBSDIAG-004 実在しない実行fileは既定executorでも起動失敗として報告される
+    Given 実在しない実行fileを指すproviderがある
+    When 既定executorで失敗診断のためにproviderを観測する
+    Then reasonは"provider実行入口を起動できません"である
+    And reasonに終了値が現れない
+
+  Scenario: SCN-UNIT-OBSDIAG-005 executorがargsを書き換えても診断は製品が組み立てたargvを示す
+    Given 受け取ったargsを書き換えてから終了値3で終了する実行入口を持つproviderがある
+    When 失敗診断のためにproviderを観測する
+    Then entrypointは"provider-fixture models list --json"である
diff --git a/test/features/unit/review-progress.feature b/test/features/unit/review-progress.feature
deleted file mode 100644
index 294f5b74..00000000
--- a/test/features/unit/review-progress.feature
+++ /dev/null
@@ -1,42 +0,0 @@
-@unit
-Feature: 判定入力から分離したparallel progress evidenceの純粋契約
-
-  Scenario: SCN-UNIT-PROGRESS-004 journalを決定論的に投影する
-    Given parallel progressの純粋fixtureがある
-    When "projection" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-UNIT-PROGRESS-005 prefix改変を拒否する
-    Given parallel progressの純粋fixtureがある
-    When "prefix" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-UNIT-PROGRESS-006 suffix改変を拒否する
-    Given parallel progressの純粋fixtureがある
-    When "suffix" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-UNIT-PROGRESS-007 projectionの1 byte差を拒否する
-    Given parallel progressの純粋fixtureがある
-    When "one-byte" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-UNIT-PROGRESS-008 file mode変更を拒否する
-    Given parallel progressの純粋fixtureがある
-    When "mode" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-UNIT-PROGRESS-015 progressから判定結果を導出しない
-    Given parallel progressの純粋fixtureがある
-    When "no-verdict" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-UNIT-PROGRESS-016 progressからdelivery authorityを導出しない
-    Given parallel progressの純粋fixtureがある
-    When "no-delivery" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
-
-  Scenario: SCN-UNIT-PROGRESS-017 dependency cycleを持たない
-    Given parallel progressの純粋fixtureがある
-    When "acyclic" のparallel progress反例を評価する
-    Then parallel progress契約を満たす
diff --git a/test/steps/atomic-write.steps.ts b/test/steps/atomic-write.steps.ts
index 1ed707a8..1f49af43 100644
--- a/test/steps/atomic-write.steps.ts
+++ b/test/steps/atomic-write.steps.ts
@@ -37,13 +37,6 @@ When("sibling directoryを一時領域としてrecordをatomic更新する", fun
   });
 });
 
-When("mode 0644を指定してrecordをatomic更新する", function () {
-  writeFileAtomic(this.record, newRecord, {
-    temporaryDirectory: this.sibling,
-    fileMode: 0o644,
-  });
-});
-
 When(
   "利用可能なら異なるfilesystemを一時領域としてrecordをatomic更新する",
   function () {
@@ -66,11 +59,6 @@ Then("recordは完全な新版だけを保持する", function () {
   assert.equal(fs.readFileSync(this.record, "utf8"), newRecord);
 });
 
-Then("recordは完全な新版とmode 0644を保持する", function () {
-  assert.equal(fs.readFileSync(this.record, "utf8"), newRecord);
-  assert.equal(fs.statSync(this.record).mode & 0o777, 0o644);
-});
-
 Then("digest管理directoryとsibling directoryに一時fileを残さない", function () {
   const temporaryPattern = /^\.staging-record\.json\.tmp-/u;
   assert.deepEqual(
diff --git a/test/steps/project-rule-ledger.steps.ts b/test/steps/project-rule-ledger.steps.ts
index fb46b3b8..9484d25b 100644
--- a/test/steps/project-rule-ledger.steps.ts
+++ b/test/steps/project-rule-ledger.steps.ts
@@ -65,7 +65,6 @@ const LEDGER_COMPOSED_CHECKS: readonly string[] = [
   "checkLifecycleIgnore",
   "checkModeQuestionText",
   "checkNodeRuntimeAlignment",
-  "checkParallelProgressIsolation",
   "checkPackageDistributionBoundary",
   "checkPackageManagerBoundary",
   "checkQualityCiPermissions",
diff --git a/test/steps/provider-observation-diagnostic.steps.ts b/test/steps/provider-observation-diagnostic.steps.ts
new file mode 100644
index 00000000..4d7475a6
--- /dev/null
+++ b/test/steps/provider-observation-diagnostic.steps.ts
@@ -0,0 +1,117 @@
+import assert from "node:assert/strict";
+import {
+  observeProvider,
+  type ProviderAvailabilityObservation,
+  type ProviderExecutor,
+} from "../../src/adapters/provider.js";
+import { stepDefinitions, WorkflowWorld } from "../support/world.js";
+
+/**
+ * 期待値は実装から導出せず、この file 内の literal で持つ（Issue #1341）。
+ * 実装側の argv 組み立てを参照して expected を作ると、argv が壊れる変異で
+ * 期待値も同じ向きへずれて検出できなくなる。
+ */
+const EXPECTED_ENTRYPOINT = "provider-fixture models list --json";
+
+class ProviderObservationDiagnosticWorld extends WorkflowWorld {
+  diagnosticExecutor: ProviderExecutor | undefined = undefined;
+  diagnosticObservation: ProviderAvailabilityObservation | undefined =
+    undefined;
+  diagnosticStderrSecret: string | undefined = undefined;
+  diagnosticMissingProvider: string | undefined = undefined;
+}
+
+const { Given, When, Then } =
+  stepDefinitions<ProviderObservationDiagnosticWorld>();
+
+Given("終了値3で終了する実行入口を持つproviderがある", function () {
+  this.diagnosticExecutor = () => ({ status: 3, stdout: "", stderr: "" });
+});
+
+Given("起動に失敗する実行入口を持つproviderがある", function () {
+  this.diagnosticExecutor = () => {
+    throw new Error("spawn ENOENT");
+  };
+});
+
+Given(
+  "stderrへ秘密を書いて終了値3で終了する実行入口を持つproviderがある",
+  function () {
+    this.diagnosticStderrSecret = "token=obsdiag-stderr-secret-fixture";
+    this.diagnosticExecutor = () => ({
+      status: 3,
+      stdout: "",
+      stderr: this.diagnosticStderrSecret ?? "",
+    });
+  },
+);
+
+When("失敗診断のためにproviderを観測する", async function () {
+  assert.ok(this.diagnosticExecutor);
+  this.diagnosticObservation = await observeProvider(
+    "provider-fixture",
+    this.diagnosticExecutor,
+    () => new Date("2026-09-12T00:00:00.000Z"),
+  );
+});
+
+Then("entrypointは{string}である", function (expected: string) {
+  assert.equal(this.diagnosticObservation?.state, "unknown");
+  assert.equal(this.diagnosticObservation?.entrypoint, expected);
+});
+
+Then("reasonは{string}である", function (expected: string) {
+  assert.equal(this.diagnosticObservation?.state, "unknown");
+  assert.equal(this.diagnosticObservation?.reason, expected);
+});
+
+Then(
+  "観測結果のどのfieldにもstderrの本文が現れない",
+  function (this: ProviderObservationDiagnosticWorld) {
+    const secret = this.diagnosticStderrSecret;
+    assert.ok(secret);
+    assert.equal(this.diagnosticObservation?.state, "unknown");
+    assert.equal(
+      JSON.stringify(this.diagnosticObservation).includes(secret),
+      false,
+    );
+    assert.equal(this.diagnosticObservation?.entrypoint, EXPECTED_ENTRYPOINT);
+    assert.equal(
+      this.diagnosticObservation?.reason,
+      "provider実行入口のread-only観測が失敗しました（終了値3）",
+    );
+  },
+);
+
+/**
+ * **実在しない実行fileはmockでは作れない。** 既定executorは`run`を通り、
+ * `allowFailure: true`のとき起動失敗を終了値1へ写す。throwするmockだけを
+ * 検査していると、この経路の欠陥を検出できない（Issue #1341のREV-01）。
+ */
+Given("実在しない実行fileを指すproviderがある", function () {
+  this.diagnosticMissingProvider = "provider-that-does-not-exist-1341";
+});
+
+When("既定executorで失敗診断のためにproviderを観測する", async function () {
+  assert.ok(this.diagnosticMissingProvider);
+  this.diagnosticObservation = await observeProvider(
+    this.diagnosticMissingProvider,
+    undefined,
+    () => new Date("2026-09-12T00:00:00.000Z"),
+  );
+});
+
+Then("reasonに終了値が現れない", function () {
+  assert.equal(this.diagnosticObservation?.state, "unknown");
+  assert.equal(/終了値/u.test(this.diagnosticObservation?.reason ?? ""), false);
+});
+
+Given(
+  "受け取ったargsを書き換えてから終了値3で終了する実行入口を持つproviderがある",
+  function () {
+    this.diagnosticExecutor = (_file, args) => {
+      args.splice(0, args.length, "mutated-by-executor");
+      return { status: 3, stdout: "", stderr: "" };
+    };
+  },
+);
diff --git a/test/steps/review-progress.steps.ts b/test/steps/review-progress.steps.ts
deleted file mode 100644
index 5e2f45b4..00000000
--- a/test/steps/review-progress.steps.ts
+++ /dev/null
@@ -1,404 +0,0 @@
-import assert from "node:assert/strict";
-import { execFileSync } from "node:child_process";
-import fs from "node:fs";
-import path from "node:path";
-import {
-  buildReviewProgressInventory,
-  makeReviewProgressEntry,
-  makeReviewProgressSeal,
-  parallelCriticalPath,
-  parseReviewProgressRecords,
-  projectReviewProgressTarget,
-  PROGRESS_END,
-  PROGRESS_START,
-  verifyReviewProgressTarget,
-  type ReviewProgressInventory,
-  type ReviewProgressRecord,
-} from "../../src/domain/review-progress.js";
-import { parseReviewRoundInput } from "../../src/domain/review-convergence.js";
-import { COMMAND_USAGE } from "../../src/cli-usage.js";
-import { stableJson } from "../../src/lib/security.js";
-import { checkParallelProgressSourceIsolation } from "../../scripts/check_conformance.js";
-import {
-  appendReviewProgress,
-  projectReviewProgress,
-} from "../../src/adapters/review-progress.js";
-import {
-  buildReviewRoundDraft,
-  recordReviewRound,
-} from "../../src/adapters/review-session.js";
-import { main } from "../../src/cli.js";
-import { createIssueStaging } from "../../src/domain/issue.js";
-import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
-import {
-  refreshStoredStagingDigest,
-  REVIEW_PROGRESS_JOURNAL_FILE,
-} from "../../src/domain/staging.js";
-import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
-import { stepDefinitions, WorkflowWorld } from "../support/world.js";
-
-interface ProgressWorld extends WorkflowWorld {
-  source: string;
-  inventory: ReviewProgressInventory;
-  records: readonly ReviewProgressRecord[];
-  passed: boolean;
-  root: string;
-  staging: string;
-  target: string;
-  fixtureHead: string;
-}
-
-const { Given, When, Then } = stepDefinitions<ProgressWorld>();
-const sessionId = "a".repeat(64);
-const head = "b".repeat(40);
-const instant = "2026-09-12T00:00:00.000Z";
-const isolatedSources = {
-  "src/domain/staging.ts":
-    'export const REVIEW_PROGRESS_JOURNAL_FILE = "journal/review-progress.jsonl";',
-  "src/adapters/review-progress.ts":
-    'import { REVIEW_PROGRESS_JOURNAL_FILE } from "../domain/staging.js";',
-  "src/adapters/review-session.ts":
-    'import { buildReviewProgressInventory } from "../domain/review-progress.js";',
-  "src/domain/delivery.ts": "export const delivery = true;",
-};
-
-function expectFailure(action: () => unknown): void {
-  assert.throws(action);
-}
-
-function fixtureAnswers(): Record<string, ModeAnswer> {
-  return Object.fromEntries(
-    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id} fixture` }]),
-  );
-}
-
-function gitHead(root: string): string {
-  return execFileSync("git", ["rev-parse", "HEAD"], {
-    cwd: root,
-    encoding: "utf8",
-  }).trim();
-}
-
-Given("parallel progressの純粋fixtureがある", function () {
-  this.source = `# plan\n${PROGRESS_START}\n| T01 | old |\n${PROGRESS_END}\n# tail\n`;
-  this.inventory = buildReviewProgressInventory(
-    "03_実装計画.md",
-    this.source,
-    0o644,
-  );
-  this.records = [];
-  this.passed = false;
-});
-
-Given("parallel progressの実adapter fixtureがある", function () {
-  this.root = this.initRepo();
-  const base = gitHead(this.root);
-  fs.writeFileSync(
-    path.join(this.root, "candidate.ts"),
-    "export const x = 1;\n",
-  );
-  execFileSync("git", ["add", "candidate.ts"], { cwd: this.root });
-  execFileSync("git", ["commit", "-q", "-m", "candidate"], {
-    cwd: this.root,
-  });
-  this.fixtureHead = gitHead(this.root);
-  this.staging = createIssueStaging(this.root, {
-    title: "parallel-progress-adapter",
-    answers: fixtureAnswers(),
-    now: new Date(instant),
-    requestedMode: "quick",
-  }).path;
-  this.source = `# 実装計画\n${PROGRESS_START}\n| タスク | 状態 |\n|---|---|\n| T01 | 未着手 |\n${PROGRESS_END}\n`;
-  this.target = path.join(this.staging, "03_実装計画.md");
-  fs.writeFileSync(this.target, this.source, { mode: 0o644 });
-  fs.appendFileSync(
-    path.join(this.staging, STEP_JOURNAL_FILE),
-    `${JSON.stringify({
-      step: 9,
-      skillId: "step-09-implement",
-      mode: "quick",
-      recordedAt: instant,
-      artifacts: ["candidate.ts"],
-      evidence: `candidate HEAD ${this.fixtureHead}`,
-      implementationHeadSha: this.fixtureHead,
-    })}\n`,
-  );
-  refreshStoredStagingDigest(this.staging);
-  const { round } = buildReviewRoundDraft({
-    staging: this.staging,
-    headSha: this.fixtureHead,
-    baseSha: base,
-    scopeIds: ["ISSUE-1336"],
-    acceptanceCriteriaIds: ["AC-1336-01"],
-  });
-  recordReviewRound({ staging: this.staging, round });
-  this.passed = false;
-});
-
-When("review入力を変えずcompleted進捗を実際にappendする", function () {
-  const preview = appendReviewProgress({
-    staging: this.staging,
-    taskId: "T01",
-    state: "completed",
-    recordedAt: instant,
-    expectedDigest: null,
-    apply: false,
-  });
-  assert.equal(preview.applied, false);
-  const applied = appendReviewProgress({
-    staging: this.staging,
-    taskId: "T01",
-    state: "completed",
-    recordedAt: instant,
-    expectedDigest: null,
-    apply: true,
-  });
-  assert.equal(applied.applied, true);
-  assert.equal(fs.readFileSync(this.target, "utf8"), this.source);
-  assert.equal(
-    fs.statSync(path.join(this.staging, REVIEW_PROGRESS_JOURNAL_FILE)).mode &
-      0o777,
-    0o600,
-  );
-  const projection = projectReviewProgress({
-    staging: this.staging,
-    apply: false,
-  });
-  assert.match(projection.projected, /\| T01 \| completed \|/u);
-  assert.equal(fs.readFileSync(this.target, "utf8"), this.source);
-  this.passed = true;
-});
-
-When(
-  "{string} のparallel progress反例を評価する",
-  async function (kind: string) {
-    const entry = () =>
-      makeReviewProgressEntry({
-        previous: this.records,
-        sessionId,
-        implementationHeadSha: head,
-        taskId: "T01",
-        state: "completed",
-        recordedAt: instant,
-      });
-    switch (kind) {
-      case "append": {
-        const next = entry();
-        assert.equal(next.previousDigest, null);
-        assert.equal(next.sequence, 1);
-        break;
-      }
-      case "digest-chain": {
-        const next = entry();
-        const line = `${stableJson({ ...next, entryDigest: "f".repeat(64) })}\n`;
-        expectFailure(() => parseReviewProgressRecords(line));
-        break;
-      }
-      case "binding":
-        expectFailure(() =>
-          makeReviewProgressEntry({
-            previous: [],
-            sessionId: "bad",
-            implementationHeadSha: head,
-            taskId: "T01",
-            state: "completed",
-            recordedAt: instant,
-          }),
-        );
-        break;
-      case "projection": {
-        const projected = projectReviewProgressTarget({
-          inventory: this.inventory,
-          source: this.source,
-          records: [entry()],
-        });
-        assert.match(projected, /\| T01 \| completed \|/u);
-        break;
-      }
-      case "prefix":
-        expectFailure(() =>
-          verifyReviewProgressTarget({
-            inventory: this.inventory,
-            source: `changed${this.source}`,
-            records: [],
-          }),
-        );
-        break;
-      case "suffix":
-        expectFailure(() =>
-          verifyReviewProgressTarget({
-            inventory: this.inventory,
-            source: `${this.source}changed`,
-            records: [],
-          }),
-        );
-        break;
-      case "one-byte": {
-        const projected = projectReviewProgressTarget({
-          inventory: this.inventory,
-          source: this.source,
-          records: [entry()],
-        });
-        expectFailure(() =>
-          verifyReviewProgressTarget({
-            inventory: this.inventory,
-            source: projected.replace("completed", "completeD"),
-            records: [entry()],
-          }),
-        );
-        break;
-      }
-      case "mode":
-        expectFailure(() =>
-          buildReviewProgressInventory("03_実装計画.md", this.source, 0o755),
-        );
-        break;
-      case "traversal":
-        expectFailure(() =>
-          buildReviewProgressInventory("../03_実装計画.md", this.source, 0o644),
-        );
-        break;
-      case "unicode":
-        expectFailure(() =>
-          makeReviewProgressEntry({
-            previous: [],
-            sessionId,
-            implementationHeadSha: head,
-            taskId: "T\u0001",
-            state: "completed",
-            recordedAt: instant,
-          }),
-        );
-        break;
-      case "stale": {
-        const first = entry();
-        const second = makeReviewProgressEntry({
-          previous: [first],
-          sessionId,
-          implementationHeadSha: head,
-          taskId: "T02",
-          state: "started",
-          recordedAt: instant,
-        });
-        assert.equal(second.previousDigest, first.entryDigest);
-        break;
-      }
-      case "partial":
-        expectFailure(() => parseReviewProgressRecords('{"schemaVersion":'));
-        break;
-      case "sealed": {
-        const first = entry();
-        const seal = makeReviewProgressSeal({
-          previous: [first],
-          sessionId,
-          implementationHeadSha: head,
-          sealedAt: instant,
-        });
-        expectFailure(() =>
-          makeReviewProgressEntry({
-            previous: [first, seal],
-            sessionId,
-            implementationHeadSha: head,
-            taskId: "T02",
-            state: "started",
-            recordedAt: instant,
-          }),
-        );
-        break;
-      }
-      case "limit":
-        expectFailure(() => parseReviewProgressRecords("{}\n".repeat(258)));
-        break;
-      case "no-verdict": {
-        const errors = checkParallelProgressSourceIsolation({
-          ...isolatedSources,
-          "src/adapters/review-session.ts":
-            'const x = parseReviewProgressRecords("{}");',
-        });
-        assert.ok(errors.some((error) => error.includes("review gate")));
-        break;
-      }
-      case "no-delivery": {
-        const errors = checkParallelProgressSourceIsolation({
-          ...isolatedSources,
-          "src/domain/delivery.ts":
-            'import { renderReviewProgress } from "./review-progress.js";',
-        });
-        assert.ok(errors.some((error) => error.includes("delivery")));
-        break;
-      }
-      case "acyclic": {
-        assert.deepEqual(
-          checkParallelProgressSourceIsolation(isolatedSources),
-          [],
-        );
-        const errors = checkParallelProgressSourceIsolation({
-          ...isolatedSources,
-          "src/adapters/review-progress.ts":
-            "refreshStoredStagingDigest(staging); writeFileAtomic(observed.target, body);",
-        });
-        assert.ok(errors.some((error) => error.includes("review入力tree")));
-        break;
-      }
-      case "absent":
-        expectFailure(() =>
-          buildReviewProgressInventory(
-            "03_実装計画.md",
-            "# no marker\n",
-            0o644,
-          ),
-        );
-        break;
-      case "legacy": {
-        const round = parseReviewRoundInput({
-          round: 1,
-          previousRoundDigest: null,
-          anchor: {
-            scopeIds: ["ISSUE-1336"],
-            acceptanceCriteriaIds: ["AC-1336-01"],
-            invariantIds: [],
-            diffBaseSha: head,
-            initialHeadSha: head,
-            initialDiffDigest: "c".repeat(64),
-          },
-          candidateHeadSha: head,
-          focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
-          findings: [],
-        });
-        assert.equal(round.anchor.progressInventory, undefined);
-        break;
-      }
-      case "cli": {
-        let output = "";
-        const write = process.stdout.write;
-        process.stdout.write = ((chunk: string | Uint8Array) => {
-          output += String(chunk);
-          return true;
-        }) as typeof process.stdout.write;
-        try {
-          assert.equal(await main(["review", "progress", "--help"]), 0);
-        } finally {
-          process.stdout.write = write;
-        }
-        assert.match(output, /"command": "review progress"/u);
-        assert.ok(
-          COMMAND_USAGE.some(
-            ({ command, subcommand }) =>
-              command === "review" && subcommand === "progress",
-          ),
-        );
-        break;
-      }
-      case "critical-path":
-        assert.ok(parallelCriticalPath(30, 15) <= 30 + 15);
-        break;
-      default:
-        assert.fail(`unknown case: ${kind}`);
-    }
-    this.passed = true;
-  },
-);
-
-Then("parallel progress契約を満たす", function () {
-  assert.equal(this.passed, true);
-});
```
