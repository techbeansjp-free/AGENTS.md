# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| H_impl | `6d1ad607818082d02f54d922e42c01b23dd79aab` |
| 比較基点 | `2bb00af07f09935b4091cdb476c89ffd66c1a0dc` |
| 対象SHA・文書ダイジェスト | `6d1ad607818082d02f54d922e42c01b23dd79aab` |
| 対象差分 | `2bb00af07f09935b4091cdb476c89ffd66c1a0dc..6d1ad607818082d02f54d922e42c01b23dd79aab`、10 path。うち`dist/`配下1件は生成物として個別監査の対象外とし、配布影響は§8へ残す |
| 対象外 | 結果の再利用・cache・digest条件付きskip、`cucumber.mjs`、`check_project_quality.ts`、`ci.yml`、`quality` script、`DISTRIBUTION_GATES`、予算や閾値の変更 |
| 残り予算 | 同一範囲で最大3ラウンドのうち1ラウンドを使用。**残り2。** |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260908_101725_conformance-checkのcucumber実行をbindingの反例SCNへ限定する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-005。引用: 「**`conformance:check`が起動するcucumberは、conformance bindingが名指しした反例SCNだけへ完全ID一致で限定する。**」 |
| 成果物行数 | 実装 +51、test +129、仕様 +9、生成dist +30 |
| 縮小の先行評価 | **新しいgate、validator、CLI、schema、台帳、project choice項目を1つも追加していない。** 既存の`checkConformance`が起動するcucumberの範囲を狭めるだけである。**seamのwrapperは追加せず削除した。** 当初は`ConformanceTestRunner`という中間層を置いたが、reviewerの指摘でwrapper自体を消し、既定を`spawnSync`そのものにした。argvを組む式はrepository全体で1箇所である |
| 実施者・日時 | implementer: Claude Code / claude-opus-5[1m]。reviewer: codex CLI / 設定既定model / reasoning effort high。2026-09-08 |

### 0.1 routing入力契約

| role欄（担当role） | 許可path・操作 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|---|
| implementer | `src/`、`scripts/`、`test/`、`docs/specs/`、`dist/`の読み書き | SCN実行結果、所要の前後比較、変異試験の生存0件 | standard | project choiceのprovider上限に従う | project choiceのtier mapping | 検査失敗時はcommitせず停止する | reviewerはcodexの新規sessionで実装contextを共有しない |
| reviewer | 読み取りのみ。`--sandbox read-only` | 肯定・敵対review、finding分類、原文引用 | advanced。riskはmedium、外部契約変更あり | codex CLI | **`--model`で固定せず設定既定に従う** | 独立性が不明ならPRとmergeを停止する | reviewer自身が「ファイル変更・commit・push・テスト実行は行っていません」と報告した |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | GitHub Issue #1281、staging 00・01のAC-01からAC-05 | Step 8で`sync-verified`、syncDigestとreadBackDigestが`3206f6eef1df09c5f924b306ed62007030bb3f05ed4f2545aa7c19a2f1b33c51`で一致 | 実行観測 |
| 変更前の所要 | `conformance:check` | **1650 scenarios、9分34秒** | 実行観測 |
| 変更後の所要 | 同上 | **87 scenarios、26秒**。49名のうちScenario Outline 3件のExamples展開で87件になる | 実行観測 |
| 全Gherkinの独立確認 | `npm test` | **1642 passed、16 skipped、失敗0**（全1658 scenarios）、9分15秒。**skipを合格として数えない** | 実行観測 |
| 対象SCN | `--name`で絞り込んだcucumber実行 | 3 scenarios、15 steps成功 | テスト出力 |
| 前方一致の危険 | `git grep`の全SCN ID集計 | repository内1525 IDに対しbinding IDが前方一致になる組は0件。**それを根拠に境界指定を省いていない** | 実行観測 |
| 変異試験 | 8件 | **8 kill、生存0。うち3件はreviewer由来である** | テスト出力 |
| 仕様 | `docs/specs/02_要件/04_仕様・品質管理要件.md`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | `git diff --name-only 2bb00af0 6d1ad607` | 10 path。うち生成dist 1件 | Git index |
| Phase A artifact | `docs/reviews/177_課題1281conformance検査の実行範囲限定レビュー.md` | H_implの後にこの1 fileだけをcommitしてH_finalとする | Git観測 |
| commit後external | PR、CI run、外部review | **本artifactの作成時点では未観測である。** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **満たす。** 契約→実行範囲→実行結果→契約検証の一方向であり、**実行結果を`bindings.json`へ書き戻さない。**
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **artifact commit時点で満たす。**
- reviewer stable IDが`H_impl` author stable IDと異なる: **満たす。**
- 既定branch追随を行った場合: **該当なし。** 比較基点は`2bb00af0`のままである。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/conformance.ts` | M | package owner | domain | `counterexampleScenarioNamePattern`と`conformanceTestArgv`を追加する。**同fileは既にconformance契約の判定を所有する** | pass。新しい依存を追加していない | REQ-SQ-005 / AC-01・AC-02 / SCN-UNIT-CONFORMANCE-006・007 | 既存exportを変更していない。前進revertで復旧 | pass |
| `scripts/check_conformance.ts` | M | package owner | script | bindingの読み取りをspawnより前へ移し、`--name`を渡す。**seamのwrapperを削除し既定を`spawnSync`自体にした** | pass。`scripts/` → `src/domain/`の既存方向を維持 | REQ-SQ-005 / AC-03・AC-04 / SCN-INT-CANON-007 | 判定条件3点と出力文言を変更していない | pass |
| `test/features/unit/risk-policy.feature` | M | package owner | evidence | SCN-UNIT-CONFORMANCE-006・007の追加 | pass | AC-01・AC-02 | 追加のみ | pass |
| `test/features/integration/canonical-single-source.feature` | M | package owner | evidence | SCN-INT-CANON-007の追加 | pass | AC-03・AC-04 | 追加のみ | pass |
| `test/steps/risk-policy.steps.ts` | M | package owner | evidence | 完全一致、ハイフン延長、メタ文字、重複、空bindingのargvを検査する | pass。既存step定義を書き換えていない | AC-01・AC-02 | 追加のみ | pass |
| `test/steps/canonical-single-source.steps.ts` | M | package owner | evidence | 注入したspawnが受け取るargvを観測する。**expectedを同じhelperから導出しない** | pass | AC-03・AC-04 | 追加のみ | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | package owner | spec | REQ-SQ-005へ限定条件と受け入れる検出損失4件を追記 | pass。名指ししたSCN 3件は同じ要件の追跡行に登録済み | REQ-SQ-005 / AC-SQ-005 | 既存段落を削除していない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 新3 SCNの追跡登録 | pass。`trace:check`のorphanが0件 | REQ-SQ-005 | 既存行は不変 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | 変更理由と判断の記録1行 | pass。9列のheader区切り直後へ挿入 | REQ-SQ-005 | 既存行は不変 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **満たす。** `git diff --name-only`の10 pathのうち、生成物である`dist/`配下1件を除いた9 pathと表の9行が一致する。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **満たす。**
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **満たす。** ラウンド1の是正は`src/domain/conformance.ts`、`scripts/check_conformance.ts`、`test/`3 file、仕様1 fileに閉じている。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 判断 | 対処 | 検証 |
|---|---|---|---|---|---|
| DISC-001 | 主作業ディレクトリの未追跡fileが`SCN-UNIT-QUALITY-003`を落とす | 測定環境が汚れていると誤った失敗を観測する | 環境要因であり製品の欠陥ではない | clean worktreeで測り直した | 両環境での実行結果の差 |
| DISC-002 | 87 scenariosがmatchするのは過剰matchではなくScenario Outline 3件のExamples展開である | 「49件のはずが87件」に見える | 静的解析で49 scenario名だけがmatchすることを確認した | 実測値をそのまま記録する | featureの静的走査 |

いずれも目的、scope、AC、security境界、不可逆操作を変えない。`workflow assess-discovery`の判定は`continue`である。

### 2.1 受け入れ条件とシナリオ

| AC ID | 判定 | 根拠 |
|---|---|---|
| AC-01 完全ID一致で前方一致を巻き込まない | pass | SCN-UNIT-CONFORMANCE-006。数字延長、ハイフン延長、後方一致、メタ文字、重複、空bindingを検査する |
| AC-02 成功証拠0件のreportを拒否する | pass | SCN-UNIT-CONFORMANCE-007 |
| AC-03 bindingの反例SCNだけを実行する | pass | SCN-INT-CANON-007。**bindingのJSONを独立に読み、repository中の全SCN IDと突き合わせる** |
| AC-04 出力文言と終了値の規則が変わらない | pass | SCN-INT-CANON-007と`conformance:check`の実行結果 |
| AC-05 検出損失の明記 | pass | REQ-SQ-005の原文4件。**層の担保が無いため代替手段として`trace:check`とgrepで確認した** |

## 3. 肯定的評価

- **所要が9分34秒から26秒になった。** `verify:distribution`全体で約9分30秒の短縮であり、1 Issueで検証を2〜3回回すと20〜30分になる。
- **新しい機構を1つも足していない。** それどころかseamのwrapperを削除し、argvを組む式をrepository全体で1箇所にした。
- **限定対象が過不足ないことを、主張ではなく反例で示した。** 名指しした全IDが一致し、repository中の名指ししていない全IDが一致しないことを突き合わせ、限定の正しさを8件の変異で拘束した。全Gherkinは別途1642 passed・16 skipped・失敗0を確認した。**「検出力を落としていない」とは書かない。** §10と`REQ-SQ-005`が受け入れる検出損失を4件明示しており、そのうち3件と4件は機械的に閉じていない。
- **受け入れる検出損失を4件、隠さず書いた。** うち3件はreviewerの指摘で追加したものである。

## 4. 敵対的評価

**reviewerが3件のBlockerを構成し、いずれも私の見落としだった。3件とも実測で再現した。**

| Blocker | 内容 | 実測 | 対処 |
|---|---|---|---|
| 1 | **語境界`\b`は完全ID一致ではない。** SCN IDは`-`を含み`-`は非単語文字なので、`\b(SCN-UNIT-RISK-003)\b`は`SCN-UNIT-RISK-003-EXTRA`に一致する | `true`を確認した。**私のSCNは数字延長しか試しておらずこの反例を検出しなかった** | `(?<![A-Z0-9-])(?:…)(?![A-Z0-9-])`へ変え、ハイフン延長の反例をSCN-006へ足した。是正後に変異Aがkillする |
| 2 | **SCN-INT-CANON-007がexpectedを同じhelperから導出している。** 非boundなIDをpatternへ足す変異が両側で同じ向きにずれて素通りする | 変異Bが3 SCN全緑で生存した | bindingのJSONを独立に読み、repository中の全SCN IDと突き合わせる形へ組み直した。是正後に変異Bがkillする |
| 3 | **既定spawnのwrapperをtestが実行しない。** そこだけargvを切る変異はproductionでのみ`--name`を消す | 変異Cが3 SCN全緑で生存した | wrapperを削除し既定を`spawnSync`自体にした。argv式は`checkConformance`内の1箇所だけになり、注入したspawnが受け取るargvは既定経路と同一である。是正後に変異Cがkillする |

**reviewerの指摘で訂正した主張。**

| 私の当初の主張 | 訂正 |
|---|---|
| 「空bindingを限定なしへ倒すと検査が素通しになる」 | **強すぎる。** `validateRepositoryConformance`が`bindings`をexact 12件と要求するため後段で拒否される。guardの役割はfail-fastと診断である |
| 「純関数を`scripts/`へ置くとdomainのSCNから到達しにくい」 | **成立しない。** testは既に`scripts/check_conformance.ts`を直接importしている。`src/domain/conformance.ts`へ置く正しい理由は、同fileが既にconformance契約の判定を所有していることである |
| 「結果の再利用案は成立しない」 | **やや強い。** 現在JSON再利用元が無いのは事実だが、CLIの`--format`追加で`quality`の同一実行からJSONを出す案は技術的に成立しうる。今回採らない理由は、それが`quality` scriptの変更を要し`EXPECTED_SCRIPTS`に固定されていることである |
| 「`quality`が全Gherkinを担うので検出力は落ちない」 | **前提を明記する必要がある。** `test/support/`は候補側が同一PRで変更でき、`Before` hookで非boundなscenarioを`skipped`へ倒すと`npm test`は終了値0のままである。**これは本変更が作った穴ではなく、testが信頼境界でないという既存の性質である。** REQ-SQ-005へ検出損失として明記した |

**reviewerの指摘のうち採らなかったもの。**

| 指摘 | 判断 | 理由 |
|---|---|---|
| 「`^(?:ID)(?:\s\|$)`で先頭固定にする」 | 採らない | scenario名が常にIDで始まる契約は明文化されていない。**明文化されていない前提に依存する形にしない。** 許可文字集合で閉じる形なら位置に依存しない |
| 「候補側hookによるskipを機械的に閉じる」 | 別Issueへ | 新しい強制点の追加であり、本Issueのscopeを超える。既存の「testは信頼境界ではない」という判断に属する。**検出損失として明記することを選んだ** |

## 5. 指摘

| ID | 重大度 | 内容 | 対処 |
|---|---|---|---|
| H-01 | High | 語境界では完全ID一致にならず、ハイフン延長のIDを巻き込む | 是正。許可文字集合で閉じ、反例を追加した |
| H-02 | High | 結合SCNがexpectedを同じhelperから導出しており、非boundなIDの混入を検出しない | 是正。独立比較へ組み直した |
| H-03 | High | 既定spawnのwrapperが未実行で、そこだけを変える変異が生存する | 是正。wrapperを削除した |
| M-01 | Medium | 「空bindingで素通しになる」が強すぎる | 是正。後段の拒否を明記し、guardの役割をfail-fastと診断へ縮めた |
| M-02 | Medium | 純関数の配置理由が事実に反する | 是正。正しい理由へ書き直した |
| M-03 | Medium | 受け入れる検出損失が1件しか書かれていない | 是正。4件へ増やした |
| L-01 | Low | 「結果の再利用案は成立しない」がやや強い | 是正。手続上の理由へ書き直した |

## 6. ラウンド固有の確認

### ラウンド1

- reviewerはcodex CLIの新規sessionで、`--sandbox read-only`、`--model`未指定である。
- **inline contextで全差分を渡した。** repository探索をさせず、実装・SCN・実測値・採らなかった手段5件を本文へ埋め込んだ。
- 指摘7件のうちHigh 3件・Medium 3件を是正し、Low 1件も是正した。**reviewerが構成した3変異がすべてkillへ変わることを実測した。**
- 是正は`src/domain/conformance.ts`、`scripts/check_conformance.ts`、`test/`3 file、仕様1 fileに閉じ、隣接依存だけを再監査した。

### ラウンド2（外部reviewerの取り込み）

CodeRabbitがinlineで4件を指摘し、うち3件を是正した。

| 指摘 | 重大度 | 対処 |
|---|---|---|
| `1658 scenarios合格`は未実行の16件を合格として記録している | Major | 是正。`1642 passed、16 skipped、失敗0`へ直した。**skipを合格として数えない。** §1と§7の2箇所 |
| 「検出力を落としていない」が同artifactの受け入れ検出損失4件と矛盾する | Minor | 是正。§3を「限定対象が過不足ないことを示した」へ改め、検出損失を否定しない表現にした |
| `audit:check`の欄が未実行のままで、総合判定「合格」が暫定である | Major | 是正。H_final確定後に実行した実測結果へ更新した |
| `npm test`を補償統制として単独で扱わないこと | Major | **既に対処済み。** `REQ-SQ-005`の受け入れる検出損失の第三項が、`test/support/`の`Before` hookによるskipを名指しで明記している。追加の強制点は本Issueのscope外として別扱いにした |

## 7. テスト結果

| 検証 | コマンド | 結果 |
|---|---|---|
| project選択の文書形式 | `npm run docs:format` | 合格 |
| Gherkin形式 | `npm run test:format` | 合格 |
| 静的検査 | `npm run lint` | エラー0件 |
| formatter非破壊 | `npm run format:check` | 差分0件 |
| strict型検査 | `npm run typecheck` | 型error 0件 |
| source契約 | `npm run source:check` | 合格 |
| project品質 | `npm run project:quality` | 合格 |
| 追跡整合 | `npm run trace:check` | orphanが要件・SCN・実装とも0件 |
| 依存方向 | `npm run architecture:check` | 違反0件 |
| 配布物 | `npm run package:check` | 合格 |
| 対象SCN | `npm test -- --name 'SCN-INT-CANON-007\|SCN-UNIT-CONFORMANCE-00[67]'` | 3 scenarios、15 steps成功 |
| **全Gherkin（独立確認）** | `npm test` | **1642 passed、16 skipped、失敗0**（全1658 scenarios）、9分15秒 |
| **conformance（限定後）** | `npm run conformance:check` | **87 scenarios合格、26秒** |
| 監査 | `npm run audit:check` | **valid、監査対象9 file。** 本artifactをcommitしてH_finalを確定させた後に実行した |

**本Issueに限り`npm test`を`conformance:check`と別に1回実行した。** 限定により`conformance:check`が全Gherkinを内包しなくなるため、変更後の全Gherkin合格を独立に確認する必要がある。

### 所要の前後

| 実行 | 変更前 | 変更後 |
|---|---|---|
| `conformance:check` | 1650 scenarios、9分34秒 | **87 scenarios、26秒** |
| `verify:distribution`全体の重複 | 約9分30秒 | **0** |

### 変異試験

**8件、8 kill、生存0。うち3件はreviewer由来である。**

| 群 | 変異 | 結果 |
|---|---|---|
| A 記入欄削除 | A1 `--name`引数を落とす | kill |
| A | A2 空bindingの拒否を消す（型不整合） | kill。`typecheck`が拒否 |
| B 値の空洞化 | B1 `counterexampleScenarioNamePattern(binding) ?? ""`で型を満たしたまま拒否を消す | kill。**当初は生存した。** `conformanceTestArgv`へ判断を閉じて是正 |
| B | B2 境界指定を`\b`へ戻す | kill。**reviewer由来。当初は生存した** |
| B | B3 非boundなIDをpatternへ足す | kill。**reviewer由来。当初は生存した** |
| C 走査回避 | C1 既定spawnのwrapperでargvを切る | kill。**reviewer由来。当初は生存した。** wrapper削除で変異の置き場そのものを無くした |
| C | C2 唯一のargv式を`argv.slice(0, 4)`にする | kill |
| C | C3 重複除去を外す | kill |

**変異scriptに置換の当たり判定を入れている。** 置換対象が見つからない場合は「生存」ではなく「script不備」として報告し、字面を追随させてから測り直す。

**変異後は必ず`npm run build`と`git status`で`dist/`の汚染を掃いた。** #1255で変異残骸がcommitへ入りCIのclean検査だけが検出した実例がある。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/conformance.ts`、`dist/src/domain/conformance.js` | 入る | `counterexampleScenarioNamePattern`と`conformanceTestArgv`が追加される。既存exportの振る舞いは変わらない |
| `scripts/check_conformance.ts` | 入らない | `package.json`の`files`に含まれない。ただし実利用者はgit依存で導入しておりrepository全体が届くため、`conformance:check`の振る舞い変化はQ-01をfalseとして扱った |
| `docs/specs/`の3 file | 入らない | ASC自身の仕様と追跡であり配布物に含まれない |
| `test/`の4 file | 入らない | 配布境界外の検証資産である |

判断: 配布物を更新した

根拠: `src/domain/conformance.ts`は配布されるpackage所有資産であり、新しいexportが2つ増える。**既存exportの契約、`conformance:check`の判定条件3点、標準出力の合格文言、終了値の規則はいずれも不変である。** 利用者から見た変化は`conformance:check`が実行するscenarioの範囲が狭まることだけであり、受け入れる検出損失はREQ-SQ-005が4件明示する。

## 9. 独立reviewの成立

- reviewerはcodex CLIの新規sessionであり、implementerのcontextを共有しない。
- reviewer自身が「ファイル変更・commit・push・テスト実行は行っていません」と報告した。
- **reviewerは3つのBlockerを構成し、すべて実測で再現し、すべて是正後にkillへ変わった。** さらに私の主張4件を訂正させた。
- `--model`を指定せずconfig既定に従った。

## 10. 仕様整合性

- `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-005へ、限定条件、境界指定の根拠、guardの役割、受け入れる検出損失4件を追記した。
- `docs/specs/15_要件追跡/00_追跡表.md`へ新3 SCNを登録した。`trace:check`のorphanは0件である。
- `docs/specs/15_要件追跡/01_変更履歴.md`へ1行を追加した。9列のheader区切り直後である。
- **`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`は変更していない。** 同文書は`conformance:check`のCLI契約を規定しておらず、`package.json` scriptの実行範囲は対象外である。
- 用語台帳は変更していない。既存の`TERM-ASC-006`を参照する。

## 11. 総合判定と再開地点

**判定: 合格。** ラウンド1でHigh 3件・Medium 3件・Low 1件を、ラウンド2で外部reviewerのMajor 2件・Minor 1件を是正した。reviewerが構成した3変異がkillへ変わることを実測した。変異8件すべてkillであり、生存0である。**`audit:check`はH_final確定後に実行し`valid`を確認済みである。**

**残る前提を隠さない。** 全Gherkinの合格は`quality`段に依存し、`test/support/`は候補側が同一PRで変更できる。これは本変更が作った穴ではなく既存の性質だが、本変更が`quality`を補償統制として必要条件にするため、REQ-SQ-005へ検出損失として明記した。機械的に閉じることは別Issueの範囲である。

再開地点は本artifactのcommit（H_final）、`review round`の記録、`pr create`である。
