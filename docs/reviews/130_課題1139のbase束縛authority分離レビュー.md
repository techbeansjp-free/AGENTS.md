# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1139 |
| ラウンド | Step 10 ラウンド1〜3 |
| 比較基点 | `28b7ebf6464a184fb17629c86d69a2e878eb79ae` |
| H_impl | `a3b616f02a99c42e444f690de77cb217ed475e38` |
| 比較基点の由来 | review開始時点の`origin/main`のtip |
| Step 10のreview session ID | `f3632ca53553a9088ec4f3280690df0c7a6ad06751826944ec30917397cb4202` |
| モード | full（Q-01とQ-03がfalse） |
| 対象差分 | `src/domain/policy.ts`、`src/domain/worktree.ts`、`src/cli.ts`、`src/cli-usage.ts`、`test/features/unit/merge-method-policy.feature`、`test/features/integration/lifecycle-worktree.feature`、`test/steps/merge-method-policy.steps.ts`、`test/steps/lifecycle-worktree.steps.ts`、`docs/specs/02_要件/03_外部連携要件.md`、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md`。commitは`a3b616f0` |
| 対象外 | **`pr create`・`pr merge`側（#1176へ分離）。** delivery stateへのtuple分離保存。`merge.branches`のschema変更。`delivery.baseBranches`等の専用allowlistの新設。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **0**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで。総2ラウンドで設計したが、**ラウンド3で外部reviewerが検出したMajor迂回の是正に使った**。6節を参照する） |
| ラウンド数 | 3。ラウンド1は実装差分、ラウンド2は本artifactを加えた版、**ラウンド3は外部reviewer（CodeRabbit）が検出したMajor迂回の是正**が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260903_151657_worktreeのbase束縛を宣言済み長命branchへ広げpolicy-authorityと分離する |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-004 |
| 成果物行数 | 製品 **+166 / −4行**（policy +59、worktree +82/−4、CLI +13、usage +12）。仕様 **+7 / −4行**。支援層 **+346行**（feature +54、steps +292）。**支援層/成果物 = 2.4倍** |
| 縮小の先行評価 | 3案を先に評価した。(1) 3つ目の比較だけを削除する案は、**trusted policyが`origin/<base>`から読まれる経路を残すため不採用**（DISC-001）。(2) `delivery.baseBranches`等の専用allowlistを新設する案は、意味は最も明確だが**新しいpolicy手段を増やす**ため不採用。既存の`merge.branches`と`isMergeBaseCandidate`を再利用する。(3) 7条件すべてを1 PRへ入れる案は差分が大きくレビュー粒度が落ちるため、`pr create`・`pr merge`側を #1176 へ分離した |
| 実施者・日時 | reviewer（claude）、2026-09-03 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する。**ただし方針はcodexとfableへ独立に諮問した結果である** |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** project choiceの`reviewer.independence.differentFrom = implementer`を満たさない。緩和は2つある。判定の根拠をすべて機械観測（scenario結果、変異試験の赤・緑、実CLI出力）に置いたこと。**設計方針そのものをcodexとfableへ独立に諮問し、両者一致の結論を採用したこと。**
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 諮問（codex） | Issue #1139 のコメント | 案A条件付き採用、案B不採用。「policy authorityとbase authorityが1つの等式に潰されている」 | 外部の判断 |
| 諮問（fable） | 同上 | 同じ結論。**`src/cli.ts:1503`と`src/domain/policy.ts:1454-1467`を読み、trusted policyが`origin/<base>`から読まれることを実測で指摘** | 外部の判断 |
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1139 、AC-01〜AC-07 | Step 8で00を同期した。`issue validate`は`valid: true`、errors 0件 | 一次資料 |
| 差分 | `28b7ebf6..a3b616f0` | 11 file、+499 / −7行 | 既存コード |
| テスト | `npm run conformance:check` | `1440 scenarios (1424 passed, 16 skipped)`、失敗0 | テスト出力 |
| **実CLI検証** | 本repositoryへ一時remote refを作って実行 | 宣言していないbranchは`受理するbaseはmainです`で拒否、既定branchは`preview`で通過。**検証後にrefを削除した** | 実行記録 |
| 仕様 | `docs/specs/02_要件/03_外部連携要件.md`ほか2 file | updated | 既存文書 |
| commit前candidate | 11 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/130_課題1139のbase束縛authority分離レビュー.md` | `H_impl` = `a3b616f0`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** `issue-1139 → req-gh-004 → ac-01..07 → scn-unit-basebranch-001..005 / scn-int-worktree-010..014 → accepted-base-branches`の一方向である。`worktree.ts → policy.ts`も一方向で`architecture:check`合格。**trusted policyをbase側から読まないため、候補branchによる自己評価の経路が無い。** 本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl` = `a3b616f0`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** いずれも`adachi-tatsuru`である。9節を参照する。
- 既定branch追随を行った場合: **行っていない。** 基点`28b7ebf6`は`origin/main`のtipであり、`比較基点..H_final`は2 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/policy.ts` | M | package | package | `acceptedBaseBranches`が集合を返し、`inspectBaseBranchAcceptance`が判定と理由を返す。**既存の`isMergeBaseCandidate`を再利用し、新しい判定を発明していない** | pass。既存の内部関数を使うだけで新しい依存を作らない | REQ-GH-004 / AC-06・07 / SCN-UNIT-BASEBRANCH-001〜005 | **既定branchを宣言の有無によらず受理する。** 宣言を空にしたprojectが既定branchすら使えなくなる状態を作らない。rollbackは追加した2関数のrevert | pass |
| `src/domain/worktree.ts` | M | package | package | base束縛をbranch固有へ一般化した。**remote defaultのtip検査（policy authority）とbase検査（base authority）を分離した** | pass。`worktree.ts → policy.ts`の一方向。`architecture:check`が`cycles: null` | REQ-GH-004 / AC-01〜05 / SCN-INT-WORKTREE-010〜014 | **既定branch以外を選ぶときだけ追加検査が走る。** `--base-branch`省略時の経路は変更前と同一である。すべての拒否は`worktree add`の前に起き、外部状態を変えない | pass |
| `src/cli.ts` | M | package | package | `baseBranch`・`baseSha`を配線した。`trustedSet.policy`は既に渡っていた | pass | 同上 | optionalであり、省略時は従来と同一 | pass |
| `src/cli-usage.ts` | M | package | package | usage定義を2件足した。**これが無いと`build`が落ちる**（#1104のDISC-002で学習済み） | pass | 同上 | 記述だけで実行authorityを持たない | pass |
| `test/features/unit/merge-method-policy.feature` | M | package | package | scenarioを5件追加した。既存scenarioを1件も書き換えていない | pass | AC-06・07 | 純関数の検査であり外部へ到達しない | pass |
| `test/features/integration/lifecycle-worktree.feature` | M | package | package | scenarioを5件追加した | pass | AC-01〜05 | fixtureは一時repositoryに閉じる | pass |
| `test/steps/merge-method-policy.steps.ts` | M | package | package | step定義を8件追加した。**1つ目の正規表現が2つ目と両方一致してambiguousになったため厳密化した** | pass | AC-06・07 | 同上 | pass |
| `test/steps/lifecycle-worktree.steps.ts` | M | package | package | fixture helperとstep定義を追加した。**配布default policyを土台にし`merge.branches`だけ差し替える**（DISC-002） | pass | AC-01〜05 | 一時repositoryを作り、実workspace・実remoteへ到達しない | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | project | spec | REQ-GH-004へbase受理の規定を追記した | pass | REQ-GH-004 | 記述だけで実行authorityを持たない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | SCN 10件を結線した（DISC-004） | pass | REQ-GH-004 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 1行追加した | pass | REQ-GH-004 / Issue #1139 | 同上 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only 28b7ebf6 a3b616f0`が返す11 pathが上表の11行と同じである。**本artifactは`H_impl..H_final`の差分であり`比較基点..H_impl`に入らないため、個別監査の行にしない。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** base受理の判定はpackage層の機構であり、**受理集合の実値はproject policyの宣言から来る。** 判定logicへproject固有のbranch名を焼き込んでいない。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **DISC-003の是正で`lifecycle-worktree.feature`と`lifecycle-worktree.steps.ts`を再監査した。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**実装中の発見が4件ある。**

**DISC-001。素朴な実装はtrusted policyを`origin/<base>`から読む。** fableが`src/cli.ts:1503`の`loadEffectiveTrustedPolicySet(input.root, base)`と`src/domain/policy.ts:1454-1467`を読んで指摘した。developがmainと同等のbranch protectionを持たなければ、**保護対象policyの改変をdevelop経由で「trusted」にできる**。policy authorityとbase authorityを分離し、**3つ目の比較だけを削除する修正を採らなかった。**

**DISC-002。fixtureを手書きすると`rules`必須と`worktree.allowedBranchTypes`で落ちる。** 検査したい境界と別の理由で失敗していた。配布default policyを土台にし`merge.branches`だけ差し替える形へ変えた。

**DISC-003（Medium）。変異M5が当初生存した。** 基点commitとbase SHAの一致要求を外しても検出できなかった。`SCN-INT-WORKTREE-014`を追加して塞いだ。**M3が「申告tipとprovider観測の不一致」、M5が「申告どおりのtipを持つbranchなのに実際に分岐する基点がそこでない」で別の境界である。**

**DISC-004。孤立SCN 10件。** 新規SCNを追跡表へ結線していなかった。`conformance:check`の`SCN-INT-SPECNORM-001`が検出した。**本日3回目の同型である**（#1147・#1104・本Issue）。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-INT-WORKTREE-010 | `worktree.ts`のbase分岐 | `10 scenarios (10 passed)` | pass | worktreeのHEADが`develop`のtipと一致する。**fixtureは`develop`と既定branchを別commitにしており、同一commitでは検査にならないことをassertionで明示している** |
| AC-02 | SCN-INT-WORKTREE-011 | `inspectBaseBranchAcceptance` | 同上 | pass | 診断が受理集合の実値を含む。変異M4で失敗する |
| AC-03 | SCN-INT-WORKTREE-012 | trusted policy必須の分岐 | 同上 | pass | `trusted policyの観測が必要です`で拒否する |
| AC-04 | SCN-INT-WORKTREE-013 | `refs/remotes/origin/<base>`の観測 | 同上 | pass | 変異M3で失敗する |
| AC-05 | SCN-INT-WORKTREE-014 | 基点commitとbase SHAの一致 | 同上 | pass | **DISC-003で追加した。** 変異M5で失敗する |
| AC-06 | SCN-UNIT-BASEBRANCH-004 | `isMergeBaseCandidate`の再利用 | 同上 | pass | 変異M1で失敗する |
| AC-07 | SCN-UNIT-BASEBRANCH-001 | `acceptedBaseBranches` | 同上 | pass | 変異M2で失敗する |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | **受理するbaseの集合を広げる変更であり、authority分離が安全条件である。** trusted policyをbase側から読むと宣言の正本を候補branchで差し替えられる | 変異M4で宣言検査を素通しさせると1 scenarioが失敗し、変異M1でwildcard除外を外すと2 scenarioが失敗する。**trusted policyの読み取り先は変更前後で同一である**（`loadEffectiveTrustedPolicySet`へ触れていない） |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 拒否されたとき「宣言していない」のか「wildcardだから使えない」のかを利用側が区別できる必要がある | 診断が受理集合の実値を列挙する。実CLIで`受理するbaseはmainです`を観測した。変異M2で2 scenarioが失敗する |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないCLIであり、出力はJSONだけである | `projectKind`が`cli` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たず、色・間隔・typographyの決定を含まない | `capabilities.designTokens`が`not-applicable` |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | **実CLIで拒否と受理の両方向を観測した。** 宣言していないbranchは受理集合を示して拒否され、既定branchは`preview`で通る |
| 価値 | 利用者・運用上の目的を満たすか | **部分的にpass** | git-flow consumerが`develop`起点のworktreeを作れるようになる。**ただしStep 11到達には #1176 が要る。** 本PRだけでは利用者の目的は達成されない。0節の対象外と5節のADV-01に明記した |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 新しい依存を足していない。`trustedSet.policy`は既にCLIから渡っていた |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 00〜03の設計と実差分が一致する。`trace:check`は`valid: true`、orphan 0件（DISC-004の是正後） |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 既存の`isMergeBaseCandidate`を共有し、判定を二重に持たない。**#1176も同じ2関数を再利用する前提で起票した** |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 宣言済み・未宣言・wildcard・trusted policy不在・tip不一致・基点不一致の6経路を検査する |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | **すべての拒否は`git worktree add`の前に起きる。** 部分的に作られたworktreeが残らない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `merge.branches`が空の場合を`SCN-UNIT-BASEBRANCH-001`で検査する。重複は`new Set`で除去する |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | branch名は完全一致でのみ照合する。`refs/remotes/origin/<base>`の解決失敗は拒否する |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | **trusted policyをbaseの選択に依存させない。** これがDISC-001の是正の要点であり、`loadEffectiveTrustedPolicySet`の呼び出しへ1行も触れていないことで担保される |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 書き込みは`git worktree add`のみで、既存の`dirtyBefore`/`dirtyAfter`検査を変えていない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 11 fileのrevertで完結する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding（ADV-01、High、record-only）** | **本PRだけではconsumerのStep 11到達が達成されない。** `pr create`・`pr merge`が依然として既定branch固定である。5節へ記録し #1176 へ分離した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| ADV-01 | **High** | 本PRだけではconsumerのStep 11到達が達成されない。`pr create`・`pr merge`が既定branch固定のまま | `src/cli.ts:1503, 1720, 2088`が`defaultBranch(input.root)`からbaseを導出する | 配布先 | **本PRでは修正しない。** 差分が大きくなりレビュー粒度が落ちる。**#1176へ分離し、諮問で確定した7条件のうち本PRが1〜4、#1176が5〜7を担うことを明記した** | valid / record-only | **git-flow consumerは #1176 まで待つ必要がある。** 本PRは前進だが完了ではない |
| CR-01 | **Major** | **`--base-branch <既定branch> --base-sha <別commit>`で、既定branchのprovider観測tipでない任意commitを基点にできた。** SHAの正本を「`--base-branch`の指定有無」で決めていたため、既定branchを明示した経路が分岐を素通りしていた | 実CLIで再現。`state: preview base: 5c4ec47a…`（別commitが通る） | 製品 | **修正した。** SHAの正本をbranch名で決める形へ変え、既定branchに別SHAを明示した場合を拒否するガードを足した。`SCN-INT-WORKTREE-015`を追加した | valid / resolved | なし。是正後は`base branch SHAはremote default branch SHAと一致しなければなりません`で拒否する |
| CR-02 | Low | usage説明が「既定branchにも完全一致の宣言が必要」と読める | `baseにするbranch名。trusted policyのmerge.branchesへ完全一致で宣言されている必要がある` | CLI | **修正した。** 「既定branch以外は」と限定した | valid / resolved | なし |
| CR-03 | Low | `SCN-INT-WORKTREE-010`〜`015`がREQ-LC-003にしか結線されていなかった | 追跡表のLine 52 | 仕様 | **修正した。** REQ-GH-004のintegration行を追加した | valid / resolved | なし |
| DISC-003 | Medium | 変異M5が当初生存した | 基点commitとbase SHAの一致要求を外しても10件全通過した | test | **修正した。** `SCN-INT-WORKTREE-014`を追加した | valid / resolved | なし |
| ADV-02 | Low | `--base-branch`と`--base-sha`の整合は実行時にしか検査されない | 片方だけ指定すると`base branch SHAは40桁hexで指定してください`で落ちる | CLI | **修正しない。** 拒否の診断が原因を述べており、外部状態を変える前に落ちる | valid / record-only | 診断を読まないと片方指定の誤りに気付けない |
| AFF-01 | Low | fableが実測でDISC-001を指摘した（肯定的所見） | `src/cli.ts:1503`と`policy.ts:1454-1467` | — | 対応不要 | resolved | なし |

**未解決のCritical / Highは0件である。ADV-01はHighだが`record-only`であり、分離先（#1176）を明示している。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分`28b7ebf6..a3b616f0`の11 file。
- 確認: 個別監査11行、AC-01〜07、肯定5観点、敵対8観点。
- 結果: blocking 0件。**DISC-003（Medium）はラウンド内で検出し是正した。** record-only 2件（ADV-01・ADV-02）。resolved 1件（AFF-01）。

### ラウンド2

- 対象: 本artifactを加えた版。
- 確認: 本artifactの記述が実観測と一致するかを全件突合する。行数、SHA、scenario件数、変異結果、実CLI出力の5種を実コマンド出力と照合した。
- 結果: blocking 0件。


### ラウンド3

- 対象: 外部reviewer（CodeRabbit）が検出したMajor迂回（CR-01）と Minor 2件の是正版。
- 確認: 迂回の再現と是正後の拒否を**実CLIで観測**した。変異M6〜M8で構造を確定した。
- 結果: blocking 0件。
- **ラウンド3をreview sessionへ記録できていない。** CR-01の是正を実装commitへ畳むため`git reset --soft`と`amend`を行い、ラウンド2のcandidate HEADが消えた。`review round`は前ラウンドのcandidate HEADをancestorとして要求するため記録できない（#1172）。**review sessionのrounds記録は2件のままであり、本artifactの記述が3ラウンドである点と一致しない。この不一致を承認根拠に含めず、事実として残す。**
- **`pr create`より後の指摘だが本PRで取り込んだ。** `02_品質基準.md`は後続の指摘をfollow-up Issueへ分離すると定めるが、CR-01は**本変更が足そうとしている束縛そのものを迂回する経路**であり、分離すると既知の迂回を出荷することになる。「目的阻害」に該当するため例外とした。Minor 2件は同じ差分の一部であり併せて取り込んだ。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format`、`npm run test:format` | 2 | 2 | 0 | 0 | pass |
| unit・integration・e2e（runner `cucumber-js`、dialect `en`） | `npm run conformance:check`（内部で`npm test`を実行する） | 1440 | 1424 | 0 | 16 | pass |
| 型・既存一式・配布物 | `npm run lint`・`format:check`・`typecheck`・`source:check`・`trace:check`・`architecture:check`・`skills:check`・`build`・`package:check` | 9 | 9 | 0 | 0 | pass |

**上の9本を1本ずつ実行し、それぞれの終了値で合否を取った。**

**変異試験。** 8件を実施し、7件をkillした。**M6は等価変異である。**

**M6が等価なのは、ternaryとガードがそれぞれ独立に同じ迂回を塞ぐためである。** M7（ガードだけ外す）とM8（両方戻す）がいずれも失敗することで、`SCN-INT-WORKTREE-015`が迂回そのものを検出していることを確認した。**等価と判定できたため反射的なfixture追加を行っていない。**

| ID | 変異 | 結果 | 復元後 |
|---|---|---|---|
| M1 | wildcard除外を外す | `9 scenarios (7 passed, 2 failed)` | 全通過 |
| M2 | 既定branchを受理集合から外す | `9 scenarios (7 passed, 2 failed)` | 全通過 |
| M3 | base branchのtip照合を外す | `9 scenarios (8 passed, 1 failed)` | 全通過 |
| M4 | 宣言検査を素通しさせる | `9 scenarios (8 passed, 1 failed)` | 全通過 |
| M5 | **基点commitとbase SHAの一致要求を外す** | **当初`9 scenarios (9 passed)`で生存。** `SCN-INT-WORKTREE-014`追加後は`10 scenarios (9 passed, 1 failed)` | `10 scenarios (10 passed)` |
| M6 | SHAの正本をbranch名でなく`--base-branch`の指定有無で決める（ternaryだけ戻す） | `11 scenarios (11 passed)`。**等価変異である** | — |
| M7 | 既定branchの別SHA拒否ガードだけを外す | `11 scenarios (10 passed, 1 failed)` | `11 scenarios (11 passed)` |
| M8 | ternaryとガードの両方を戻す（迂回の完全復活） | `11 scenarios (10 passed, 1 failed)` | `11 scenarios (11 passed)` |

**復元は複写で行い`git checkout`を使っていない。**

**実CLIによる確認。** 本repositoryへ一時remote ref（`refs/remotes/origin/asc-1139-probe`）を作り、`--dry-run`で次を観測した。**検証後にrefを削除した。**

| 入力 | 出力 |
|---|---|
| 宣言していないbranchをbaseにする | `base branch asc-1139-probeはtrusted policyのmerge.branchesへ完全一致で宣言されていません。受理するbaseはmainです` |
| 既定branchをbaseにする | `preview 28b7ebf6…`（従来どおり） |

**本repositoryの`merge.branches`は`[]`であり、受理集合が`main`だけになることも同時に確認できている。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/policy.ts`、`src/domain/worktree.ts`、`src/cli.ts`、`src/cli-usage.ts` | **入る**（`files`が`dist/src/`を列挙する） | `worktree create`が`--base-branch`・`--base-sha`を受理する。**省略時の振る舞いは変わらない** |
| `docs/specs/02_要件/03_外部連携要件.md`、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md` | **入る**（`files`が`docs/`を列挙する） | REQ-GH-004の記述と追跡が延びる |
| `test/` | 入らない | `package.json`の`files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/`へbase受理判定が入り、`--help`に2 flagが増える。**既定branchをbaseにする従来の呼び出しは1文字も変わらない。** 受理集合は広がるが、束縛の形（宣言＋provider観測tipへの一致）は各baseへ同じ強度で要求する。`npm run package:check`はexit 0である。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **設計方針についてはあり。** codexとfableへ独立に諮問し、両者の結論をIssue #1139 のコメントへ記録した。**実装差分そのもののreviewはStep 11で観測する** |
| reviewerがPR author・実装commit authorと異なる | いいえ。いずれも`adachi-tatsuru`である |
| 観測したreview commentとapprovalの件数 | 諮問2件。本PRのreview commentとapprovalは現時点で0件・0件 |

**適用する例外は無い。** `.agent-skill-chain/review-exceptions.json`が持つ例外は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の1件だけであり、PR作成前の本時点では条件の判定自体ができない。

**残る事実を隠さず記録する。** implementerとreviewerが同一sessionであり、approval reviewは0件である。本artifactの`approved`は**AIによる最終裁定**であって人間の独立approvalではない。

**設計方針を独立に検証したことが緩和である。** 案A・案Bの採否、安全条件との関係、実装条件の7項目は、codexとfableへ独立に諮問して両者一致した結論である。**とりわけDISC-001（trusted policyのbase依存）は私が見落としており、fableが実測で指摘した。** 私単独なら安全条件の縮小を出荷していた。

## 10. 仕様整合性

- 判定: **updated**
- 更新した仕様: `docs/specs/02_要件/03_外部連携要件.md`（REQ-GH-004）、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md`。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **成立する。** 新規用語を追加していない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。**
- 要件・変更・SCN・テストの追跡: REQ-GH-004 → AC-GH-004 → AC-01〜07 → SCN-UNIT-BASEBRANCH-001〜005、SCN-INT-WORKTREE-010〜014。`trace:check`は`valid: true`、orphan 0件。
- `no-spec-impact`の場合の限定的根拠: 該当しない。**受理するbaseの集合という観測可能な契約を変えているため要件本文を延ばした。**
- UI・トークンの判断: いずれも`not-applicable`。2.2節のとおり。

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件。** ADV-01はHighだが`record-only`であり、分離先（#1176）を明示している。
- Medium/Lowの記録: ADV-01（High、record-only）、ADV-02（Low、record-only）。**CR-01（Major）・CR-02・CR-03・DISC-003・AFF-01はresolved。**
- 判定: **approved**（AIによる最終裁定。人間の独立approvalは0件であり、9節に事実として記録した。**設計方針はcodexとfableの一致した結論である**）
- 新しい権限が必要な事項: **なし。**
- 残存リスク: 3件。(1) **本PRだけではconsumerのStep 11到達が達成されない**（ADV-01、#1176へ分離）。(2) `--base-branch`と`--base-sha`の整合は実行時にしか検査されない（ADV-02）。(3) `docs/reviews/`のrole authority不整合（#1047へ委譲）。
- 次に許可される操作: **Step 11（`pr create`）。** その後CIが緑になってからmergeする。
- 次回の再開地点: pushした後、CIの結果確認から。**mainが動いていた場合は`pr create`を先に済ませてからrebaseする**（#1172）。
