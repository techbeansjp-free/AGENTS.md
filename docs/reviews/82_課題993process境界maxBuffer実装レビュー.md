# 82 課題993 process境界のmaxBuffer超過 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。`src/lib/process.ts`の`run()`が`spawnSync`へ`maxBuffer`を渡さず、既定1MiBを超える出力で失敗原因が「終了値1・stderr空」へ化けていた欠陥を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。**`valid: true`は候補が既定branchを基準に検証を通過したことを示すだけであり、既定branchへの反映を示さない。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #993（親 #1025 第1層） |
| 比較基点 | `25ed3aff08173ac607af545eba881b827c080f67` |
| H_impl | `e844737e15a5b89dacb7286f641a5a48412965ed` |
| reviewer | claude（変異試験4方向とbaseline/GREENの実測）。外部諮問としてcodexとfableへ独立に判定させた |
| 実施日 | 2026-08-28 |
| ラウンド数 | 2 |
| Step chain | 迂回: 手書き運用で進めており、workflow recordを経由していない |
| 仕様の所有箇所 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md:59-63` REQ-LC-008。「不正entryを分離して正常entryの判定を継続」する要件に対し、利用側では`entries`が0件になっていた |
| 成果物行数 | **製品23行**（`src/lib/process.ts` +29 / -6）。支援層はtest 121行（`unit.steps.ts` +53、`worktree-survey.steps.ts` +46、feature 22行）、仕様1行 |
| 縮小の先行評価 | 新規feature fileもsteps fileも作っていない。integration検査は既存の`worktree-survey.feature`と既存fixture builder `createSurveyRepository`へ相乗りし、追跡表も新規行を足さず既存のintegration行へSCNを追記した。**一度はSCN-UNIT-PROC-001も冗長として削除したが、変異M2の実測で誤りと分かり復活させた**（後述） |

### 支援層が製品を超えていることの評価

支援層121行が製品23行を上回る（5.3倍）。**運用ポリシー「支援層が成果物を大きく超えたら設計を疑う」に照らして評価した。**

- 内訳の最大項は#993の完了条件そのものである。「`maxBuffer`定数をassertするだけのtestは不可。ignored出力1MiB超のconsumer repoで baseline RED / 修正版 GREEN を示せ」という条件が、3MiB規模のfixture生成器（28行）を要求している
- 残りは3 unit scenarioのstep定義で、変異M1〜M3がそれぞれ別のscenarioを落とすことを実測しており、削ると対応する変異が生存する
- 新機構は1つも作っていない。増えた行はすべて既存機構への追加である
- S82-L-01として記録する

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| **利用者環境での失敗** | Issue #993 本文 | `worktree survey`が`entries: []`、`errors`に「終了値1」2件。同じcommandを直接実行すると成功 | 利用者報告 |
| 原因 | `src/lib/process.ts` `run()` | `spawnSync`へ`maxBuffer`を渡していない。Node既定は1MiB | 既存コード |
| **発火閾値** | 本repository | ignored出力2,520,215byte / 10,137件 / 平均path長249。閾値は約4,218件 | 実行観測 |
| **超過時のstatus** | `git ls-files`をfixtureへ実行 | 3MiB規模では`status=null` / `stdoutLen=1114112`。**利用者報告の`stdoutLen`と一致** | 実行観測 |
| **`status`が0のまま残る領域** | 同上、出力が上限を164byte超える場合 | `status=0` / `error=ENOBUFS` / 出力は全量。**5回中5回再現**。node製の子processでは同条件で75回中0回（常に`status=null`） | 実行観測 |
| 要件との対応 | REQ-LC-008 | 分類・保持理由の返却が成立していない | 仕様 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/lib/process.ts` | M | package owner | lib（process境界） | `maxBuffer`の既定を64MiBにし、`result.error`を失敗として写す | 追加依存なし。`redactSecrets`の既存利用のみ | REQ-LC-008、SCN-UNIT-PROC-001〜003 | 逆変換で戻る。既定値の変更は呼び出し側の分岐を変えない | pass |
| `test/features/unit/process-boundary.feature` | A | package owner | test | 全量性と原因保存の3 scenario | 実装へ単方向 | SCN-UNIT-PROC-001〜003 | fileの削除で戻る | pass |
| `test/steps/unit.steps.ts` | M | package owner | test | 上記のstep定義 | 実装へ単方向 | 同上 | 追加分の除去で戻る | pass |
| `test/features/integration/worktree-survey.feature` | M | package owner | test | consumer規模のscenarioを1件追加 | 実装へ単方向 | SCN-INT-WTSURVEY-012 | 4行の除去で戻る | pass |
| `test/steps/worktree-survey.steps.ts` | M | package owner | test | 3MiB fixture生成器とstep定義 | 実装へ単方向 | 同上 | 追加分の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 利用側 | 仕様 | REQ-LC-008のunit行を新設し、既存integration行へSCNと実装を追記 | 参照のみ | REQ-LC-008 | 行の除去で戻る | pass |

## 2. 受け入れ条件の確認

| AC（Issue #993 と諮問で厳格化された完了条件） | 結果 | 証拠 |
|---|---|---|
| `maxBuffer`超過で`worktree survey`が失敗しない | 充足 | SCN-INT-WTSURVEY-012がGREEN |
| **定数assertではなく、ignored出力1MiB超のconsumer repoでbaseline RED / 修正版 GREEN** | 充足 | 外部の一時git repositoryへ3MiB超のignored出力を作り、製品CLIを別processで起動。修正前は利用者報告と同一文言でRED |
| 原因が終了値1へ化けない | 充足 | 変異M3でSCN-UNIT-PROC-002/003が落ちる |
| `allowFailure`側の制御フローを変えない | 充足 | `status=1`・stderrへ原因。全1010 scenario通過 |
| 出力の全量性 | 充足 | 変異M2でSCN-UNIT-PROC-001が落ちる |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | applicable | 失敗messageは`redactSecrets`を通す。既存の秘匿経路をそのまま使う |
| DC-OBSERVABILITY | applicable | **ENOBUFS・ENOENT・timeoutの原因をmessageとstderrへ載せる。**無言で終了値1へ丸めない |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **利用者が観測した経路そのもので固定した。** 定数のassertではなく、外部repositoryに対して製品CLIを起動し、修正前は利用者報告と同一の文言でerrorsへ落ちることを実測した
- **`status`に頼らない判定にした。** 実測で「上限超過なのに`status`が0のまま残る」領域が存在することが分かった。`result.error`を見る述語はこの領域も同じ経路で拒否する
- **既存機構へ相乗りした。** 新規feature file・steps file・追跡表の新規integration行をいずれも作っていない
- **変異試験で支援層の必要性を確かめた。** 3 scenarioがそれぞれ別の変異で落ちる。冗長と判断して削ったscenarioを、変異M2の実測で復活させた

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| 定数を大きくしただけで実効が無い | **不成立。**変異M1（`maxBuffer`行の削除）で2 scenarioが落ちる |
| integration scenarioがあればunitは不要 | **不成立。**変異M2（stdoutを1MiBで切り詰める）はintegrationを通過し、SCN-UNIT-PROC-001だけが落ちる。**codexの指摘どおりであり、当初の削除判断は誤りだった** |
| `allowFailure`側の意味変更で回帰する | **不成立。**stderrを意味解析する呼び出しは3箇所のみで、いずれも`status===0`または404判定であり、全1010 scenarioが通過する。ただしS82-L-02を残す |
| 64MiBでも足りない利用者がいる | **成立しうる。**その場合は超過が診断可能なerrorとして現れる（旧実装は終了値1へ化けていた）。`maxBufferBytes`で呼び出し側が上書きできる |
| `Infinity`にすべき | **不成立。**同期APIで全出力を文字列に載せる契約のため、`Infinity`は異常processによる無制限のメモリ消費を許す |
| **`status`がnullのときだけ失敗とみなす実装でも通る** | **成立する。**変異M4は4 scenarioすべてを通過した（S82-M-01） |
| `runJsonlSession`も同じ症状を持つ | **成立する。**1MiB超過時に`finish(1)`するだけで理由が残らない。ただし別機構・別消費者であり本PRのscopeを超える（S82-M-02） |
| 配布境界を越えていない | **成立する。**source treeを`tsx`で実行しており、tarball経由ではない。**配布境界のacceptanceは親Issue #1025 第2層の #1024 が所有する** |

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S82-M-01 | Medium | **変異M4（`result.error !== undefined && result.status === null`）が生存する。** 判別入力は「64MiB超の出力を出しつつ、上限超過の直後に子processが自力で終了する」場合に限られる | 未是正。**決定的な足場が無い。**node製の子processでは75回中0回しか再現せず、gitでは上限を164byte超えたときに5回中5回再現した。子processのwrite粒度に依存するため、pinするとflakyになる（fableの判定）。決定化には製品側へtest専用の縫い目を入れる必要があり、費用が便益を上回ると判断した |
| S82-M-02 | Medium | `runJsonlSession`が`MAX_STREAM_BYTES`超過時に理由なしで`finish(1)`する。**#993の題名と同型の症状** | 未是正。別Issueへ分離する。意図的なboundであり、async stream・timeout killという別の失敗モデルを持つ。両アドバイザーとも分離を推奨 |
| S82-L-01 | Low | 支援層121行が製品23行を上回る（5.3倍） | 未是正。**完了条件がconsumer規模のfixtureを要求している。**新機構は作っていない |
| S82-L-02 | Low | `src/adapters/github.ts:676`は`status===1`かつstderrが`/404\|Branch not protected/`に一致することで「保護なし」と判定する。新実装はspawn失敗時にcommand文字列（repository名・branch名を含む）をstderrへ載せるため、**ghの起動自体が失敗し、かつrepository名かbranch名に`404`が含まれる**場合に誤分類しうる | 未是正。二重に不運な条件であり、fableもLow判定。stderrの正規表現で分類する既存設計そのものが脆く、本PRで悪化の度合いは小さい |
| S82-L-03 | Low | integration層のfixtureはgitの子processに依存し、追跡表の旧行が示すとおり`spawnSync git EPERM`で走れない環境が実在した | 未是正。SCN-UNIT-PROC-001を復活させたため、その環境でも既定値の守りはunit層に残る |

### ラウンド予算

ラウンド2で収束した。未解決のCritical/Highは0件。上限3ラウンドに対して1ラウンドの余裕を残している。

## 6. ラウンド固有の確認

### ラウンド1

全評価基準（肯定: 正しさ・価値・実現可能性・整合性・保守性／敵対: 反例・失敗経路・境界値・悪用・安全性・データ損失・rollback・範囲漏れ）を確認した。Medium 2、Low 3。新規Critical/High 0件。判定 **candidate-verified（自動reviewを待つ）**。

**外部諮問2件を入力にした。** codexは「完了条件を充足、Critical/High 0件」としたうえでMedium 3件（PROC-001の復活、status=0領域の専用unit、`JsonlSessionOptions`の型漏れ）を出した。fableは「PRを出してよい（yes）」としたうえでLow 2件を出し、**status=0領域のscenarioはflakyになるとしてcodexと反対の判定**を示した。

割れた2点の扱い。
- **PROC-001の復活はcodexを採った。**変異M2を自分で実測し、integrationが通過することを確認したためである
- **status=0領域の専用scenarioはfableを採った。**ただし諮問文へ「status=0で切り詰まる」と書いたのは私の誤りで、実測では出力は全量届いていた。**この誤りはfableの再測定で発見された**
- **`JsonlSessionOptions`の型漏れはcodexを採った。**本PRで`ProcessOptions`へ追加した`maxBufferBytes`をstream側が受理して無視する型契約になっていたため、`Omit`で除いた

### ラウンド2（自動review）

CodeRabbitがactionable 2件を出した。**両方とも是正した。**

| 指摘 | 判定 | 対応 |
|---|---|---|
| fixtureの`.gitignore`がmerge後に作られ、無関係な未追跡fileとして走査へ現れる | **妥当。**分類の意味が変わる | `createSurveyRepository`へ`ignoreRules`引数を足し、初期commitへ含めた。是正後もbaseline REDは同じ文言で再現する |
| レビュー文書130行のコードスパン末尾の空白（MD038） | 妥当 | コードスパンを閉じ、空文字であることを本文で述べた |

是正後に`npm test`を再実行し**1010 scenario全通過**、`typecheck`・`lint`・`format:check`もexit 0であることを確認した。実装commitはamendで畳み、`H_impl`を取り直している。

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality`、`npm run trace:check`、`npm run architecture:check`、`npm run package:check`、`npm run conformance:check` | exit 0 | pass |
| 全層 | `npm test` | **1010 scenario全通過** | pass |

**baseline RED / 修正版 GREEN。** 同一のSCN-INT-WTSURVEY-012を、`src/lib/process.ts`だけ比較基点の版へ戻して実行した。

| 版 | 実測 |
|---|---|
| 比較基点（`25ed3aff`）の`process.ts` | **`1 scenario (1 failed)`**。`errors`に`/tmp/asc-v03-XXXX/.worktrees/20260825_120000-883-survey: git ls-files --others --ignored --exclude-standardが失敗しました（終了値1）:`（コロンの後は空文字）。**利用者報告と同一の文言で、stderrも空** |
| 本PR | **`1 scenario (1 passed)`**。`errors`は空、2 worktreeが分類される |

**変異試験4方向。** 対象scenarioは`SCN-UNIT-PROC-001〜003`と`SCN-INT-WTSURVEY-012`の4件。

| ID | 変異 | 期待 | 実測 |
|---|---|---|---|
| M1 | `maxBuffer`行を削除 | 検出 | **2 failed**（WTSURVEY-012、PROC-001） |
| M2 | `stdout`を1MiBで切り詰める | 検出 | **1 failed**（PROC-001のみ。integrationは通過する） |
| M3 | `result.error`検査を無効化 | 検出 | **2 failed**（PROC-002、PROC-003） |
| M4 | `status===null`のときだけ失敗とみなす | 検出したい | **4 passed（生存）**。S82-M-01として記録 |

変異の後片付けは複写で戻し、`git status`が空であることを確認した。

**超過時の`status`の実測。** fixtureへ`git ls-files --others --ignored --exclude-standard`を既定`maxBuffer`で実行した。

| 出力量 | 実測 |
|---|---|
| 上限を164byte超える | `status=0` / `error=ENOBUFS` / 出力は全量。**5回中5回** |
| 上限を200KiB超える | `status=null` / `error=ENOBUFS` / 出力は切り詰め |
| 3MiB | `status=null` / `stdoutLen=1114112`。**利用者報告と一致** |
| node製の子process、上限を1〜4096byte超える | `status=null`のみ。**75回中0回**しか`status=0`にならない |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/lib/process.ts` | **入る**（`files`が`dist/src/`を列挙する） | **consumerが観測する挙動が変わる。**大規模repositoryで`worktree survey`・`hygiene`・`finalize`が成功するようになる |
| `test/`、`docs/` | 入らない | `files`が列挙しない |

判断: 配布物を更新した

根拠: 本変更の目的が利用側repositoryでの失敗の解消であり、`dist/src/lib/process.ts`の内容が変わる。`npm run package:check`はexit 0。公開API・schema・templateの形は変わらず、変わるのは失敗時のstderr文言と出力上限だけである。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。baseline/GREENの実測、変異試験4方向、`status`の反復測定を入力にした。外部諮問2件はいずれもrepositoryを実見して独立に判定した |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足。REQ-LC-008の本文、利用者報告の出力、変異ごとの実測を引用 |
| 有限ラウンドで終了する | 充足。1ラウンドで収束 |
| 外部証拠 | PR作成後のCI結果と自動reviewで補う |

**諮問の再測定が私の誤りを1件見つけた。** 「1MiB直上では切り詰めた出力を成功として返す」と書いていたが、実測では出力は全量届いていた。commit messageからも該当記述を除いている。

## 10. 仕様整合性

`docs/specs/15_要件追跡/00_追跡表.md`のみを更新した。

| 更新内容 | 理由 |
|---|---|
| REQ-LC-008 / AC-LC-008のunit行を新設（`process-boundary.feature`、`src/lib/process.ts`） | `src/lib/process.ts`は追跡行を1件も持たなかった。親Issue #1025 の一次証拠4がこれを指している |
| 既存のintegration行へSCN-INT-WTSURVEY-012と`src/cli.ts`・`src/lib/process.ts`を追記し、結果を「合格・作業treeで対象実行済み」へ更新 | 旧記載は「未確認・fixture repository初期化時に`spawnSync git EPERM`」だったが、本環境では全11 scenarioが通過する |

要件本文は変更していない。**本変更はREQ-LC-008が既に要求していることを満たすための修正であり、新しい要件を導入しない。**

## 11. 総合判定と再開地点

**判定: candidate-verified（外部承認待ち）**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 2件（S82-M-01は決定的な足場が無く、S82-M-02は別Issueへ分離）
- 記録したLow: 3件

再開地点: ステップ11（PR作成）。**merge後に`runJsonlSession`の理由なし`finish(1)`を別Issueへ起票する（S82-M-02）。**
