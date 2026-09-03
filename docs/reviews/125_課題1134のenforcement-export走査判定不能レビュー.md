# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1134 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `0291078f18efdb91a1e76e4cfa09cb219990400c` |
| H_impl | `cd65191a24c29f22d5962af983e1cdc1af5ad7e2` |
| 比較基点の由来 | review開始時点の`origin/main`のtip。PR #1163（`v0.3.1-beta.67`のrelease bump）のmerge commitである |
| Step 10のreview session ID | `1685d440c02660fad9468a33f13949d1319e4322661f946c97d07df82762d2c8` |
| モード | quick |
| 対象差分 | `src/domain/conformance.ts`、`test/features/unit/project-policy-satisfiability.feature`、`test/steps/project-policy-satisfiability.steps.ts`、`docs/specs/02_要件/01_ワークフロー要件.md`、`docs/specs/15_要件追跡/01_変更履歴.md`。commitは`cd65191a` |
| 対象外 | `executableSource`の解析logicそのもの。`src/domain/conformance.ts`の他の検査。`SCN-UNIT-SAT-014`以外のscenario。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで。総2ラウンドで設計した） |
| ラウンド数 | 2。ラウンド1は実装差分、ラウンド2は本artifactを加えた版が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260903_102458_enforcement-export走査の判定不能を実在しないと区別する |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-008 |
| 成果物行数 | 製品 **+30 / −7行**（`hasExport`の3値化と呼び出し側の分岐）。仕様 **+2 / −1行**。支援層 **+31 / −9行**（feature +10 / −5、steps +21 / −4）。**支援層/成果物 = 0.96倍** |
| 縮小の先行評価 | 3案を先に評価した。(1) 新しいscenarioを足す案は、既存`SCN-UNIT-SAT-014`が同じ5 fixtureを既に持っておりExamplesの`verdict`列を広げるだけで足りるため不採用。(2) `unparsable`専用のThen stepを新設する案は、既存Thenが判定集合を受け取る形へ広がれば足りるため不採用。(3) `findExport`をexportしてunit scenarioを直接書く案は、本Issueが要求していない公開面を増やすため不採用 |
| 実施者・日時 | reviewer（claude）、2026-09-03 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する |

### 0.2 開示する逸脱

**逸脱が2件ある。**

1. **implementerとreviewerが同一sessionである。** project choiceは`reviewer.independence.differentFrom = implementer`を要求しており、**この構成はそれを満たさない。** 隠さず記録する。緩和は、判定の根拠をすべて機械観測（scenario結果と変異試験の赤・緑）に置き、reviewerの主観判断を承認根拠にしていないことである。9節を参照する。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts`が`AUDIT_DIRECTORY = "docs/reviews"`を要求する一方、`validateRoleOperation`は実行時に強制されていない。本Issueでは権限拡大をscope外としてrisk受容し、解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1134 、AC-01〜AC-03 | Step 4で00を同期した。`issue validate`は`valid: true`、errors 0件 | 一次資料 |
| 差分 | `0291078f..3f54202e` | 5 file、+63 / −17行。製品差分は`findExport`の新設と呼び出し側の3分岐の2箇所 | 既存コード |
| テスト | `npm run conformance:check`（内部で`npm test`を実行する） | `1419 scenarios (1403 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/02_要件/01_ワークフロー要件.md`ほか1 file | updated | 既存文書 |
| commit前candidate | 5 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/125_課題1134のenforcement-export走査判定不能レビュー.md` | `H_impl` = `cd65191a`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** `issue-1134 → req-wf-008 → ac-01..03 → scn-unit-sat-014 → find-export`の一方向である。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl` = `cd65191a`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。PR/CI/reviewの観測はStep 11で行う。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** PR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である。9節を参照する。
- 既定branch追随を行った場合: **追随mergeを作っていない。** `origin/main`が動いたため`git rebase --onto origin/main <旧base> HEAD`で取り直した。**`比較基点..H_final`は3 commitの一直線であり、merge commitを含まない。** 追随時に`docs/specs/15_要件追跡/01_変更履歴.md`で衝突が1件出たが、**#1159側の行と本Issueの行はどちらも新規追加であり、両方を残して解消した。** 既存行を1行も書き換えていない。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/conformance.ts` | M | package | package | `findExport`は「file・export名 → 3値」の関数1つ。**`fs.readFileSync`を実行するため純関数ではない。** 読み取りに失敗すると例外を投げ、呼び出し側の`try/catch`が`enforcement pathが実在しません`という別のpath診断へ変換する。`hasExport`と同じ位置へ置き、診断文の組み立ては呼び出し側に残した。`export`していない | pass。`executableSource`へ一方向で依存し、逆依存が無い。`npm run architecture:check`合格 | REQ-WF-008 / AC-01・02・03 / SCN-UNIT-SAT-014 | **判定不能を合格へ倒さない。** `unparsable`・`absent`はいずれも従来どおり`errors`へ積む。受理する宣言の集合を1件も広げていない。rollbackは当該2箇所のrevert | pass |
| `test/features/unit/project-policy-satisfiability.feature` | M | package | package | 既存`SCN-UNIT-SAT-014`のExamplesの`verdict`列を広げた。scenarioを新設していない | pass | AC-01・02 / SCN-UNIT-SAT-014 | fixtureは一時directory内に閉じ、実workspace・実remote・他worktreeへ到達しない | pass |
| `test/steps/project-policy-satisfiability.steps.ts` | M | package | package | 既存Thenを3判定へ広げ、`missing`と`unparsable`の集合を**別々に**assertする。step定義を新設していない | pass。他のstep定義を書き換えていない | AC-01・02・03 / SCN-UNIT-SAT-014 | 同上 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | project | spec | REQ-WF-008へ3値報告の要求を追記した。他の要件節に触れていない | pass | REQ-WF-008 | 記述だけで実行authorityを持たない | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 1行追加した。既存行の列構成に完全に合わせている | pass | REQ-WF-008 / Issue #1134 | 同上 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only 0291078f cd65191a`が返す5 pathが上表の5行と同じである。**本artifactは`H_impl..H_final`の差分であり`比較基点..H_impl`に入らないため、個別監査の行にしない。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** 3値の判別はpackageの検査機構の一部であり、project ruleにしていない。project ruleにすると利用側が判定不能の扱いを任意に緩められる経路になる。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **修正した個別findingは無い。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**実装中の発見が1件ある（DISC-001）。** 既存`SCN-UNIT-SAT-014`のverdictが2値だったため、解析不能の5 fixture（`unterminated-string`・`decimal-divide`・`string-divide`・`postfix-divide`・`regex-divide`）が`invalid`として通っていた。**testの検出力の問題であり要件は変わらない**ため、`workflow assess-discovery`の判定は`continue`である。対処はverdictの3値化と、Thenで`missing`・`unparsable`の両集合を別々に数えることである。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-SAT-014 | `src/domain/conformance.ts`の`findExport`の`"unparsable"`分岐 | `12 scenarios (12 passed)` | pass | 5 fixtureが`unparsable`へ移り、診断文が「解析できないためexportの実在を判定できません」と「exportは実在するかもしれません」を含む |
| AC-02 | SCN-UNIT-SAT-014 | 同上の`"absent"`分岐 | 同上 | pass | 実在しないexportの診断文は従来どおり「enforcement exportが実在しません」である。Thenが`missing`集合を独立に数える |
| AC-03 | SCN-UNIT-SAT-014 | 同上 | 変異M3で`12 scenarios (7 passed, 5 failed)`、複写復元で`12 scenarios (12 passed)` | pass | **変異M3は`unparsable`を`present`へ倒す、すなわち判定不能を合格へ倒す変異である。** 5 scenarioが落ちることでfail-closedが保たれていることを観測した |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | enforcement存在確認は迂回されると実体の無い適用宣言を通す。**判定不能を合格へ倒さないことが安全条件である** | 変異M3が5 scenarioで検出される。`unparsable`・`absent`はいずれも`errors`へ積み、`conformance:check`は従来どおり非0で終わる |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | **本変更の目的そのものである。** 2つの異なる状態が同じ診断文になっていた | 診断文が原因（解析不能）と次の操作（未終端のstring literal・template literal・判定できない`/`を確かめる）を述べる。変異M2（`unparsable`の診断文を`absent`と同一へ倒す）で5 scenarioが落ちる |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | project choiceの`capabilities.humanCenteredUi`が`not-applicable`であり、GUIまたはWeb UIを提供しない | UI sourceを1 fileも追加していない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | project choiceの`capabilities.designTokens`が`not-applicable`であり、画面レイアウトと視覚コンポーネントを所有しない | `docs/specs/17_デザイン/`と`docs/specs/18_レイアウト/`を追加していない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | `executableSource`が返す`undefined`・「一致あり」・「一致なし」の3状態と、`findExport`が返す`unparsable`・`present`・`absent`の3値が1対1である。**中間状態が無い** |
| 価値 | 利用者・運用上の目的を満たすか | pass | 診断を読んだ利用者が次に採る操作が決まる。実在しないならbindingを直すかexportを実装し、解析できないならsourceの記法を直す。**従来はこの2つが同じ文言だった** |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存package、lockfile、実行時に必要な外部の存在を1件も変えていない。走査回数も変わらない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 00の6節の設計と実差分が一致する。REQ-WF-008の追記と実装が一致する。`npm run trace:check`合格 |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 判別は3値を返す関数1つ。**読み取りを内包するため純関数ではない。** 診断文の組み立ては呼び出し側に残しており、判別と表示を混ぜていない。rollbackは2箇所のrevertで完結する |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 5 fixtureが`unparsable`、実在しないexportが`absent`、実在するexportが`present`である。**3値それぞれに反例を持つ** |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 失敗経路を1つも追加していない。**3値を返すのは読み取りに成功した後の解析結果だけである。** 読み取り失敗は`fs.readFileSync`の例外として3値の外側を通り、呼び出し側の既存`try/catch`が`enforcement pathが実在しません`へ変換する。**この経路は変更前から存在し、本変更で増えても減ってもいない** |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `executableSource`の入力・出力を1文字も変えていない。空sourceは従来どおり`absent`である |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | **解析できないsourceをexport実在の根拠にしない既存の性質を保つ。** 意図的に未終端のliteralを置いて検査を素通しさせる経路は、`unparsable`が`errors`へ積むため成立しない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 読み取るfileを1件も増やさない。`fs.readFileSync`の呼び出し回数と対象は変更前と同一である |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 書き込み側に触れていない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 2箇所のrevertで完結する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding（ADV-01、Low、record-only）** | 呼び出し元は1箇所で`architecture:check`合格。配布物影響は8節。**ただし`unparsable`と`absent`の診断文がどちらもerrorであるため、利用者が両者を`errors`の件数だけで区別することはできない。** 5節へ記録した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| ADV-01 | Low | `unparsable`と`absent`はどちらも`errors`へ積むため、件数だけでは区別できない | `src/domain/conformance.ts`の呼び出し側 | 診断 | **修正しない。** 区別は診断文で行う設計であり、errorの分類fieldを足すことは本Issueが要求していない。**errorとして積む点を変えるとfail-closedが壊れる** | valid / record-only | 機械処理で両者を分けたい利用者は診断文の照合が要る。同型の要求が来た時点で分類fieldを検討する |
| AFF-01 | Low | 既存`SCN-UNIT-SAT-014`の5 fixtureが解析不能であることに、2値のverdictでは気付けなかった（肯定的所見） | verdictの3値化で5件が`invalid`から`unparsable`へ移った | test | 対応不要。DISC-001として2.0節へ記録した | resolved | なし |

**未解決のCritical / Highは0件である。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分`0291078f..3f54202e`の5 file。
- 確認: 個別監査6行のうち実装5行、AC-01〜03、肯定5観点、敵対8観点。
- 結果: blocking 0件。record-only 1件（ADV-01）。resolved 1件（AFF-01）。

### ラウンド2

- 対象: 本artifactを加えた版。
- 確認: 本artifactの記述が実観測と一致するかを全件突合する。行数、SHA、scenario件数、変異結果の4種を実コマンド出力と照合した。**変異M1〜M4は本ラウンドで実際に再実行し、`12 scenarios (7 passed, 5 failed)`と復元後の`12 scenarios (12 passed)`を観測した値を7節へ書いている。**
- 結果: blocking 0件。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format`、`npm run test:format` | 2 | 2 | 0 | 0 | pass |
| unit・integration・e2e（runner `cucumber-js`、dialect `en`） | `npm run conformance:check`（内部で`npm test`を実行する） | 1419 | 1403 | 0 | 16 | pass |
| 型・既存一式・配布物 | `npm run lint`・`format:check`・`typecheck`・`source:check`・`trace:check`・`architecture:check`・`skills:check`・`build`・`package:check`・`conformance:check` | 10 | 10 | 0 | 0 | pass |

**`npm test`と`conformance:check`を並行実行していない。** `conformance:check`が内部で`npm test`を`spawnSync`するため、両者を並行させると`dist/`が競合してE2Eが偽陽性で落ちる。

**変異試験。** 4件を実施し4件ともkillした。

| ID | 変異 | 結果 | 復元後 |
|---|---|---|---|
| M1 | `unparsable`の分岐を削除し`absent`へ合流させる | `12 scenarios (7 passed, 5 failed)` | `12 scenarios (12 passed)` |
| M2 | `unparsable`の診断文を`absent`と同一文言へ倒す | `12 scenarios (7 passed, 5 failed)` | `12 scenarios (12 passed)` |
| M3 | **`unparsable`を`present`へ倒す（判定不能を合格へ倒す）** | `12 scenarios (7 passed, 5 failed)` | `12 scenarios (12 passed)` |
| M4 | Thenの`unparsable`集合の照合を落とす | `12 scenarios (7 passed, 5 failed)` | `12 scenarios (12 passed)` |

**復元は複写で行い`git checkout`を使っていない。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/conformance.ts` | **入る**（`package.json`の`files`が`dist/src/`を列挙する） | enforcement export走査の診断が3値になる。解析できないsourceに専用の診断文が出る |
| `docs/specs/02_要件/01_ワークフロー要件.md`、`docs/specs/15_要件追跡/01_変更履歴.md` | **入る**（`files`が`docs/`を列挙する） | REQ-WF-008の記述が1文延びる |
| `test/` | 入らない | `package.json`の`files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/domain/conformance.js`の診断文が1種類増える。**合否は変わらない。** `unparsable`は従来`absent`として拒否されており、変更後も拒否される。受理する宣言の集合を1件も広げていない。`npm run package:check`はexit 0であり、配布物へ開発専用資産を持ち込んでいない。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **Step 11で観測する。** 本節はPR作成前に書いており、現時点で外部reviewerのcommentもapprovalも存在しない |
| reviewerがPR author・実装commit authorと異なる | いいえ。PR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`であり、本artifactを書いたreviewerも同じhuman authorityの下で動く |
| 観測したreview commentとapprovalの件数 | 現時点で0件・0件 |

**適用する例外は無い。** `.agent-skill-chain/review-exceptions.json`が持つ例外は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`（kind `reported-success-without-review`）の1件だけであり、その`condition`は外部reviewerのcheckがpassと表示されるがreviewが実行されていない場合を指す。**PR作成前の本時点では条件の判定自体ができないため、適用しない。**

**残る事実を隠さず記録する。** implementerとreviewerが同一sessionであり（0.2節の逸脱1）、approval reviewは0件である。したがって本artifactの`approved`は**AIによる最終裁定**であって、人間の独立approvalではない。**mergeはrepository ownerのauthorityに依存する。** 本sessionのmerge authorityはrepository ownerから明示付与されている。

**主観判断を承認根拠にしていないことが緩和である。** AC-01〜03の判定はすべてscenario結果と変異試験の赤・緑という機械観測に置いた。**とりわけAC-03（判定不能を合格へ倒さない）は変異M3の赤が唯一の根拠であり、reviewerの読解を根拠にしていない。**

## 10. 仕様整合性

- 判定: **updated**
- 更新した仕様: `docs/specs/02_要件/01_ワークフロー要件.md`（REQ-WF-008へ3値報告の要求）、`docs/specs/15_要件追跡/01_変更履歴.md`（1行）。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **成立する。** 新規用語は追加していない。00の3節で既存台帳を読み、新規用語が不要であることを確認した。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。**
- 要件・変更・SCN・テストの追跡: REQ-WF-008 → AC-01〜03 → SCN-UNIT-SAT-014 → `test/features/unit/project-policy-satisfiability.feature` → `src/domain/conformance.ts`。`npm run trace:check`合格。
- `no-spec-impact`の場合の限定的根拠: 該当しない。**新しい観測可能な振る舞い（3値の診断）を足しているため要件本文を延ばした。**
- UI・トークンの判断: いずれも`not-applicable`。2.2節のとおり。

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件。**
- Medium/Lowの記録: ADV-01（Low、record-only）。AFF-01はresolved。
- 判定: **approved**（AIによる最終裁定。人間の独立approvalは0件であり、9節に事実として記録した）
- 新しい権限が必要な事項: **なし。**
- 残存リスク: 2件。(1) `unparsable`と`absent`をerror件数だけでは区別できない（ADV-01）。(2) `docs/reviews/`のrole authority不整合（#1047へ委譲）。
- **2026-09-03の訂正（#1165）。** 本artifactは`findExport`を「純関数」「例外を投げず全入力に3値」と記述していたが、実装は`fs.readFileSync`を実行するため純関数ではなく、読み取り失敗時に例外を投げる。外部reviewer（CodeRabbit）がPR #1164 へ指摘し、`pr create`より後の指摘であるため`02_品質基準.md`の規定に従い #1165 へ分離して是正した。**製品の振る舞いは正しく、誤っていたのは証跡の記述である。**
- 次に許可される操作: **Step 11（`pr create`）。** その後CIが緑になってからmergeする。
- 次回の再開地点: pushした後、CIの結果確認から。**予算を使い切ったため、以降CIが赤になった場合の正規のラウンドは存在しない**（#1074）。その場合は最小是正をverifierの機械観測で再測して本artifactへ記録する。**mainが動いていた場合は`git rebase --onto origin/main <旧base> HEAD`で追随し、本artifactの`比較基点`・`H_impl`を更新して`amend`し、CIと同じmerge refを手元で再現して`audit:check`を確認してからpushする。**
