# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1069 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `b2ad5a5fe8c3f6156fb02465040eec6f9001c472` |
| H_impl | `9345dc8c18ebebb0448de9989331567346085777` |
| 比較基点の由来 | review開始時点の`origin/main`のtip。PR #1080（`v0.3.1-beta.48`のrelease bump）のmerge commitである |
| Step 10のreview session ID | `d55b451b004432c1aee96905c4b11e0e133b1777cb4a8e9f0719f9655df9d661` |
| モード | full |
| 対象差分 | `src/domain/conformance.ts`、`.agent-skill-chain/schemas/project-conformance-binding.schema.json`、`test/features/unit/project-policy-satisfiability.feature`、`test/steps/project-policy-satisfiability.steps.ts`、`docs/specs/01_システム概要/02_用語・略語.md`、`docs/specs/15_要件追跡/00_追跡表.md`。commitは`50406b25`・`0adcb536`・`2db4ae0d`・`81a072f4`・`9345dc8c` |
| 対象外 | 判定の受理・拒否境界の変更。schema patternの狭化（後方非互換）。`registeredCheckIds`の導出規則そのもの。正本の運用ポリシーの改訂。repository経路の診断重複の排除（5節のR1-F13） |
| 残り予算 | **1**（同一範囲で最大3ラウンド。総2ラウンドで設計し、CI是正のために予算1を残した） |
| ラウンド数 | 2。ラウンド1は実装差分、ラウンド2は本artifactを加えた版が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260831_125115_check-refの解決規則が発見可能でない |
| 仕様の所有箇所 | 導出規則の正本は`.agent-skill-chain/docs/00_運用ポリシー.md`の「conformance scopeと適用可否」節である。**本Issueはこの正本へ規則を足していない。** 用語台帳へ`TERM-ASC-083`を、追跡表へ1行を足しただけである |
| 成果物行数 | 製品 **+64 / −2行**（`src/domain/conformance.ts`）。配布schema **+1行**。仕様 **+2行**。支援層 **+239行**（feature +36、steps +203） |
| 縮小の先行評価 | 4案を先に評価した。(1) 規則の本文を`docs/specs/`と診断へ書き下ろす案は、正本の二重化になりINV-07に反するため不採用。(2) schema `pattern`を導出可能な形へ狭める案は、既存の利用側宣言を後方非互換に壊すため不採用。(3) `checkIdForRuleId`を`export`してunit scenarioを直接書く案は、本Issueが要求していない公開面を増やすため不採用。(4) 支援層の縮小は**実施した**。5つの`Given`が逐語で反復していたbinding構築9行を共有helperへ畳み、`SCN-UNIT-SAT-026`の`Given`から使われないbinding構築を除いた。**step定義の新設は01の9節が事前に固定した10件で、実装もちょうど10件である** |
| 実施者・日時 | reviewer（claude）、2026-08-31 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは**codex**の別invocationである。ラウンド1の敵対reviewは**claudeとfableの2 providerの独立invocation**が並行で実施し、いずれもimplementerと別contextである |

**開示する逸脱が2件ある。**

1. **是正の実装は進行役（coordinator）が行った。** ラウンド1のfindingを受けた是正commit `9345dc8c`は、reviewerを兼ねる進行役のsessionが書いている。project choiceは`reviewer.independence.differentFrom = implementer`だけを要求しており、implementer（codex）との分離は成立している。しかし`roleContracts.coordinator.forbiddenOperations`の`self_approve`に接する。**この構成を隠さず記録する。**
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts:26`が`AUDIT_DIRECTORY = "docs/reviews"`を要求する一方、`validateRoleOperation`は実行時に強制されていない。**本Issueでは権限拡大をscope外としてrisk受容し、解消を #1047 へ委譲する。**

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1069 、AC-1069-01〜09 | Step 8で00〜03を同期。`syncDigest`と`readBackDigest`が`44cd5d4756ccb3ec3c7af66615f929460b834f20eff314e92cb48dafbeb47fea`で一致 | 一次資料 |
| 差分 | `b2ad5a5f..9345dc8c` | 6 file、+306 / −2行。製品差分は`unregisteredCheckRefMessage`の新設と2箇所の呼び出し置換、`CHECK_ID.test`の追加 | 既存コード |
| テスト | `npm test` | `1310 scenarios (1294 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/01_システム概要/02_用語・略語.md`ほか1 file | updated | 既存文書 |
| commit前candidate | 6 file（1.1節の表） | working tree clean | Git index |
| Phase A artifact | `docs/reviews/100_課題1069のcheck-ref解決規則の発見可能性レビュー.md` | `H_impl` = `9345dc8c`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** 02の2.3節の一方向であり、投影結果を自身の正しさの根拠にしていない。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl` = `9345dc8c`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。PR・CI・reviewの観測はStep 11で行う。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** 本repositoryではPR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である。9節の例外経路を参照する。
- 既定branch追随を行った場合: **追随mergeを作っていない。** ラウンド1のあとに`git rebase --onto origin/main a502730a HEAD`で一直線へ載せ替えた。`比較基点..H_impl`は5 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/conformance.ts` | M | package | package | `unregisteredCheckRefMessage`は「入力 → 診断文字列」の純関数1つ。`checkIdForRuleId`の直後へ置き、判定・実在検査・schema検証と責務を混ぜていない。`export`していない | pass。filesystem・環境変数・他projectへ依存しない。nodeもedgeも増やさないため新しい循環が生じない。`npm run architecture:check`合格 | REQ-WF-008 / AC-1069-01〜08 / SCN-UNIT-SAT-021〜025 | 受理・拒否の分岐を変えていない。3値の再測が変更前と同一である。診断長は入力長に依存しない。rollbackは当該箇所のrevert | pass |
| `.agent-skill-chain/schemas/project-conformance-binding.schema.json` | M | package | package | `check-ref`の`checkId`へ`description`を1件足しただけ。`type`と`pattern`を変更していない | pass。schemaは宣言であり実行authorityを持たない | REQ-WF-008 / AC-1069-09 / SCN-UNIT-SAT-026 | 既存の利用側宣言を1件も無効にしない。rollbackは当該1行のrevert | pass |
| `test/features/unit/project-policy-satisfiability.feature` | M | package | package | 既存Featureの末尾へscenarioを6件追加した。既存scenarioを1件も書き換えていない | pass | AC-1069-01〜09 / SCN-UNIT-SAT-021〜026 | fixtureは合成objectと配布schemaの読み取りに閉じ、実workspace・実remote・他worktreeへ到達しない | pass |
| `test/steps/project-policy-satisfiability.steps.ts` | M | package | package | step定義を10件（Given 5・When 1・Then 4）追加した。01の9節が事前に固定した上限と内訳に一致する。重複していたbinding構築は共有helperへ畳んだ | pass。既存step定義を1件も書き換えていない | AC-1069-01〜09 / SCN-UNIT-SAT-021〜026 | 同上。一時fileを作らない | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | project | spec | `TERM-ASC-083`を1行追加した。既存行の列構成に完全に合わせている | pass | REQ-WF-008 / Issue #1069 | 規則の本文を書かず正本を参照する。rollbackは当該1行のrevert | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | REQ-WF-008の既存行を書き換えず、下へ1行追加した | pass | REQ-WF-008 / AC-WF-008 / SCN-UNIT-SAT-021〜026 | 追跡の追加だけで実行authorityを持たない | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only b2ad5a5f 9345dc8c`が返す6 pathが上表の6行と同じである。**本artifactは`H_impl..H_final`にあり、この範囲には入らない。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** 導出規則はpackageの適合機構の一部であり、project ruleにしていない。診断の文言は利用者へ正本を案内するだけで、規則そのものを所有しない。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **ラウンド1のfindingのうち11件を修正した。** 修正範囲は上表の`src/domain/conformance.ts`・`test/`2 file・用語台帳の4 fileであり、隣接依存として`.agent-skill-chain/schemas/`と追跡表も再監査した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**実装中の発見は1件である。** 03の11.2節に記録した。実装完了時点の`Then`が登録済み一覧の**件数**だけを検査し、そこへ並ぶ値が導出checkIdであることを検査していなかった。`ASC-PROJ-MAIN-PROTECT-001`をそのまま列挙する実装でも緑になる。AC-1069-01とAC-1069-04が要求する内容そのものである。**AC・scope・security境界のいずれも変えていないため、03の4.1節の発見記録には該当しない。**

### 2.1 受け入れ条件とシナリオ

| AC ID | 内容 | SCN | 観測 |
|---|---|---|---|
| AC-1069-01 | 診断が導出規則の要約と登録済み一覧を示す | SCN-UNIT-SAT-021 | 緑。期待する導出checkIdを`Given`側にliteralで置き、製品の`checkIdForRuleId`から導出していない |
| AC-1069-02 | 登録0件のときの表現 | SCN-UNIT-SAT-022 | 緑。`登録済みcheckIdは0件です`と、打ち切り表現が現れないことを検査する |
| AC-1069-03 | 上限まで辞書順で示し総件数を添えて打ち切る | SCN-UNIT-SAT-023 | 緑。**上限ちょうど20件と上限+1の21件の両方**を回す。`ruleId`を降順で与え、連結済み一覧の完全一致で辞書順を観測する |
| AC-1069-04 | 無関係な識別子が現れない | SCN-UNIT-SAT-021 | 緑。導出前の`ruleId`が1件も現れないことを検査する |
| AC-1069-05 | 受理・拒否が変わらない | 既存SCN-UNIT-SAT-005・006と3値の再測 | 緑。3値の受理・拒否が変更前後で同一である（7節） |
| AC-1069-06 | 2経路の診断が文字列として一致する | SCN-UNIT-SAT-024 | 緑。正常な`checkId`での完全一致に加え、**不正な`checkId`で両経路とも未登録診断を出さない**ことを検査する |
| AC-1069-07 | 導出できない`ruleId`の件数と例を示す | SCN-UNIT-SAT-025 | 緑。上限3件での打ち切り、4件目の非露出、切り詰めと安全化を検査する |
| AC-1069-08 | 正本pathを含む | SCN-UNIT-SAT-021 | 緑 |
| AC-1069-09 | schemaの`description`が正本を参照する | SCN-UNIT-SAT-026 | 緑。配布schema fileを直接読む |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 判定 | 観測 |
|---|---|---|
| DC-PRIVACY | applicable | 診断へ載るのは利用者自身のrule fileの`ruleId`に由来する値だけである。file読み取り・環境変数・他projectの参照は当該純関数内に1件も無い。出力集合の限定をSCN-UNIT-SAT-021が、件数上限をSCN-UNIT-SAT-023が、長さ上限と安全化をSCN-UNIT-SAT-025が反例で固定する |
| DC-OBSERVABILITY | applicable | 本変更は診断そのものの改善である。利用者が行動可能なerrorを返すことが目的であり、保持・rotation・監視は変更していない |
| DC-UX | not-applicable | project choiceの`capabilities.humanCenteredUi`が`not-applicable`である |
| DC-TOKENS | not-applicable | project choiceの`capabilities.designTokens`が`not-applicable`である |

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 受理・拒否の分岐を1つも変えていない。差し替えたのは`errors.push`の引数だけである。3値の再測が変更前後で同一である |
| 価値 | pass | 報告者が踏んだ「何を書けばよいか分からない」が、診断だけで解ける。`proj-main-protect-001`という正解が診断へ列挙される |
| 実現可能性 | pass | 製品差分は純関数1つと呼び出し2箇所、および`CHECK_ID.test`の1条件に閉じている |
| 整合性 | pass | 規則の正本を増やしていない。診断・schema・用語台帳はいずれも正本を参照する側である |
| 保守性 | pass | 登録済みcheckIdの集合を呼び出し側から受け取るため、受理判定と診断が別々に導出して食い違う経路が無い |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例 | pass | 変異12件がいずれも対象scenarioを殺す（7節）。うち5件はラウンド1で生存が判明し、反例を足して殺した |
| 失敗 | pass | `rules`がnull・非配列・要素が非objectのいずれでも例外を投げず、`登録済みcheckIdは0件です`へ縮退することを実測した |
| 境界 | pass | 登録0件・上限ちょうど20件・上限+1の21件・1000件を実測した。導出できない`ruleId`は0件・3件・4件・100件を実測した |
| 悪用 | pass | 診断長が入力長に依存しない。`ruleId`が100文字・100KB・1MiBのいずれでも診断の総byteが同一である（7節） |
| 安全性 | pass | 制御文字とANSI escapeが生のまま端末へ届く経路を閉じた。`scripts/check_conformance.ts:614`は`- ${error}`で生出力するため、エスケープは診断側の責務である |
| 損失 | not-applicable | 読み取り側の純関数であり書き込み単位を変えていない |
| 復旧 | pass | rollbackは5 commitのrevertで完結する。永続状態を残さない |
| 範囲 | pass | INV-07が禁じる規則本文の複製を行っていない。schema `pattern`を狭めていない |

## 5. 指摘

**ラウンド1で14件、ラウンド2で0件。未解決のCritical/Highは0件である。** blockingは0件で`converged`した。

| ID | 深刻度 | 種別 | 状態 | 内容 |
|---|---|---|---|---|
| R1-F01 | High | fix-regression | resolved | 診断が件数上限だけを持ちbyte上限を持たなかった。`JSON.stringify(ruleId.slice(0, 64))`で閉じた |
| R1-F02 | Medium | improvement | resolved | 導出できない`ruleId`が無検査の生値で載り、制御文字が端末へ届いた。同じ1操作で閉じた |
| R1-F03 | Medium | acceptance-violation | resolved | AC-1069-03が要求する辞書順を検査していなかった。`sort`を外す変異が生存した |
| R1-F04 | Medium | acceptance-violation | resolved | 01の境界値表が要求する「上限ちょうど」のfixtureが無かった |
| R1-F05 | Medium | improvement | resolved | repository経路に`CHECK_ID.test`が無く、不正な`checkId`で2経路の診断が一致しなかった |
| R1-F06 | Low | improvement | resolved | 導出できない`ruleId`の上限3件が検査されていなかった |
| R1-F07 | Low | improvement | resolved | 導出できない`ruleId`が重複排除されず件数を水増ししていた |
| R1-F08 | Low | improvement | resolved | 登録済みcheckIdの集合を受理判定と診断が別々に導出していた |
| R1-F09 | Low | improvement | resolved | 5つの`Given`がbinding構築を逐語で反復していた |
| R1-F10 | Low | improvement | resolved | `assert.match(diagnostic, /main-branch-protection/u)`が恒真だった |
| R1-F11 | Low | improvement | resolved | `TERM-ASC-083`の該当しない列に数字始まりの類型が欠けていた |
| R1-F12 | Low | out-of-scope | valid | 診断が導出できない理由と直し方を告げない。制約の本文は正本にも無く、INV-07が説明面への複製を禁じている。正本側への追記が先に要る |
| R1-F13 | Low | out-of-scope | valid | repository経路で未登録診断が2件並ぶ。変更前から存在する構造であり、prefix統一で可視化されただけである |
| R1-F14 | Low | out-of-scope | valid | 正本は「小文字ハイフン化」、新設文書は「小文字化」と書く。実装はハイフン化を行わないため後者が正確である。正本の改訂はscope外である |

**R1-F12・R1-F13・R1-F14は本Issueで是正しない。** いずれも正本の改訂か判定構造の変更を伴い、#1069の目的（発見可能性）を超える。**この3件を根拠に新しいIssueを起こしていない。** 進行トラッカー #1072 へ掲示してownerの判断を仰ぐ。

## 6. ラウンド固有の確認

### ラウンド1

- 対象は`b2ad5a5f..9345dc8c`の実装差分である。
- **敵対reviewを2 providerの独立invocationで実施した。** claudeとfableがそれぞれ別contextで全差分を読み、指摘を独立に返した。両者が独立にR1-F01・R1-F02・R1-F07・R1-F09を指摘し、claudeがR1-F03・R1-F04・R1-F05・R1-F10・R1-F11を、fableがR1-F06・R1-F08を単独で指摘した。
- **すべての指摘を受け入れる前に実測で検証した。** `sort`・`slice(0, 3)`・打ち切り判定の3変異を実際に適用し、いずれも6 scenarioが緑のまま生存することを確認してから是正へ進んだ。`CHECK_ID.test`の欠落は原文を読んで確認した。
- 是正は前進commit `9345dc8c`で積んだ。

### ラウンド2

- 対象は本artifactを加えた版である。
- 0.1節の逸脱2件、5節のR1-F12〜F14の未是正、7節の実測値が本文の主張と一致することを確認した。
- **新規findingは0件である。** 未解決blockingは0件で`converged`した。
- **予算1を残している。** CIが赤になった場合の是正をこのラウンドで載せる。

## 7. テスト結果

| 検証 | 結果 |
|---|---|
| `npm test` | `1310 scenarios (1294 passed, 16 skipped)`、失敗0 |
| CI同順の全chain | `project:quality`→`quality`→`docs:format`→`test:format`→`trace:check`→`architecture:check`→`build`→`package:check`→`conformance:check`の9 commandを**終了値を明示的に見るループで**完走した |

### 7.1 変異試験

**復元はすべて複写で行い`git checkout`を使わない。** 復元後にsha256が一致することを毎回確認した。

| 変異 | 内容 | 対象scenarioの結果 |
|---|---|---|
| M1 | binding経路の呼び出しを元の`errors.push`へ戻す | 5件が赤 |
| M2 | 導出せず`ruleId`をそのまま登録済み集合へ入れる | 1件が赤 |
| M3 | 登録済みの上限を20から21へ変える | 1件が赤 |
| M4 | 診断から正本pathの参照を落とす | 4件が赤 |
| M5 | 導出できない`ruleId`の節を出力しない | 1件が赤 |
| M6 | 登録済み一覧の`sort`を外す | 2件が赤 |
| M7 | 導出できない`ruleId`の上限を3から99へ変える | 1件が赤 |
| M8 | 打ち切り判定を`>`から`>=`へ変える | 2件が赤 |
| M9 | `ruleId`の切り詰めを外す | 1件が赤 |
| M10 | `ruleId`の安全化を外して生値で載せる | 1件が赤 |
| M11 | 導出できない`ruleId`の重複排除を外す | 1件が赤 |
| M12 | repository経路の`CHECK_ID.test`を削除する | 1件が赤 |

**M2・M3・M6・M7・M8・M12はラウンド1の時点では生存していた。** 反例を足して殺した。M12は最初`sed`の複数行patternが不発で生存に見えたため、置換を実際に適用してから再測した。

### 7.2 3値の再測

`validateProjectConformanceBinding`へ`ruleId`が`ASC-PROJ-MAIN-PROTECT-001`のruleを1件与え、`check-ref`の`checkId`を3値で変えて`check-ref`関連errorの件数を数えた。

| `checkId` | 変更前 | 変更後 |
|---|---|---|
| `main-branch-protection` | 拒否（error 1件） | 拒否（error 1件） |
| `asc-proj-main-protect-001` | 拒否（error 1件） | 拒否（error 1件） |
| `proj-main-protect-001` | 受理（error 0件） | 受理（error 0件） |

### 7.3 診断長が入力長に依存しないことの実測

未登録`check-ref`を200件持つbindingへ、導出できない`ruleId`を1件与えて診断の総byteを測った。

| `ruleId`の長さ | errors件数 | 診断の総byte | 最長の1件 |
|---|---|---|---|
| 導出できる`ruleId`だけ | 200 | 66,690 | 334 |
| 100文字 | 200 | 84,690 | 424 |
| 100 KB | 200 | 84,690 | 424 |
| 1 MiB | 200 | 84,690 | 424 |

**100文字・100 KB・1 MiBが同一値である。** ラウンド1の是正前は100 KBで総byteが20,072,290、最長の1件が100,362であった。

## 8. 配布物影響

配布境界へ入る変更pathは`src/domain/conformance.ts`と`.agent-skill-chain/schemas/project-conformance-binding.schema.json`の2件である。いずれも`package.json`の`files`が配布対象とする。`docs/specs/`と`test/`は配布対象外である。

判断: 配布物を更新した

根拠: 利用側が受け取る診断文字列とbinding schemaの`description`が変わるため、配布物のdigestが変化する。受理・拒否の判定は変わらないので既存の宣言を無効にしない。

## 9. 独立reviewの成立

- **`.agent-skill-chain/review-exceptions.json`の`exceptions`は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の1件だけである。** 全文を読んで確認した。本Issueへ適用できる例外区分は存在しない。
- 外部reviewerによるapprovalは**0件**である。`approved`はAIによる最終裁定である。
- ラウンド1の敵対reviewは**implementer（codex）とは別providerの2 invocation（claudeとfable）**が独立に実施した。両者は互いの出力を見ていない。
- 是正の実装は進行役が行ったため、0.1節の逸脱1として開示している。

## 10. 仕様整合性

| 変更 | 更新先 | 追跡 |
|---|---|---|
| `TERM-ASC-083`の追加 | `docs/specs/01_システム概要/02_用語・略語.md` | REQ-WF-008 / AC-WF-008 |
| 追跡行の追加 | `docs/specs/15_要件追跡/00_追跡表.md` | REQ-WF-008 / AC-WF-008 / SCN-UNIT-SAT-021〜026 |

- **`trace:check`はAC↔SCNの対応の正しさを見ない。** 追加行の各列をscenarioの実体と人が原文で突合した。Feature列の`test/features/unit/project-policy-satisfiability.feature`に6件のSCNがすべて実在し、実装列の2 pathがいずれも実在することを確認した。
- `TERM-ASC-083`の成立例と該当しない例を実装で確認した。`ASC-PROJ-MAIN-PROTECT-001`は`proj-main-protect-001`を導出する。`ASC-FOO--BAR`・`ASC-001-FOO`・`ASC-`と70文字のいずれも導出できない。
- **`TERM-ASC-083`の採番は台帳とstagingの両方を実測して`082`が最大であることを確認して行った。**

## 11. 総合判定と再開地点

**approved。** 未解決のCritical/Highは0件、blockingは0件、`converged`である。

- 再開地点はStep 11の`pr create`である。
- **`pr create`は作成直後のread-backで`reconciliation-required`へ落ちることが既知である（2/2で再現）。** このとき副作用を再送しない。`pr create`を再実行するとread-only照合で既存PRを1件だけ束ね、`step11-recorded`まで進む。一致が0件または2件以上なら停止して人へ返す。
- CIが赤になった場合は残り予算1のラウンドで是正する。**赤を通す理屈を作らない。**
