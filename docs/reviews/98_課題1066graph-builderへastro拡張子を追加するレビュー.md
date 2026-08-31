# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1066 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `56a35ef0ba539fb683883e1778fe0d05b79aeeb9` |
| H_impl | `e0abec740f52f8c8d307ce4e9cca3e5c9b20a1a4` |
| 比較基点の由来 | 0.2節の既定branch追随（rebase）後の`origin/main`のtip。PR #1075（`v0.3.1-beta.46`のrelease bump）のmerge commitである。rebase前は`2732e0e9…`だった |
| Step 10のreview session ID | `06b6403beaf4e89fc30bfd7334a084d7c021ba2fbe2b260c0b3fe56ed0493c4f` |
| モード | full |
| 対象差分 | `src/adapters/repository-graph.ts`、`test/features/integration/semantic-graph-observation.feature`、`test/steps/semantic-graph-observation.steps.ts`、`docs/specs/15_要件追跡/00_追跡表.md`。commitは`fc885b58`・`a0463757`・`e0abec74`（rebase前は`0e9c3ca9`・`4746df3b`・`6504e401`） |
| 対象外 | `safeRepositoryPath`・source件数byte上限・symlink拒否への検査新設（01の9節末尾の限定と02の1.2節）。inline code区間をpathと解釈する判定の是正（#1067）。`SOURCE_EXTENSIONS`を利用側が拡張する機構（01の1節）。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド。本artifactは総2ラウンドで設計している。**残り1ラウンドはCIが赤になった場合の是正のために意図的に残す**） |
| ラウンド数 | 2。ラウンド1は`H_impl`の実装差分、ラウンド2は本artifactを加えた`H_final`が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260830_211648_graph-builderのSOURCE_EXTENSIONSへastroを追加する |
| 仕様の所有箇所 | `docs/specs/02_要件/05_グラフ投影要件.md`のREQ-GR-003「Builderはrepository rootを境界とし、Gitのtracked fileおよびignoreされていない対象fileを、NFC正規化したrepository相対pathの辞書順で有限走査する」。実装は同節の「実装: `src/domain/semantic-graph.ts`、`src/adapters/repository-graph.ts`」 |
| 成果物行数 | 製品 **+1行**（`SOURCE_EXTENSIONS`へ`".astro",`）。支援層 **+76行**（feature +10、steps +65、追跡表 +1）。合計 +77行、削除0行 |
| 縮小の先行評価 | 既存step定義の流用を先に評価した。`Given 存在しない実装pathを含むtrace rowがある`／`When endpoint不足のsemantic graphを構築する`／`Then stableなtrace endpoint診断でfail closedになる`はfixture内容と診断文言（`src/missing.ts`）へ固定されており、`.astro`を対象にできない。再利用できたのは`createModeFixture`・`writeFixture`・`commitFixture`・`buildRepositorySemanticGraph`という**helperであってstep定義ではない**。新設は01の9節が事前に固定した5件（Given 2・When 1・Then 2）で、実装もちょうど5件である。unit層とe2e層のscenarioは新設しなかった（`sourcePaths`が非exportで接合部が無く、e2eは公開CLI起動を追加検査するだけで本変更の境界を新たに固定しないため）。 |
| 実施者・日時 | reviewer（claude）、2026-08-31 |

### 0.1 routing入力契約

providerとmodel設定はproject choiceとrouting evidenceの観測値を用い、固有のmodel slugだけからreview authorityを推測しない。

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは**codex**の別invocationであり、reviewerは**claude**である。provider・contextともに異なる。reviewerは対象差分path（`src/`・`test/`・`docs/specs/`）を変更していない。本artifactが触れるのは`docs/reviews/`だけである |

**開示する逸脱が2件ある。**

1. **reviewerは進行役（coordinator）と同一sessionである。** project choiceは`reviewer.independence.differentFrom = implementer`だけを要求しており、implementer（codex）との分離は成立している。しかしcoordinatorとreviewerが同一sessionであることは、`roleContracts.coordinator.forbiddenOperations`の`self_approve`に接する。**実装は行っていない**ため自分の実装を承認してはいないが、この構成を隠さず記録する。#1068のreview artifact 97も同じ構成である。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts:26`が`AUDIT_DIRECTORY = "docs/reviews"`を要求する一方、`validateRoleOperation`は実行時に強制されていない（`grep -rn "validateRoleOperation" src/ scripts/`の定義1件のみ）。**本Issueでは権限拡大をscope外としてrisk受容し、解消を #1047 へ委譲する。**

### 0.2 既定branch追随（rebase）の開示

**review artifactを固定した後、既定branchが前進したためbranchをrebaseした。事実を隠さず記録する。**

| 項目 | 内容 |
|---|---|
| 事象 | PR #1077 のCIが全green（`8m42s`）になった後、`mergeStateStatus`が`BEHIND`だった。`main`が`56a35ef0`（PR #1075、`v0.3.1-beta.46`のrelease bump）へ前進していたためである |
| なぜ追随が必要か | `repos/.../rules/branches/main`の`required_status_checks`が`strict_required_status_checks_policy: true`である。branchが最新でなければmergeできない |
| 採った手段 | `git rebase --onto origin/main 2732e0e9… HEAD`。**`gh pr update-branch`（merge commit）を使っていない。** 追随merge commitはPR headの位置に入るため、review artifact commitより後ろに来て`H_impl`の導出を壊す |
| 結果 | 4 commitの一直線構造を保ったまま`56a35ef0`の上へ移した。**内容の差分は1 byteも変わっていない**（rebaseは適用のみで衝突が無い） |
| 本artifactへの反映 | `H_impl`を`e0abec74…`へ、`対象差分`のcommit列をrebase後の値へ更新した。`比較基点`は`scripts/check_file_audit.ts`の`inferReviewBoundary`が導出する値と一致することを`npm run audit:check`で確認する |
| review sessionとのずれ | `review-session.json`のanchorとcandidate headはrebase前のSHA（`6504e401…`・`e17ebd22…`）に束縛されたままである。**Step 11は`outcome=pull-request`で既に記録済みであり、`merge.mode=disabled`のため`pr merge`を通らない。** したがってreview sessionを取り直す経路が製品に無い。**この不一致を開示する** |
| 再検証 | rebase後のHEADに対し、CIと同じ順序の全10 commandを1本のchainで再実行する |


## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1066 、AC-1066-01〜03 | Step 4で00・01を、Step 8で00〜03を同期。`syncDigest`と`readBackDigest`が`35ff9bece89d120e2ce5d024bde163a20adf911a23d6835459caf19ae5cb42e6`で一致 | 一次資料 |
| 差分 | `2732e0e9..6504e401` | 4 file、+77行 / −0行。製品差分は1行 | 既存コード |
| テスト | `npm test` | `1301 scenarios (1285 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/15_要件追跡/00_追跡表.md` | updated（+1行） | 既存文書 |
| commit前candidate | 4 file（1.1節の表） | working tree clean（`git status --short`が空） | Git index |
| Phase A artifact | `docs/reviews/98_課題1066graph-builderへastro拡張子を追加するレビュー.md` | `H_impl` = `6504e401`。`H_final`は本artifactだけを加えたcommit。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

重要判断を推論だけで承認していない。**新しい権限は要求していない。**

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** 02の2.3節の6 nodeは`issue-1066 → req-gr-003 → ac-1066-* → scn-int-semgraph-* → repository-graph-source-extensions`の一方向であり、投影結果を自身の正しさの根拠にしていない。判定は隔離疑似projectのscenario実行結果である。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl` = `6504e401`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。PR/CI/reviewの観測はStep 11で行う。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** 本repositoryではPR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`であり、reviewerも同一の人間authorityの下で動く。`.agent-skill-chain/review-exceptions.json`の例外経路を9節で参照する。
- 既定branch追随を行った場合: **行っていない。** 基点`2732e0e9`は`origin/main`のtipであり、追随mergeを作っていない。`比較基点..H_impl`は3 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/adapters/repository-graph.ts` | M | package | package | `SOURCE_EXTENSIONS`は`sourcePaths()`の候補述語の入力集合であり、拡張子の追加はこの1箇所に閉じる。関数・分岐・importを増やしていない | pass。集合への要素追加であり、node・edgeを1つも追加しないため新しい循環が生じない。`npm run architecture:check`合格 | REQ-GR-003 / AC-1066-01 / SCN-INT-SEMGRAPH-029 | `safeRepositoryPath`（TB-1066-01）、件数byte上限（TB-1066-03）、symlink拒否、Source Identity再観測（TB-1066-04）のいずれも変更していない。rollbackは当該1行のrevert | pass |
| `test/features/integration/semantic-graph-observation.feature` | M | package | package | 既存Featureの末尾へscenarioを2件追加した。既存scenarioを1件も書き換えていない | pass | AC-1066-01 / SCN-INT-SEMGRAPH-029、AC-1066-02 / SCN-INT-SEMGRAPH-030 | fixtureは`world.initRepo()`の一時directory内に閉じ、実workspace・実remote・他worktreeへ到達しない | pass |
| `test/steps/semantic-graph-observation.steps.ts` | M | package | package | step定義を5件（Given 2・When 1・Then 2）追加した。01の9節が事前に固定した上限と内訳に一致する。新しいfixture生成器を作らず既存helperを再利用した。**ADV-01（Low、record-only）を5節へ記録した。** 新設Whenの本体が既存Whenと実質同一である点であり、既存step定義の書き換えが03のT01で禁止されているため修正しない | pass。既存step定義を1件も書き換えていない | AC-1066-01、AC-1066-02 / SCN-INT-SEMGRAPH-029、030 | 同上。`.astro` fixtureの内容にREQ・AC・SCN IDを含めず、ID走査への副作用を避けている | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | REQ-GR-003のintegration行の下へ1行追加した。既存行のSCN列を書き換えていない | pass | REQ-GR-003 / AC-GR-003 / SCN-INT-SEMGRAPH-029、030 | 追跡の追加だけで実行authorityを持たない | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only 56a35ef0ba539fb683883e1778fe0d05b79aeeb9 e0abec740f52f8c8d307ce4e9cca3e5c9b20a1a4`が返す4 pathが上表の4行と同じである。
- **比較基点の導出はcheckoutの形に依存する。** rebase後のbranch tipで`npm run audit:check`を実行すると`inferReviewBoundary`は比較基点を`2732e0e9…`と導出し、監査範囲へrelease bumpの`package.json`・`package-lock.json`が入る。一方CIはPRのmerge refをcheckoutするため、境界commitの第1親が`56a35ef0…`となり比較基点も`56a35ef0…`になる。**判定に用いるのはCIと同じmerge ref上の観測である。** 手元でも`main`へ`--no-ff` mergeした一時branchで同じ観測を再現して確認した。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** `.astro`はAstroの標準拡張子であり特定projectの固有値ではない。`.vue`・`.svelte`と同じ性質の要素である。追跡表は対応関係だけを持ち実行authorityを持たない。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **修正した個別findingは無い。** ラウンド1のfindingは3件ともrecord-onlyである。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1066-01 | 03の4.1節を参照する。`.astro`をliteralに一時削除して`graph rebuild --dry-run`すると、変更した`src/adapters/repository-graph.ts`自身が意味sourceであるため、`.astro` file 0件でも`graphContentHash`が変化する | OUTCOME-02のbuilder差だけを比較するには投影対象sourceを同一に固定する必要がある。目的・scope・AC・security境界・不可逆操作のいずれも変わらない | なし | `.astro`なしでbuildした`dist`を保持したままsourceを複写復元してdry-runし、同一sourceに対する3値を比較した。`workflow assess-discovery`のdispositionは`continue`、影響成果物0件 | 両builderとも`graphContentHash=7d55930e076a53cde7102659e6d11c2859b5592c0aa2d0737e659dd5d490961b`、node 2303、edge 10864。`git ls-files '*.astro' \| wc -l`は`0` | no-spec-impact | pass |

**この発見は測定手続きの誤りを実測で見つけたものである。** 「変更前後の投影hash比較」を素朴に行うと、変更した実装file自身が意味sourceであるため必ず差が出る。**同型の測定を行う他Issueでも同じ罠がある。**

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1066-01 | SCN-INT-SEMGRAPH-029 | `src/adapters/repository-graph.ts:33` | `1 scenario (1 passed) / 5 steps (5 passed)` | pass | 修正前は`AssertionError: + 'semantic graph projection診断 trace-endpoint-missing: docs/specs/15_要件追跡/00_追跡表.md:5: 存在しないrepository path=src/pages/index.astro' - undefined`で赤。**Issue #1066が報告した症状と同じ形である** |
| AC-1066-02 | SCN-INT-SEMGRAPH-030 | 同上 | `1 scenario (1 passed) / 5 steps (5 passed)` | pass | 修正前も修正後も緑。**030は「集合を広げすぎていない」ことの反例であり、修正の前後で振る舞いが変わらないことが正しい** |
| AC-1066-03 | SCN-INT-SEMGRAPH-029 | 同上 | 変異で`1 scenario (1 failed)`、複写復元で`1 scenario (1 passed)` | pass | 変異は`".astro",`の行削除。復元は複写で行い`git checkout`を使っていない。変異中も030は緑のままである |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | `.astro`が読み取り対象になり、構築中に平文が`SourceFile.text`としてprocess memoryへ載る。project choiceの`capabilities.privacySecurity`も`applicable`である | 実装を読んで確認した3点。(1) `observeSourceFile`はNUL byteを含まない場合だけ`text`へ平文を保持する（`src/adapters/repository-graph.ts:756-762`）。(2) snapshotへ永続化されるのはpath・state・sha256・size（同`:1023-1029`）と抽出したIDおよび行番号（同`:1041-1063`）であり平文ではない。databaseへの格納も同じ（`src/adapters/graphqlite.ts:1028-1049`）。(3) `.astro`は`ECMASCRIPT_EXTENSIONS`外のためAST parseされない。**`.vue`・`.svelte`と完全に同一経路であり、取得・一時保持・永続化のいずれの経路も新設していない。** 反例はSCN-INT-SEMGRAPH-030 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | not-applicable | log出力、保持、rotation、監視、復旧手順、診断文言の文字列のいずれも変更しない | 差分4 fileに`console`・log・診断文言の変更が1件も無いことを1.1節の個別監査で確認した。SCN-INT-SEMGRAPH-030が既存の診断文言をそのまま照合しており、文言が変わっていないことの反例になっている |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | project choiceの`capabilities.humanCenteredUi`が`not-applicable`であり、GUIまたはWeb UIを提供しない | `package.json`の`bin`が公開する4 CLIだけを持つ。UI sourceを1 fileも追加していない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | project choiceの`capabilities.designTokens`が`not-applicable`であり、画面レイアウトと視覚コンポーネントを所有しない | `docs/specs/17_デザイン/`と`docs/specs/18_レイアウト/`を追加していない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | REQ-GR-003は走査対象を「Gitのtracked fileおよびignoreされていない対象file」と規定しており、`.astro`の欠落はこの要件に対する実装の不足である。追加後、SCN-INT-SEMGRAPH-029がその不足の解消を観測している |
| 価値 | 利用者・運用上の目的を満たすか | pass | Issue #1066の報告者（`RUA-PROM/nexus-corporate-website`）は`src/pages/*/index.astro`を実装正本にしている。修正前の赤の診断文（`存在しないrepository path=src/pages/index.astro`）は報告された症状と同じ形であり、修正後に消える |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存package、lockfile、実行時に必要な外部の存在を1件も変えていない。`SOURCE_EXTENSIONS`はmodule内`const`であり実行時設定を要求しない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の1.1の設計目標（1要素追加、INV-01〜05維持）と実差分が一致する。03のT01〜T04の完了条件をすべて観測した。追跡表の追加行のAC・SCN・層・Feature・実装がscenarioの実体と一致することを**人が原文で突合した**（`trace:check`はAC↔SCNの対応の正しさを見ないため） |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 製品差分は1行で、辞書順の位置（`".c"`の前）を保っている。rollbackは当該1行のrevertで完結する |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 隣接する`.astro.bak`をSCN-INT-SEMGRAPH-030で固定した。`path.posix.extname("src/pages/index.astro.bak")`は`".bak"`であり集合に無いため除外される。file名が`.astro`だけの場合も`extname`が空文字となり、`SOURCE_BASENAMES`にも無いため除外される（INV-04） |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 失敗経路を1つも追加していない。件数上限・byte上限・Source Identity再観測の判定順序と拒否動作が変更前と同一である |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `sourcePaths()`の`new Set(listed)`による重複除去と辞書順整列、`safeRepositoryPath`のNFC判定・制御文字拒否をいずれも変更していない。`.ASTRO`は既存の`toLowerCase()`により従来どおり一致する |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | 追加は候補述語の入力集合を広げるだけで、前段の`safeRepositoryPath`も後段の上限も弱めない。利用側が`SOURCE_EXTENSIONS`を書き換える経路を作っていない（02の1.2節で不採用としたため、集合を任意に**縮小**される経路も生じない） |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 2.2節のDC-PRIVACYのとおり。読み取り対象file集合は広がるが、広がった先へ適用される取得・一時保持・非永続化の扱いは`.vue`・`.svelte`と同一である |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 書き込み側の述語を変えていない。投影は派生Read Modelであり完全rebuildで再生成する。保存済みdataの形式・移行手順・後方非互換な読み書き規則を変えない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 当該1行のrevertで完結する。追加scenarioは同じPRで戻る |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding（ADV-02、Low、record-only）** | 呼び出し元は`sourcePaths` 1箇所で、`architecture:check`合格。配布物影響は8節。文書は追跡表を更新済み。**ただしSCN-INT-SEMGRAPH-030は`.astro.bak`という隣接1件だけを固定するため、無関係な拡張子を同時に足す変異は検出できない。** AC-1066-02が要求する条件はそのまま観測できているため、ACを超える一般化をscenarioへ求めずrecord-onlyとした |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| ADV-01 | Low | 新設`When`の本体が既存`When`と実質同一である。差は成功時に`this.snapshots`へ結果を保持する点だけ | `test/steps/semantic-graph-observation.steps.ts`の新設`trace endpoint観測用のsemantic graphを構築する`と既存`endpoint不足のsemantic graphを構築する` | test層のみ | **修正しない。** 既存step定義の書き換えは03のT01が明示的に禁止しており、step定義5件という上限も01の9節が事前に固定した契約である | valid / record-only | step定義の重複が1件残る。将来まとめる場合は既存scenarioの再検証を伴うため別Issueの範囲 |
| ADV-02 | Low | SCN-INT-SEMGRAPH-030は隣接1件（`.astro.bak`）だけを固定し、集合を`.astro`以外へ広げていないことの完全な証明にはならない | 同scenarioのGivenとThen | test層のみ | **修正しない。** AC-1066-02の条件そのものは観測できている。ACを超える一般化をscenarioへ求めない | valid / record-only | 無関係な拡張子を同時に追加する変異は検出できない。差分レビュー（1.1節の個別監査）が代替統制である |
| AFF-01 | Low | 製品差分が`SOURCE_EXTENSIONS`への1行追加に閉じていることを確認した（肯定的所見） | `git diff --stat 2732e0e9..HEAD`が`src/adapters/repository-graph.ts \| 1 +` | 製品 | 対応不要 | resolved | なし |

**未解決のCritical / Highは0件である。**

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: **はい。** 3節（肯定5観点）と4節（敵対8観点）をすべて判定した。対象は`H_impl` = `6504e401`である。
- 指摘を確定した: **はい。** ADV-01・ADV-02・AFF-01の3件。いずれもLowでrecord-onlyであり、`review-session.json`の`blocking`は空である。
- 次ラウンド対象のCritical/High: **0件。** ラウンド1の`status`は`converged`である。

### ラウンド2

- 未解決Critical/High: **0件。**
- 修正差分: **本review artifact 1 fileだけ。** `H_impl`（`6504e401`）から`H_final`への差分は`docs/reviews/98_課題1066graph-builderへastro拡張子を追加するレビュー.md`のみである。製品・test・`docs/specs/`を一切変更していない。
- 修正で触れた隣接範囲: **なし。** ラウンド1のfindingはすべてrecord-onlyであり、コード修正を伴わない。
- 既承認・未変更範囲を再走査していない: **成立する。** ラウンド2はartifact自身の記述と`H_impl..H_final`の差分pathだけを対象にする。

### ラウンド3

**実施しない。予算1を残す。** 理由を明示する。#1068（artifact 97の10.1・10.2節）と#1051（artifact 96）で、**review予算3を使い切った後にCIが赤になると、是正を載せる正規のラウンドが存在しない**という構造問題が2回起きた。`pr create`はreview sessionのHEADとPR HEADの一致を要求するため、review artifact自身が最終ラウンドの対象になり、CIが初めて走る前に予算を使い切る構造になっている。**本Issueでは総ラウンド数を2に設計し、CI是正のために予算1を明示的に残す。** これは前例であって機構ではなく、構造問題の解消ではない。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format`、`npm run test:format` | 2 | 2 | 0 | 0 | pass |
| unit・integration・e2e（runner `cucumber-js`、dialect `en`） | `npm test` | 1301 | 1285 | 0 | 16 | pass |
| 型・既存一式・配布物 | `npm run project:quality`・`npm run quality`・`npm run trace:check`・`npm run architecture:check`・`npm run build`・`npm run package:check`・`npm run conformance:check` | 7 | 7 | 0 | 0 | pass |

**上の全commandをCI（`.github/workflows/ci.yml`）と同じ順序で1本のchainとして実行し、途中終了なしで完走した。** `npm test`と`conformance:check`は直列である（並行実行すると`dist/`を奪い合いE2Eが偽陽性で落ちる）。

**変異試験。** `".astro",`の行削除でSCN-INT-SEMGRAPH-029が`1 scenario (1 failed)`となり、複写復元で`1 scenario (1 passed)`へ戻る。SCN-INT-SEMGRAPH-030は変異中も緑である。

**implementerのsandbox結果を承認根拠にしていない。** implementer（codex）はsandboxが`spawnSync git EPERM`を返したため通常起動での実測ができず、`/tmp` shim下の測定と未commitの差分を報告した。**reviewerは非sandbox環境で赤・緑・変異・復元・full gate chainをすべて再実行し、その結果だけを上表の根拠にしている。** implementerのsandbox都合で製品コードやtestを弱める変更は差分に含まれていないことを1.1節の個別監査で確認した。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/repository-graph.ts` | **入る**（`package.json`の`files`が`dist/src/`を列挙する） | 意味source集合へ`.astro`が加わる。`.astro`を実装列へ持つprojectで、これまで必ず失敗していた`graph rebuild`・`graph status`が成功へ転じる |
| `test/`、`docs/specs/` | 入らない | `package.json`の`files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/adapters/repository-graph.js`の候補述語の入力集合が変わり、対象入力に対する終了値と診断の有無が変わる。JSON出力形式・field構成・診断文言の文字列と、非対象入力に対する振る舞いは変えていない。`npm run package:check`はexit 0であり、配布物へ開発専用資産を持ち込んでいない。

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
| 観測値 | `gh api`で観測できる本PRのapproval reviewは0件である。本repositoryは単一のhuman ownerが運用しており、PR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である |

**承認元、承認者、承認日時、失効日時は正本を参照し、ここへ複製しない。**

**implementerとreviewerの分離は成立している。** implementerは`codex`の別invocation（別provider・別context）、reviewerは`claude`である。project choiceの`reviewer.independence.differentFrom = implementer`を満たす。0.1節に開示した2件の逸脱を承認根拠に含めていない。

## 10. 仕様整合性

- 判定: **updated**
- 更新した仕様: `docs/specs/15_要件追跡/00_追跡表.md`（REQ-GR-003のintegration行を1行追加）。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **成立する。** 00の4.2で候補差分0件、01の2.1で確定差分0件、耐久台帳（`docs/specs/01_システム概要/02_用語・略語.md`）への追加・変更・廃止も0件である。参照した`意味source`はREQ-GR-003本文が定義の正本であり、台帳の独立IDを持たない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。** 新語を導入していない。
- 要件・変更・SCN・テストの追跡: REQ-GR-003 → AC-GR-003 → SCN-INT-SEMGRAPH-029・030 → `test/features/integration/semantic-graph-observation.feature` → `src/adapters/repository-graph.ts`。`npm run trace:check`合格。**`trace:check`は到達性だけを見てAC↔SCNの対応の正しさを見ないため、追加行の各列を人が原文で突合した。**
- `no-spec-impact`の場合の限定的根拠: 該当しない。
- `docs/specs/02_要件/05_グラフ投影要件.md`のREQ-GR-003本文を変更しない根拠: 同節は走査対象を「Gitのtracked fileおよびignoreされていない対象file」と既に規定しており、`.astro`の欠落はこの要件に対する実装の不足である。**要件文へ拡張子を列挙すると、以後の拡張子追加が要件変更になり、正本が実装詳細を抱え込む。**
- UI・トークンの判断: いずれも`not-applicable`。2.2節のとおり。

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件。**
- Medium/Lowの記録: ADV-01・ADV-02（いずれもLow、record-only）。AFF-01はresolved。
- 判定: **approved**
- 新しい権限が必要な事項: **なし。**
- 残存リスク: 3件。(1) 同型の拡張子欠落報告が来るたび個別追加になる（判断基準はBR-01・BR-02として00と01が保持し、02の12節で`docs/specs/`への恒久記述を不採用と決めた）。(2) `safeRepositoryPath`・source件数byte上限・symlink拒否にscenario検査が無い状態が続く（**本変更が作った状態ではなく、本変更で解消もしない**。01の9節末尾の限定）。(3) `docs/reviews/`のrole authority不整合（#1047へ委譲）。
- 次に許可される操作: **Step 11（`pr create`）。** その後CIが緑になってからmergeする。
- 次回の再開地点: PR作成後、CIの結果確認から。CIが赤になった場合は**残り予算1のラウンド3**で是正を載せる。
