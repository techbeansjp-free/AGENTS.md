# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| H_impl | `f9dcba9f0e80cccac547eca3fbcd2682769f8e85` |
| 比較基点 | `b5346195b4554d9d05ba1856ee588ec3d166a8c5` |
| 対象SHA・文書ダイジェスト | `f9dcba9f0e80cccac547eca3fbcd2682769f8e85` |
| 対象差分 | `b5346195b4554d9d05ba1856ee588ec3d166a8c5..f9dcba9f0e80cccac547eca3fbcd2682769f8e85`、11 path。うち`dist/`配下1件は生成物として個別監査の対象外とし、配布影響は§8へ残す |
| 対象外 | 変異試験の実施そのもののgate化、`mutation-test`を選ぶ条件の`externalContractChanged`以外への拡張、既存増補規則5件の変更、`BASE_VERIFICATION`の変更、Issue #1261が所有するSemantic Graphのskill参照 |
| 残り予算 | 同一範囲で最大3ラウンドのうち1ラウンドを使用。**残り2。** 収束後のHEAD移動に対する取り直し1ラウンドは未使用 |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260907_143916_mutation-testに選択経路を与え新しいSCNの検出力を要求する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-029。引用: 「critical logicは必要に応じてnegative、property-based、differential、mutation等を追加する」 |
| 成果物行数 | 実装 +14、配布文書 +7、test +219、仕様 +5、生成dist +14 |
| 縮小の先行評価 | 新しいCLI flagで`mutation-test`を明示指定させる案は、選定の正本が`selectVerificationSet`であるという既存構造を二重化するため不採用。riskを条件にする案は既存SCN-UNIT-AGILE-005が固定するownerの判断を実装側から覆すため不採用。**新しい検査器とgateを作らず、既存の増補規則へ1件を加え、SCN 4件で足りると判断した** |
| 実施者・日時 | implementer: Claude Code / claude-opus-5[1m]。reviewer: codex CLI / 設定既定model / reasoning effort high。2026-09-07 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、原文引用 | advanced。riskはhigh、外部契約変更あり | codex CLI。Codexの推論レベル上限highの範囲内 | **`--model`で固定せず設定既定に従う** | 独立性が不明ならPRとmergeを停止する | implementerはClaude Code、reviewerはcodexの新規session。`--sandbox read-only`で起動し対象pathを変更していない。reviewer自身が「ファイル編集・commit・push・外部送信は行っていません」と報告している |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | GitHub Issue #1259、staging 01のAC-1259-01からAC-1259-03 | Step 8で`sync-verified`、syncDigestとreadBackDigestが一致 | 実行観測 |
| 欠陥の実測 | `workflow verification-set`を是正前のHEADで実行 | new-feature・high・外部契約変更ありに対し`['acceptance-test','integration-test','build','negative-test','security-analysis','contract-test']`を返し`mutation-test`を含まない | 実行観測 |
| 是正後の観測 | 同一入力を是正後のHEADで実行 | 同じ集合へ`mutation-test`が1件加わる | 実行観測 |
| 差分 | `b5346195..f9dcba9f` | 11 path | 既存コード |
| テスト | 対象4 SCNを`--name`で絞り込んだcucumber実行 | 4 scenarios、20 steps、すべて成功 | テスト出力 |
| 変異試験 | 8件 | 8 kill。独立reviewerが構成した回避2件を含む | テスト出力 |
| 全数比較 | reviewerによる10変更種別×4 risk×境界数2種×影響フラグ32組合せ=2,560入力 | 外部契約変更なしの1,280入力で出力全体が基点と`deepEqual`一致。変更ありの1,280入力すべてで`mutation-test`が選ばれ、従来との差は`mutation-test`だけ | 実行観測 |
| 仕様 | `docs/specs/02_要件/04_仕様・品質管理要件.md`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | `git diff --name-status b5346195 f9dcba9f` | 11 pathすべてM。うち生成dist 1件 | Git index |
| Phase A artifact | `docs/reviews/171_課題1259mutation-test選択経路レビュー.md` | H_implの後にこの1 fileだけをcommitしてH_finalとする | Git観測 |
| commit後external | PR、CI run、外部review | **本artifactの作成時点では未観測である。** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **満たす。**
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **artifact commit時点で満たす。**
- reviewer stable IDがPR author/`H_impl` author stable IDと異なる: **満たす。**
- 既定branch追随を行った場合: **該当なし。** 比較基点は`b5346195`のままである。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/agile-verification.ts` | M | package owner | domain | 既存`externalContractChanged`増補規則へ1手段を追加 | pass。domainからadapterとCLIへの依存を追加していない | REQ-SQ-029 / AC-1259-01・AC-1259-02 / SCN-UNIT-AGILE-028・029・030 | 既存分岐と既定値を削除していない。前進revertで復旧 | pass |
| `.agent-skill-chain/docs/02_品質基準.md` | M | package owner | package | 変異の作り方の判断材料の正本 | pass。Evidence-driven Verification行を再定義せず別項目として追加 | AC-1259-03 / SCN-UNIT-PACKAGE-026 | 既存行を削除していない | pass |
| `.agent-skill-chain/templates/issue/03_実装計画.md` | M | package owner | package | 選ばれた検証の充足を記録する欄 | pass。`workflow verification-set`の呼び出し記述の直後へ置き、選定と記録を隣接させた | AC-1259-03 / SCN-UNIT-PACKAGE-026 | 追加のみ。既存の記入欄を変更していない | pass |
| `test/features/unit/agile-verification.feature` | M | package owner | evidence | SCN-UNIT-AGILE-028・029・030の3件 | pass | AC-1259-01 / AC-1259-02 | 追加のみ。既存scenarioを変更していない | pass |
| `test/features/unit/review-policy-package.feature` | M | package owner | evidence | SCN-UNIT-PACKAGE-026の1件 | pass | AC-1259-03 | 追加のみ | pass |
| `test/steps/agile-verification.steps.ts` | M | package owner | evidence | 選定条件の観測。全種別sweepを含む | pass。既存step定義を変更していない | AC-1259-01 / AC-1259-02 | 追加のみ | pass |
| `test/steps/unit.steps.ts` | M | package owner | evidence | 配布文書の契約文と記録欄の実在の観測 | pass | AC-1259-03 | 追加のみ | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | package owner | spec | REQ-SQ-029へ選定条件と保証範囲を明記 | pass。名指ししたSCN 4件は同じ要件の追跡行に登録済み | REQ-SQ-029 / AC-SQ-029 | 既存段落を削除していない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 追加SCNの追跡行2件 | pass。`trace:check`のorphanが要件・SCN・実装とも0件 | REQ-SQ-029 / AC-SQ-029 | 既存行は不変 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | 変更理由と判断の記録1行 | pass。9列のheader区切り直後へ挿入 | REQ-SQ-029 | 既存行は不変 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **満たす。** `git diff --name-status`の11 pathのうち、生成物である`dist/`配下1件を除いた10 pathと表の10行が一致する。`dist/`の配布影響は§8へ残す。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **満たす。**
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **満たす。** M-01とM-02は`test/`の2 file、M-03は仕様1 fileに閉じている。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | 既存の`SCN-UNIT-AGILE-014`と`SCN-UNIT-AGILE-017`は`new-feature`・`medium`・外部契約変更ありに該当し、選定結果へ`mutation-test`が増える | 「既存の選定結果を変えない」という当初の無限定な記述が誤り | なし | 記述を「外部契約を変えない入力の選定結果は従来と同一である」へ限定し、変更履歴と本artifactへ訂正を明記した | reviewerによる2,560入力の全数比較 | `01_変更履歴.md`へ訂正を記録 | pass |
| DISC-002 | SCN-UNIT-AGILE-028のGivenが`affectedBoundaries`を設定せず、単独実行で`TypeError`となる | 028単独の成功証拠が成立しない | なし | 同じGivenで境界も設定した。scenario間の実行順序への依存を断った | SCN-UNIT-AGILE-028が単独で合格 | 不要 | pass |
| DISC-003 | 陽性1点・陰性1点の固定では、`risk === "high"`への限定と`api`での無条件追加という2つの回帰を見逃す | AC-1259-01とAC-1259-02の担保範囲 | なし | SCN-UNIT-AGILE-030として10変更種別×4 riskで`externalContractChanged`だけを反転するsweepを追加した | 回避2件をkill | REQ-SQ-029へSCN-UNIT-AGILE-030を追記 | pass |
| DISC-004 | SCN-UNIT-PACKAGE-026は本文を反転して元文をHTMLコメントへ移す変異で生存する | 仕様の「不変条件を強制する」が過大 | なし | **assertionを強化せず仕様の主張を狭めた。** 保証するのは選定結果と固定文字列の実在であることを明記した | 変異の生存を記録 | REQ-SQ-029へ保証範囲を明記 | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1259-01 | SCN-UNIT-AGILE-028、SCN-UNIT-AGILE-030 | `externalContractChanged`分岐への`methods.add("mutation-test")` | 合格 | pass | 追加行を落とす変異、`risk === "high"`へ限定する変異をkillする。reviewerの全数比較で変更ありの1,280入力すべてが選ぶ |
| AC-1259-02 | SCN-UNIT-AGILE-029、SCN-UNIT-AGILE-030 | 追加は当該分岐内だけ | 合格 | pass | `api`で無条件に追加する変異、分岐を`true`へ退化させる変異をkillする。reviewerの全数比較で変更なしの1,280入力が基点と`deepEqual`一致 |
| AC-1259-03 | SCN-UNIT-PACKAGE-026 | `02_品質基準.md`の変異試験行と`03_実装計画.md`の充足記録表 | 合格 | pass | 契約文4件と表header 4列を個別に落とす変異をkillする。**本文の意味を反転する変異は生存する。** 仕様の主張をその範囲へ狭めた |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | not-applicable | 選定規則と文書の変更であり、信頼境界、認可、秘密情報の扱いを変更しない | 差分にauthorityとgateの変更が無いことを独立reviewerが確認した |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 選ばれた手段をどう充足したかを記録できないと、後から検出力を確認できない | `03_実装計画.md`の充足記録表とSCN-UNIT-PACKAGE-026 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CLIでありGUIを追加しない。変更は選定規則と配布Markdownの本文である | projectKindはcliである。差分に視覚要素はない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚componentとtokenを追加しない | project choicesのcapabilities.designTokensに従う |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | AC-1259-01からAC-1259-03、INV-1259-01からINV-1259-03を独立reviewerが原文引用で成立と判定した |
| 価値 | 利用者・運用上の目的を満たすか | pass | **宣言されていながらどの入力でも選ばれなかった手段に選択経路ができた。** 外部契約を変える変更に対し、検出力の提示が選定結果として要求される |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 新しいCLI、schema、validator、deny gate、依存packageを追加していない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の§2.2に列挙した変更箇所と実差分の11 pathが一致する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 追加は既存増補規則の1行と判断根拠のコメントである。新しい分岐構造を作っていない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 変異8件中8 kill。reviewerが構成した回避2件を含む。2,560入力の全数比較で例外なし |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 追加した`methods.add("mutation-test");`は既存の`if (input.impactAnalysis.externalContractChanged) {`分岐内のSet操作だけで、I/Oも例外送出も追加していない。**選定は要求であって強制ではない。** 充足できない場合は理由を実装計画へ残す経路がある。SCN-UNIT-AGILE-030 |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 10変更種別×4 risk×境界数1・2をsweepした。`externalContractChanged`が真かつ他の影響がすべて偽の場合も選ぶ |
| 悪用 | 注入、経路脱出、権限外操作等 | not-applicable | 新しい入力経路と権限を追加していない。入力schemaを変更していない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | gateを追加せず既存gateも弱めていない。**選ばれた手段を充足したかの判定は既存の独立reviewが担う。** 実装側でmerge可否を変えない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 既存の増補規則、`BASE_VERIFICATION`、既存scenarioを削除していない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 前進revertで復旧する。既存の記入済み成果物へ遡及的な要求をしない |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `dist`のbuild結果を同一commitへ含めた。REQ-SQ-029、追跡表、変更履歴へ反映した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | SCN-UNIT-AGILE-028のGivenが`affectedBoundaries`を設定せず、単独実行では`TypeError: Cannot read properties of undefined (reading 'length')`となる。先行scenarioの状態に依存していた | reviewerが新しい状態でstep関数を実行し再現した | AC-1259-01の成功証拠 | 同じGivenで`affectedBoundaries`を`["domain"]`へ設定した | resolved | なし |
| M-02 | Medium | 陽性1点・陰性1点の固定では選定条件と全種別の互換性を固定できない。`mutation-test`追加を`risk === "high"`へ限定する変異と、`api`で無条件に追加する変異がともに既存7 scenarioを通過した | reviewerがメモリ内変異実行で両方の生存を示した | AC-1259-01、AC-1259-02、INV-1259-01 | SCN-UNIT-AGILE-030を追加し、10変更種別×4 riskで`externalContractChanged`だけを反転して`mutation-test`の有無が完全一致することを検査した | resolved | なし |
| M-03 | Medium | REQ-SQ-029の「この不変条件を強制する」が検証範囲を超えている。SCN-UNIT-PACKAGE-026は本文を反転して元文をHTMLコメントへ移す変異で生存する | reviewerが該当変異の生存を示した | 仕様の主張 | **assertionをACを超えて広げず仕様の主張を狭めた。** 「保証するのは選定結果と固定文字列の実在であり、変異の作り方に従ったことも変異試験を実施したことも保証しない」と明記した | resolved | 配布文書の意味の反転は検出しない。実施の確認は独立reviewが担う |
| L-01 | Low | SCN-UNIT-PACKAGE-026の期待値が太字記号まで固定しており、意味を変えない表記修正でも落ちる。厳密には契約全文の固定ではなく選んだ4文字列の部分一致である | reviewerが期待値の原文を引用 | 記録の正確性、将来の表記変更の費用 | 記録のみ。**固定配布文書の回帰検査として4箇所の同時更新は受け入れ可能と判断した。** M-03で仕様の主張を実態へ合わせている | valid | 表記変更時に期待値の更新が要る |
| L-02 | Low | 「契約の変更は利用者へ届く」は対象に含める根拠にはなるが、対象外をすべて除く根拠にはならない。外部契約を維持する内部refactoringでも回帰は利用者へ届き得る | reviewerの総評 | 選定条件の広さ | **今回の明示的なscopeとして狭さを受け入れる。** 拡張は別Issueが所有する | valid | 外部契約を変えない変更の検出力は選定として要求されない |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。AC-1259-01からAC-1259-03、INV-1259-01からINV-1259-03を原文引用で判定した。
- 指摘を確定した: M-01、M-02、M-03、L-01、L-02。**Critical/Highは0件。**
- 次ラウンド対象のCritical/High: なし。M-01、M-02、M-03はこのラウンド内で是正した。
- verdictはAPPROVE_WITH_FINDINGS。

## 7. テスト結果

実行したcommandの一覧。

- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm run docs:format`
- `npm run trace:check`
- `npm run verify:distribution`
- `node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-UNIT-AGILE-02[89]|SCN-UNIT-AGILE-030|SCN-UNIT-PACKAGE-026'`

runnerは`@cucumber/cucumber`、`projectChoices.gherkinDialect`は`en`、`projectChoices.testLayers`は`unit`、`integration`、`e2e`である。

対象シナリオの実行は4 scenarios、4 passed、0 failed、0 skipped。20 steps、20 passed。

`verify:distribution`の全suite実行は1620 scenarios、1604 passed、0 failed、16 skipped。8520 steps、8470 passed、50 skipped。**skipは既存の環境依存scenarioであり本件が追加したものではない。**

失敗またはskipがある層: **対象シナリオの実行では0件である。** 全suiteの結果は`verify:distribution`の実行ログを正本とする。

対応する成功CI runの参照: **本artifactの作成時点では存在しない。** branchを未pushであるため、run IDとURLと対象HEADは提出時に別途記録する。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/agile-verification.ts`、`dist/src/domain/agile-verification.js` | 入る | `workflow verification-set`が外部契約を変える入力へ`mutation-test`を1件多く返す |
| `.agent-skill-chain/docs/02_品質基準.md` | 入る | 変異の作り方の判断材料が1項目増える |
| `.agent-skill-chain/templates/issue/03_実装計画.md` | 入る | 選ばれた検証の充足を記録する表が1つ増える |
| `docs/specs/`の3 file | 入らない | ASC自身の仕様と追跡であり配布物に含まれない |
| `test/`の4 file | 入らない | 配布境界外の検証資産である |

判断: 配布物を更新した

根拠: `src`と`.agent-skill-chain/docs/`と`templates/`はいずれも配布されるpackage所有資産であり、利用者が受け取る選定結果と記入欄が変わる。**既存fieldの削除も改名もない。** 外部契約を変えない入力の選定結果は従来と同一であり、既存の記入済み成果物へ遡及的な要求をしない。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | 本artifactの作成時点ではなし。提出時にPRとCI runで観測する |
| reviewerがPR author・実装commit authorと異なる | はい。reviewerはcodex CLIの独立sessionであり、commitのauthorではない |
| 観測したreview commentとapprovalの件数 | 1ラウンド。Medium 3件・Low 2件を確定。Critical/Highは0件 |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-029、`docs/specs/15_要件追跡/00_追跡表.md`、`01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **満たす。** 用語を追加していない。`mutation-test`は既存の`VerificationMethod`である。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **満たす。**
- 要件・変更・SCN・テストの追跡: REQ-SQ-029、AC-SQ-029、SCN-UNIT-AGILE-028、SCN-UNIT-AGILE-029、SCN-UNIT-AGILE-030、SCN-UNIT-PACKAGE-026。`trace:check`のorphanが要件・SCN・実装とも0件。
- `no-spec-impact`の場合の限定的根拠: 該当なし。
- UI・トークンの判断: DC-UXとDC-TOKENSはともにnot-applicable。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし。
- Medium/Lowの記録: M-01、M-02、M-03はresolved。L-01とL-02はvalidとして記録のみとする。追加loopとgate停止を生じさせない。
- 判定: approved
- 新しい権限が必要な事項: なし。push、PR作成、mergeはユーザーが2026-09-07に明示承認している。merge承認は`pr.merge`だけを許可し、branch削除、Issue終了、release、公開、cleanupを連結しない。mergeは`--merge`で行い`--squash`を使わない。
- 残存リスク: M-03により、配布文書の契約文が意味ごと反転してもSCN-UNIT-PACKAGE-026は検出しない。L-01により表記変更時の期待値更新が要る。L-02により外部契約を変えない変更の検出力は選定として要求されない。
- **主張の範囲。** 本件が担保するのは、`externalContractChanged`が真の入力に対して`mutation-test`が選ばれること、偽の入力の選定結果が従来と同一であること、配布文書に判断材料と記録欄が実在することである。**変異の作り方に従ったことも、変異試験を実施したことも担保しない。** それらの確認は独立reviewが担う。
- 次に許可される操作: 本artifactをH_implの後に単独commitしてH_finalとし、`audit:check`と`verify:distribution`をH_finalで実行する。その後にbranchをpushしPRを作成する。
- 次回の再開地点: H_finalでの配布gate実行。
