# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| H_impl | `68c32528984b44e7bed563016f9dffd0be4cba11` |
| 比較基点 | `a6d150ac4748cd1388eb36c3135bab458d164121` |
| 対象SHA・文書ダイジェスト | `68c32528984b44e7bed563016f9dffd0be4cba11` |
| 対象差分 | `a6d150ac4748cd1388eb36c3135bab458d164121..68c32528984b44e7bed563016f9dffd0be4cba11`、10 path。うち`dist/`配下2件は生成物として個別監査の対象外とし、配布影響は§8へ残す |
| 対象外 | 上限値そのものの見直し、Graph Evidenceのgate化、Step skillからの参照追加（Issue #1261）、node kindとedge kindの追加、GraphQLite版とasset digestの変更、`dist/vendor/typescript.cjs`をrepositoryから外すこと |
| 残り予算 | 同一範囲で最大3ラウンドのうち2ラウンドを使用。**残り1。** 収束後のHEAD移動に対する取り直し1ラウンドは未使用 |
| ラウンド数 | 2。ラウンド1はREJECT、ラウンド2はAPPROVE_WITH_FINDINGS |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260907_104854_graph-rebuildが4MiB超の追跡fileで投影全体をfail-closedする |
| 仕様の所有箇所 | `docs/specs/02_要件/05_グラフ投影要件.md`のREQ-GR-003。引用: 「絶対path、`..`、backslash、制御文字、symlink先のcontent、上限を超える単一file・source集合を意味Graphへ取り込まない」 |
| 成果物行数 | 製品・仕様 +191、test +330、生成dist +109 |
| 縮小の先行評価 | 上限値を上げる案は投影の決定性と所要時間を守る目的を失うため不採用。除外fileをnode化する案はREQ-GR-003に反するため不採用。**起票時にこの案を書いたのは規範仕様を読まなかった誤りで、issuecomment-5563886014で公開訂正した。** 新しい検査器とCLI flagを追加せず、既存の`observeSourceFiles`の分岐だけを変えた |
| 実施者・日時 | implementer: Claude Code / claude-opus-5[1m]。reviewer: codex CLI / 設定既定model / reasoning effort high。2026-09-07 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、原文引用 | critical。riskはhigh、外部契約変更あり | codex CLI。Codexの推論レベル上限highの範囲内 | **`--model`で固定せず`~/.codex/config.toml`の設定既定に従う。** 旧世代slugを明示指定して降格させない | 独立性が不明ならPRとmergeを停止する | implementerはClaude Code、reviewerはcodexの新規sessionでprovider・model・contextを共有しない。`--sandbox read-only`で起動し対象pathを変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | GitHub Issue #1262、staging 01のAC-1262-01からAC-1262-04 | Step 8で`sync-verified`、syncDigestとreadBackDigestが一致 | 実行観測 |
| 是正前の赤 | `graph rebuild --root=. --apply` | `graph source file上限を超えました: dist/vendor/typescript.cjs`で失敗 | 実行観測 |
| 是正後 | `graph rebuild --root=. --dry-run` | 4.37秒で完了。node 3,028、edge 14,304、`oversizedSource: {count: 1, paths: ["dist/vendor/typescript.cjs"]}` | 実行観測 |
| 差分 | `a6d150ac..68c32528` | 10 path | 既存コード |
| テスト | `--name 'SCN-(UNIT-SEMGRAPH-03[456789]\|INT-SEMGRAPH-033)'` | 7 scenarios、35 steps、すべて成功 | テスト出力 |
| 変異試験 | 11件 | 9 kill。生存2件は集合byte上限の二重防御 | テスト出力 |
| 仕様 | `docs/specs/02_要件/05_グラフ投影要件.md`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | `git diff --name-status a6d150ac 68c32528` | 10 pathすべてM。追加・削除・改名なし。個別監査は生成物の2件を除いた8件 | Git index |
| Phase A artifact | `docs/reviews/169_課題1262graph投影の単一file上限レビュー.md` | H_implの後にこの1 fileだけをcommitしてH_finalとする | Git観測 |
| commit後external | PR、CI run、外部review | **本artifactの作成時点では未観測である。** push後に別途記録する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **満たす。** 本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **artifact commit時点で満たす。**
- reviewer stable IDがPR author/`H_impl` author stable IDと異なる: **満たす。**
- 既定branch追随を行った場合: **該当なし。** 比較基点は`a6d150ac`のままである。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/adapters/repository-graph.ts` | M | package owner | package | source観測の上限適用と除外の収集 | pass。`cli.ts`へ依存しない一方向を維持 | REQ-GR-003 / AC-1262-01からAC-1262-04 | 既定値は本番値のまま。前進revertで復旧 | pass |
| `src/cli.ts` | M | package owner | package | 除外診断の提示 | pass。`cli.ts`から`repository-graph.ts`への一方向 | AC-1262-02 | 既存fieldを削除も改名もしない | pass |
| `test/features/unit/semantic-graph.feature` | M | package owner | evidence | SCN-UNIT-SEMGRAPH-034からSCN-UNIT-SEMGRAPH-039の6件 | pass | AC-1262-01からAC-1262-03 | 追加のみ。既存scenarioを変更していない | pass |
| `test/features/integration/semantic-graph-observation.feature` | M | package owner | evidence | SCN-INT-SEMGRAPH-033の1件 | pass | AC-1262-04 | 追加のみ | pass |
| `test/steps/semantic-graph.steps.ts` | M | package owner | evidence | 上限注入つき構築と除外の観測 | pass。既存step定義を変更していない | AC-1262-01からAC-1262-04 | 追加のみ | pass |
| `docs/specs/02_要件/05_グラフ投影要件.md` | M | package owner | spec | REQ-GR-003へ単一file除外と診断の契約を追記 | pass。名指ししたSCNは同じ要件の追跡行に登録済み | REQ-GR-003 / AC-GR-003 | 既存段落を削除していない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 追加SCNの追跡行2件 | pass。`trace:check`のorphanが要件・SCN・実装とも0件 | REQ-GR-003 / AC-GR-003 | 既存行は不変 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | 変更理由と判断の記録1行 | pass。9列のheader区切り直後へ挿入 | REQ-GR-003 | 既存行は不変 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **満たす。** `git diff --name-status`の10 pathのうち、生成物である`dist/`配下2件を除いた8 pathと表の8行が一致する。`dist/`の配布影響は§8へ残す。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **満たす。**
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **満たす。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | 起票時の提案1「超過fileをnodeに残す」がREQ-GR-003の「意味Graphへ取り込まない」に反していた | 設計の方向が逆になるところだった | なし | 00と01を訂正し、issuecomment-5563886014で公開訂正した | REQ-GR-003の原文引用 | REQ-GR-003へ除外の実装契約を追記した | pass |
| DISC-002 | 集合byte上限の拒否は2箇所にあり、実fileのfixtureでは個別に殺せない | AC-1262-03の担保範囲 | なし | **当初「決定論的に観測できない」と書いたのは誤り。** 独立reviewerがI/O seamによる反例を構成した。「実fileのfixtureでは殺せない」へ訂正した | 変異11件中9 kill | 変更履歴へ反映済み | pass |
| DISC-003 | 除外fileを`files`から外すと、実在判定とedge生成の両方が壊れる。**2段階あった** | AC-1262-01、INV-1262-01 | なし | `existingRegularFiles`へ除外した通常fileを合流させ、edge生成では除外pathをendpointにしない | SCN-UNIT-SEMGRAPH-037が2段目を検出した | 不要 | pass |

**fixtureだけを見るtestは、実入力の欠陥を検出しない。** 既存96 scenarioはすべて隔離疑似projectを対象にしており、追跡済みの4 MiB超fileで投影全体がfail-closedする状態を素通りさせた。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1262-01 | SCN-UNIT-SEMGRAPH-034、SCN-UNIT-SEMGRAPH-037 | `observeSourceFiles`の除外分岐、`excludedFromProjection` | 合格 | pass | 上限超過fileのnodeが無く通常fileのnodeが在る。追跡表が除外fileを指しても構築が完了する |
| AC-1262-02 | SCN-UNIT-SEMGRAPH-035 | `oversizedPaths`、`oversizedSourceDiagnostic` | 合格 | pass | 除外pathを決定論的な順序で件数付きで観測できる |
| AC-1262-03 | SCN-UNIT-SEMGRAPH-036、SCN-UNIT-SEMGRAPH-038、SCN-UNIT-SEMGRAPH-039 | 集合byte上限、file件数上限、symlinkの扱い | 合格 | pass | 集合上限と件数上限の拒否を維持し、超過symlinkを実在する通常fileとして扱わない |
| AC-1262-04 | SCN-INT-SEMGRAPH-033 | 実repository rootでの構築 | 合格 | pass | 除外が1件以上あり、各除外pathが既定上限を実際に超えることを`fs.statSync`で確認する |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 除外fileの本文を読まないことで、巨大fileの内容がメモリと投影へ載らない状態を保つ | size判定が`observeSourceFile`より前にある。除外fileへのreadは0回であることを独立reviewerが確認した |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 黙って除外すると「投影にあるはずのfileが無い」を後から追えない | `rebuild`のpreviewとapply、`status`の成功出力へ`oversizedSource`を追加した。件数を必ず出し、pathは先頭5件までとする |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CLIでありGUIを追加しない。出力はJSONで視覚要素を含まない | projectKindはcliである。差分に視覚要素はない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚componentとtokenを追加しない | project choicesのcapabilities.designTokensに従う。差分にtoken定義はない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | AC-1262-01からAC-1262-04をすべて成立と判定した |
| 価値 | 利用者・運用上の目的を満たすか | pass | 是正前は失敗していた`graph rebuild --root=.`が4.37秒で完了する |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 新しいCLI、schema、validator、deny gate、依存packageを追加していない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の§2.2に列挙した変更箇所と実差分の10 pathが一致する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 単一fileの除外と集合上限の拒否を別責務として分けた。上限は既定値つきで注入できる |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 変異11件中9 kill。生存2件は集合上限の二重防御で、実fileのfixtureでは区別できない |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 集合byte上限、file件数上限、構築中source変更の拒否をすべて維持する |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 上限ちょうどは取り込み、1 byte超は取り込まない。除外0件でも診断fieldを欠かさない。超過symlinkは実在する通常fileとして扱わない |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | `safeRepositoryPath`の境界検査を変更していない。診断へ出すのは境界検査済みのrepository相対pathだけである |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | Graph Evidenceの`authority: "none"`と`mergeAuthorization: false`を変更していない。gateを増やさず既存gateも弱めない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 投影はGit管理外の派生投影であり全削除と完全再構築が可能である。既存fieldを削除も改名もしていない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 前進revertで復旧する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `buildRepositorySemanticGraph`の署名を維持したため既存呼び出しは壊れない。REQ-GR-003と変更履歴へ反映した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| H-01 | High | 除外fileを`files`から外したことで、追跡表が除外fileを参照すると`trace-endpoint-missing`で構築全体が失敗する | ラウンド1のreviewerが具体的な3 fileの入力で再現した | AC-1262-01、INV-1262-01 | `existingRegularFiles`へ除外した通常fileを合流させ、さらにedge生成で除外pathをendpointにしないようにした。**2段階あった** | resolved | なし。SCN-UNIT-SEMGRAPH-037が両段を固定する |
| M-01 | Medium | 実repository用scenarioが、除外が0件でも合格する | ラウンド1のreviewerが`oversizedPaths: []`を渡してPASSすることを示した | AC-1262-04 | `oversized.length > 0`を要求し、各pathが既定上限を実際に超えることを`fs.statSync`で確認する形へ変えた | resolved | なし |
| M-02 | Medium | 生存変異の「決定論的に観測できない」という記述に反例がある | ラウンド1のreviewerがI/O seamを前提とした反例を構成した | 記録の正確性 | 「実fileのfixtureでは殺せない」へ訂正した | resolved | なし |
| L-01 | Low | 訂正後の記録にある「この2箇所を1文字も変更していない」が実diffと矛盾する | ラウンド2のreviewerが`MAX_SOURCE_SET_BYTES`から`limits.maxSetBytes`への置換を示した | 記録の正確性 | 「変えたのは閾値の参照先だけで、比較演算・拒否の発生条件・既定の上限値は維持した」へ訂正した | resolved | なし |
| L-02 | Low | 実repository scenarioは、将来`dist/vendor/typescript.cjs`が外れると失敗する | ラウンド2のreviewerが指摘 | SCN-INT-SEMGRAPH-033 | 記録のみ。**実入力による回帰検証の前提が失われた通知として受け入れる。** その時点で代替の検証入力を検討する | valid | 前提が変わったときに失敗する。診断文が理由を示す |
| L-03 | Low | 集合byte上限の二重防御を実fileのfixtureで個別に殺せない | 変異試験で2件生存 | AC-1262-03 | 記録のみ。I/O seamの導入は本件のscope外とする | valid | 片方の防御が失われても他方が拒否するため、拒否そのものは維持される |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。AC-1262-01からAC-1262-04とINV-1262-01からINV-1262-03を原文引用で判定した。
- 指摘を確定した: H-01、M-01、M-02。verdictはREJECT。
- 次ラウンド対象のCritical/High: H-01。

### ラウンド2

- 未解決Critical/High: なし。H-01、M-01、M-02の解消を確認した。
- 修正差分: `existingRegularFiles`の合流、`excludedFromProjection`によるedge省略、実repository scenarioのassertion、記録の訂正。
- 修正で触れた隣接範囲: edge省略が`trace-endpoint-missing`を隠していないこと、実在判定へ不在fileやsymlinkが混入していないこと、SCN-UNIT-SEMGRAPH-039のfixture内assertが上限・追跡表・symlinkの関係が崩れたときに落ちることを、いずれも独立に確認した。
- 既承認・未変更範囲を再走査していない: はい。
- 新たにL-01とL-02を確定した。いずれも非ブロッキングである。
- verdictはAPPROVE_WITH_FINDINGS。

## 7. テスト結果

実行したcommandの一覧。

- `npm run docs:format`
- `npm run trace:check`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-(UNIT-SEMGRAPH-03[456789]|INT-SEMGRAPH-033)'`
- `npm run verify:distribution`
- `node dist/bin/agent-skill-chain.js graph install --root=. --apply` および `graph rebuild --root=. --dry-run`

runnerは`@cucumber/cucumber`、`projectChoices.gherkinDialect`は`en`、`projectChoices.testLayers`は`unit`、`integration`、`e2e`である。

対象シナリオの実行は7 scenarios、7 passed、0 failed、0 skipped。35 steps、35 passed。

失敗またはskipがある層: **対象シナリオの実行では0件である。** 全suiteの合計は1602 scenarios中1585 pass、16 skip、1 failだった時点があり、**その1件はこの変更が壊した既存scenario `SCN-INT-SPECNORM-001` である。** 追加SCNを追跡表へ登録しておらず「孤立SCNです」で落ちた。追跡表へ登録して解消した。**この経緯を隠して最初から全合格とは書かない。**

skipの16件はGraphQLiteの実native assetを要する環境依存であり、本変更のSCNにskipはない。

対応する成功CI runの参照: **本artifactの作成時点では存在しない。** branchを未pushであるため、run IDとURLと対象HEADは提出時に別途記録する。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/repository-graph.ts` | 入る | 単一fileの上限超過で投影全体が失敗しなくなる。除外pathを返す |
| `src/cli.ts` | 入る | `graph rebuild`と`graph status`の出力へ`oversizedSource`が増える |
| `dist/src/adapters/repository-graph.js` | 入る | 上記sourceのbuild生成物 |
| `dist/src/cli.js` | 入る | 上記sourceのbuild生成物 |
| `docs/specs/`の3 file | 入らない | ASC自身の仕様と追跡であり配布物に含まれない |
| `test/`の3 file | 入らない | 配布境界外の検証資産である |

判断: 配布物を更新した

根拠: `src/`と`dist/`はpackage manifestの配布file指定に含まれる。利用者から見て、4 MiB超の追跡fileを持つrepositoryで投影が構築できるようになり、除外の診断が出力へ増える。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | 本artifactの作成時点ではなし。提出時にPRとCI runで観測する |
| reviewerがPR author・実装commit authorと異なる | はい。reviewerはcodex CLIの独立sessionであり、commitのauthorではない |
| 観測したreview commentとapprovalの件数 | 2ラウンド。ラウンド1でHigh 1件・Medium 2件、ラウンド2でLow 2件を新規確定し収束 |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/05_グラフ投影要件.md`のREQ-GR-003、`docs/specs/15_要件追跡/00_追跡表.md`、`01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **満たす。** 用語を追加していない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **満たす。**
- 要件・変更・SCN・テストの追跡: REQ-GR-003、AC-GR-003、SCN-UNIT-SEMGRAPH-034からSCN-UNIT-SEMGRAPH-039、SCN-INT-SEMGRAPH-033。`trace:check`のorphanが要件・SCN・実装とも0件。
- `no-spec-impact`の場合の限定的根拠: 該当なし。
- UI・トークンの判断: DC-UXとDC-TOKENSはともにnot-applicable。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし。
- Medium/Lowの記録: H-01、M-01、M-02、L-01はresolved。L-02とL-03はvalidとして記録のみとする。追加loopとgate停止を生じさせない。
- 判定: approved
- 新しい権限が必要な事項: なし。push、PR作成、mergeはユーザーが2026-09-07に明示承認している。merge承認は`pr.merge`だけを許可し、branch削除、Issue終了、release、公開、cleanupを連結しない。
- 残存リスク: L-02により、`dist/vendor/typescript.cjs`がrepositoryから外れると実repository scenarioが失敗する。L-03により、集合byte上限の二重防御を実fileのfixtureで個別に殺せない。
- **主張の範囲。** 本件が担保するのは、単一fileの上限超過で投影全体が失敗しないことと、その除外が診断として出ることである。**Semantic GraphがStep skillから参照されていない問題はIssue #1261が所有し、本件では解消しない。**
- 次に許可される操作: 本artifactをH_implの後に単独commitしてH_finalとし、`audit:check`と`verify:distribution`をH_finalで実行する。その後にbranchをpushしPRを作成する。
- 次回の再開地点: H_finalでの配布gate実行。
