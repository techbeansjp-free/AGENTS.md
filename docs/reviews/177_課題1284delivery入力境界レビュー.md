# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1284 の内部独立実装review |
| ラウンド | 2。round1収束後のHEAD移動に対する取り直し1回。差分と隣接影響だけを確認 |
| H_impl | `98e0ee399ea0fc06c10157ed03831ce1a9894c71` |
| 対象SHA・文書ダイジェスト | 新H_implをGit観測。旧H_impl `13715fed40578b51837d9095c68f04f84e16fdd4`、旧H_final `8c9e362a45211fedc4e02297891d0c29e59bd8f7` はancestor。製品実装759fbcと追跡補完a2bf8dを保持 |
| 比較基点 | `358c93256d90d335979fc11f681024f47bd974d3` |
| 対象差分 | 比較基点..H_implは製品10pathと前round review177の計11path。生成distを除く10pathを個別表へ記録 |
| 対象外 | 共通extension合成の変更、真正floorを偽るcallerの新provenance機構、個別rule廃止、proposal自動消費、提出操作 |
| 残り予算 | 収束後の取り直し1回を本roundで使用。scope/anchor/予算をresetしない |
| ラウンド数 | 2 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260908_081724_deliveryのpackageFloor省略を安全側に拒否する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md` REQ-SQ-004「trusted側へ先行登録したproject rule廃止提案とrule ID・trusted fragmentのraw UTF-8 SHA-256が完全一致する完全削除だけを受理する」 |
| 成果物行数 | source +16/-3、配布案内 +2、仕様 +14、test +230/-10、生成dist +5/-1。支援層は確認時00〜03の480行と本書、機械記録を再利用 |
| 縮小の先行評価 | 既存validator2個をdelivery入口へ合成し、共通resolver・保存状態・依存・policy設定を変更しない |
| 実施者・日時 | reviewer `/root/review_1284`。round1は2026-09-07T23:40:00Z以降、round2は2026-09-08の既定branch追随後 |

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
| round1直列検証 | `.agent-skill-chain/tmp/issue-1284-verification-final/latest-results.json` と `conformance-check.log` | 旧H_impl 13715fedで6command exit0、1631scenario成功・16skip・失敗0。新HEADのfull証拠とは称さない | verifier出力 |
| 追加反例 | `.agent-skill-chain/tmp/1284-independent-review-probes.md` | dist直接呼出し24/24成功、provider0 | reviewer実行観測 |
| 仕様 | REQ-SQ-004、信頼境界、追跡、変更履歴 | updated、既存用語を参照し新定義なし | 既存文書 |
| commit前candidate | implementer handoff path/hash | rootが製品commitへ固定。reviewerは非追跡8pathのhash一致を別途確認 | Git・hash観測 |
| Phase A artifact | `docs/reviews/177_課題1284delivery入力境界レビュー.md` | 本書の確定後、rootが内容を変えずコピーしてartifactだけをcommitする | 後続操作 |
| commit後external | PR #1288のCodeRabbit実体 | rootがreview comment0・approval0、制限通知5577084377を観測。新H_finalの成功full CIは後続確認 | verifierの外部観測報告 |

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
| `docs/reviews/177_課題1284delivery入力境界レビュー.md` | A | project | evidence | 旧H_finalに存在するround1の独立review履歴 | pass、過去の観測記録であって新HEADのauthorityではない | AC-1284-01〜05、旧H_impl13715fed | 旧8c9 commitに履歴保持。今回のartifact自己SHAを記入しない | pass |

新比較基点..H_implのGit net deltaは11path、dist以外10pathと個別表が一致する。製品10pathの変更内容は前roundと同一で、追加された11件目は旧review177である。新H_implの第2親とmerge-baseは比較基点に一致し、今回のartifact更新より前に通常mergeしている。旧H_finalもancestorとして保持した。mainの#1255差分は既存独立review済みの取り込み内容であり、当案件へ混入した新実装とは扱わない。

隣接影響は `src/cli.ts` のworktree parser委譲と `test/support/world.ts` のinitRepo既定SHA-1明示に限って確認した。createPullRequestの3callへtrustedSet.packageFloorを供給する配線は不変。新BDDが使うinitRepoの省略呼出しは従来SHA-1 fixtureの意味を保つ。#1284の追跡6行、#1285の確定3cellを保持し、当案件source/test/distは旧13715fedからbyte不変。未変更製品の全範囲を再レビューしていない。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1284-001 | 実装者sandboxでgit等がEPERM、初回独立fullでもCLI入口不在等の失敗 | 正常廃止・package/fullの証拠取得 | なし | rootが許可環境で全process終了後に直列検証、旧失敗logを保持し検査弱化なし | round1の旧H_implでroot targeted42件とfull1631件成功、16skip、失敗0 | updated | pass |

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

round1収束後にmainの#1255が進み、strict更新要求へ通常mergeで追随した。新H_impl/base、net delta、隣接CLI/world fixture、追跡保持を再確認。新findingなし、既存Lowはresolvedを保持する。検証は影響範囲へ比例させ、旧fullのHEADを読み替えず、最終PR CIでcurrent H_final全体を検証する。同sessionの取り直し1回を使用し、旧Step11とstaging digestを保持する。

### ラウンド3

未実施・不要。予算を自動更新していない。

## 7. テスト結果

runnerはcucumber-js、gherkinDialect=en、project layer順はunit/integration/e2e。独立verifier rootの出力を参照し、reviewerによるfull重複実行はしていない。

command: `project:quality`、`lint`、`format:check`、`typecheck`、`source:check`、`docs:format`、`test:format`、`trace:check`、`architecture:check`、`package:check`（いずれもnpm run）、実装者の`npm run build`、独立対象回帰の `node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-(UNIT|INT)-LEDGER|SCN-INT-DELIVERY'`。上記静的10commandとbuildはexit0、対象回帰は42scenario/230step成功・失敗/skip0。

変異は契約からguard除去・null/undefined取りこぼし・空rules受理・preview逃げの4件を作り、全件assertion failureでkillした実装者logを確認。空値と境界外位置の両枠を含む。型負例はfloor省略・undefined/null/空objectのコンパイル拒否を確認。独立dist追加反例24callは全成功・provider0でありBDD件数へ加算しない。

独立full初回は1647scenario中1622成功・16skip・9失敗、8657step中8584成功・64skip・9失敗。E2Eのdist/bin入口不在等を実logで確認した。同時buildの競合は原因候補であり、9件すべての確定原因とは主張しない。旧失敗logを保持し、初回を成功へ読み替えない。

round1の旧H_impl `13715fed40578b51837d9095c68f04f84e16fdd4` でrootが `build → source:check → docs:format → trace:check → package:check → conformance:check` を直列実行し、6commandすべてexit0。全layer合計1647scenario中1631成功・0失敗・16skip、8657step中8607成功・0失敗・50skip、9m20.9s。conformanceはproject rule21件、orphan0、I1〜I12、実在source/export、成功SCN、固定model slug0の合格を実logで確認した。

| project layer | 失敗 | skip | 理由・証拠 |
|---|---:|---:|---|
| integration | 0 | 16scenario / 50step | 既存actual GraphQLiteのstore14件・runtime2件。ASC_GRAPHQLITE_TEST_EXTENSION未指定によるskipで、step側の条件を確認した。実native asset試験を成功へ読み替えない |

性能は `.agent-skill-chain/tmp/issue-1284-scenario-benchmark.mjs` と結果JSONを確認した。同一既存26scenario/130stepを前後交互3回、全6実行成功。process開始から終了までの中央値5507.658703ms→5599.087466ms、+1.66003%で15%閾値以内。baseline worktree HEAD `0157e432c70ad42b4eb869900184405dc123e258` は製品baseに対する文書だけの変更であり、測定製品が不変とGit差分で確認した。runner解決エラーの初回は測定値へ含めず、各rootの同一依存配置へ修復後の結果だけを使う。

成功CI run ID/URLとH_finalは本review時点で未観測。local出力を外部immutable CI証拠へ読み替えない。提出時にはcurrent H_finalへ一致する対象PRの成功CIを別途固定する。


round2の新H_impl `98e0ee399ea0fc06c10157ed03831ce1a9894c71` ではrootがbuildを完了後、`SCN-(UNIT|INT)-(LEDGER|WTSURVEY)|SCN-INT-DELIVERY` を実行し91scenario/475step全成功、失敗・skip0、exit0を観測した。`1284-postmerge-targeted.json` と同名logはhead/baseへ固定されている。`issue-1284-verification-postmerge/latest-results.json` と各logのtypecheck/source/docs/trace/architecture/package 6commandも全exit0。旧fullの1631成功・16skipは13715fedに固定したまま、新H_implのfullとは称さない。製品delta不変と取り込み隣接影響の確認から局所再検証で十分と判定し、current H_final全体のfull検証はPR CIへ委ねる。最終CI成功確認前にmerge完了とは扱わない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | 入る | 旧trusted callerのfloor供給と復旧 |
| `src/domain/delivery.ts` | 入る | 配布JSになる入力guardと型契約 |
| `dist/src/domain/delivery.js` | 入る | sourceと対応するruntime拒否 |
| `docs/specs/`4file、`test/`3file、`docs/reviews/177_課題1284delivery入力境界レビュー.md` | 入らない | 内部仕様・追跡・検証、旧roundの証拠履歴 |

判断: 配布物を更新した

根拠: sourceから生成したdistと配布schema利用案内を同時更新。build・package検査成功、dist入口の追加反例成功。runtimeだけ変えて利用者向け説明を取り残していない。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | PR #1288の外部review未実行をrootが実体観測。本文は内部独立code review |
| reviewerがPR author・実装commit authorと異なる | 内部identity/contextは各implementerと異なる。GitHubの独立APPROVEDは存在しない |
| 観測したreview commentとapprovalの件数 | root観測: pulls/1288/reviews=[]、pulls/1288/comments=0、review comment0・approval0。CodeRabbit checkはSUCCESSだが、issue comment5577084377はReview limit reachedの通知だけ |
| 適用する例外の識別子 | `RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`、PR #1288へ適用。正本は `.agent-skill-chain/review-exceptions.json` |
| 観測値 | checkの緑ではなく、実review不在と制限通知を根拠に未実行と判定。新H_final push後にrootが条件を再観測する |

正本の既存例外を読み、観測条件と可逆なPR/mergeの対象範囲を確認した。承認元・承認者・日時は正本を参照し複製しない。例外は内部reviewを外部のimmutable approvalに変換せず、外部不可逆配布へ拡張しない。Claude外部送信拒否後の内部代替と、CodeRabbitの未実行は別の観測であり、どちらも実行済みreviewとして扱わない。

## 10. 仕様整合性

判定: updated。REQ-SQ-004、信頼境界、追跡表、変更履歴の4fileへ成立契約と実装参照を反映。TERM-ASC-004/005/095/096は意味変更なしで参照し、未定義語・重複定義・置換先なし廃止を追加していない。AC5件→SCN-INT-LEDGER-010〜014→feature/step→delivery入力境界を確認した。UI/token変更なし。先行実装SHAへの証拠参照を承認の循環根拠にしていない。

## 11. 総合判定と再開地点

- 未解決Critical/High: 製品0。
- Medium/Low: Low1件resolved。
- 判定: approved（round2、新H_impl `98e0ee399ea0fc06c10157ed03831ce1a9894c71` の内部独立review）。旧round1承認は歴史として保持。
- 新しい権限が必要な事項: 本reviewは外部操作をしない。提出authorityは本書から生成しない。
- 残存リスク: 構造がvalidな偽floorの真正性はtrusted caller責務。新provenance機構を実装したとは主張しない。
- 次に許可される操作: rootが本書を内容不変でtracked review177へコピーし、artifactだけをcommitする。提出は別途既存authority・外部CI/review確認に従う。
- 次回の再開地点: 同session round2とpost-terminal Step10を記録し、current H_finalの外部証拠を別途観測する。旧staging00〜04/Step11は書き換えない。product/test/specはreviewer非変更、GitHub APPROVEDやmerge完了を本書から生成しない。
