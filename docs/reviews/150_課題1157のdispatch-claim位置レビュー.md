# 150 課題1157のdispatch claim位置レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1157 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `a226eaa11b5a0033616f060d75c1814d83edf40f` |
| H_impl | `c2c1998d41999e6d69a272d078908b4b8038601c` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip |
| モード | full（Q-01・Q-03・Q-06がfalse） |
| 対象差分 | 11 file（うちdist 2件は生成物）、commitは`b57e3c88`・`8a18b699`・取り込み commit（取り込みでartifact commitが`比較基点..H_impl`へ入る） |
| 対象外 | merge側のdispatch claim。既に`reconciliation-required`へ入っている既存stagingの救済。`pr reconcile`相当の新設。claim消費後の再送禁止の緩和。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド。以降は収束後のHEAD移動に対する取り直し1回のみ） |
| ラウンド数 | 2。ラウンド2は`pr create`後の外部指摘の取り込みである（#1194・#1201の経路） |
| Step chain | 経由: /home/tatsuru/Projects/techbeansjp-free/AGENTS.md/.worktrees/20260905_153141-1157-claim-after-preflight/.agent-skill-chain/tmp/issues/20260905_155028_PR-createのdispatch-claimをprovider要求の直前へ移す |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-013（**1段落追記**） |
| 成果物行数 | 製品 **+61 -27行**（`github.ts` +26 -3、`cli.ts` +35 -24）。仕様 **+3 -1行**。支援層 **+141 -3行**（feature +22、steps +119 -3）。**支援層/成果物 = 2.3倍** |
| 縮小の先行評価 | **新しいstate field・error型・subcommandを1つも足していない。** claimを消費したかどうかの真偽値だけで送信前失敗と成否不明を分ける。代替4案のうち3案（事前検査の追加、phase付きerror型、`pr reconcile`の新設）を棄却した。**支援層が2.3倍なのは、adapter層だけでなくCLI経路の合成まで測るためである。** adapterだけを測ると、CLIがcallbackを渡さなくなる変異が生存する |
| 決裁 | **既存要件REQ-WF-013への適合であり、新しい判断を要さない。** 同要件は既に「provider call直前」と定めている |
| 実施者・日時 | reviewer（claude）、2026-09-05（JST） |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する。**設計は外部2者へ諮問した** |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、**設計を外部2者へ諮問し、両者の指摘で当初案を2点修正したこと**と、判定の根拠をすべて実行結果に置いたことである。
2. **私の当初案は誤っていた。** 「事前検査を追加してclaimの前に置く」としていたが、外部reviewerが「事前検査は既に存在する。論点は最終再検証とclaimの順序をどこで不可分に接続するか」と指摘した。**採用したのは指摘後の形である。**
3. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要件の原文 | REQ-WF-013 | 「createとmergeの**provider call直前**に永続dispatch claimをfsyncし」 | 一次資料 |
| 実装が要件に反していた | `src/adapters/github.ts`（変更前） | `pr.create`の第1文が`verifyRepository`、その第1文が`run("gh", ["auth","status"])` | 一次資料 |
| claimが検査より前 | `src/cli.ts`（変更前） | `claimStoredPullRequestCreationDispatch` の後に `createPullRequest` を呼ぶ | 一次資料 |
| 復旧経路が到達しない | `src/domain/delivery-state.ts:940` | `消費済みPR create dispatch claimはabsence確認で再開できません` | 一次資料 |
| subcommandが無い | `pr --help` | `prにはsubcommandが必要です: create、merge、reanchor` | 実行記録 |
| gateの位置 | 変異M1（gateを旧位置へ） | **新規3件が落ちる** | テスト出力 |
| 実行時のfail-closed | 変異M2（`typeof`検査を消す） | **SCN-INT-GITHUB-021が落ちる** | テスト出力 |
| CLI経路の合成 | `SCN-E2E-WFSTEP-043` | 再検証失敗でclaim未消費・`create-prepared`維持・**解消後の同一commandが成功** | テスト出力 |
| テスト | `npm run conformance:check` | `1502 scenarios (1486 passed, 16 skipped)`。project rule 21件、orphan 0件 | テスト出力 |
| 追跡 | `npm run trace:check` | valid。orphan 0件 | テスト出力 |
| commit前candidate | 11 file | working tree clean | Git index |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/adapters/github.ts` | M | package | adapter | dispatch gateを最終再検証の直後・変更要求の直前へ置く。**overloadで必須にし実装でも`typeof`を確かめる** | CLI→domain→adapterの単方向。callbackは値であり逆依存を作らない | REQ-WF-013 / AC-01・AC-02 / SCN-INT-GITHUB-019〜021 | **受理集合を広げない。** claimなしのPR作成をfail-closedで拒否する。revertで戻る | pass |
| `src/cli.ts` | M | package | cli | claim消費をcallbackへ移し、`dispatchClaimed`で送信前失敗と成否不明を分ける | 適合 | REQ-WF-013 / AC-03・AC-04 / SCN-E2E-WFSTEP-043 | claim消費後の扱いを1行も変えない | pass |
| `test/features/integration/delivery-finalize.feature` | M | package | test | Scenario 3件の追加 | test層のみ | AC-01・AC-02 | `gh` stubのみ | pass |
| `test/steps/delivery-finalize.steps.ts` | M | package | test | 認証失敗stubとclaim消費観測 | 同上 | 同上 | 同上 | pass |
| `test/features/e2e/workflow-step-enforcement-cli.feature` | M | package | test | Scenario 1件の追加 | 同上 | AC-03・AC-04 | 隔離stagingのみ | pass |
| `test/steps/workflow-step-enforcement.steps.ts` | M | package | test | `failCreateVerification` controlと合成Scenario | 同上 | 同上 | 同上 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | project | spec | REQ-WF-013へ1段落追記。**既存本文を1文字も変えない** | 適合 | REQ-WF-013 / AC-WF-013 | 記述のみ | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | 新規SCN 4件の結線 | 適合 | 同上 | 記述のみ | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 変更履歴1行 | 適合 | 同上 | 記述のみ | pass |
| `docs/reviews/150_課題1157のdispatch-claim位置レビュー.md` | A | project | evidence | 本レビュー証跡。取り込みでラウンド1のartifact commitが`比較基点..H_impl`へ入るため自己行を持つ | 適合 | AC-06 | 記述のみ | pass |

**`dist/src/adapters/github.js` と `dist/src/cli.js` は個別監査の対象外である。** `scripts/check_file_audit.ts` の `isGeneratedDistributionPath` が生成物を個別監査から除外する（#1187）。

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/github.ts`・`src/cli.ts` | **入る** | 実装の正本。`files` は `dist/` を配る |
| `dist/src/` | **入る** | 上記のcompile結果 |
| `test/` 4件 | 入らない | `files` に `test/` が無い |
| `docs/specs/` 3件 | 入らない | project所有の仕様 |

判断: 配布物を更新した
根拠: **配布file数は343のまま変わらない。** `package:check` が合格した。**変わるのは、送信前に失敗した場合の `pr create` の出力と復旧可能性である。**

## 2. 差分の要約

| 変更 | 内容 |
|---|---|
| claimの消費時点 | CLIの呼び出し前 → **adapter内の最終再検証の直後・変更要求の直前** |
| claimの受け渡し | 無し → **型で必須、実行時にもfail-closed** |
| 送信前失敗の扱い | `reconciliation_required`（恒久停止） → **`dispatch_not_started`（再実行可能）** |
| claim消費後の扱い | **変更なし** |

## 3. 肯定review

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 既存要件REQ-WF-013の文言に実装を合わせた。変異試験2件がkill |
| 価値 | pass | 認証の一時失敗で工程が恒久的に止まらなくなる |
| 実現可能性 | pass | 保護fileを変更せず、proposalを要さない |
| 整合性 | pass | REQ-WF-013 / AC-WF-013 / 新規SCN 4件へ結線し `trace:check` が valid |
| 保守性 | pass | **新しいstate field・error型・subcommandを1つも足していない** |

## 4. 敵対review

| 反例・攻撃 | 検証 | 結果 |
|---|---|---|
| gateを旧位置へ戻しても通るのではないか | 変異M1 | **kill。** 新規3件が落ちる |
| 実行時のfail-closedを消しても通るのではないか | 変異M2 | **kill。** SCN-INT-GITHUB-021が落ちる |
| CLIがcallbackを渡さなくなっても通るのではないか | CLI経路の合成Scenario | **SCN-E2E-WFSTEP-043が落ちる。** adapterだけを測っていたら生存していた |
| 受理集合が広がっていないか | claim消費後の分岐 | **1行も変えていない。** 既存SCN-E2E-WFSTEP-023が合格し続ける |
| claimなしで変更要求を送れる経路があるか | overloadの必須化と`typeof`検査 | **無い。** castで型を回避しても実行時に拒否される |
| `書き込み直前の再検証` を失っていないか | 最終再検証→claim→変更要求が同じ呼び出しの中で連続する | **維持している。** 検査を1箇所も削っていない |
| 残る窓はあるか | 再検証成功→claimのfsync→process起動 | **極小の窓が残る。** そこでの失敗は成否不明であり止まるのが正しい |

## 5. finding分類

| ID | 分類 | 内容 | 対処 |
|---|---|---|---|
| DISC-001 | resolved | 既存adapter testが型エラーで落ちた。`onDispatch` を渡さない呼び出しがoverloadに一致しなくなったため | **gateが効いている証拠である。** testへ受け渡しとclaim消費観測を足した |
| DISC-002 | resolved | 新規SCN IDが既存と衝突した（GITHUB-016〜018は使用済み） | 019〜021へ採番し直した。他branchも照合した |
| DISC-003 | resolved | E2E harnessは `break` で合格を立てる。`return` では合格扱いにならない | `break` へ直した |
| ADV-01 | record-only | **私の当初設計は誤っていた。** 「事前検査を追加してclaimの前に置く」としたが、事前検査は既に存在した | 外部reviewerの指摘で「最終再検証とclaimの順序を不可分に接続する」形へ修正した |
| ADV-02 | record-only | 再検証成功からprocess起動までの極小の窓が残る | **成否不明なので止まるのが正しい。** 縮めるにはprovider側のidempotency keyが要る |
| ADV-03 | record-only | 既に`reconciliation-required`へ入っている既存stagingの救済経路が無い | **本Issueの範囲外。** 外部2者とも「復旧策であって変更経路ではない」で一致した。件数の実測後に判断する |

| ADV-04 | resolved | **dispatch gateが`try/finally`の外にあり、拒否時にPR本文を含む一時領域`asc-pr-body-*`が残っていた**（外部reviewer指摘、Minor） | gateを`try`の中・`gh`起動の直前へ移した。**前へ出す案は採らない。** 本文書き込みの失敗がclaim消費後に起きて同じ欠陥を再現する |
| ADV-05 | resolved | **ADV-04の是正を固定する変異が最初は生存した。** gateを`try`の外へ戻しても21件すべて合格した | 等価変異ではない（本文入りの一時領域が実際に残る）。`TMPDIR`を差し替えて残留を観測するassertionを`SCN-INT-GITHUB-021`へ足し、変異M3をkillした |

**blocking 0件。未解決のCritical / High 0件。**

## 6. 検証結果

| 検査 | 結果 |
|---|---|
| `npm run conformance:check` | `1502 scenarios (1486 passed, 16 skipped)`、`7915 steps`。project rule 21件、orphan 0件 |
| `npm run lint` / `format:check` / `typecheck` / `source:check` | すべて合格 |
| `npm run project:quality` | `valid: true` |
| `npm run directories:check` / `skills:check` / `cli:check` / `workflow:check` | すべて合格 |
| `npm run docs:format` / `test:format` / `package:check` / `architecture:check` | すべて合格 |
| `npm run trace:check` | valid。orphan 0件 |
| `npm run audit:check` | Step 11直前に実行する |

### 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | dispatch gateを `verifyRepository` の前（旧位置）へ戻す | **kill**（新規3件） |
| M2 | 実行時のfail-closed（`typeof` 検査）を消す | **kill**（SCN-INT-GITHUB-021） |
| M3 | dispatch gateを `try` の外（`bodyDirectory` 直後）へ戻す | **kill**（同上。**当初生存**） |

**3件ともkill。** M3は当初生存した。**外部指摘を直しただけでは、その是正を固定する検査が無かった。** `TMPDIR`を差し替えてPR本文の一時領域の残留を観測するassertionを足して塞いだ。変異は複写で戻し、復元を確認した。

## 6.1 ラウンド2 固有の確認

**外部reviewer（CodeRabbit）の指摘1件を受けた取り込みラウンドである。**

| 指摘 | 判定 | 対処 |
|---|---|---|
| `bodyDirectory` 作成後・`try` の外に gate があり、拒否時に一時領域が残る（Minor） | **valid** | ADV-04。gateを`try`の中・`gh`起動の直前へ移した |

**指摘は私の不変条件にとっても正しかった。** gateを`bodyDirectory`より前へ出すと、本文書き込みの失敗がclaim消費後に起きて**本Issueが直している欠陥をそのまま再現する。** `try`の中で`gh`起動の直前に置くのが、清掃と「変更要求の直前」の両方を満たす唯一の位置である。

## 7. 仕様更新

- **REQ-WF-013へ1段落追記した。** 「provider call直前」が認証・権限・remote SHA再検証より後を指すこと、claim受け渡しの必須化、**強制主体が新規SCN 4件であること**を明記した
- **新規SCN 4件を追跡表へ結線した。** `trace:check` の orphan は0件
- **既存本文を1文字も変えていない。既存SCNも1件も削除していない**

## 8. 判定

**承認。** blocking 0件、未解決のCritical / High 0件。resolved 5件（DISC-001〜003、ADV-04・05）、record-only 3件（ADV-01〜03）。
