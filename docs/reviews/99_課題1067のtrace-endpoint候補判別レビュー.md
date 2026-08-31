# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1067 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `d4c79be46b97552b1f803bb4c01dba0106f882d9` |
| H_impl | `a53613f6abec765260f273a2d674d15f5707a50f` |
| 比較基点の由来 | review開始時点の`origin/main`のtip。PR #1078（`v0.3.1-beta.47`のrelease bump）のmerge commitである |
| Step 10のreview session ID | `88c83142d70152021aaa422c7700a472b8389f7de335c9b6adb7f137c33fac8d` |
| モード | full |
| 対象差分 | `src/adapters/repository-graph.ts`、`test/features/integration/semantic-graph-observation.feature`、`test/steps/semantic-graph-observation.steps.ts`、`docs/specs/01_システム概要/02_用語・略語.md`、`docs/specs/02_要件/05_グラフ投影要件.md`、`docs/specs/15_要件追跡/00_追跡表.md`。commitは`703ee66f`・`6c9aace3`・`a53613f6` |
| 対象外 | `trace-endpoint-missing`のwarning降格（01の1節）。追跡表の列構成の変更。Feature列・実装列以外のcellの解釈。`resolveImport`のimport解決規則。判別述語の`export`（02の1.2節）。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド。本artifactは総2ラウンドで設計している。**残り1ラウンドはCIが赤になった場合の是正のために意図的に残す**） |
| ラウンド数 | 2。ラウンド1は`H_impl`の実装差分、ラウンド2は本artifactを加えた`H_final`が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260831_110148_trace-endpoint検査がinline-code区間をすべてfile-pathとして扱う |
| 仕様の所有箇所 | `docs/specs/02_要件/05_グラフ投影要件.md`のREQ-GR-005。**着手時点でこの節は「追跡表のどの記法をrepository pathとして解釈するか」を規定していなかった。** その欠落を埋めること自体が本Issueの要求の一部である（00のRQ-BR-03） |
| 成果物行数 | 製品 **+14 / −1行**（`isTraceEndpointCandidate`の新設10行と`referencedPaths`への`.filter`追加）。仕様 **+4行**（用語台帳+1、グラフ投影要件+2、追跡表+1）。支援層 **+89行**（feature +10、steps +79）。合計 +106 / −1行 |
| 縮小の先行評価 | 3案を先に評価した。(1) `missingPaths`側で除外する案は、`featurePaths`・`implementationPaths`に除外区間が残りINV-02に反するため不採用（02の12節）。(2) 判別述語をexportしてunit scenarioを書く案は、本Issueが要求していない公開面を増やすため不採用。(3) `When`の新設は、#1066が追加した`trace endpoint観測用のsemantic graphを構築する`を再利用できるため行わなかった。**step定義の新設は01の9節が事前に固定した4件（Given 2・Then 2）で、実装もちょうど4件である。** |
| 実施者・日時 | reviewer（claude）、2026-08-31 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは**codex**の別invocationであり、reviewerは**claude**である。provider・contextともに異なる。reviewerは対象差分path（`src/`・`test/`・`docs/specs/`）を変更していない |

**開示する逸脱が2件ある。**

1. **reviewerは進行役（coordinator）と同一sessionである。** project choiceは`reviewer.independence.differentFrom = implementer`だけを要求しており、implementer（codex）との分離は成立している。しかしcoordinatorとreviewerが同一sessionであることは`roleContracts.coordinator.forbiddenOperations`の`self_approve`に接する。**実装は行っていない**が、この構成を隠さず記録する。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts:26`が`AUDIT_DIRECTORY = "docs/reviews"`を要求する一方、`validateRoleOperation`は実行時に強制されていない。**本Issueでは権限拡大をscope外としてrisk受容し、解消を #1047 へ委譲する。**

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1067 、AC-1067-01〜04 | Step 4で00・01を、Step 8で00〜03を同期。`syncDigest`と`readBackDigest`が`c2ecbf379833a006765e488939940dab5d13615785ea0563de0de910a70d32ac`で一致 | 一次資料 |
| 差分 | `d4c79be4..a53613f6` | 6 file、+106 / −1行。製品差分は`isTraceEndpointCandidate`の新設と`.filter`の追加の2箇所 | 既存コード |
| テスト | `npm test` | `1303 scenarios (1287 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/02_要件/05_グラフ投影要件.md`ほか2 file | updated | 既存文書 |
| commit前candidate | 6 file（1.1節の表） | working tree clean | Git index |
| Phase A artifact | `docs/reviews/99_課題1067のtrace-endpoint候補判別レビュー.md` | `H_impl` = `a53613f6`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** 02の2.3節の5 nodeは`issue-1067 → req-gr-005 → ac-1067-* → scn-int-semgraph-* → is-trace-endpoint-candidate`の一方向であり、投影結果を自身の正しさの根拠にしていない。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl` = `a53613f6`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。PR/CI/reviewの観測はStep 11で行う。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** 本repositoryではPR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である。9節の例外経路を参照する。
- 既定branch追随を行った場合: **行っていない。** 基点`d4c79be4`は`origin/main`のtipであり、追随mergeを作っていない。`比較基点..H_impl`は3 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/adapters/repository-graph.ts` | M | package | package | `isTraceEndpointCandidate`は「文字列 → 真偽」の純関数1つ。`safeRepositoryPath`の直後へ置き、実在検査・edge生成・診断生成と責務を混ぜていない。`export`していない | pass。filesystem・project policy・project choiceへ依存しない。nodeもedgeも追加しないため新しい循環が生じない。`npm run architecture:check`合格 | REQ-GR-005 / AC-1067-01・03 / SCN-INT-SEMGRAPH-031 | 判別は実在検査の**前段**であり代替ではない。`safeRepositoryPath`・各上限・symlink拒否・`MAX_TRACE_IDS_PER_CELL`を1行も変えていない。rollbackは当該2箇所のrevert | pass |
| `test/features/integration/semantic-graph-observation.feature` | M | package | package | 既存Featureの末尾へscenarioを2件追加した。既存scenarioを1件も書き換えていない | pass | AC-1067-01・03 / SCN-INT-SEMGRAPH-031、AC-1067-02 / SCN-INT-SEMGRAPH-032 | fixtureは`world.initRepo()`の一時directory内に閉じ、実workspace・実remote・他worktreeへ到達しない | pass |
| `test/steps/semantic-graph-observation.steps.ts` | M | package | package | step定義を4件（Given 2・Then 2）追加した。01の9節が事前に固定した上限と内訳に一致する。`When`は#1066の既存stepを再利用し新設していない | pass。既存step定義を1件も書き換えていない | AC-1067-01〜03 / SCN-INT-SEMGRAPH-031、032 | 同上。SCN-031のfixtureは`.gitignore`と`AGENTS.md`を実fileとして作る | pass |
| `docs/specs/02_要件/05_グラフ投影要件.md` | M | project | spec | REQ-GR-005節へ判別規則を2文で追加した。他の要件節に触れていない | pass | REQ-GR-005 / AC-GR-005 | 規則の記述だけで実行authorityを持たない | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | project | spec | `TERM-ASC-082`を1行追加した。既存行の列構成に完全に合わせている | pass | REQ-GR-005 / Issue #1067 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | REQ-GR-005のintegration行の下へ1行追加した。既存行のSCN列を書き換えていない | pass | REQ-GR-005 / AC-GR-005 / SCN-INT-SEMGRAPH-031、032 | 追跡の追加だけで実行authorityを持たない | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only d4c79be4 a53613f6`が返す6 pathが上表の6行と同じである。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** 判別規則はpackageの投影機構の一部であり、`.agent-skill-chain/project/rules/`のproject ruleにしていない（02の12節で不採用と決めた）。project ruleにすると利用側が検査を任意に縮小できる経路になる。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **修正した個別findingは無い。** ラウンド1のfindingは4件ともrecord-onlyである。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**実装中の発見は0件である。** 03の4.1節に記録がない。Step 7のNON-BLOCKING 2件は実装開始前に是正済みであり、実装中の発見ではない。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1067-01 | SCN-INT-SEMGRAPH-031 | `src/adapters/repository-graph.ts`の`isTraceEndpointCandidate` | `1 scenario (1 passed) / 5 steps (5 passed)` | pass | 変異時は`AssertionError: + 'semantic graph projection診断 trace-endpoint-missing: docs/specs/15_要件追跡/00_追跡表.md:5: 存在しないrepository path=.feature,ci:quality,src/**/*.css,src/components/,z-index' - undefined`。**Issue #1067が報告した`存在しないrepository path=.feature,src/components/`と同型である** |
| AC-1067-02 | SCN-INT-SEMGRAPH-032 | 同上 | `1 scenario (1 passed) / 5 steps (5 passed)` | pass | 修正前も修正後も緑。`存在しないrepository path=README.md,src/proces.ts`を完全一致で照合する。**`src/proces.ts`はBR-03側、`README.md`はBR-04のpositive側の反例である** |
| AC-1067-03 | SCN-INT-SEMGRAPH-031 | 同上 | 同上 | pass | Thenが`src/components/`・`src/**/*.css`・`ci:quality`・`z-index`・`.feature`を指すnodeとedgeの非存在をassertする |
| AC-1067-04 | SCN-INT-SEMGRAPH-031 | 同上 | 変異で`1 scenario (1 failed)`、複写復元で`1 scenario (1 passed)` | pass | 変異は`.filter(isTraceEndpointCandidate)`の除去。復元は複写で行い`git checkout`を使っていない |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 判別規則は「どのpathを実在検査するか」を決める。project choiceの`capabilities.privacySecurity`も`applicable`である | 02の5節TB-1067-01〜04のうち本変更が触れるのはTB-1067-01だけである。**判別を通した候補には従来どおり`existingRegularFiles`への所属を要求する。** `existingRegularFiles`は`observeSourceFiles(root)`の結果から作られ（`src/adapters/repository-graph.ts:940-942`）、その列挙元`sourcePaths(root)`が`safeRepositoryPath`と各上限を通す（同`:724-741`）。**本変更は読み取るfileを1件も増やさない。** 反例はSCN-INT-SEMGRAPH-032 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | not-applicable | log出力、保持、rotation、監視、復旧手順、診断文言の文字列のいずれも変更しない | 差分6 fileに`console`・log・診断文言の変更が1件も無いことを個別監査で確認した。SCN-INT-SEMGRAPH-032が既存の診断文言を完全一致で照合しており、文言が変わっていないことの反例になっている |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | project choiceの`capabilities.humanCenteredUi`が`not-applicable`であり、GUIまたはWeb UIを提供しない | `package.json`の`bin`が公開する4 CLIだけを持つ。UI sourceを1 fileも追加していない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | project choiceの`capabilities.designTokens`が`not-applicable`であり、画面レイアウトと視覚コンポーネントを所有しない | `docs/specs/17_デザイン/`と`docs/specs/18_レイアウト/`を追加していない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | BR-01〜BR-04の4条が実装の4段（glob → 末尾`/` → `/`を含む → basename/extension）と過不足なく対応する。変異時の赤の実出力が報告された症状と同型である |
| 価値 | 利用者・運用上の目的を満たすか | pass | Issue #1067が挙げた区間（`src/components/`・`test/`・`docs/specs/`・`dist/`・`src/**/*.css`・`src/**/*.scss`・`src/**/*.{ts,tsx}`・`.steps.{ts,tsx}`・`ci:quality`・`lint:scss`・`z-index`・`.feature`）がすべて候補から外れる。**利用側へ追跡表の書き換えを要求しない** |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存package、lockfile、実行時に必要な外部の存在を1件も変えていない。判別はfilesystemを走査しない純関数である |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の1.1の設計目標と実差分が一致する。03のT01〜T04の完了条件をすべて観測した。**判別規則が`docs/specs/`と実装の2箇所に置かれ、実装のリテラルだけが規則を持つ状態が解消された**（RQ-BR-03）。追跡表の追加行の各列を人が原文で突合した |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 判別は10行の純関数1つ。`SOURCE_EXTENSIONS`・`SOURCE_BASENAMES`という既存の集合を再利用し、新しい閾値を発明していない。rollbackは2箇所のrevertで完結する |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | `src/proces.ts`（`/`を含むtypo）と`README.md`（`/`を含まず拡張子が集合内）の両方をSCN-INT-SEMGRAPH-032で拒否側に固定した。**BR-04のpositive側に検証上の盲点があるというStep 7のN-01を、この`README.md`で塞いだ** |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 失敗経路を1つも追加していない。判別は例外を投げず全入力に真偽を返す。実在検査・Source Identity再観測の判定順序と拒否動作が変更前と同一である |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | inline code区間は正規表現上1文字以上であり空文字にならない。`.gitignore`（`extname`が空だが`SOURCE_BASENAMES`に一致）と`AGENTS.md`（`extname`が集合内）をSCN-031のfixtureへ含めた。重複除去（`new Set`）と辞書順整列は変更していない |
| 悪用 | 注入、経路脱出、権限外操作等 | **finding（ADV-02、Low、record-only）** | 判別を通した候補も`existingRegularFiles`に無ければ拒否されるため、`safeRepositoryPath`が除外したpathは候補になっても通らない。**ただしfile名にglob metacharacterを含む実在fileは候補から外れて無検査になる。** 5節へ記録した |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 2.2節のDC-PRIVACYのとおり。読み取るfileを1件も増やさない。判別規則はmodule内の純関数であり、project policyやproject choiceから書き換えられない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 書き込み側に触れていない。投影は派生Read Modelであり完全rebuildで再生成する |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 判別述語の追加分のrevertで完結する。追加scenarioは同じPRで戻る |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding（ADV-01、Low、record-only）** | 呼び出し元は`referencedPaths`生成1箇所で`architecture:check`合格。配布物影響は8節。文書は3 fileを更新済み。**ただしglob metacharacterの集合が5種であり、extglobの`!`・`(`・`)`を含まない。** 5節へ記録した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| ADV-01 | Low | glob metacharacterの集合が`*`・`?`・`[`・`]`・`{`・`}`の6文字であり、extglobの`!`・`(`・`)`を含まない | `src/adapters/repository-graph.ts`の`/[*?[\]{}]/u` | 判別述語 | **修正しない。** 01のBR-01が明示した6文字と実装が一致しており、Issue #1067が報告した区間にextglob形は1件も無い | valid / record-only | `src/@(a\|b).ts`のような記法は`/`を含むためBR-03で候補になり、実在しなければ拒否される。同型報告が来た時点でBR-01を拡張する判断になる |
| ADV-02 | Low | file名にglob metacharacterを含む実在fileを追跡表が指すと、BR-01で候補から外れて無検査になる | 同上 | 判別述語 | **修正しない。** `safeRepositoryPath`はこれらの文字を拒否しないが、repositoryの命名規約が許さず本repositoryに0件である | valid / record-only | glob記法の許容と引き換えに受容する。差分レビュー（個別監査）が代替統制である |
| AFF-01 | Low | 判別を`referencedPaths`生成時点で適用したことでINV-02が追加コードなしで成立し、既存の潜在不具合も消えた（肯定的所見） | 修正前は`.feature`という断片が`endsWith(".feature")`に一致しfeature nodeを作り得た | 製品 | 対応不要 | resolved | なし |
| AFF-02 | Low | 変異時の赤の実出力がIssue #1067の報告と同型である（肯定的所見） | `存在しないrepository path=.feature,ci:quality,src/**/*.css,src/components/,z-index` | test | 対応不要 | resolved | なし |

**未解決のCritical / Highは0件である。**

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: **はい。** 3節（肯定5観点）と4節（敵対8観点）をすべて判定した。対象は`H_impl` = `a53613f6`である。
- 指摘を確定した: **はい。** ADV-01・ADV-02・AFF-01・AFF-02の4件。いずれもLowでrecord-onlyであり、`review-session.json`の`blocking`は空である。
- 次ラウンド対象のCritical/High: **0件。** ラウンド1の`status`は`converged`である。

### ラウンド2

- 未解決Critical/High: **0件。**
- 修正差分: **本review artifact 1 fileだけ。** `H_impl`（`a53613f6`）から`H_final`への差分は`docs/reviews/99_課題1067のtrace-endpoint候補判別レビュー.md`のみである。製品・test・`docs/specs/`を一切変更していない。
- 修正で触れた隣接範囲: **なし。** ラウンド1のfindingはすべてrecord-onlyであり、コード修正を伴わない。
- 既承認・未変更範囲を再走査していない: **成立する。** ラウンド2はartifact自身の記述と`H_impl..H_final`の差分pathだけを対象にする。

### ラウンド3

**実施しない。予算1を残す。** #1068（artifact 97の10.1・10.2）と#1051（artifact 96）で「予算3を使い切った後にCIが赤になると、是正を載せる正規のラウンドが存在しない」が2回起きており、#1074がこの構造問題を所有している。**本Issueでは総ラウンド数を2に設計し、CI是正のために予算1を明示的に残す。** #1066でも同じ設計を採り、rebase後にCIが赤になった際に実際に役立った。これは前例であって機構ではない。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format`、`npm run test:format` | 2 | 2 | 0 | 0 | pass |
| unit・integration・e2e（runner `cucumber-js`、dialect `en`） | `npm test` | 1303 | 1287 | 0 | 16 | pass |
| 型・既存一式・配布物 | `npm run project:quality`・`npm run quality`・`npm run trace:check`・`npm run architecture:check`・`npm run build`・`npm run package:check`・`npm run conformance:check` | 7 | 7 | 0 | 0 | pass |

**上の全commandをCI（`.github/workflows/ci.yml`）と同じ順序で1本のchainとして実行し、途中終了なしで完走した。** `npm test`と`conformance:check`は直列である。

**変異試験。** `.filter(isTraceEndpointCandidate)`の除去でSCN-INT-SEMGRAPH-031が`1 scenario (1 failed)`となり、複写復元で`1 scenario (1 passed)`へ戻る。

**本repositoryの追跡表の判定不変を実測した。** 同一commit（`a53613f6`）・同一source（`contentDigest=e3587f6bcec296e6f65e384146c7882250149fcd1110ca7e88e7f67aa9dbcd47`、`dirty=false`）に対し、`.filter`ありbuilderと`.filter`なしbuilderで`graph rebuild --dry-run`を実行し、`graphContentHash=8e46b004517ae071a5d659b75c5195a88594ced115e56dbfd2e2a395ca2868e2`、node 2310、edge 10885 の3値が完全一致することを確認した。**これは本repositoryの追跡表に判別で除外される区間が1件も無いことの実測でもある。**

**implementerのsandbox結果を承認根拠にしていない。** implementer（codex）はsandboxの多段子process制限で`npm test`が131件失敗し、さらに`.git/worktrees/...`がread-onlyでcommitできなかった。**reviewerが非sandbox環境で赤・緑・変異・復元・commit・full gate chainをすべて実行し、その結果だけを上表の根拠にしている。** implementerのsandbox都合で製品コードやtestを弱める変更は差分に含まれていないことを個別監査で確認した。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/repository-graph.ts` | **入る**（`package.json`の`files`が`dist/src/`を列挙する） | trace endpoint候補の判別が入る。path以外のinline codeを追跡表へ書いたprojectで、これまで必ず失敗していた`graph rebuild`・`graph status`が成功へ転じる |
| `test/`、`docs/specs/` | 入らない | `package.json`の`files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/adapters/repository-graph.js`にtrace endpoint候補の判別が入り、対象入力に対する終了値と診断の有無が変わる。JSON出力形式・field構成・診断文言の文字列と、非対象入力に対する振る舞いは変えていない。`npm run package:check`はexit 0であり、配布物へ開発専用資産を持ち込んでいない。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | なし |
| reviewerがPR author・実装commit authorと異なる | いいえ |
| 観測したreview commentとapprovalの件数 | 0件（PR未作成のため） |

外部証拠が無いため、正本の例外を参照する。

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | `.agent-skill-chain/review-exceptions.json`の`independent-reviewer-absent`区分 |
| 観測値 | 本PRのapproval reviewは0件である。本repositoryは単一のhuman ownerが運用しており、PR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である |

**承認元、承認者、承認日時、失効日時は正本を参照し、ここへ複製しない。**

**implementerとreviewerの分離は成立している。** implementerは`codex`の別invocation（別provider・別context）、reviewerは`claude`である。0.1節に開示した2件の逸脱を承認根拠に含めていない。

## 10. 仕様整合性

- 判定: **updated**
- 更新した仕様: `docs/specs/02_要件/05_グラフ投影要件.md`（REQ-GR-005へ判別規則を2文）、`docs/specs/01_システム概要/02_用語・略語.md`（`TERM-ASC-082`を1行）、`docs/specs/15_要件追跡/00_追跡表.md`（REQ-GR-005のintegration行を1行）。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **成立する。** 00の4.2で候補、01の2.1で確定、`docs/specs/01_システム概要/02_用語・略語.md`で現在有効な定義、と一方向である。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。** `TERM-ASC-082`は新語であり既存語の意味を変えない。**採番は台帳の最大値+1ではなく、他Issueのstagingを実測して決めた。** 台帳の最大は`081`、#1044のstagingが`076`〜`079`を採番済みであり、未使用の最小が`082`である。
- 要件・変更・SCN・テストの追跡: REQ-GR-005 → AC-GR-005 → AC-1067-01〜04 → SCN-INT-SEMGRAPH-031・032 → `test/features/integration/semantic-graph-observation.feature` → `src/adapters/repository-graph.ts`。`npm run trace:check`合格。**`trace:check`は到達性だけを見てAC↔SCNの対応の正しさを見ないため、追加行の各列を人が原文で突合した。**
- `no-spec-impact`の場合の限定的根拠: 該当しない。
- **#1066と違いREQ-GR-005の要件本文を更新した根拠。** #1066は「走査対象file」の集合へ1要素を足すだけで、要件文の規定が既にその集合を述べていた。本Issueは「追跡表のどの記法をrepository pathとして解釈するか」という**要件文がまだ述べていない規則**を決める。実装のリテラルだけが規則を持つ状態の解消自体がRQ-BR-03の要求である。
- UI・トークンの判断: いずれも`not-applicable`。2.2節のとおり。

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件。**
- Medium/Lowの記録: ADV-01・ADV-02（いずれもLow、record-only）。AFF-01・AFF-02はresolved。
- 判定: **approved**
- 新しい権限が必要な事項: **なし。**
- 残存リスク: 3件。(1) glob metacharacterの集合が6文字でありextglobを含まない（ADV-01）。(2) file名にglob metacharacterを含む実在fileは候補から外れて無検査になる（ADV-02）。(3) `docs/reviews/`のrole authority不整合（#1047へ委譲）。
- 次に許可される操作: **Step 11（`pr create`）。** その後CIが緑になってからmergeする。
- 次回の再開地点: PR作成後、CIの結果確認から。CIが赤になった場合は**残り予算1のラウンド3**で是正を載せる。**mainが動いていた場合は`git rebase --onto origin/main <旧base> HEAD`で追随し、本artifactの`H_impl`・`比較基点`を更新して`amend`し、CIと同じmerge refを手元で再現して`audit:check`を確認してからpushする。**
