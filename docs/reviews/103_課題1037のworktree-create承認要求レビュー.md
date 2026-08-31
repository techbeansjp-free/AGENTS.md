# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1037 |
| ラウンド | Step 10 ラウンド1〜3 |
| 比較基点 | `ba9f3e043251454be84f69479a49d03ea6030036` |
| H_impl | `d3e4975d19f5a8a742dc6bfc8ea68b616ec684b0` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip。**本artifact commitまでの間に`origin/main`は動いていない**（`git fetch`後に同一SHAであることを確認した） |
| モード | full |
| 対象差分 | 本artifactのラウンド2版を含む10 path。`src/domain/worktree.ts`、`src/cli.ts`、`test/features/integration/worktree-create-dry-run.feature`、`test/steps/worktree-create-dry-run.steps.ts`、`test/steps/worktree-placement.steps.ts`、`scripts/check_test_determinism.ts`、`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`、`docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`、`docs/specs/15_要件追跡/00_追跡表.md`、および本artifact。commitは`174c7699`・`e15c59f4`・`d3e4975d` |
| 対象外 | (a) preview成功がapply成功を保証しない残差の機構的解消。(b) `createWorktree`の`preview`引数を必須にする変更（5節のR1-F01）。(c) `worktree create`以外のcommandのflag契約。(d) `applyMode`自身の実装 |
| 残り予算 | **0**（同一範囲で最大3ラウンド。総2ラウンドで設計し予算1を残していたが、**ラウンド3で外部reviewerの指摘3件を判定して使い切った**。6節を参照する） |
| ラウンド数 | 3。ラウンド1は実装差分、ラウンド2は本artifactを加えた版、**ラウンド3は外部reviewer（CodeRabbit）の指摘3件の判定**が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260831_203535_worktree-createが-dry-runを無視してworktreeとbranchを実際に作成する |
| 仕様の所有箇所 | `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`の`worktree create`行と`docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`のREQ-LC-003。**着手時点でこの2箇所は`worktree create`の承認要求を規定していなかった。** その欠落を埋めることが本Issueの要求の一部である |
| 成果物行数 | 製品 **+10 / −0行**（`src/domain/worktree.ts` +8、`src/cli.ts` +2）。仕様 **+5 / −2行**。検査script **+6 / −0行**。支援層 **+264行**（feature +35、新規steps +226、既存steps +3） |
| 縮小の先行評価 | 4案を先に評価した。(1)**CLI層で`rev-parse`を複製してpreviewを組み立てる案**は、`createWorktree`が持つorigin同一性・`origin/HEAD`一致・`base == remoteDefaultSha`の3検査をpreviewが飛ばすため不採用。previewがapplyより弱くなりINV-02に反する。**この評価はStep 7のreadiness checkの指摘N-02と進行役の独立測定が同時に到達した。** (2)`preview`を返さず終了値だけで表す案は、利用者が作成先pathとbaseを事前に確認できず要求を満たさないため不採用。(3)`applyMode`を使わず`flags["dry-run"]`を直接読む案は、両flag同時指定の拒否を再実装することになり既存機構の重複となるため不採用。(4)新規step定義を既存`worktree-placement.steps.ts`へ相乗りさせる案は、既存の型なしWorld（`WorktreePlacementWorld`）へ依存が増えるため不採用。新規fileは`stepDefinitions<DryRunWorld>()`の型付きWorldで書いた |
| 実施者・日時 | reviewer（fable・codex）、coordinator（claude）、2026-08-31 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | fable、codex | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは**claude**であり、reviewerは**fableとcodex**である。providerとcontextがともに異なる |

**開示する逸脱が3件ある。**

1. **implementerが計画の当初想定と異なる。** `codex exec --full-auto`がhost側のauto mode分類器に拒否され起動できないため、進行役（claude）が実装した。**reviewerにclaudeを含めていない。** reviewerがimplementerと別providerである性質は保たれている。**この帰結（実行時にimplementer identityとreviewerの独立性を検証する機構が無い）は既存の #1040 が所有する。**
2. **codex reviewerが応答の途中で停止した。** `ERROR: Selected model is at capacity.`で打ち切られ、finding一覧を出力できなかった。**ただし停止前の実行traceに探索対象が残っており、進行役がその1点を独立に実測して確認した**（5節のR1-F00）。**codexの主張をそのまま採用していない。実測で再現したものだけをfindingにした。** 残りの観点はfableの独立invocationで網羅した。
3. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts`が`AUDIT_DIRECTORY = "docs/reviews"`を要求する一方、`validateRoleOperation`は実行時に強制されていない。**本Issueでは権限拡大をscope外としてrisk受容し、解消を #1047 へ委譲する。**

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1037 | Step 8で00〜03を同期。`syncDigest`と`readBackDigest`が一致し`sync-verified`のcheckpoint 8へ遷移した | 一次資料 |
| 差分 | `ba9f3e04..d3e4975d` | **9 file、+285 / −2行**（`git diff --numstat`の実測値）。**製品差分は+10 / −0行** | 既存コード |
| テスト | `npm test` | `1331 scenarios (1315 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/`配下3 file | updated | 既存文書 |
| Phase A artifact | `docs/reviews/103_課題1037のworktree-create承認要求レビュー.md` | `H_impl` = `d3e4975d`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** 本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl` = `d3e4975d`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。同一である。** 本repositoryの全sessionが単一アカウントで走る。**providerの差はcontextの独立性であってidentityの独立性ではない。** 9節で成立条件を正確に記録した。
- 既定branch追随を行った場合: **行っていない。** 基点`ba9f3e04`は`origin/main`のtipであり、追随mergeを作っていない。`比較基点..H_impl`は3 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/worktree.ts` | M | package | package | `createWorktree`の作成責務のまま。任意引数`preview`と、`git worktree add`の直前で計画を返す分岐8行だけである | pass。新しいmodule依存を作らない。`npm run architecture:check`合格 | REQ-LC-003 / AC-LC-003 / SCN-INT-WTDRY-001〜006 | **検証規則を1つも変えていない。** 分岐は全検証の後・唯一の副作用の前にある。rollbackは当該8行のrevert | pass |
| `src/cli.ts` | M | package | package | `worktree create` dispatch blockへ`applyMode(flags)`と`preview: !apply`の2行だけである | pass。既存の`applyMode`を再利用し新機構を足していない | REQ-LC-003 / AC-LC-003 / SCN-INT-WTDRY-004、005 | flag検査はdispatch block内であり、`--path`のtrusted boundary評価を行う`USAGE_PREFLIGHT`より後である。評価順序契約を壊さない | pass |
| `test/features/integration/worktree-create-dry-run.feature` | A | package | package | integration scenarioを6件持つ新規Featureである。既存Featureを1件も書き換えていない | pass | AC-LC-003 / SCN-INT-WTDRY-001〜006 | fixtureは`initRepo()`の一時directory内に閉じる | pass |
| `test/steps/worktree-create-dry-run.steps.ts` | A | package | package | step定義を4件（Given 1・When 2・Then 2）追加した。`stepDefinitions<DryRunWorld>()`の型付きWorldで書いた | pass。既存step定義を1件も書き換えていない | AC-LC-003 / SCN-INT-WTDRY-001〜006 | 実`.agent-skill-chain/project`の複写のため`REPOSITORY_READ_EXCEPTIONS`を1件宣言した | pass |
| `test/steps/worktree-placement.steps.ts` | M | package | package | 既存3呼び出しへflagを1行ずつ補っただけである。判定logicを1行も変えていない | pass | AC-LC-003 / SCN-INT-WTPLACE-003、SCN-INT-WTTS-001、002 | 未来path拒否は**`--apply`**にして「副作用前に拒否される」性質を測る形を保った（5節のR1-F03） | pass |
| `scripts/check_test_determinism.ts` | M | package | package | `REPOSITORY_READ_EXCEPTIONS`へ1件宣言した。検査logicを変えていない | pass | 既存のtest決定性契約 | 過剰宣言も過少宣言も同検査が両方向で拒否する。当該検査自身が緑である | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | project | spec | `worktree create`行の入力列と出力列を書き換え、直後へpreviewの検証範囲と残差を1段落足した。他のcommand行に触れていない | pass | REQ-LC-003 / AC-LC-003 | 規則の記述だけで実行authorityを持たない | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | project | spec | REQ-LC-003の本文へ明示承認の要求を2文足した。他の要件に触れていない | pass | REQ-LC-003 / AC-LC-003 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | REQ-LC-003の既存行を書き換えず、1行追加した | pass | REQ-LC-003 / AC-LC-003 / SCN-INT-WTDRY-001〜006 | 追跡の追加だけで実行authorityを持たない | pass |
| `docs/reviews/103_課題1037のworktree-create承認要求レビュー.md` | A | project | evidence | **本artifact自身のラウンド2版である。** ラウンド3の是正を前進commitで積んだため`比較基点..H_impl`の範囲へ入った。まとめ行にせず1 file 1行で記録する | pass。evidence層であり実行authorityを持たない | 全AC。review sessionの`7b77bfea…` | 内容はreview記録のみ。rollbackは本fileのrevert | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only ba9f3e04 d3e4975d`が返す**10 path**が上表の10行と同じである。**10件目は本artifactのラウンド2版であり、ラウンド3の是正を前進commitで積んだ結果として監査範囲へ入った。** `amend`で畳まなかったのは、`review round`が前ラウンドのHEADをancestorとして要求するためである。**amendするとラウンド3を記録できなくなる。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** `preview`はdomainの制御引数であり、承認という概念をdomainへ持ち込んでいない。承認判定は`applyMode`が担うCLI層の責務のままである。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **ラウンド1のfindingのうち2件を修正した。** 修正範囲は`test/steps/worktree-placement.steps.ts`と`docs/specs/15_要件追跡/00_追跡表.md`の2 fileだけであり、**製品差分は1行も変わっていない。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**設計段階の発見が1件、review段階の発見が1件ある。**

1. **Step 7で設計を変更した。** 当初の03はCLI層で`rev-parse`を呼んでpreviewを組み立てる計画だった。readiness checkのN-02と進行役の独立測定が同時に、その形ではpreviewがorigin同一性・`origin/HEAD`一致・`base == remoteDefaultSha`の3検査を飛ばすことへ到達した。**INV-03を「`createWorktree`の実装を変えない」から「検証規則と副作用の内容を変えない。副作用の直前で停止して計画を返す任意引数を1つ足すことは許す」へ改定した。** AC・scope・security境界の契約は変えていない。
2. **ラウンド1で仕様文の誤りを1件是正した**（5節のR1-F00）。**ACを変えていない。**

### 2.1 受け入れ条件とシナリオ

| AC | 内容 | SCN | 観測 |
|---|---|---|---|
| AC-LC-003（本Issue分） | `--dry-run`でworktreeもbranchも作成されない | SCN-INT-WTDRY-001 | 緑。修正前は赤 |
| 同上 | `--dry-run`の出力が`state: "preview"`の計画（絶対path・branch・解決済み40桁hex base）を返す | SCN-INT-WTDRY-002 | 緑。修正前は赤 |
| 同上 | `--apply`ではworktreeが作成される | SCN-INT-WTDRY-003 | 緑。修正前から緑（正常系の回帰） |
| 同上 | flagなしの呼び出しを拒否する | SCN-INT-WTDRY-004 | 緑。修正前は赤 |
| 同上 | 両flag同時指定を拒否する | SCN-INT-WTDRY-005 | 緑。修正前は赤 |
| 同上 | `--dry-run`でも配置検証が働く | SCN-INT-WTDRY-006 | 緑。修正前から緑（回帰ガード） |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 判定 | 観測 |
|---|---|---|
| DC-PRIVACY | not-applicable | 個人データも秘匿値も扱わない。preview出力はpath・branch名・commit SHAだけで、いずれも入力から決まる |
| DC-OBSERVABILITY | applicable | 症状は「`--dry-run`と書いても実際に作成される」という、出力から区別できない副作用であった。**是正後はpreviewが`state: "preview"`を返し、利用者が出力だけで副作用の有無を判別できる。** SCN-INT-WTDRY-002がこれを正の形で固定する |
| DC-UX | not-applicable | project choiceの`humanCenteredUi`が`not-applicable`である |
| DC-TOKENS | not-applicable | project choiceの`designTokens`が`not-applicable`である |

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 検証規則を1つも変えていない。足したのは副作用の直前で停止する分岐1つと、既存`applyMode`の呼び出し1つである |
| 価値 | pass | 隔離repositoryの実測で、`--dry-run`がworktree数を1のまま保つようになった（修正前は2へ増えた） |
| 実現可能性 | pass | 製品差分は+10 / −0行である |
| 整合性 | pass | `applyMode`は他12箇所で使われている既存機構であり、`worktree create`だけが未使用だった。使用側へ揃えただけである |
| 保守性 | pass | 検証をCLI層へ複製していない。preview経路とapply経路が同一の検証codeを通る |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例 | pass | 変異5件がいずれも対象scenarioを殺す（7.1節） |
| 失敗 | pass | 検証失敗時の既存の振る舞いを変えていない。previewは検証を通過した場合だけ計画を返し、失敗は従来どおり例外として上がる |
| 境界 | pass | flagの4状態（`--dry-run`のみ・`--apply`のみ・両方・無し）をすべてscenarioで観測した |
| 悪用 | pass | previewはread-onlyであり、`git remote get-url origin`・`git rev-parse`・`git symbolic-ref`しか実行しない。`worktree add`へ到達しない。**`git status`は実行しない**（`sourceStatusExcludingTarget`はpreview分岐より後にある） |
| 安全性 | pass | **previewがapplyより弱い検査で通ることはない。** 分岐は全検証の後にあり、飛ばす検査が存在しないことを原文で確認した（7.4節） |
| 損失 | not-applicable | previewは書き込みを行わない。applyの副作用は従来と同一である |
| 復旧 | pass | rollback-validationを実測した（7.2節） |
| 範囲 | pass | `applyMode`自身、他command、`validateWorktreePlacement`に触れていない |

## 5. 指摘

**ラウンド1で4件、ラウンド2で0件。未解決のCritical/Highは0件である。**

| ID | 深刻度 | 種別 | 状態 | 内容 |
|---|---|---|---|---|
| R1-F00 | High | spec-inconsistency | resolved | **仕様へ書いた「previewが成功した入力とapplyが成功する入力は一致する」が偽であった。** codex reviewerが停止前のtraceで「既存branchがworktree未登録ならpreview検証を通過する経路」を探索していたため、進行役が隔離repositoryで独立に実測した。同名branchが既存の場合、previewは`state: "preview"`で成功し、applyは`git worktree add -b`が`fatal: a branch named '…' already exists`で失敗する。**仕様文を残差の明記へ書き換えた。** 機構的解消は0節の対象外(a)とする |
| R1-F01 | Low | improvement | valid・是正しない | `preview?: boolean`が任意引数のため、`createWorktree`を直接呼ぶ将来の呼び出し元が引数を忘れると副作用側へ倒れる。**是正しない理由**: `src/domain/worktree.ts`は配布公開APIではない（公開CLIは4 commandで、domain moduleは`package.json`の`exports`に無い）。承認はCLI境界の概念であり、domainへ承認引数を必須化すると責務が越境する。既定は「引数省略＝従来の振る舞い」であって、検査を無効化する既定ではない |
| R1-F02 | Low | traceability | resolved | 追跡表の新行の実装列が`src/domain/worktree.ts`だけで、flag検査とpreviewの配線を担う`src/cli.ts`を指していなかった。同表のWTTS行が両者を併記する前例がある。併記へ是正した |
| R1-F03 | Low | vacuous-assertion | resolved | 未来path拒否のintegration testへ`--dry-run`を選んだため、`assert.equal(fs.existsSync(...), false)`が拒否と無関係に恒真になっていた。`--apply`へ戻し「副作用前に拒否される」性質を測る形に保った。`--dry-run`側はSCN-INT-WTDRY-006が別に覆う |

**R1-F01を根拠に新しいIssueを起こしていない。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象は`ba9f3e04..174c7699`の実装差分である。
- **敵対reviewをfableとcodexの独立invocationで実施した。** implementer（claude）とは別providerである。
- **codexは`Selected model is at capacity`で途中停止し、finding一覧を出力できなかった。** 停止前のtraceに残った探索対象1点を進行役が独立に実測してR1-F00を確定した。**codexの未完了の主張をそのまま採用していない。**
- **すべての指摘を受け入れる前に実測で検証した。** R1-F00は隔離repositoryで既存branchを作ってpreviewとapplyを連続実行し、前者が終了値0、後者が`ASC-CLI-VALIDATION-001`で拒否されることを観測した。R1-F03は`--apply`へ戻した状態で`@integration`の466 scenarioが緑であることを確認した。
- R1-F00の是正はamendで畳んだ（review sessionをまだ作っていないためH_implが動いていない）。R1-F02とR1-F03の是正は前進commit `e15c59f4`で積んだ。**製品差分は1行も変えていない。**

### ラウンド2

- 対象は本artifactを加えた版である。
- 0.1節の逸脱3件、5節のR1-F01の未是正、7節の実測値が本文の主張と一致することを確認した。
- **新規findingは0件である。** 未解決blockingは0件である。

### ラウンド3

**外部reviewer（CodeRabbit）の指摘3件を受けて実施した。** 残していた予算1をここで使った。**CI全chainはこの時点で緑である。**

| ID | 判定 | 内容 |
|---|---|---|
| R3-F01 | **前提が誤り・退ける** | 4節の悪用行が「previewは`git rev-parse`・`symbolic-ref`・`status`しか実行しない」と書いていた点の指摘に付随して、`sourceStatusExcludingTarget`をpreview分岐の前へ移し、dry-runでも`dirtyBefore`を取得せよという提案があった。**採らない。** `sourceStatusExcludingTarget`は検証ではなく、副作用の前後を比較するための基準値の観測である。previewは副作用を起こさないため比較対象の`dirtyAfter`が存在せず、取得した値をどの判定にも使えない。**「全検証を実行する」契約に`status`観測は含まれない。** 実行すれば読み取り費用だけが増える |
| R3-F02 | **有効・是正した** | 同じ4節の悪用行が実装と食い違っていた。preview経路は`git status`を実行せず（`sourceStatusExcludingTarget`はpreview分岐より後にある）、逆に`git remote get-url origin`を`enforceTrustedWorktreeBoundary`の中で実行する。**この誤りがR3-F01の提案の前提を作っていた。** 原文を実装と突合して書き直した |
| R3-F03 | **退ける** | 0節の縮小評価が書く「`flags["dry-run"]`を直接読む案」を「直接参照する案」へ改めよという指摘。LanguageToolの`MEISI_YOMU`規則による文法指摘だが、flagの値を「読む」は日本語として正しく、意味も変わらない。**文体上の好みであり欠陥ではない** |

**製品差分はラウンド3でも1行も変えていない。** 変えたのは本artifactだけである。

## 7. テスト結果

| 検証 | 結果 |
|---|---|
| `npm test` | `1331 scenarios (1315 passed, 16 skipped)`、失敗0 |
| CI同順の全chain | `project:quality`→`quality`→`docs:format`→`test:format`→`trace:check`→`architecture:check`→`build`→`package:check`→`conformance:check`の9 commandを**終了値を明示的に見るループで**完走した |

### 7.1 変異試験

**復元はすべて複写で行い`git checkout`を使わない。**

| 変異 | 内容 | 対象scenarioの結果 |
|---|---|---|
| M-a | `applyMode(flags)`を`flags.apply === true`へ置換する（両flag同時指定と無指定の拒否を消す） | **2件**が赤（004・005） |
| M-b | `preview: !apply`を`preview: false`へ置換する（常に副作用） | **2件**が赤（001・002） |
| M-c | `preview: !apply`を`preview: apply`へ置換する（向きの反転） | **3件**が赤 |
| M-d | previewの`base`を`baseCheck.stdout.trim()`から`input.base`の生値へ変える | **1件**が赤（002） |
| M-e | preview分岐を`git worktree add`の後へ移す | **1件**が赤（001） |

**M-aは最初に生存に見えた。** `src/cli.ts`の先頭側にある**別commandの`const apply = applyMode(flags);`行**を書き換えてしまい、`worktree create`のdispatch blockが無改修のままだったためである。anchorを`if (command === "worktree" && subcommand === "create") {`から始まる3行へ一意化して再実行し、2件の赤を確認した。**「変異が生存した」を等価変異と結論する前に、変異が実際に当たっているかを確認する。**

**M-dは`--base=main`のscenarioでのみ殺せる。** 既存fixtureはすべて解決済み40桁SHAを`--base`へ渡しており、生値と解決済みSHAが区別できない。SCN-INT-WTDRY-002はsymbolic refの`main`を渡し、出力の`base`が40桁hexかつ`remoteDefaultSha`と等しいことを検査する。**この設計はStep 7のreadiness checkの指摘B-01による。**

### 7.2 差し戻し検証（rollback-validation）

隔離repositoryを`mktemp -d`で作り、trusted policyとorigin remoteを備えて実測した。

| 操作 | worktree数 |
|---|---:|
| `--dry-run`実行前 | **1** |
| `--dry-run`実行後 | **1** |
| `--apply`実行後 | **2** |

flagなしの実行は`ASC-CLI-VALIDATION-001`／`書き込み可能なコマンドには--dry-runまたは--applyが必要です`で拒否された。

**修正前の同一手順では`--dry-run`・`--apply`・flagなしの3経路すべてがworktree数を1から2へ増やした。** これはStep 0の欠陥再現で観測済みである。

### 7.3 修正前の赤の観測

T01完了時点で**4件が赤、2件が緑**であった。緑の2件は事前に回帰ガードと宣言していた。

| scenario | T01時点 | 赤の内容 |
|---|---|---|
| SCN-INT-WTDRY-001 | 赤 | `git worktree list --porcelain`と`git branch --list`の連結がdry-run前後で変化した |
| SCN-INT-WTDRY-002 | 赤 | `state`が`undefined`であった |
| SCN-INT-WTDRY-004 | 赤 | flagなしが終了値0でworktreeを作成した |
| SCN-INT-WTDRY-005 | 赤 | 両flag同時指定が終了値0でworktreeを作成した |
| SCN-INT-WTDRY-003・006 | 緑（宣言どおり） | — |

### 7.4 INV-02の確認（previewが検証を飛ばさない）

`src/domain/worktree.ts`のpreview分岐の**前**にある検証を原文で列挙した。

| 検証 | preview経路を通るか |
|---|---|
| `enforceTrustedWorktreeBoundary`（root一致・symlink脱出・Git内部・destination衝突・origin同一性） | 通る |
| `validateWorktreePlacement`（規定名・branch type・Issue／slug一致・timestamp・重複） | 通る |
| 規定rootからのsymlink脱出判定 | 通る |
| `rev-parse --verify <base>^{commit}` | 通る |
| `remoteDefaultSha`の40桁hex検査 | 通る |
| `symbolic-ref refs/remotes/origin/HEAD`と`--remote-default-branch`の一致 | 通る |
| `base == remoteDefaultSha`の一致 | 通る |

preview分岐の**後**にあるのは`sourceStatusExcludingTarget`（副作用前後のstatus観測）、`git worktree add`（唯一の副作用）、副作用後のstatus不変検査の3つだけである。**previewが飛ばす検証は0件である。**

## 8. 配布物影響

配布境界へ入る変更pathは`src/domain/worktree.ts`と`src/cli.ts`の2件である。いずれも`package.json`の`files`が配布対象とする。`docs/specs/`、`test/`、`scripts/`は配布対象外である。

判断: 配布物を更新した

根拠: 利用側の`worktree create`が`--dry-run`または`--apply`のいずれかを必須とするようになり、無指定の呼び出しが拒否される。**これは利用側の既存の呼び出しを壊す変更である。** 本repository内の呼び出し元（`.claude/skills/`のStep 9手順とAGENTS.md）は`--apply`を明示しており影響を受けない。

## 9. 独立reviewの成立

- **reviewerとimplementerのstable actor IDは同一である。** 本repositoryの全sessionが単一のアカウントで走るため、`H_impl`のcommit authorもPR authorもreviewerも同じstable IDになる。**providerがclaude・fable・codexで異なることはcontextの独立性であって、identityの独立性ではない。** 両者を同一視しない。
- **外部reviewerによる独立approvalは0件である。** `.agent-skill-chain/review-exceptions.json`の`exceptions`は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の1件だけで、本Issueへ適用できる例外区分は存在しない。
- **したがって11節の`approved`は、人間による独立approvalを伴わないAIの最終裁定である。**
- **これは本PR固有の事情ではなく、本repositoryの恒常的な条件である。** 実行時にimplementer identityとreviewerの独立性を検証する機構が無いことは既存の #1040 が所有する。
- 進行役はR1-F00を指摘の受け入れ前に隔離repositoryで独立に実測し、R1-F01を退ける根拠（domain moduleが`exports`に無いこと）も独立に確認した。

## 10. 仕様整合性

| 変更 | 更新先 | 追跡 |
|---|---|---|
| `worktree create`が`--dry-run`と`--apply`のどちらか一方を必須とし、previewが検証を省略しないこと、およびpreview成功がapply成功を保証しない残差 | `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | REQ-LC-003 / AC-LC-003 |
| 作成に明示承認を要する要件 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | REQ-LC-003 / AC-LC-003 |
| 追跡行の追加 | `docs/specs/15_要件追跡/00_追跡表.md` | REQ-LC-003 / AC-LC-003 / SCN-INT-WTDRY-001〜006 |

- **`trace:check`はAC↔SCNの対応の正しさを見ない。** 追加行の各列をscenarioの実体と人が原文で突合した。6件のSCNがすべてFeature fileに実在し、実装列の2 fileがいずれも実在することを確認した。
- **用語台帳へ追加していない。** 新語は無い。`preview`も`apply`も既存の用語である。
- **`AC-1037-xx`形式のIDを使っていない。** `scripts/check_trace.ts`の`ACCEPTANCE_ID`が`AC-[A-Z][A-Z0-9]*-[0-9]{3,}`を要求し、数字始まりのIDは機械追跡の対象にならない。既存のAC-LC-003へ束ねた。

## 11. 総合判定と再開地点

**approved。** 未解決のCritical/Highは0件、blockingは0件である。**CI全chainが緑であることをmerge前に確認した。****この`approved`は、人間による独立approvalを伴わないAIの最終裁定である**（9節）。

- 再開地点はStep 11の`pr create`である。
- **`pr create`は作成直後のread-backで`reconciliation-required`へ落ちることが既知である。** このとき副作用を再送しない。`pr create`を再実行するとread-only照合で既存PRを1件だけ束ね、`step11-recorded`まで進む。一致が0件または2件以上なら停止して人へ返す。
- CIが赤になった場合は残り予算1のラウンドで是正する。**赤を通す理屈を作らない。**
