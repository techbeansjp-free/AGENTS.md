# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | `5ca47b3a651920ba1ec6b15be5bcda9a23ca4728` |
| 比較基点 | `58ed41c3756e8252cf4b35524e10faa0611789cb` |
| H_impl | `5ca47b3a651920ba1ec6b15be5bcda9a23ca4728` |
| 対象差分 | `58ed41c3756e8252cf4b35524e10faa0611789cb..5ca47b3a651920ba1ec6b15be5bcda9a23ca4728`。12 pathのうち`dist/`配下2件は生成物として個別監査の対象外であり、表は10行 |
| 対象外 | finalizeの対象同一性を`path + headSha + headState`へ拡張してdetachedを後片付け可能にすること（段階2）、`doctor.healthy`と終了codeの変更、無視対象資産allowlist（#1248）、起動契機（#946）、auto-finalizeの述語（#947） |
| 残り予算 | 3ラウンドのうち1使用。**残り2** |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260907_003127_bugfix-detached-HEADのworktreeがsurveyの分類から脱落し-原因をpath単位で発見できない |
| 仕様の所有箇所 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`のREQ-LC-008。引用: 「**不正entryを分離して正常entryの判定を継続し**」 |
| 成果物行数 | `src/` +162行。test +177行。仕様 +6行。`dist/`はbuild生成物 |
| 縮小の先行評価 | 諮問で3案を評価し、案1（branchをoptional）は観測漏れと合法なdetachedを区別できないため、案3（脱落を維持して診断だけ改善）は合法なGit状態を不正扱いし続けるため採らなかった。案2を判別値へ精緻化した。**段階2（finalize拡張）は不可逆操作の認可条件に触れるため同じIssueで扱わず、可視化だけに限定した。** `registeredWorktrees`は6呼び出し元があるため変えず、survey専用の観測関数1つを足した |
| 実施者・日時 | reviewer / 2026-09-07 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、差分全文、条件ごとの変異試験 | standard（削除候補集合の入力を変えるが、認可条件には触れない） | project choiceのprovider上限に従う | project choiceのtier mappingに従う | 未解決Critical/Highがあれば停止し次roundで再評価する | reviewerはimplementerと別contextで起動する。reviewerは対象差分pathを1件も変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1251、staging `01_要件定義.md`§9 | AC-01〜AC-06、INV-01〜INV-04 | 一次資料 |
| 諮問 | Issue #1251のcodex諮問結果コメント | 案2を判別値へ精緻化する。detachedを一律cleanup-ready不可とするのは過剰。surveyだけを変えると現行finalizeが必ず拒否する | 一次資料 |
| 発生の実測 | 2026-09-06の`worktree survey` | 35件中2件が脱落し、`entry[4]`・`entry[34]`という添字だけのerrorになった | 実測 |
| 差分 | `4d83166d..31bbbb54` | 12 path（うち`dist/`2件は生成物） | 既存コード |
| テスト | `npm run conformance:check`（全suite内包） | 1580 scenarios（1564 passed、16 skipped）、失敗0 | テスト出力 |
| 変異試験 | 7変異を1件ずつ適用 | **7件すべてkill。復元後に41 scenario再合格を確認した** | テスト出力 |
| commit後external | PR未作成 | ラウンド1時点では未観測 | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **確認した。** CLI（観測）→domain（分類）の単方向で、domainはGitへ触れない。本artifactへ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl`は`5ca47b3a651920ba1ec6b15be5bcda9a23ca4728`。本artifactの1 fileだけを加えて`H_final`にする
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: reviewerはimplementerと別contextで起動する
- 既定branch追随を行った場合: **行っていない。** baseは`58ed41c3756e8252cf4b35524e10faa0611789cb`のままである

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/worktree-survey.ts` | M | 本repository | package | `WorktreeHeadState`の判別値、検証4条件とpath付きprefix、detached理由の連結、命名不一致の`null`回避（SCN-UNIT-WTSURVEY-023〜026） | pass。Gitへ触れない | REQ-LC-008 / AC-01〜AC-04 / SCN-UNIT-WTSURVEY-023〜026 | 読み取り専用。revertで戻る | pass |
| `src/cli.ts` | M | 本repository | package | survey専用の`registeredWorktreeHeads`、detachedのmerge判定、`(detached)`表示（SCN-INT-WTSURVEY-014〜015） | pass。`registeredWorktrees`の6呼び出し元へ触れない | REQ-LC-008 / AC-05〜AC-06 / SCN-INT-WTSURVEY-014〜015 | 読み取り専用 | pass |
| `test/features/unit/worktree-survey.feature` | M | 本repository | evidence | SCN-UNIT-WTSURVEY-023〜026のscenario定義 | pass | AC-01〜AC-04 | 副作用なし | pass |
| `test/features/integration/worktree-survey.feature` | M | 本repository | evidence | SCN-INT-WTSURVEY-014〜015のscenario定義 | pass | AC-05〜AC-06 | 一時repositoryのみ | pass |
| `test/steps/worktree-survey.steps.ts` | M | 本repository | evidence | 観測fixtureの既定値、detachedのGiven 4件とThen 5件、実repositoryへの`--detach` worktree作成 | pass。既存の`observation`・`createSurveyRepository`・`runCli`を再利用 | 同上 | 同上 | pass |
| `test/steps/finalize-ignored-artifacts.steps.ts` | M | 本repository | evidence | 観測fixtureへ`headState`・`headSha`の既定値を足す | pass | 既存SCNの非回帰 | 副作用なし | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | 本repository | spec | REQ-LC-008へdetachedの条項を追加し強制SCNを名指しする | pass | REQ-LC-008、AC-LC-008 | 追加なし | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | 本repository | spec | `worktree survey`行へ`headState`と`(detached)`とpath付きerrorを追記 | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 本repository | spec | REQ-LC-008行へUNIT 023〜026とINT 014〜015 | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | 本repository | spec | 本変更の履歴行。**9列の変更履歴表の先頭へ置いた**（#1236のCR-04の再発防止） | pass | 同上 | 同上 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **確認した。** `git diff --name-only`が返す12件のうち`dist/src/cli.js`と`dist/src/domain/worktree-survey.js`は`isGeneratedDistributionPath`により個別監査の対象外であり、残る10件と表の10行が一致する
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **確認した。** 観測はCLI、分類はdomain、契約は`docs/specs/`へ置いた
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 是正は行っていない

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| ID | 発見 | 対処 |
|---|---|---|
| DISC-001 | **起票時の「`doctor`がunhealthyになる」は誤りだった。** `healthy`は`installed && diagnostics.length === 0`でinstall健全性だけから計算され、worktree走査の結果は`worktrees.diagnostics`へ入るだけである | 諮問で指摘され、`src/domain/lifecycle.ts:607`と`doctor`の実出力で確認した。Issueへ訂正コメントを残し、欠陥の記述を「原因をpath単位で発見できない」へ直した |
| DISC-002 | **起票時の「detachedは一律cleanup-readyにしない」は過剰だった。** REQ-LC-009は既定branchからの到達を独立の免除根拠として認める | 諮問で指摘された。**ただしsurveyだけを変えると現行finalizeが必ず拒否する状態を作る**ため、本変更は可視化に限定し、理由駆動でretainへ倒す形にした。段階2は対象外として記録した |
| DISC-003 | **`registeredWorktrees`は6呼び出し元を持ち、返り値型を変えるとfinalizeの認可条件へ波及する** | survey専用の`registeredWorktreeHeads`を足し、既存関数へ触れなかった |
| DISC-004 | **既存の観測fixtureが`finalize-ignored-artifacts.steps.ts`にも1件あり、型検査で見つかった** | 既定値に`headState`・`headSha`を足した |
| DISC-005 | **変更履歴の行を8列表へ入れる#1236の誤りを、本Issueでは9列表の見出し直後へ挿入する形で回避した** | 挿入位置を`|---|`行の直後に固定し、列数を検証してから書き込んだ |

### 2.1 受け入れ条件とシナリオ

| AC | 内容 | SCN | 結果 |
|---|---|---|---|
| AC-01 | detachedのmerge済み観測がretainで`branch: null`・`headState: "detached"`、detached理由付き、`cleanupReady`に含まれない | SCN-UNIT-WTSURVEY-023 | pass |
| AC-02 | detachedの未merge観測がin-progressでdetached理由付き | SCN-UNIT-WTSURVEY-024 | pass |
| AC-03 | attachedで空branchとdetachedでbranchありがpath付きerrorになり、正常観測だけが分類される | SCN-UNIT-WTSURVEY-025 | pass |
| AC-04 | headState不明がpath付きerrorになりentriesへ入らない | SCN-UNIT-WTSURVEY-026 | pass |
| AC-05 | 実repositoryのdetached worktreeがretain・`branch: null`で報告され、終了codeが0 | SCN-INT-WTSURVEY-014 | pass |
| AC-06 | text形式に`(detached)`の行がある | SCN-INT-WTSURVEY-015 | pass |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | surveyの分類はworktree削除という不可逆操作の候補集合を決める入力であり、detachedを誤ってcleanup-readyへ入れると復旧不能な削除候補になる。秘密情報と個人情報は扱わない | SCN-UNIT-WTSURVEY-023とSCN-INT-WTSURVEY-014がdetachedのpathが`cleanupReady`配列に含まれないことを検査する。理由の付与を落とす変異M1がkillされた |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | raw添字だけのerrorでは、どのworktreeが不正観測かを特定できない | SCN-UNIT-WTSURVEY-025・026がerrorにpathが含まれることを検査する。pathを落とす変異M4がkillされた。出力はJSONとtext表だけで、log保持・rotation・監視・常駐processを持たない |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 非対話のCLI出力であり、画面・入力要素・focus順序・支援技術の対象になる成果物を持たない | 変更対象の`src/cli.ts`はstdoutへJSON文字列とtab区切りの要約表だけを書き、SCN-INT-WTSURVEY-015がその行を照合する |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 生む出力はJSONとtab区切り文字列だけであり、色・寸法・typography・間隔を決めるtokenを適用する描画対象が存在しない | DC-UXと同じ根拠 |

## 3. 肯定的評価

- **起票時の主張2件を自分で訂正してから着手した。** 「`doctor`がunhealthyになる」と「detachedは一律cleanup-readyにしない」はいずれも誤りで、諮問と実測で確定してからIssueへ訂正を残した。
- **合法なGit状態を不正entry扱いする構造を、明示markerの判別値で置き換えた。** branch行の欠落をdetachedと推測せず、両方ある・両方ない形を不正観測としてpath付きで分離する。**観測漏れと合法なdetachedを区別できる。**
- **分類はdetachedで自動的に変えず、理由で駆動する。** REQ-LC-010の先例と同じ形にし、段階2で理由を外せば自然にcleanup-readyへ進める。
- **既存の6呼び出し元へ触れなかった。** `registeredWorktrees`の返り値型を変えるとfinalizeの認可条件へ波及する。survey専用の観測関数を足した。
- **合成経路を実repositoryで検査した。** `git worktree add --detach`で作ったworktreeに対してCLIを実行し、JSONとtext形式の両方を照合する。
- **変異7件が条件ごとに別のscenarioへ殺される。** 理由の除去はUNIT-023、不明の受理はUNIT-026、矛盾の受理はUNIT-025、pathの除去はUNIT-025・026、porcelainの不正化はINT-014、text表示の除去はINT-015で落ちる。

## 4. 敵対的評価

- **detachedのworktreeは依然として製品経路で後片付けできない。** 可視化されただけで、`worktree finalize`は対象branchを要求して拒否する。**本変更は迂回誘因を減らすが消していない。** 段階2はowner判断であり、本Issueでは扱わない。
- **detachedのmerge判定を`merge-base --is-ancestor <headSha> <既定branch>`へ変えた。** attachedの`git branch --merged`とは観測方法が違う。**両者が同じ事実を返すことをscenarioで突き合わせていない。** 同一fixtureでattachedとdetachedの両形を作って比較する試験は無い。
- **命名不一致の検査はdetachedでは走らない。** `namingMismatchReasons`は`branch === null`で空を返す。directory名だけからの検査は設計していない。
- **`headSha`はentryへ載せていない。** 出力契約の増分を最小にするためだが、errorにはpathしか出ず「pathと可能ならHEAD SHA」という諮問の推奨を半分しか満たしていない。
- **本検査は信頼境界ではない。** `src/`は保護対象ではなく同一PRで理由ごと削除できる。担保するのは偶発的劣化の回帰検出である。
- **doctorの`worktrees.diagnostics`はsurveyのerrorsをそのまま載せる。** pathが付くようになったが、その描画をdoctor側のscenarioで固定していない。既存のSCN-INT-WTSURVEY-008・009は要約件数だけを見る。

## 5. 指摘

| ID | 分類 | 内容 | 対処 |
|---|---|---|---|
| F-01 | Medium | **attachedとdetachedでmerge判定の観測方法が違い、同値性をscenarioで突き合わせていない** | **本Issueでは扱わない。** 敵対的評価へ記録した。両形を同一fixtureで作る試験は段階2の対象同一性拡張と同じ材料が要る |
| F-02 | Medium | **detachedは可視化されただけで後片付けできない** | **本Issueでは扱わない。** 段階2として対象外に置いた。owner判断 |
| F-03 | Low | **errorにHEAD SHAを含めていない** | **本Issueでは扱わない。** pathで一意に識別できる。諮問の推奨を要求定義へ「可能なら」として残した |
| F-04 | Low | **doctor側でpath付きerrorの描画を固定していない** | **本Issueでは扱わない。** 既存scenarioが件数だけを見る構造に従った |
| F-05 | Low | 既存fixtureの1件が型検査で見つかった | 是正済み。DISC-004 |

未解決のCritical/Highは0件である。

## 6. ラウンド固有の確認

### ラウンド1

固定initial HEADに対する全scope reviewである。`previousBlocking`、`fixedDiff`、`adjacentScope`はいずれも空である。

## 7. テスト結果

実行したcommandの一覧: `npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run trace:check`、`npm run docs:format`、`npm run test:format`、`npm run build`、`npm run conformance:check`、変異試験script

全layerの合計: **1580 scenarios（1564 passed、16 skipped）、失敗0**

失敗またはskipがある層: skipは16 scenarioで、いずれも本変更以前から存在する環境依存scenarioである。**本変更が追加した6 scenarioはいずれもpassである。**

**gateはすべて直列で実行した。** `src/`を変更したため`dist/src/cli.js`と`dist/src/domain/worktree-survey.js`をcommitへ含めた。**`conformance:check`が全suiteを内包するため`npm test`を単独では実行していない**（#1230の実測に基づく）。

runnerは`@cucumber/cucumber`、`projectChoices.gherkinDialect`は英語keyword・日本語説明である。

対応する成功CI runの参照: **ラウンド1時点ではPR未作成のため未観測。** push後に観測する。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/worktree-survey.ts` | 入る | 観測型に`headState`・`headSha`が加わり、entryに`headState`が加わる。`branch`が`null`を取りうる |
| `src/cli.ts` | 入る | detachedがentriesへ現れる。text形式に`(detached)`。errorsにpath |
| `dist/src/domain/worktree-survey.js` | 入る | 上記のbuild生成物 |
| `dist/src/cli.js` | 入る | 同上 |
| `test/features/unit/worktree-survey.feature` | 入る | なし |
| `test/features/integration/worktree-survey.feature` | 入る | なし |
| `test/steps/worktree-survey.steps.ts` | 入る | なし |
| `test/steps/finalize-ignored-artifacts.steps.ts` | 入る | なし |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | 入らない | なし |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | 入らない | なし |
| `docs/specs/15_要件追跡/00_追跡表.md` | 入らない | なし |
| `docs/specs/15_要件追跡/01_変更履歴.md` | 入らない | なし |

判断: 配布物を更新した

根拠: `src/`と`dist/`は`npm pack`の対象であり利用者が実行する。**entriesが増える方向の変更で、attachedの分類は変わらない。** `branch: null`を想定しない利用側の読み手は`headState`で判別できる。cleanupReadyの集合は狭まる方向にしか動かない。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **ラウンド1時点では未観測。** PR作成後に外部reviewerの指摘とCI checkを観測する |
| reviewerがPR author・実装commit authorと異なる | はい |
| 観測したreview commentとapprovalの件数 | 内部の敵対review finding 5件（Medium 2、Low 3）。**設計段階で外部アドバイザー（codex）が起票時の主張2件を訂正し、案2の精緻化と段階分けを示した。** 外部reviewとapprovalはPR作成後に観測する |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `02_要件/02_プロジェクトライフサイクル要件.md`、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`15_要件追跡/`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **台帳への追加・変更・廃止は0件である。** 後片付け走査と復旧可能性の意味を変えていない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **確認した。** `conformance:check`が合格している
- 要件・変更・SCN・テストの追跡: REQ-LC-008 → AC-LC-008 → SCN-UNIT-WTSURVEY-023〜026、SCN-INT-WTSURVEY-014〜015。`trace:check`でorphan 0件
- `no-spec-impact`の場合の限定的根拠: 該当しない
- UI・トークンの判断: UI無し

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件**
- Medium/Lowの記録: F-01〜F-04を対象範囲外として記録し、F-05をresolvedとした
- 判定: approved
- 新しい権限が必要な事項: **なし。** `PROTECTED_FILES`所属fileを1件も変更していない。**削除可能範囲を広げる差分を含まない**
- 残存リスク: **detachedのworktreeは可視化されただけで、製品経路では依然として後片付けできない。** 段階2はowner判断である。**attachedとdetachedでmerge判定の観測方法が違い、同値性を突き合わせていない。** **errorにHEAD SHAを含めていない。** **本検査は信頼境界ではない。** `src/`は保護対象ではなく同一PRで理由ごと削除できる
