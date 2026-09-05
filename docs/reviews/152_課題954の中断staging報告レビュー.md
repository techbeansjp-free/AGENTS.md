# 152 課題954の中断staging報告レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #954 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `68c5bf1cfba06da6f4299a30f9c7717f8fda7620` |
| H_impl | `f0ab19ad35300d3824bba26c3bc06661faff6052` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip |
| モード | full（Q-01がfalse。`doctor`の出力構造が変わる） |
| 対象差分 | 8 file（うちdist 2件は生成物）、commitは`b9b3c27c` 1件 |
| 対象外 | `healthy`の判定変更。`workflow list`の新設。中断の自動是正。契約driftの是正（古いstaging 17件）。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド。以降は収束後のHEAD移動に対する取り直し1回のみ） |
| ラウンド数 | 2。ラウンド2は`pr create`後の外部指摘の取り込みである（#1194・#1201の経路） |
| Step chain | 経由: /home/tatsuru/Projects/techbeansjp-free/AGENTS.md/.worktrees/20260905_183025-954-interrupted-chain-report/.agent-skill-chain/tmp/issues/20260905_184025_契約を満たしたまま未完のstagingをdoctorが分けて報告する |
| 仕様の所有箇所 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`のREQ-LC-011（**1段落追記**） |
| 成果物行数 | 製品 **+30 -2行**（`workflow.ts` +14 -2、`lifecycle.ts` +16）。仕様 **+2行**。支援層 **+58行**（feature +15、steps +43）。**支援層/成果物 = 1.9倍** |
| 縮小の先行評価 | **新しい観測もsubcommandも門も足していない。** 既存2値（`valid`・`nextStep`）の論理積として定義した。代替3案（`workflow list`の新設、`healthy`へ含める、契約driftも同時是正）を棄却した。**支援層が1.9倍なのは、判定の両条件を別々に測るためである。** 片方だけでは条件を落とす変異が生存する |
| 決裁 | **不要。** REQ-LC-011が既に「`doctor`はworktreeを報告するが削除は行わず`healthy`も変えない」と定めており、同じ扱いをstagingへ広げる |
| 実施者・日時 | reviewer（claude）、2026-09-05（JST） |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、判定の根拠をすべて実行結果に置いたこと（変異試験3件、実データでの件数観測）である。
2. **本Issueで私は2回誤った。** (1)「Step 11到達済みなのに `next 10` は判定の誤り」と断定したが、**同じ出力の `journal.errors` に正しい理由が入っていた。** (2) 中断を「2件」と見積もったが**実測は9件**だった。最初の6件しか見ずに数えていた。
3. **外部への諮問を行っていない。** 判断が #969 と同型（報告するが門にしない）であり、**同じ問いを3度目に投げるのは支援層の無駄**と判断した。REQ-LC-011に同じ形の前例がある。
4. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 列挙は既にある | `src/domain/lifecycle.ts:555-566` | `.agent-skill-chain/tmp/issues` 配下を全走査し `inspectDoctorWorkflowStaging` を呼ぶ | 一次資料 |
| Step位置も既にある | `src/domain/workflow.ts:1029-1047` | `completedSteps`・`currentStep`・`nextStep` を返す | 一次資料 |
| 本文の主張が成立しない | `doctor --root=.` | **28件を列挙し全件のStep位置を返す。** 本文の「列挙が無い」は成立しない | 実行記録 |
| 真の欠落 | 同上 | 未完のうち **9件が `valid: true`（中断）、17件が契約drift**。どちらも `valid: false` の集計へ潰れて選べない | 実行記録 |
| 私の誤診の否定材料 | 同じ出力の `journal.errors` | `journal N行目のStep 10にreviewSession bindingが必要です`。**`next 10` は正しい挙動だった** | 実行記録 |
| 是正後の観測 | `doctor --root=.` | `workflow.interrupted` が **9件**を path・mode・currentStep・nextStep つきで返す | 実行記録 |
| `healthy` の不変 | 判定式の差分 | **1文字も変えていない** | Git観測 |
| テスト | `npm run conformance:check` | `1515 scenarios (1499 passed, 16 skipped)`。project rule 21件、orphan 0件 | テスト出力 |
| 追跡 | `npm run trace:check` | valid。orphan 0件 | テスト出力 |
| commit前candidate | 8 file | working tree clean | Git index |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/workflow.ts` | M | package | domain | 戻り値へ `interrupted` を1つ足す。**既存2値の論理積であり新しい観測を持たない** | 単方向。循環なし | REQ-LC-011 / AC-01〜AC-03 / SCN-UNIT-WFPATH-003〜005 | **`valid` の判定式を変えない。** 同じ値を共有する。revertで戻る | pass |
| `src/domain/lifecycle.ts` | M | package | domain | `doctor` が `interrupted` を集計して報告する | `lifecycle` → `workflow` の単方向 | REQ-LC-011 / AC-04 | **`healthy` の判定を変えない** | pass |
| `test/features/unit/workflow-step-enforcement.feature` | M | package | test | Scenario 3件の追加 | test層のみ | AC-01〜AC-03 | 一時directoryのみ | pass |
| `test/steps/workflow-step-enforcement.steps.ts` | M | package | test | 実stagingへjournalを与えて判定する | 同上 | 同上 | 同上 | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | project | spec | REQ-LC-011へ1段落追記。**既存本文を1文字も変えない** | 適合 | REQ-LC-011 / AC-LC-011 | 記述のみ | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | 新規SCN 3件の結線 | 適合 | 同上 | 記述のみ | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 変更履歴1行 | 適合 | 同上 | 記述のみ | pass |
| `docs/reviews/152_課題954の中断staging報告レビュー.md` | A | project | evidence | 本レビュー証跡。取り込みでラウンド1のartifact commitが`比較基点..H_impl`へ入るため自己行を持つ | 適合 | AC-06 | 記述のみ | pass |

**`dist/` 2件は個別監査の対象外である。** `isGeneratedDistributionPath` が生成物を除外する（#1187）。

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/workflow.ts`・`src/domain/lifecycle.ts` | **入る** | 実装の正本 |
| `dist/src/` | **入る** | compile結果 |
| `test/` 2件・`docs/specs/` 3件 | 入らない | `files` に含まれない |

判断: 配布物を更新した
根拠: **配布file数は変わらない**（既存fileへの追記のみ）。`package:check` が合格した。**変わるのは `doctor` の出力に1 field が加わることであり、既存fieldは1つも削っていない。**

## 2. 差分の要約

| 変更 | 内容 |
|---|---|
| 判定 | `interrupted = valid && nextStep !== undefined` |
| 報告 | `doctor` の `workflow.interrupted` へ path・mode・currentStep・nextStep |
| `healthy` | **変更なし** |
| 新しい観測・subcommand・門 | **0件** |

## 3. 肯定review

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 3件合格、変異3件すべてkill。実データで9件を名指しした |
| 価値 | pass | 28件から手を入れるべき9件を機械が選ぶ |
| 実現可能性 | pass | 保護fileを変更せず、新しい観測も足さない |
| 整合性 | pass | REQ-LC-011 / AC-LC-011 / 新規SCN 3件へ結線し `trace:check` が valid |
| 保守性 | pass | 既存2値の論理積であり、独立に維持すべき状態を持たない |

## 4. 敵対review

| 反例・攻撃 | 検証 | 結果 |
|---|---|---|
| 契約driftを中断に混ぜないか | 変異M1（`valid` 条件を落とす） | **kill** |
| 完了を中断に混ぜないか | 変異M2（未完条件を落とす） | **kill** |
| 常に `false` でも通るのではないか | 変異M3 | **kill** |
| `healthy` を変えていないか | 判定式の差分 | **1文字も変えていない。** 既存Scenarioが合格し続ける |
| 門を足していないか | `doctor` の戻り値 | **報告のみ。** `healthy` にも exit code にも影響しない |
| 実データで機能するか | `doctor --root=.` | **28件中9件**を path・Step位置つきで返す |
| 本文の主張は正しかったか | 実測 | **「列挙が無い」は成立しない。** 列挙もStep位置も既にあった |

## 5. finding分類

| ID | 分類 | 内容 | 対処 |
|---|---|---|---|
| DISC-001 | resolved | 「Step 11到達済みなのに `next 10` は判定の誤り」と断定した | **誤りだった。** 同じ出力の `journal.errors` に正しい理由が入っていた。**出力の一部だけを見て断定していた** |
| DISC-002 | resolved | 中断を「2件」と見積もった | **誤りだった。** 最初の6件しか見ずに数えていた。実測は9件 |
| DISC-003 | resolved | test helper の `result()` は `interrupted` を持たない | `inspectWorkflowStagingArtifacts` を実stagingで直接呼ぶ形へ書き直した |
| ADV-01 | record-only | **報告は出るが進行役が読む保証は無い。** 規約であって機構ではない | REQ-LC-011がworktreeへ同じ形を既に採っている。owner決裁「強制は基本使わない」に照らして門を足さない |
| ADV-02 | record-only | 契約driftの17件は残る | **本Issueの範囲外。** 古いstagingの是正は別論点である |

| ADV-03 | resolved | **新規SCN 3件を誤った要件行へ結線していた。** `REQ-WF-004`・`REQ-WF-012` の証拠として登録しており、仕様本文が名指しする `REQ-LC-011` の受入証拠になっていなかった（外部reviewer指摘、Minor） | **`trace:check` は orphan だけを見るため通っていた。** `REQ-LC-011` の専用行を作り、`REQ-WF-004`側からは戻した |
| ADV-04 | resolved | **doc commentが実装と食い違っていた。** 「契約を満たしたまま止まったstagingも `valid: false` になる」と書いたが、`validateStepJournal` へ `upToStep: currentStep` を渡すため接頭辞が正しければ `valid: true` のままである（外部reviewer指摘、Minor） | 契約driftと中断を明示的に分けて書き直した。**実装が正しく説明が誤りだった** |

**blocking 0件。未解決のCritical / High 0件。**

## 5.1 ラウンド2 固有の確認

**外部reviewer（CodeRabbit）の指摘2件を受けた取り込みラウンドである。**

| 指摘 | 判定 | 対処 |
|---|---|---|
| 新規SCNが `REQ-LC-011` へ結線されていない（Minor） | **valid** | ADV-03。専用行を作った |
| doc commentが実装と食い違う（Minor） | **valid** | ADV-04。説明を実装へ合わせた |

**1件目は `trace:check` が通るのに誤っていた。** 同検査は orphan の有無だけを見るため、**紐づく先が違っても検出しない。** 識別子の実在と、紐づく先の正しさは別の検査である。

**ラウンド2で判定logicを1行も変更していない。** 変更は追跡表の行とdoc commentである。

## 6. 検証結果

| 検査 | 結果 |
|---|---|
| `npm run conformance:check` | `1515 scenarios (1499 passed, 16 skipped)`。project rule 21件、orphan 0件 |
| `npm run lint` / `format:check` / `typecheck` / `source:check` | すべて合格 |
| `npm run project:quality` / `package:check` / `architecture:check` / `test:format` | すべて合格 |
| `npm run trace:check` | valid。orphan 0件 |
| `npm run audit:check` | Step 11直前に実行する |
| `doctor --root=.` | `workflow.interrupted` が9件 |

### 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | `valid` 条件を落とす（未完なら常にinterrupted） | **kill** |
| M2 | 未完条件を落とす（契約を満たせば常にinterrupted） | **kill** |
| M3 | 常に `false` | **kill** |

**3件ともkill。** 変異は複写で戻し、復元を確認した。

## 7. 仕様更新

- **REQ-LC-011へ1段落追記した。** 報告の分離、`healthy` を変えないこと、**強制主体が新規SCN 3件であること**を明記した
- **新規SCN 3件を追跡表へ結線した。** `trace:check` の orphan は0件
- **既存本文を1文字も変えていない。既存SCNも1件も削除していない**

## 8. 判定

**承認。** blocking 0件、未解決のCritical / High 0件。resolved 5件（DISC-001〜003、ADV-03・04）、record-only 2件（ADV-01・02）。
