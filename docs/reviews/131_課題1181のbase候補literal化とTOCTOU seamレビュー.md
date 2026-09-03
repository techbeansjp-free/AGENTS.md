# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1181 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `1c4fc38e6252f4021eed6a7f7b0ccb3cc29e97ef` |
| H_impl | `6600cf23db960379c852abb8a2ebf4414fb5d3fd` |
| 比較基点の由来 | review開始時点の`origin/main`のtip。PR #1183（`v0.3.1-beta.73`のrelease bump）のmerge commitである |
| Step 10のreview session ID | `3bb197a9c659b362958bc49339c5adb0df4b74451653ccfadd88723dfe1bf01b` |
| モード | quick |
| 対象差分 | `src/domain/policy.ts`、`src/domain/worktree.ts`、`test/features/unit/merge-method-policy.feature`、`test/steps/merge-method-policy.steps.ts`、`test/steps/lifecycle-worktree.steps.ts`、`docs/specs/02_要件/03_外部連携要件.md`、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md`。commitは`6600cf23` |
| 対象外 | `isMergeBaseCandidate`の意味変更。Gitのrefname規則の完全な再実装。`pr create`・`pr merge`側（#1176）。base branchの内容の信頼モデル（#1176のAC-TRUST-01）。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで。総2ラウンドで設計した） |
| ラウンド数 | 2。ラウンド1は実装差分、ラウンド2は本artifactを加えた版が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260903_175332_base候補からGit-revision-syntaxを除外しTOCTOU回帰を観測可能にする |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-004 |
| 成果物行数 | 製品 **+31 / −1行**（policy +23/−1、worktree +8）。仕様 **+3 / −2行**。支援層 **+46行**（feature +27、steps +19）。**支援層/成果物 = 1.5倍** |
| 縮小の先行評価 | 3案を先に評価した。(1) `isMergeBaseCandidate`自体へrevision syntax検査を足す案は、**同関数が長命branch警告のbase候補判定でも使われており**、そちらの意味まで変えるため不採用。(2) Gitのrefname規則（`git check-ref-format`相当）を実装する案は、**拒否すべき形を数え上げる方向**であり漏れが避けられないため不採用。**受理してよい形を狭く列挙する。** (3) seamを設けずM9を観測不能のままにする案は、**#1179で一度採ったが外部reviewerの指摘で覆った**ため不採用 |
| 実施者・日時 | reviewer（claude）、2026-09-03 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する。**ただし本Issueの起点は外部reviewer（CodeRabbit）の指摘2件である** |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は2つある。判定の根拠をすべて機械観測に置いたこと。**本Issueの2件はいずれも外部reviewerが検出したものであり、私の内部reviewでは出ていない。**
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 外部reviewerの指摘 | PR #1180 のinline comment 2件 | Major（revision syntax受理）とMinor（TOCTOU seam不在） | 外部のimmutable証拠 |
| 迂回の再現 | `inspectBaseBranchAcceptance` | `main~1`が**受理**された | 実行記録 |
| 解決の実測 | `git rev-parse --verify` | `refs/remotes/origin/main~1^{commit}`が`4ca43dba`（親commit）、`refs/remotes/origin/main^{commit}`が`28b7ebf6`（tip）。**別のcommitである** | 実行記録 |
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1181 、AC-01〜03 | Step 4で00を同期した。`issue validate`は`valid: true` | 一次資料 |
| 差分 | `1c4fc38e..6600cf23` | 8 file、+80 / −3行 | 既存コード |
| テスト | `npm run conformance:check` | `1453 scenarios (1437 passed, 16 skipped)`、失敗0 | テスト出力 |
| commit前candidate | 8 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/131_課題1181のbase候補literal化とTOCTOU seamレビュー.md` | `H_impl` = `6600cf23`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** `issue-1181 → req-gh-004 → ac-01..03 → scn-unit-basebranch-006/007・scn-int-worktree-016 → is-literal-branch-name`の一方向である。`isLiteralBranchName`はbranch名の字面だけを見て**repositoryの状態を参照しない**。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl` = `6600cf23`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** いずれも`adachi-tatsuru`である。9節を参照する。
- 既定branch追随を行った場合: **行っていない。** 基点`9636ff17`は`origin/main`のtipであり、`比較基点..H_final`は2 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/policy.ts` | M | package | package | `isLiteralBranchName`は「文字列 → 真偽」の関数1つ。`acceptedBaseBranches`の直前へ置き、`isMergeBaseCandidate`と併せて要求する。**`isMergeBaseCandidate`の意味を変えていない** | pass。branch名の字面だけを見る。**repositoryの状態も他domainも参照しない** | REQ-GH-004 / AC-01・02 / SCN-UNIT-BASEBRANCH-006・007 | **受理集合を狭める方向の変更である。** 正当なbranch名の受理は変わらない。rollbackは当該関数と1行の合成のrevert | pass |
| `src/domain/worktree.ts` | M | package | package | `afterVerification`をoptionalで足し、検査完了直後へ1行の呼び出しを置いた。**testだけが使う** | pass | AC-03 / SCN-INT-WORKTREE-016 | **省略時は何もしない。** productionの呼び出し元は指定しない。rollbackは2箇所のrevert | pass |
| `test/features/unit/merge-method-policy.feature` | M | package | package | Scenario Outlineを2件追加した。**拒否7例と受理4例の両方をOutlineで押さえる** | pass | AC-01・02 | 純関数の検査であり外部へ到達しない | pass |
| `test/steps/merge-method-policy.steps.ts` | M | package | package | `baseは拒否される`のThenを1件追加した。既存step定義を書き換えていない | pass | AC-01 | 同上 | pass |
| `test/steps/lifecycle-worktree.steps.ts` | M | package | package | `SCN-INT-WORKTREE-016`へseam経由のref移動を注入した | pass | AC-03 | fixtureは一時repositoryに閉じる | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | project | spec | REQ-GH-004へrevision syntax除外を追記した | pass | REQ-GH-004 | 記述だけで実行authorityを持たない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | SCN 2件を結線した | pass | REQ-GH-004 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 1行追加した | pass | REQ-GH-004 / Issue #1181 | 同上 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only 1c4fc38e 6600cf23`が返す8 pathが上表の8行と同じである。**本artifactは`H_impl..H_final`の差分であり`比較基点..H_impl`に入らないため、個別監査の行にしない。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** `isLiteralBranchName`は特定のbranch名を焼き込まず、形だけを判定する。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **修正した個別findingは無い。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**実装中の発見が2件ある。**

**DISC-001。#1179 のreview artifactは「変異M9は観測不能」と記録していた。** 外部reviewerの指摘がその判断を覆した。**seamを設ければ観測できる。私の見立てが足りなかっただけである。** 10節で訂正記録の扱いを述べる。

**DISC-002。`refs/heads/main`・`HEAD`・`@{-1}`が拒否されていたのは、宣言リストに無かったためであり検査の結果ではなかった。** 偶然の拒否を検査の成果と誤認しかけた。`isLiteralBranchName`で明示的に拒否し、`SCN-UNIT-BASEBRANCH-006`のExamplesへ`HEAD`と`refs/heads/main`を含めた。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-BASEBRANCH-006 | `isLiteralBranchName` | `16 scenarios (16 passed)` | pass | `main~1`・`main^`・`a..b`・`x@{1}`・`-bad`・`HEAD`・`refs/heads/main`の7例で拒否する。変異M10で7 scenarioが失敗する |
| AC-02 | SCN-UNIT-BASEBRANCH-007 | 同上 | 同上 | pass | `develop`・`release/1.0`・`feat.x`・`ok/nested`の4例で受理する。**拒否側だけでなく受理側もOutlineで押さえている** |
| AC-03 | SCN-INT-WORKTREE-016 | `afterVerification` | `1 scenario (1 passed)` | pass | seam内で`git branch -f asc-base-probe <別commit>`を実行しても、worktreeのHEADは検査時のcommitである。**変異M9で1 scenarioが失敗する** |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | **baseはworktreeの比較基点であり、tipでないcommitを指せると監査の前提が崩れる** | 変異M10でliteral検査を外すと7 scenarioが失敗する。変異M9でseam経由のTOCTOUを復活させると1 scenarioが失敗する |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 拒否理由が受理集合の実値を示す既存の形を保つ必要がある | `inspectBaseBranchAcceptance`の診断経路を変えず、受理集合の算出だけを狭めた。`SCN-UNIT-BASEBRANCH-003`が既存の診断を固定し続ける |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないCLIであり、出力はJSONだけである | `projectKind`が`cli` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たず、色・間隔・typographyの決定を含まない | `capabilities.designTokens`が`not-applicable` |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | `refs/remotes/origin/main~1^{commit}`が`4ca43dba`、`refs/remotes/origin/main^{commit}`が`28b7ebf6`で**別のcommitである**ことを実測した。この差が迂回の実体である |
| 価値 | 利用者・運用上の目的を満たすか | pass | #1179 が守ろうとした「baseはbranchのtipである」という束縛が、**宣言側の記法で迂回されない** |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 正規表現1本と`?.()`1行。新しい依存を足していない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 00の6節の設計と実差分が一致する。`trace:check`は`valid: true`、orphan 0件 |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | **受理してよい形を狭く列挙し、拒否すべき形を数え上げていない。** Gitのrefname規則を再実装していない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 拒否7例・受理4例をOutlineで押さえる。**受理側を押さえていないと、過剰に拒否する実装が通ってしまう** |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 判定はbranch名の字面だけを見て例外を投げない。受理集合へ含めないだけである |
| 境界値 | 空、最大、最小、重複、Unicode等 | **finding（ADV-01、Low、record-only）** | 空文字と255文字超を拒否する。**ただし非ASCIIのbranch名は拒否される。** Gitは非ASCIIを許すため、そうしたbranchを宣言したprojectはbaseにできない。5節へ記録した |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | `~`・`^`・`..`・`@{`・`:`・空白・`refs/`前置・`-`始まり・`HEAD`を拒否する。**`git rev-parse`へ渡る前に弾く** |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | **受理集合を狭める方向の変更である。** 新しい受理経路を1つも作っていない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 書き込み側に触れていない。`afterVerification`は省略時に何もしない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 8 fileのrevertで完結する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding（ADV-02、Medium、record-only）** | `isLiteralBranchName`は`acceptedBaseBranches`からのみ呼ばれる。**`pr create`・`pr merge`側は #1176 で同じ判定を再利用する前提だが、本PRではその結線を検査していない。** 5節へ記録した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| ADV-01 | Low | 非ASCIIのbranch名を拒否する。Gitは許すため、そうしたbranchを宣言したprojectはbaseにできない | `/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u` | 配布先 | **修正しない。** 「受理してよい形を狭く列挙する」設計の帰結である。**同型の要求が来た時点で語彙を広げる。** 拒否は診断付きで、黙って通らない | valid / record-only | 非ASCII branch名を長命branchにしているprojectは`--base-branch`を使えない |
| ADV-02 | Medium | `pr create`・`pr merge`側での同判定の再利用が本PRでは検査されていない | 現在`isLiteralBranchName`の呼び出し元は`acceptedBaseBranches`1箇所だけである | #1176 | **本PRでは検査しない。** #1176が同じ2関数を再利用する前提で起票済みである。**判定が割れるとworktreeを作れたのにPRを出せない状態が生まれる**ため、#1176の完了条件に含める | valid / record-only | #1176 の実装時に再利用を怠ると判定が分岐する |
| DISC-001 | Low | #1179 が「変異M9は観測不能」と記録していた（肯定的所見の裏返し） | 本PRでseamを設けてkillできた | 証跡 | 10節で訂正記録の扱いを述べる | valid / resolved | なし |
| DISC-002 | Low | `refs/heads/main`等の拒否は偶然だった | 宣言リストに無かっただけ | 検査 | **明示的に拒否し、Examplesへ含めた** | valid / resolved | なし |

**未解決のCritical / Highは0件である。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分`1c4fc38e..6600cf23`の8 file。
- 確認: 個別監査8行、AC-01〜03、肯定5観点、敵対8観点。
- 結果: blocking 0件。record-only 2件（ADV-01・ADV-02）。resolved 2件（DISC-001・DISC-002）。

### ラウンド2

- 対象: 本artifactを加えた版。
- 確認: 本artifactの記述が実観測と一致するかを全件突合する。行数、SHA、scenario件数、変異結果、`rev-parse`の実出力の5種を実コマンド出力と照合した。
- 結果: blocking 0件。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format`、`npm run test:format` | 2 | 2 | 0 | 0 | pass |
| unit・integration・e2e（runner `cucumber-js`、dialect `en`） | `npm run conformance:check`（内部で`npm test`を実行する） | 1453 | 1437 | 0 | 16 | pass |
| 型・既存一式・配布物 | `npm run lint`・`format:check`・`typecheck`・`source:check`・`trace:check`・`architecture:check`・`skills:check`・`build`・`package:check` | 9 | 9 | 0 | 0 | pass |

**上の9本を1本ずつ実行し、それぞれの終了値で合否を取った。**

**変異試験。** 2件を実施し2件ともkillした。

| ID | 変異 | 結果 | 復元後 |
|---|---|---|---|
| M10 | `isLiteralBranchName`の合成を外す | `16 scenarios (9 passed, 7 failed)` | `16 scenarios (16 passed)` |
| M9 | `worktree add`へ検査済み固定SHAでなく可変refを渡す | `1 scenario (1 failed)` | `1 scenario (1 passed)` |

**復元は複写で行い`git checkout`を使っていない。**

**M9は #1179 では生存していた。** 本PRでseamを設けたことでkillできるようになった。**「観測不能」は実装の性質ではなくtestの構造の問題だった。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/policy.ts`、`src/domain/worktree.ts` | **入る**（`files`が`dist/src/`を列挙する） | base候補からrevision syntaxが除外される。**受理集合が狭まる方向であり、正当なbranch名の受理は変わらない** |
| `docs/specs/` 3 file | **入る**（`files`が`docs/`を列挙する） | REQ-GH-004の記述と追跡が延びる |
| `test/` | 入らない | `package.json`の`files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/domain/policy.js`がrevision syntaxをbase候補から除外する。**#1179 で`--base-branch`を導入した直後であり、この記法をbaseにできていたのは本日のmain 1版分だけである。** `npm run package:check`はexit 0である。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **あり。** 本Issueの起点が外部reviewer（CodeRabbit）のPR #1180 へのinline comment 2件である。**内部reviewでは2件とも出ていない** |
| reviewerがPR author・実装commit authorと異なる | いいえ。いずれも`adachi-tatsuru`である |
| 観測したreview commentとapprovalの件数 | 起点のcomment 2件。本PRのreviewはStep 11で観測する |

**適用する例外は無い。** `.agent-skill-chain/review-exceptions.json`が持つ例外は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の1件だけであり、PR作成前の本時点では条件の判定自体ができない。

**残る事実を隠さず記録する。** implementerとreviewerが同一sessionであり、approval reviewは0件である。本artifactの`approved`は**AIによる最終裁定**であって人間の独立approvalではない。

**外部reviewが実際に効いたことが緩和である。** Major 1件（revision syntax）とMinor 1件（seam不在）はいずれも私の内部reviewで出ていない。**とりわけMinorは、私が #1179 で「観測不能」と結論した判断を覆した。**

## 10. 仕様整合性

- 判定: **updated**
- 更新した仕様: `docs/specs/02_要件/03_外部連携要件.md`（REQ-GH-004）、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md`。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **成立する。** 新規用語を追加していない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。**
- 要件・変更・SCN・テストの追跡: REQ-GH-004 → AC-GH-004 → AC-01〜03 → SCN-UNIT-BASEBRANCH-006・007、SCN-INT-WORKTREE-016。`trace:check`は`valid: true`、orphan 0件。
- `no-spec-impact`の場合の限定的根拠: 該当しない。**受理するbaseの形という観測可能な契約を変えているため要件本文を延ばした。**
- **#1179 のartifactの扱い。** `docs/reviews/130_課題1179…`は「変異M9は観測不能である」と記録している。**本PRでこれが覆った。** ただし**元の行を証拠付きに見せかけて書き換えない。** 当時その判断でreviewを通した事実は変えず、**#1165型の追補・訂正記録**として別途扱う。本PRでは`130_`を1文字も変更していない（個別監査表のpath集合がそれを示す）。
- UI・トークンの判断: いずれも`not-applicable`。2.2節のとおり。

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件。**
- Medium/Lowの記録: ADV-01（Low、record-only）、ADV-02（Medium、record-only）。DISC-001・DISC-002はresolved。
- 判定: **approved**（AIによる最終裁定。人間の独立approvalは0件であり、9節に事実として記録した）
- 新しい権限が必要な事項: **なし。** 受理集合を狭める変更である。
- 残存リスク: 4件。(1) 非ASCIIのbranch名を拒否する（ADV-01）。(2) `pr create`・`pr merge`側での同判定の再利用が未検査（ADV-02、#1176へ）。(3) base branchの内容の信頼モデル（#1176のAC-TRUST-01）。(4) `docs/reviews/`のrole authority不整合（#1047へ委譲）。
- 次に許可される操作: **Step 11（`pr create`）。** その後CIが緑になってからmergeする。
- 次回の再開地点: pushした後、CIの結果確認から。**`pr create`より後に指摘が届いた場合は同一PRへ取り込まず、follow-up Issueへ分離する**（#1177 で同一PRへ取り込んでbindingを失った）。
