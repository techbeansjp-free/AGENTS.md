# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1284 の内部独立実装review |
| ラウンド | 1、提出前の同一review内で追跡6cellを前向き補完 |
| H_impl | `13715fed40578b51837d9095c68f04f84e16fdd4` |
| 対象SHA・文書ダイジェスト | H_implをGit観測。製品 `759fbc413fa1303334cf9eb42dc58448b3ead6a8`、追跡補完 `a2bf8d276c254c1236e3e4ad556a1a98d71bfab3` の後に既定branchを取り込んだ |
| 比較基点 | `f54d3f739483e847c75bff673da120705ed5fc5d` |
| 対象差分 | 製品・test・配布案内・仕様10path。生成dist以外9pathを個別表へ記録 |
| 対象外 | 共通extension合成の変更、真正floorを偽るcallerの新provenance機構、個別rule廃止、proposal自動消費、提出操作 |
| 残り予算 | 通常2回、収束後のHEAD移動の取り直し1回。新たなroundは要求しない |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260908_081724_deliveryのpackageFloor省略を安全側に拒否する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md` REQ-SQ-004「trusted側へ先行登録したproject rule廃止提案とrule ID・trusted fragmentのraw UTF-8 SHA-256が完全一致する完全削除だけを受理する」 |
| 成果物行数 | source +16/-3、配布案内 +2、仕様 +14、test +230/-10、生成dist +5/-1。支援層は確認時00〜03の480行と本書、機械記録を再利用 |
| 縮小の先行評価 | 既存validator2個をdelivery入口へ合成し、共通resolver・保存状態・依存・policy設定を変更しない |
| 実施者・日時 | reviewer `/root/review_1284`、2026-09-07T23:40:00Z以降の同一review turn |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定5・敵対8評価、finding分類 | critical（authority境界） | 内部Codex agent。Claudeではない | 継承した内部実行設定。実効model attestationは取得していない | Claude外部送信が自動審査拒否された後の内部代替reviewをrootが明示依頼。無音切替ではない | 製品implementer `codex-1284 / issue-1284-implementation`、追跡implementer `codex-1284-trace / issue-1284-trace-finalization` と別identity/context `review_1284 / issue-1284-independent-review`。product/test/specを変更していない |

実装と追跡補完の `routing launch` 終了記録を確認した。両方とも起動時 `codex app-server model/list`、selected/dispatched `gpt-6-astra`、high/default、required/adopted critical、trusted policy SHA `ea50cfeb103bf2d29d9b33dde558d4ee9bb9f31d`、succeeded/exit0。これはdispatch引数証拠でありproviderの実効model保証ではない。project choiceのClaude reviewer mappingを実行済みとは主張せず、内部reviewから外部approval・例外authorityを生成しない。

既定branch追随の2文書競合は別implementer `codex-1284-merge / issue-1284-main-merge` が解消した。`1284-main-merge-routing-termination.json` は同じselected/dispatched model、high/default、required/adopted critical、trusted policy SHA `f54d3f739483e847c75bff673da120705ed5fc5d`、succeeded/exit0を記録する。reviewerはこの実装contextとも別であり、内容を修正せず、rootが後続のadd/通常merge commitを担当した。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | 同staging 00〜03、Issue #1284 | AC-1284-01〜05、INV-01〜03、full | 既存文書 |
| 差分 | 上記製品commitと追跡補完commit | 全10pathを独立確認、追跡修正は6cellのみ | Git観測 |
| 実装引継ぎ | `.agent-skill-chain/tmp/1284-implementation-handoff.json` | 10pathのhashと成果物。環境EPERMを成功へ読み替えていない | 実装者記録 |
| 独立対象回帰 | `.agent-skill-chain/tmp/1284-root-targeted.md` | 42scenario/230step成功、失敗・skip0 | verifier出力 |
| 独立静的検証 | `.agent-skill-chain/tmp/1284-independent-static-results.json` と各log | 10command exit0。実tool session出力の集約 | verifier出力 |
| 最終直列検証 | `.agent-skill-chain/tmp/issue-1284-verification-final/latest-results.json` と `conformance-check.log` | H_implで6command exit0、1631scenario成功・16skip・失敗0 | verifier出力 |
| 追加反例 | `.agent-skill-chain/tmp/1284-independent-review-probes.md` | dist直接呼出し24/24成功、provider0 | reviewer実行観測 |
| 仕様 | REQ-SQ-004、信頼境界、追跡、変更履歴 | updated、既存用語を参照し新定義なし | 既存文書 |
| commit前candidate | implementer handoff path/hash | rootが製品commitへ固定。reviewerは非追跡8pathのhash一致を別途確認 | Git・hash観測 |
| Phase A artifact | `docs/reviews/177_課題1284delivery入力境界レビュー.md` | 本書の確定後、rootが内容を変えずコピーしてartifactだけをcommitする | 後続操作 |
| commit後external | 対象PRのCI・review | 本review時点で未観測。既存別PRの成功を流用しない | 未観測 |

依存はtrusted loader→floor validation→effective/comparison→provider。一方向でありcandidateはauthorityを作らない。tracked文書のSHAは先行実装commitだけを指す。H_final・artifact digest/blob・provider actor/CI/approvalの一致は後続提出時の観測であり、本書だけでは成立しない。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | M | package | package | 配布利用者へfloor供給と復旧を案内 | pass、authorityを発行しない | REQ-SQ-004、AC-1284-01〜05 | candidate由来floorを禁じ真正性限界を説明 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | project | spec | 成立中のdelivery入力契約 | pass、runtimeへの追跡 | REQ-SQ-004、全AC | 非trusted互換とcaller移行を明示 | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | project | spec | trusted loaderとdomainの責務分離 | pass、CLI3入口へ追跡 | 全AC、INV-01〜03 | 偽floorの真正性を証明したとしない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | AC・SCN・実装と先行commitを結ぶ | pass、自己SHAなし | SCN-INT-LEDGER-010〜014 | 5cellを確定証拠参照へ補完 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 互換変更と固定実装参照を記録 | pass、authorityなし | REQ-SQ-004、全AC | 既存#1211履歴を巻き戻さない | pass |
| `src/domain/delivery.ts` | M | package | package | trusted有時の型/runtime入力guard | pass、既存validatorへ依存、逆依存なし | 全AC、INV-01/02 | 副作用前の固定error、共通resolver非変更 | pass |
| `test/features/integration/project-rule-ledger.feature` | M | project | project | 5件の実行可能な受入例 | pass、stepへ一意対応 | SCN-INT-LEDGER-010〜014 | preview/apply、candidate有無を列挙 | pass |
| `test/steps/delivery-finalize.steps.ts` | M | project | project | trusted正常fixtureへfloor供給 | pass、test→domain | AC-1284-05、既存delivery | package層だけのfixture、非trusted分岐を保持 | pass |
| `test/steps/project-rule-ledger.steps.ts` | M | project | project | 入力変種・callback回数・復旧errorの観測 | pass、既存廃止fixture再利用 | 全AC、5新SCN | 実remoteなし、隔離Git、既存assertion保持 | pass |

生成dist1pathもsourceと比較した。最終の比較基点..H_implから観測したnet deltaは10path、dist以外9pathと個別表が一致する。H_implの第2親とmerge-baseは比較基点に一致し、取り込みはartifact作成前である。759fbc以後の差分は追跡2文書とmainからの既存review176だけで、source/test/distは不変。mainの#1285による既存3cellを保持し、比較基点からの追跡差分は#1284の5行と履歴1行の追加だけ。packageへproject固有値、spec/evidenceへ実行authorityを混入していない。最終確認でHEAD一致・tracked変更なしを観測した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1284-001 | 実装者sandboxでgit等がEPERM、初回独立fullでもCLI入口不在等の失敗 | 正常廃止・package/fullの証拠取得 | なし | rootが許可環境で全process終了後に直列検証、旧失敗logを保持し検査弱化なし | root targeted42件と最終full1631件成功、16skip、失敗0 | updated | pass |

一時Python helperがsource検査へ抵触した事実と内容保持の移動は `1284-root-verification-notice.md` に残る。reviewerはhelperを実行・編集せず、製品diff外の環境是正として記録した。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1284-01 | SCN-INT-LEDGER-010 | trusted有時の必須floor union/guard | 成功 | pass | 省略×preview/apply×candidate有無、provider0 |
| AC-1284-02 | SCN-INT-LEDGER-011 | validatePolicyとvalidateEnforcementPolicy | 成功 | pass | undefined/null/空/型不正15種×4、固定error・raw非表示 |
| AC-1284-03 | SCN-INT-LEDGER-012 | 正規floor後の既存trusted比較 | 成功 | pass | 無提案/無source×preview/apply、拒否とprovider0 |
| AC-1284-04 | SCN-INT-LEDGER-013 | 固定commit loader→比較→delivery | 成功 | pass | trusted提案・source完全一致はpreview、自己承認は拒否 |
| AC-1284-05 | SCN-INT-LEDGER-014、既存delivery | 非trusted互換・trusted正常入力 | 成功 | pass | preview、正規apply callback1、package弱化拒否 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | authority入力漏れを是正 | 不備拒否・秘密sentinel非表示・provider0 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 呼出し失敗からの復旧 | 固定日本語errorが正規loaderを案内。新log保存/rotationなし |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | domain API、GUIなし | projectKind=cli、全差分にUIなし |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚部品とlayoutを持たない | project capability、全path集合 |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 入力漏れ拒否と正常廃止 | pass | 全5ACのruntime/型/BDDと独立回帰 |
| 価値 | 旧直接callerの暗黙削除許可を防ぐ | pass | 旧SCN010/011の失敗と修正後成功 |
| 実現可能性 | 既存環境で実行できる | pass | 依存追加なし、build・package・型・静的成功 |
| 整合性 | 計画・実装・仕様・証拠 | pass | 追跡Lowを6cell補完、用語変更なし |
| 保守性 | 最小責務と互換性 | pass | 入口guardだけ、validator再利用、共通extensionを維持 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 型検査を経ない旧JS呼出し | pass | unknown入力からruntimeへ渡す反例 |
| 失敗経路 | 不備からproviderへ到達するか | pass | 全拒否例でcallback0、保存状態なし |
| 境界値 | 欠落・空・null・重複・未知field | pass | BDD15変種と独立dist24call |
| 悪用 | 無提案・sourceなし・candidate自己承認 | pass | 既存matcherを迂回せず拒否 |
| 安全性 | trusted/candidate authority分離 | pass | CLI3callはtrustedSet.packageFloorを供給、偽authorityの証明はclaimしない |
| データ損失 | 拒否時の副作用とpackage保護 | pass | provider0、package弱化拒否、実remote非操作 |
| ロールバック | 入力復旧と誤拒否是正 | pass | 正規floor供給で再試行、コードは通常revert可能 |
| 範囲漏れ | 型・caller・CLI・配布・仕様 | pass | trusted fixture更新、CLI3call、guide/distを確認 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| F-1284-01 | Low | 新規追跡6cellが作業tree/Step9の曖昧参照だった | 製品759fbcと追跡a2bf8dの差分 | 追跡表5行・変更履歴1行 | ユーザーの追跡残件まで完結する依頼に従い、先行実装SHAとreview177へ具体化 | resolved、同一review内で6cellのみ再確認 | tracked artifact実在は提出前に確認 |

Critical/Highの再現可能な製品欠陥はなし。Lowを根拠にscope拡大・追加round・gate停止を要求していない。

## 6. ラウンド固有の確認

### ラウンド1

全5肯定・8敵対評価、全path、Low1件とその局所修正を確認。次round対象のCritical/Highなし。

### ラウンド2

未実施・不要。追跡以外の既確認製品を再走査しない。

### ラウンド3

未実施・不要。予算を自動更新していない。

## 7. テスト結果

runnerはcucumber-js、gherkinDialect=en、project layer順はunit/integration/e2e。独立verifier rootの出力を参照し、reviewerによるfull重複実行はしていない。

command: `project:quality`、`lint`、`format:check`、`typecheck`、`source:check`、`docs:format`、`test:format`、`trace:check`、`architecture:check`、`package:check`（いずれもnpm run）、実装者の`npm run build`、独立対象回帰の `node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-(UNIT|INT)-LEDGER|SCN-INT-DELIVERY'`。上記静的10commandとbuildはexit0、対象回帰は42scenario/230step成功・失敗/skip0。

変異は契約からguard除去・null/undefined取りこぼし・空rules受理・preview逃げの4件を作り、全件assertion failureでkillした実装者logを確認。空値と境界外位置の両枠を含む。型負例はfloor省略・undefined/null/空objectのコンパイル拒否を確認。独立dist追加反例24callは全成功・provider0でありBDD件数へ加算しない。

独立full初回は1647scenario中1622成功・16skip・9失敗、8657step中8584成功・64skip・9失敗。E2Eのdist/bin入口不在等を実logで確認した。同時buildの競合は原因候補であり、9件すべての確定原因とは主張しない。旧失敗logを保持し、初回を成功へ読み替えない。

最終H_implでrootが `build → source:check → docs:format → trace:check → package:check → conformance:check` を直列実行し、6commandすべてexit0。全layer合計1647scenario中1631成功・0失敗・16skip、8657step中8607成功・0失敗・50skip、9m20.9s。conformanceはproject rule21件、orphan0、I1〜I12、実在source/export、成功SCN、固定model slug0の合格を実logで確認した。

| project layer | 失敗 | skip | 理由・証拠 |
|---|---:|---:|---|
| integration | 0 | 16scenario / 50step | 既存actual GraphQLiteのstore14件・runtime2件。ASC_GRAPHQLITE_TEST_EXTENSION未指定によるskipで、step側の条件を確認した。実native asset試験を成功へ読み替えない |

性能は `.agent-skill-chain/tmp/issue-1284-scenario-benchmark.mjs` と結果JSONを確認した。同一既存26scenario/130stepを前後交互3回、全6実行成功。process開始から終了までの中央値5507.658703ms→5599.087466ms、+1.66003%で15%閾値以内。baseline worktree HEAD `0157e432c70ad42b4eb869900184405dc123e258` は製品baseに対する文書だけの変更であり、測定製品が不変とGit差分で確認した。runner解決エラーの初回は測定値へ含めず、各rootの同一依存配置へ修復後の結果だけを使う。

成功CI run ID/URLとH_finalは本review時点で未観測。local出力を外部immutable CI証拠へ読み替えない。提出時にはcurrent H_finalへ一致する対象PRの成功CIを別途固定する。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | 入る | 旧trusted callerのfloor供給と復旧 |
| `src/domain/delivery.ts` | 入る | 配布JSになる入力guardと型契約 |
| `dist/src/domain/delivery.js` | 入る | sourceと対応するruntime拒否 |
| `docs/specs/`4file、`test/`3file | 入らない | 内部仕様・追跡・検証 |

判断: 配布物を更新した

根拠: sourceから生成したdistと配布schema利用案内を同時更新。build・package検査成功、dist入口の追加反例成功。runtimeだけ変えて利用者向け説明を取り残していない。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | 本reviewerは未観測。内部独立code reviewである |
| reviewerがPR author・実装commit authorと異なる | 内部identity/contextは両implementerと異なる。provider stable actor比較は未観測 |
| 観測したreview commentとapprovalの件数 | 未観測。0件と断定しない |
| 適用する例外の識別子 | 本reviewerは発行・適用していない。rootが正本とprovider実体を確認する |
| 観測値 | Claude外部送信拒否後の明示された内部代替。Claude実行・GitHub APPROVEDとは扱わない |

## 10. 仕様整合性

判定: updated。REQ-SQ-004、信頼境界、追跡表、変更履歴の4fileへ成立契約と実装参照を反映。TERM-ASC-004/005/095/096は意味変更なしで参照し、未定義語・重複定義・置換先なし廃止を追加していない。AC5件→SCN-INT-LEDGER-010〜014→feature/step→delivery入力境界を確認した。UI/token変更なし。先行実装SHAへの証拠参照を承認の循環根拠にしていない。

## 11. 総合判定と再開地点

- 未解決Critical/High: 製品0。
- Medium/Low: Low1件resolved。
- 判定: approved（H_impl `13715fed40578b51837d9095c68f04f84e16fdd4` の内部独立code review）。
- 新しい権限が必要な事項: 本reviewは外部操作をしない。提出authorityは本書から生成しない。
- 残存リスク: 構造がvalidな偽floorの真正性はtrusted caller責務。新provenance機構を実装したとは主張しない。
- 次に許可される操作: rootが本書を内容不変でtracked review177へコピーし、artifactだけをcommitする。提出は別途既存authority・外部CI/review確認に従う。
- 次回の再開地点: H_implを保持しH_finalの外部証拠を別途観測する。product/test/specはreviewer非変更、GitHub APPROVEDやmerge完了を本書から生成しない。
