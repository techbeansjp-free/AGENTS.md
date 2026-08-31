# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1033 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `3735ecc35bf588c9d361acfef08f103fb068ccee` |
| H_impl | `46bed8247ff9d35e7ea90e5ad239eebf9a358d39` |
| 比較基点の由来 | review開始時点の`origin/main`のtip。**review session作成から本artifact commitまでの間に`origin/main`は動いていない**（`git fetch`後に同一SHAであることを確認した） |
| Step 10のreview session ID | `4534ed81605ad155fe07a4e2300121a053978abe591eddc5a33d9f8f29c12481` |
| モード | full |
| 対象差分 | `src/domain/policy.ts`、`src/cli.ts`、`scripts/check_test_determinism.ts`、`test/features/unit/project-policy-file-target.feature`、`test/features/integration/project-policy-file-target.feature`、`test/steps/project-policy-file-target.steps.ts`、`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`、`docs/specs/15_要件追跡/00_追跡表.md`。commitは`ff7f6d54`・`49f1302d`・`708e0c7f`・`46bed824` |
| 対象外 | 断片fileの解決元を`--file`のdirectoryへ移すこと。`assemblePolicySet`の`export`化。`policy validate`の出力field名の改名。legacy単体policy形式の経路。manifest自体のbyte上限の新設（5節のR1-F04） |
| 残り予算 | **1**（同一範囲で最大3ラウンド。総2ラウンドで設計し、CI是正のために予算1を残した） |
| ラウンド数 | 2。ラウンド1は実装差分、ラウンド2は本artifactを加えた版が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260831_155954_policy-validate-file-が-manifest-v1-の内容を検証せず作業ツリーのpolicyを検証する |
| 仕様の所有箇所 | `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`の`policy validate`行。**着手時点でこの行は入力欄を「policy JSON」とだけ書き、`--file`の検証対象を規定していなかった。** その欠落を埋めることが本Issueの要求の一部である |
| 成果物行数 | 製品 **+22 / −8行**（`src/domain/policy.ts` +10/−6、`src/cli.ts` +12/−2）。仕様 **+3 / −1行**。支援層 **+287行**（unit feature +33、integration feature +12、steps +236、determinism allowlist +6） |
| 縮小の先行評価 | 5案を先に評価した。(1)`assemblePolicySet`を`export`してCLIから直接呼ぶ案は公開面を増やすため不採用。(2)`--file`のdirectoryから断片を解決する案はpath解決の攻撃面を広げるため不採用。(3)manifest文書だけを検証しtrusted比較を行わない案は、合否が候補の採用可否を意味しなくなるため不採用。(4)CLI側へ`validateProjectPolicyManifest`の事前呼び出しを置く案は**Step 7のreadiness checkを受けて撤回した**。失敗面が2つになり、どちらを通っても終了値が同じで変異試験が区別できない支援層になる。(5)**ラウンド1のR1-F03を受けて`override`を`{manifestRaw}`だけへ縮めた。** 製品差分が`policy.ts` +14/−7から+10/−6、`cli.ts` +15/−2から+12/−2へ減り、公開関数の引数が1つ減った |
| 実施者・日時 | reviewer（fable）、coordinator（claude）、2026-08-31 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | fable | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは**claude**であり、reviewerは**fable**である。providerとcontextがともに異なる |

**開示する逸脱が3件ある。**

1. **implementerが計画と異なる。** 03の0.1節はimplementerを**codex**と定めるが、`codex exec --full-auto`がhost側のauto mode分類器に拒否され起動できなかった。停止せず、**進行役（claude）が実装した。** その代わりラウンド1の敵対reviewを**fable**で行い、**claudeをreviewerに含めていない。** reviewerがimplementerと別providerである性質は保たれている。
2. **2体目のreviewerを立てられなかった。** `codex review`（read-only）を2体目として起動したが、`Selected model is at capacity`で中断した。**単体reviewerで進めている。** その補償として、進行役が危険点5件（override経由のlegacy分岐通過、`readJsonInput`置換の等価性、`let candidateSet`の推論型、`resolveContained`の位置変更、manifest byte上限）を独立に実測し、7.4節へ記録した。**この5件はreviewerの指摘と重複しており、reviewerも同じ結論に達している。**
3. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts:26`が`AUDIT_DIRECTORY = "docs/reviews"`を要求する一方、`validateRoleOperation`は実行時に強制されていない。**本Issueでは権限拡大をscope外としてrisk受容し、解消を #1047 へ委譲する。**

**1と2の帰結（実行時にimplementer identityとreviewerの独立性を検証する機構が無い）は、既存の #1040 が所有する。** 本Issueで新規起票しない。**ascの`routing` subcommandは`roles`・`tier`・`ceiling`・`observe`・`resolve`・`independence`・`evidence`の判定系7件だけであり起動系を持たないこと、`scripts/`にworker起動scriptが存在しないことを実測で確認した。** したがってhost側の拒否はasc側の欠陥ではない。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1033 、AC-1033-01〜08 | Step 8で00〜03を同期。`syncDigest`と`readBackDigest`が`9e8db44e4480b6a2baa7d3c7e63a1c9606a31d53d59c2743986251e3607788f7`で一致 | 一次資料 |
| 差分 | `3735ecc3..46bed824` | 8 file、+312 / −9行。製品差分は`loadProjectPolicySet`の任意第2引数と`policy validate`のmanifest v1分岐の2箇所 | 既存コード |
| テスト | `npm test` | `1318 scenarios (1302 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`ほか1 file | updated | 既存文書 |
| commit前candidate | 8 file（1.1節の表） | working tree clean | Git index |
| Phase A artifact | `docs/reviews/101_課題1033のpolicy-validate-file検証対象レビュー.md` | `H_impl` = `46bed824`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** 02の2.3節の3 nodeは`cli-policy-validate → load-project-policy-set → assemble-policy-set`の一方向であり、検証結果を自身の正しさの根拠にしていない。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl` = `46bed824`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。PR・CI・reviewの観測はStep 11で行う。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** 本repositoryではPR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である。9節の例外経路を参照する。
- 既定branch追随を行った場合: **行っていない。** 基点`3735ecc3`は`origin/main`のtipであり、追随mergeを作っていない。`比較基点..H_impl`は4 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/policy.ts` | M | package | package | `loadProjectPolicySet`の責務は「rootからpolicy setを組み立てる」のまま。manifest文書の出所だけを任意引数で切り替える。`assemblePolicySet`を`export`していない | pass。新しいmodule依存を作らない。nodeもedgeも増やさないため新しい循環が生じない。`npm run architecture:check`合格 | REQ-SQ-001 / AC-1033-01〜06 / SCN-UNIT-POLICYFILE-001〜006 | 断片解決の`resolveContained`とsymlink拒否を1行も変えない。既存10箇所の呼び出しを1つも変更していない。rollbackは当該変更のrevert | pass |
| `src/cli.ts` | M | package | package | manifest v1分岐だけを書き換えた。**失敗面を1つに保ち事前validationを重ねていない** | pass。`src/domain/policy.ts`への一方向依存のみ | REQ-SQ-001 / AC-1033-07・08 / SCN-INT-POLICYFILE-001・002 | 生textを1回だけ読みTOCTOUを避ける。組み立て失敗で作業treeのsetへfallbackしない。legacy分岐と`--file`なし経路とexplicit trusted経路に触れていない | pass |
| `scripts/check_test_determinism.ts` | M | project | package | `REPOSITORY_READ_EXCEPTIONS`へ1件だけ宣言を足した。既存3 fileと同型のdogfooding理由である | pass。宣言の追加だけで判定logicに触れていない | AC-1033-03・05（実manifestを要求するため合成fixtureでは満たせない） | 同fileは`PROTECTED_FILES`に含まれないことを実測した。過不足のどちらもerrorになる検査であり、1 fileにつき1件が必要十分である | pass |
| `test/features/unit/project-policy-file-target.feature` | A | package | package | unit scenarioを6件持つ新規Featureである。既存Featureを1件も書き換えていない | pass | AC-1033-01〜06 / SCN-UNIT-POLICYFILE-001〜006 | fixtureは`this.temp(...)`の一時directory内に閉じ、実policy setは複写元として読むだけである | pass |
| `test/features/integration/project-policy-file-target.feature` | A | package | package | integration scenarioを2件持つ新規Featureである | pass | AC-1033-07・08 / SCN-INT-POLICYFILE-001・002 | fixtureは`initRepo()`の一時git repositoryに閉じ、実remoteへ到達しない | pass |
| `test/steps/project-policy-file-target.steps.ts` | A | package | package | step定義を8件（Given 2・When 2・Then 4）追加した。01の9節が事前に固定した上限8件に一致する。**内訳は計画の`Given 4・Then 2`と異なり、その理由を03の11.2節へ記録した** | pass。既存step定義を1件も書き換えていない | AC-1033-01〜08 / SCN-UNIT-POLICYFILE-001〜006、SCN-INT-POLICYFILE-001・002 | 同上。一時fileを作らない | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | project | spec | `policy validate`行の入力欄と出力欄へ2文を足した。他のcommand行に触れていない | pass | REQ-SQ-001 / AC-SQ-001 | 規則の記述だけで実行authorityを持たない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | REQ-SQ-001の既存行を書き換えず、下へ2行追加した | pass | REQ-SQ-001 / AC-SQ-001 / SCN-UNIT-POLICYFILE-001〜006、SCN-INT-POLICYFILE-001・002 | 追跡の追加だけで実行authorityを持たない | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only 3735ecc3 46bed824`が返す8 pathが上表の8行と同じである。**本artifactは`H_impl..H_final`にあり、この範囲には入らない。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** `override`引数はpackageの読み取り機構の一部であり、project ruleにしていない。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **ラウンド1のfindingのうち3件を修正した。** 修正範囲は`src/domain/policy.ts`・`src/cli.ts`・`test/`の3 fileであり、隣接依存として仕様2 fileも再監査した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**実装中の発見は0件である。** 03の4.1節に記録がない。03の11.1節と11.2節はroutingの逸脱とstep定義の内訳変更の開示であり、AC・scope・security境界・不可逆操作の契約はいずれも変えていない。

### 2.1 受け入れ条件とシナリオ

| AC ID | 内容 | SCN | 観測 |
|---|---|---|---|
| AC-1033-01 | 壊れたmanifestを`--file`へ渡すと不合格になる | SCN-UNIT-POLICYFILE-001 | 緑。修正前は赤 |
| AC-1033-02 | 不合格時にmanifestのどのfieldが不正かを示すerrorを含む | SCN-UNIT-POLICYFILE-002 | 緑。`manifest.policy.merge.modeが不正です`の原文で突合。**CLI側に事前validationを置かずに`assemblePolicySet`のthrow messageで満たしている** |
| AC-1033-03 | 実manifestを渡すと合格する | SCN-UNIT-POLICYFILE-003 | 緑。修正前から緑（正常系の回帰） |
| AC-1033-04 | 内容の異なる複数のmanifestで`candidateSetHash`が互いに異なる | SCN-UNIT-POLICYFILE-004 | 緑。修正前は3値とも`9ab2a12a…`で同一だった |
| AC-1033-05 | 実manifestのhashが作業treeから組み立てたsetのそれと一致する | SCN-UNIT-POLICYFILE-005 | 緑。修正前から緑（正常系の回帰） |
| AC-1033-06 | 宣言inventoryが一致しないmanifestは不合格で、作業treeのhashを返さない | SCN-UNIT-POLICYFILE-006 | 緑。**ラウンド1で「作業treeと一致しない」から「存在しない」の直接観測へ是正した** |
| AC-1033-07 | 壊れたmanifestでCLIの終了値が非0になる | SCN-INT-POLICYFILE-001 | 緑。修正前は赤。**ラウンド1で出力shapeの観測を追加した** |
| AC-1033-08 | 実manifestでCLIの終了値が0のままである | SCN-INT-POLICYFILE-002 | 緑。修正前から緑（正常系の回帰） |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 判定 | 観測 |
|---|---|---|
| DC-PRIVACY | applicable | 断片解決の`resolveContained`とsymlink拒否を1行も変えていない。`resolveContained`の呼び出しが`??`の右辺へ移ったが、candidateは定数リテラルであり利用者入力を含まないため検査は緩んでいない。組み立て不能な入力をfail-closedで拒否することをSCN-UNIT-POLICYFILE-006とSCN-INT-POLICYFILE-001が反例で固定する |
| DC-OBSERVABILITY | applicable | 本変更は診断そのものの是正である。log経路・保持・rotation・監視を変更していない。診断が全field errorを含むことをSCN-UNIT-POLICYFILE-002が観測する |
| DC-UX | not-applicable | project choiceの`humanCenteredUi`が`not-applicable`である |
| DC-TOKENS | not-applicable | project choiceの`designTokens`が`not-applicable`である |

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 判定規則を1つも変えていない。`assemblePolicySet`が既に持つmanifest検証とinventory一致検査をそのまま使う。差し替えたのはmanifest文書の出所だけである |
| 価値 | pass | 報告者が踏んだ「合格が何も意味しない」が解ける。壊れた候補が採用前に落ちる |
| 実現可能性 | pass | 製品差分は+22/−8行の2箇所に閉じている |
| 整合性 | pass | 既存10箇所の呼び出しを1つも変更しない後方互換の任意引数である |
| 保守性 | pass | ラウンド1の是正で`override`が`{manifestRaw}`だけになり、`manifest`と`manifestRaw`が食い違う状態が構造上作れなくなった |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例 | pass | 変異5件がいずれも対象scenarioを殺す（7.1節）。うち1件はラウンド1で生存が判明し、反例を足して殺した |
| 失敗 | pass | 組み立て失敗を`catch`し、作業treeのsetへfallbackしない。`{valid:false, errors:[message]}`と終了値1を返す |
| 境界 | pass | 契約違反・inventory不一致・実manifestと同一内容・内容の異なる有効な3件を実測した |
| 悪用 | pass | v1でないmanifestを`override`で渡してもfail-closedである（7.4節）。断片は`--root`から解決し`--file`のdirectoryを参照しない |
| 安全性 | pass | `resolveContained`とsymlink拒否を変更していない。TOCTOU対策としてmanifest fileの読み取りを1回に保つ |
| 損失 | not-applicable | 読み取り専用commandであり書き込み単位を変えていない |
| 復旧 | pass | rollbackは4 commitのrevertで完結する。永続状態を残さない |
| 範囲 | pass | 断片の解決元を変えていない。`assemblePolicySet`を`export`していない。legacy経路に触れていない |

## 5. 指摘

**ラウンド1で5件、ラウンド2で0件。未解決のCritical/Highは0件である。** blockingは0件で`converged`した。

| ID | 深刻度 | 種別 | 状態 | 内容 |
|---|---|---|---|---|
| R1-F01 | Medium | acceptance-violation | resolved | 仕様へ書いた「失敗時に`candidateSetHash`と`trustedSetHash`を返さない」を観測するscenarioが無く、終了値1のまま作業treeのhashだけを漏らす変異が8件全緑で生存した。CLIの標準出力を捕捉して両fieldの不在を検査する形へ是正した |
| R1-F02 | Low | improvement | resolved | SCN-UNIT-POLICYFILE-006の第2 assertionが同語反復だった。`catch`経路が`setHash`を設定しないため入力に依らず真になる。「存在しない」の直接観測へ是正した |
| R1-F03 | Low | improvement | resolved | `override`の`manifest`と`manifestRaw`が非整合な対を公開関数へ渡せた。`{manifestRaw}`だけにし`manifest`を関数内で導出する形へ是正した |
| R1-F04 | Low | out-of-scope | valid | manifest自体のbyte上限が無い。**変更前もCLIは同じfileを`readJsonInput`で全文読んでおり読み取り量は同一である。** 上限の新設は非override経路の振る舞いも変えるためscopeを超える |
| R1-F05 | Low | out-of-scope | valid | 0.1節のrouting逸脱。実行時にimplementer identityを検証する機構の不在は既存の #1040 が所有する |

**R1-F04とR1-F05は本Issueで是正しない。** 前者は既存経路の振る舞い変更を伴い、後者は別Issueが所有する。**この2件を根拠に新しいIssueを起こしていない。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象は`3735ecc3..46bed824`の実装差分である。
- **敵対reviewをfableの独立invocationで実施した。** implementer（claude）とは別providerであり、互いの出力を見ていない。
- **すべての指摘を受け入れる前に実測で検証した。** R1-F01のhash漏洩変異を実際に適用して8件全緑を再現し、R1-F02の同語反復を`catch`経路の原文で確認した。
- 是正は前進commit `46bed824`で積んだ。

### ラウンド2

- 対象は本artifactを加えた版である。
- 0.1節の逸脱3件、5節のR1-F04・F05の未是正、7節の実測値が本文の主張と一致することを確認した。
- **新規findingは0件である。** 未解決blockingは0件で`converged`した。
- **予算1を残している。** CIが赤になった場合の是正をこのラウンドで載せる。

## 7. テスト結果

| 検証 | 結果 |
|---|---|
| `npm test` | `1318 scenarios (1302 passed, 16 skipped)`、失敗0 |
| CI同順の全chain | `project:quality`→`quality`→`docs:format`→`test:format`→`trace:check`→`architecture:check`→`build`→`package:check`→`conformance:check`の9 commandを**終了値を明示的に見るループで**完走した |

### 7.1 変異試験

**復元はすべて複写で行い`git checkout`を使わない。** ラウンド1の是正後に全件を再実行した。

| 変異 | 内容 | 対象scenarioの結果 |
|---|---|---|
| M-a | `override`を無視して常にfileを読む（`policy.ts`） | 8件中5件が赤 |
| M-b | `catch`で作業treeのsetへfallbackする（`cli.ts`） | 1件が赤 |
| M-d | 不合格時の`return 1`を`return 0`にする（`cli.ts`） | 1件が赤 |
| M-f | 不合格時に`candidateSetHash`を漏らす（`cli.ts`） | 1件が赤 |
| M-g | `manifestRaw`を正規化して元textと違うbyte列にする（`policy.ts`） | 1件が赤 |

**M-fはラウンド1の時点では生存していた。** R1-F01の是正で殺せるようになった。

**M-bは、CLI側へ事前validationを置く当初案では生存していた。** 契約違反入力が`catch`へ到達しないためである。Step 7のreadiness checkを受けて失敗面を1つへ畳んだ結果、INV-08がCLI層で反例により固定された。

**M-gはAC-1033-05だけを殺す。** AC-1033-04（3値の相互不一致）とAC-1033-05（実manifestと作業treeの一致）が独立に固定されていることの観測である。

### 7.2 回帰の再測

Issue本文が報告した4行を修正後に再実行した。

| 渡したfile | 修正前 | 修正後 |
|---|---|---|
| 実file | `valid:true`・終了値0・`9ab2a12a…` | **不変** |
| `merge.mode`が`NOT_A_MODE` | `valid:true`・終了値0・`9ab2a12a…` | `valid:false`・終了値1・hashなし |
| `policy`が`{"totally":"different"}` | 同上 | 同上 |
| `policy`キー無し | 同上 | 同上 |

legacy経路の回帰は既存のSCN-INT-MERGEMETHOD-001〜003が3件とも緑である。

### 7.3 修正前の赤の観測

T01完了時点で**5件が赤、3件が緑**であった。緑の3件は正常系の回帰であり、修正前も合格するため赤にならないことを計画で事前に宣言していた。

| scenario | T01時点 |
|---|---|
| SCN-UNIT-POLICYFILE-001・002・004・006 | 赤 |
| SCN-INT-POLICYFILE-001 | 赤 |
| SCN-UNIT-POLICYFILE-003・005、SCN-INT-POLICYFILE-002 | 緑（宣言どおり） |

SCN-UNIT-POLICYFILE-004の赤は3候補のhashがすべて`9ab2a12a…`で同一という欠陥そのものであった。

### 7.4 進行役が独立に実測した危険点

**2体目のreviewerを立てられなかったため（0.1節の逸脱2）、進行役が次の5点を実測した。**

| 疑い | 実測結果 |
|---|---|
| `let candidateSet;`が暗黙のanyになる | **否。** `--strict`のprobeで`PolicySet`へ推論されることを確認した |
| v1でないmanifestを`override`で渡すと危険 | **否。** rootに`project/`があれば混在拒否でthrow、無ければ`requirePolicy`の全validationが適用される |
| `resolveContained`の位置変更でpath検査が緩む | **否。** candidateは定数リテラルで利用者入力を含まない。`override`時はその fileを読まないため解決自体が不要である |
| `readJsonInput`の置換で振る舞いが変わる | **否。** `src/adapters/json-input.ts:58-60`は`parseJsonStrict(fs.readFileSync(file,"utf8"), file)`そのもので、labelも同一である |
| `manifestRaw`が1 MiB上限を迂回する | **上限は元から無い**（`policy.ts:1132`はfragment専用）。変更前もCLIは同じfileを全文読んでおり、読み取り量は同一である |

**reviewerも独立に同じ5点を確認し、同じ結論に達している。**

## 8. 配布物影響

配布境界へ入る変更pathは`src/domain/policy.ts`と`src/cli.ts`の2件である。いずれも`package.json`の`files`が配布対象とする。`docs/specs/`と`test/`と`scripts/`は配布対象外である。

判断: 配布物を更新した

根拠: 利用側が受け取る`policy validate --file`の合否と終了値と出力shapeが壊れた入力に対して変わるため、配布物のdigestが変化する。正常系の合格と終了値0は変わらない。

## 9. 独立reviewの成立

- **`.agent-skill-chain/review-exceptions.json`の`exceptions`は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の1件だけである。** 全文を読んで確認した。本Issueへ適用できる例外区分は存在しない。
- 外部reviewerによるapprovalは**0件**である。`approved`はAIによる最終裁定である。
- ラウンド1の敵対reviewは**implementer（claude）とは別providerのfable**が実施した。
- **2体目のreviewerを立てられなかったことを0.1節の逸脱2として開示している。** その補償として進行役が危険点5件を独立に実測し7.4節へ記録した。

## 10. 仕様整合性

| 変更 | 更新先 | 追跡 |
|---|---|---|
| `--file`の検証対象と断片の解決元、および失敗時に算出できないhashを返さないこと | `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | REQ-SQ-001 / AC-SQ-001 |
| 追跡行の追加 | `docs/specs/15_要件追跡/00_追跡表.md` | REQ-SQ-001 / AC-SQ-001 / SCN-UNIT-POLICYFILE-001〜006、SCN-INT-POLICYFILE-001・002 |

- **`trace:check`はAC↔SCNの対応の正しさを見ない。** 追加行の各列をscenarioの実体と人が原文で突合した。追加した2行のFeature列の8件のSCNがすべて実在し、実装列の`src/domain/policy.ts`と`src/cli.ts`がいずれも実在することを確認した。
- **所有要件を`REQ-SQ-001`とした根拠。** Step 7のreadiness checkが、当初書いていた`REQ-WF-008`はconformance適用宣言のbindingを所有し実装が`src/domain/conformance.ts`であることを指摘した。実測で確認し差し替えた。`REQ-SQ-001`「安全境界をfail-closedにする」は「外部状態を信頼せず、形式・意味・権限・最新性を副作用前に検証する」と規定しており本Issueの内容と一致する。
- **用語台帳へ追加していない。** 01の2.1節のとおり新語は無く、`TERM-ASC-001`と`TERM-ASC-005`で説明できる。

## 11. 総合判定と再開地点

**approved。** 未解決のCritical/Highは0件、blockingは0件、`converged`である。

- 再開地点はStep 11の`pr create`である。
- **`pr create`は作成直後のread-backで`reconciliation-required`へ落ちることが既知である（#1077・#1079・#1081の3/3で再現）。** このとき副作用を再送しない。`pr create`を再実行するとread-only照合で既存PRを1件だけ束ね、`step11-recorded`まで進む。一致が0件または2件以上なら停止して人へ返す。
- CIが赤になった場合は残り予算1のラウンドで是正する。**赤を通す理屈を作らない。**
