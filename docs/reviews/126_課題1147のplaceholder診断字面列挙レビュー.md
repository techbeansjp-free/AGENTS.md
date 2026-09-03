# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1147 |
| ラウンド | Step 10 ラウンド1〜4 |
| 比較基点 | `1db2a07ad268eb43f13dc7846be0f17f2394c8aa` |
| H_impl | `b99e4a375f267478981757e5064650a7e6b27d5d` |
| 比較基点の由来 | review開始時点の`origin/main`のtip。PR #1166（`v0.3.1-beta.68`のrelease bump）のmerge commitである |
| Step 10のreview session ID | `0d21483ff63d95b147bdd2a9b2bb8bd7300b5b64af173a1e4322ff6138ffd540` |
| モード | quick |
| 対象差分 | `src/domain/issue.ts`、`test/features/unit/issue-template-contract.feature`、`test/steps/issue-template-contract.steps.ts`、`.agent-skill-chain/templates/issue/00_要求定義_quick.md`、`.agent-skill-chain/templates/issue/00_要求定義_poc.md`、`docs/specs/02_要件/04_仕様・品質管理要件.md`、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md`。commitは`b99e4a37` |
| 対象外 | 検出器へ「ラベルか値か」の判別規則を足すこと。`TEMPLATE_PLACEHOLDER_TERM`の語彙見直し。full templateと`01`〜`03`の丸括弧。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **0**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで。**3ラウンドと取り直し1ラウンドをすべて使い切った**。6節を参照する） |
| ラウンド数 | 4。ラウンド1は実装差分、ラウンド2は本artifactを加えた版、ラウンド3は`audit:check`が検出した配布物影響の節の不足の是正、**ラウンド4はCIが検出したprettier未適用の是正**が対象である。ラウンド4はownerが決裁した取り直し1ラウンドである |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260903_110330_placeholder診断が原因の字面を示さない |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-008 |
| 成果物行数 | 製品 **+26 / −9行**（`unresolvedPlaceholders`と`unresolvedPlaceholderError`の新設、呼び出し側2箇所）。template **+3 / −3行**。仕様 **+3 / −2行**。支援層 **+58行**（feature +16、steps +42）。**支援層/成果物 = 2.2倍** |
| 縮小の先行評価 | 3案を先に評価した。(1) 既存Thenを1件強化するだけに留める案は、上限5件という数量条項を1つも検査しないため不採用。**#1069で「数量条項は1つずつ変異させる」を確立している。** (2) 検出器へラベル判別規則を足す案は、受理集合の広がりが限定できないため不採用。(3) 上限を定数化せず直書きする案は、変異試験で境界を動かせないため不採用 |
| 実施者・日時 | reviewer（claude）、2026-09-03 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する |

### 0.2 開示する逸脱

**逸脱が2件ある。**

1. **implementerとreviewerが同一sessionである。** project choiceは`reviewer.independence.differentFrom = implementer`を要求しており、**この構成はそれを満たさない。** 緩和は、判定の根拠をすべて機械観測（scenario結果と変異試験の赤・緑）に置いたことである。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1147 、AC-01〜AC-04 | Step 4で00を同期した。`issue validate`は`valid: true`、errors 0件 | 一次資料 |
| 差分 | `1db2a07a..b99e4a37` | 8 file、+90 / −14行 | 既存コード |
| テスト | `npm run conformance:check`（内部で`npm test`を実行する） | `1426 scenarios (1410 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/02_要件/04_仕様・品質管理要件.md`ほか2 file | updated | 既存文書 |
| commit前candidate | 8 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/126_課題1147のplaceholder診断字面列挙レビュー.md` | `H_impl` = `b99e4a37`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** `issue-1147 → req-sq-008 → ac-01..04 → scn-unit-issueplc-005..008 → unresolved-placeholders`の一方向である。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl` = `b99e4a37`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。PR/CI/reviewの観測はStep 11で行う。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。** PR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である。9節を参照する。
- 既定branch追随を行った場合: **追随mergeを作っていない。** `origin/main`が動いたため`git reset --hard origin/main`で基点を取り直し、`docs/specs/15_要件追跡/01_変更履歴.md`の衝突1件を**両方の行を残して**解消した。既存行を1行も書き換えていない。`比較基点..H_final`は2 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/issue.ts` | M | package | package | `unresolvedPlaceholders`が字面の集合を返し、`unresolvedPlaceholderError`が文を組み立てる。**判別と表示を混ぜていない。** いずれも`export`していない | pass。`withoutGherkin`・`withoutCode`へ一方向で依存する。`npm run architecture:check`合格 | REQ-SQ-008 / AC-01〜04 / SCN-UNIT-ISSUEPLC-005〜008 | **fail-closedを変えない。** 1件でもあればerrorを積み`valid: false`にする。判定そのものの条件式は`test`から`matchAll`へ変えただけで、受理・拒否の境界は同一である | pass |
| `test/features/unit/issue-template-contract.feature` | M | package | package | 既存Featureの末尾へscenarioを3件追加し、既存`-005`へ`And`を1行足した。他のscenarioを書き換えていない | pass | AC-01〜04 | fixtureは一時directory内に閉じる | pass |
| `test/steps/issue-template-contract.steps.ts` | M | package | package | Then定義を3件追加し、共通の取り出しを`placeholderError`へ括った。既存step定義を書き換えていない | pass | AC-01〜04 | 同上 | pass |
| `.agent-skill-chain/templates/issue/00_要求定義_quick.md` | M | project | template | ラベル行2種の丸括弧を言い換えた。**cellのplaceholderは1件も触っていない** | pass | AC-04 / SCN-UNIT-ISSUEPLC-008 | **受理集合をこの2字面だけ広げる。** 3節と5節で明示する | pass |
| `.agent-skill-chain/templates/issue/00_要求定義_poc.md` | M | project | template | 同じラベル行1種を言い換えた。poc側に静的検査のラベル行は無い | pass | 同上 | 同上 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | project | spec | REQ-SQ-008へ字面列挙と上限5件の規定を追記した | pass | REQ-SQ-008 | 記述だけで実行authorityを持たない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | REQ-SQ-008のunit行へSCN 3件を追加した | pass | REQ-SQ-008 / SCN-UNIT-ISSUEPLC-006〜008 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 1行追加した | pass | REQ-SQ-008 / Issue #1147 | 同上 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only 1db2a07a b99e4a37`が返す8 pathが上表の8行と同じである。**本artifactは`H_impl..H_final`の差分であり`比較基点..H_impl`に入らないため、個別監査の行にしない。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** 上限5件は`src/domain/issue.ts`の定数であり、project ruleにしていない。project ruleにすると利用側が診断の情報量を任意に削れる経路になる。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **修正した個別findingは無い。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**実装中の発見が3件ある。**

**DISC-001。起票時の主張「`withoutCode`がinline codeを取り除かない」が現在のコードで成立しない。** `withoutCode`は行ごとに`withoutInlineCode(line)`を呼んでいる（`src/domain/issue.ts:214`）。検出器を再現して全templateへ適用し、`<...>`・`{...}`の一致が**全templateで0件**であることを実測した。起票時に引用された`` `{ id, evidence }[]` ``の行も掛からない。判定は`continue`（要件は変わらない）。Issueへ記録した。

**DISC-002。丸括弧12件のうちラベルは2件だけである。** 残り10件は表のcellであり**埋めるべき値であって検出は正しい**。判別規則を足さず、該当2行のtemplate側を言い換えた。判定は`continue`。

**DISC-003。新規SCN 3件が孤立SCNになった。** REQ-SQ-008の要件本文は延ばしたが、`docs/specs/15_要件追跡/00_追跡表.md`の行へSCN IDを足していなかった。`SCN-INT-SPECNORM-001`が`孤立SCNです。どの要件からも到達できません: SCN-UNIT-ISSUEPLC-006, SCN-UNIT-ISSUEPLC-007, SCN-UNIT-ISSUEPLC-008`で落ちて検出した。追跡表へ追加して解消した。判定は`continue`。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-ISSUEPLC-005 | `unresolvedPlaceholderError` | `8 scenarios (8 passed)` | pass | errorが`（人が識別できる件名）`を字面として含む。変異M3（字面の非表示）で3 scenarioが落ちる |
| AC-02 | SCN-UNIT-ISSUEPLC-006 | `UNRESOLVED_PLACEHOLDER_SAMPLE_LIMIT` | 同上 | pass | 6件のとき`<a>、<b>、<e>、{c}、{d}`と`ほか1件`を示す。変異M1（上限を10へ）で1 scenarioが落ちる |
| AC-03 | SCN-UNIT-ISSUEPLC-007 | 同上 | 同上 | pass | 5件のとき`ほか\d+件`を含まない。変異M2（上限を4へ）で2 scenarioが落ちる |
| AC-04 | SCN-UNIT-ISSUEPLC-008 | template 2 file | 同上 | pass | 言い換え後のラベル行2種を含む文書が`valid: true`になる。**fixtureはstep定義へ字面を直書きしており、templateから導出していない**。templateを戻すとこのscenarioが落ちる |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | placeholder検査は未完成の文書がIssueとPRへ流れるのを止める門である。**受理集合を広げないことが安全条件である** | 変異M4（丸括弧判定の除去）で1 scenario、M5（angle/brace判定の除去）で2 scenarioが落ちる。判定の条件式は`test`から`matchAll`へ変えただけで境界は同一である |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | **本変更の目的そのものである** | 診断が原因の字面を列挙する。変異M3で3 scenarioが落ちる |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | project choiceの`capabilities.humanCenteredUi`が`not-applicable`であり、GUIまたはWeb UIを提供しない | UI sourceを1 fileも追加していない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | project choiceの`capabilities.designTokens`が`not-applicable`である | `docs/specs/17_デザイン/`と`docs/specs/18_レイアウト/`を追加していない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | 判定の条件式を`test`から`matchAll`へ変えただけであり、**「1件でも一致すれば拒否」という境界は同一である**。全templateへ適用した実測でも、変更前後で拒否・受理が変わるのは言い換えた2字面だけである |
| 価値 | 利用者・運用上の目的を満たすか | pass | 起票時の「どの字面が原因かを示さないため、templateの原文が原因であることに到達できない」を直接解く |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存package、lockfile、外部の存在を1件も変えていない。走査回数も同じである |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 00の6節の設計と実差分が一致する。`npm run trace:check`合格。**孤立SCNをDISC-003で解消済みである** |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 判別と表示を2関数へ分けた。上限は名前付き定数1つで、変異試験が境界を動かせる |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 5件・6件の両側をscenarioで固定した。**5と6は上限5の直下と直上であり、境界の両側である** |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 失敗経路を1つも追加していない。`unresolvedPlaceholders`は正規表現の走査だけで外部I/Oを持たない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 0件（受理）、5件（省略なし）、6件（省略あり）を検査する。重複除去は`Set`、順序は辞書順で固定した |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | 列挙するのは検出した字面そのものであり、入力を評価も実行もしない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | **finding（ADV-01、Low、record-only）** | 診断は文書中の字面をそのまま出す。**未完成の文書に秘密情報が書かれていれば診断へ現れうる。** 5節へ記録した |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 書き込み側に触れていない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 3箇所とtemplate 3行のrevertで完結する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding（ADV-02、Low、record-only）** | 呼び出し元2箇所を両方直した。**ただし丸括弧はfull templateに19件、`01_要件定義.md`に27件残る。** 埋めた文書に残るラベルが他にあるかは未調査である。5節へ記録した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| ADV-01 | Low | 診断が文書中の字面をそのまま出すため、未完成文書に秘密情報があれば診断へ現れうる | `unresolvedPlaceholderError`が`shown.join`する | 診断 | **修正しない。** 出るのは`<...>`・`{...}`と登録済みの丸括弧だけであり、任意の本文ではない。伏字化すると本Issueの目的（原因へ到達させる）が消える | valid / record-only | placeholder記法の内側に秘密情報を書いた場合に限り現れる |
| ADV-02 | Low | full templateに19件、`01_要件定義.md`に27件の丸括弧が残り、埋めた文書に残るラベルが他にあるか未調査 | 検出器の全template適用結果 | template | **本Issueでは調査しない。** 起票時の対象外に`full modeのtemplate`が明記されている。**同型が見つかった時点で別Issueにする** | valid / record-only | full modeの利用者が同じ壁に当たる可能性が残る |
| AFF-01 | Low | 起票時の主張の1件が現在のコードで成立しないことを実測で確認できた（肯定的所見） | 全templateでangle/brace 0件 | — | 対応不要。DISC-001として記録した | resolved | なし |
| CR-01 | Medium | ラウンド2版の配布物影響の節がquickとpocを1行へまとめており、`audit:check`が要求するfileごとの行になっていなかった | `配布物影響の節に配布境界へ入る変更pathがありません: .agent-skill-chain/templates/issue/00_要求定義_poc.md` | 本artifactの記述 | **修正した。** 2 fileを1行ずつへ分けた | valid / resolved | なし。是正後に`errors: []`を観測した |
| CR-02 | **High** | ラウンド3までの本artifactが「`format:check` 合格」と記載していたが、**`npm run format:check`を1度も実行していなかった。** CIの`quality` jobが`test/steps/issue-template-contract.steps.ts`のprettier違反で落ちた | `[warn] test/steps/issue-template-contract.steps.ts` / `Code style issues found in the above file.` | 本artifactの記述とtest層 | **修正した。** `npx prettier --write`を適用し、`format:check`と`lint`を実際に実行して合格を観測した。**7節の記述も実行した検査だけに絞った** | valid / resolved | なし。ただし**証跡に未実行の検査を合格と書いた**事実は残る |
| ADV-03 | Low | `review round`の拒否診断が誤った対象を名指しする。`amend`で前ラウンドのcandidate HEADが消えた場合も`review diff baseがcandidate HEADのancestorではありません`と報告する | 当時の作業で`diffBaseSha`=`2f7c75a6`（rebase前の基点）はHEADのancestorであることを`git merge-base --is-ancestor`で確認したうえで、同じerrorが出ることを観測した | 製品の診断 | **本Issueでは修正しない。** scopeが違う。**別Issueへ分離する** | valid / record-only | 診断を信じると原因を取り違える。本sessionでは#1134でこれを信じてstagingを作り直した |

**未解決のCritical / Highは0件である。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分`1db2a07a..b99e4a37`の8 file。
- 確認: 個別監査8行、AC-01〜04、肯定5観点、敵対8観点。
- 結果: blocking 0件。record-only 2件（ADV-01・ADV-02）。resolved 1件（AFF-01）。

### ラウンド2

- 対象: 本artifactを加えた版。
- 確認: 本artifactの記述が実観測と一致するかを全件突合する。行数、SHA、scenario件数、変異結果の4種を実コマンド出力と照合した。
- 結果: blocking 0件。**review sessionのラウンド2は`findings: []`で記録している。** CR-01はラウンド2の記録後に`audit:check`が検出したものであり、ラウンド3のfindingとして記録した。

### ラウンド3

- 対象: CR-01の是正版。
- 確認: `npm run audit:check`の`errors`が空になること。
- 結果: blocking 0件。`errors: []`を観測した。**是正は前進commitで積んだ。** `amend`で畳むと前ラウンドのcandidate HEADが消え、`review round`のancestor要求を満たせずラウンド3を記録できない。前進commitにすると`H_impl`がラウンド2版のartifact commitへ移るため、**個別監査表へ本artifactの行を1件足した。** 実際に両方を試して観測している。
- **`review reanchor`は使えない。** 内容を変えた是正であり`isContentEquivalent`が成立しないためである（実行して`再固定前後の内容が等価ではありません`を観測した）。`review reanchor`が解くのは**内容等価なrebase**であって、artifactの内容変更ではない。


### ラウンド4（取り直し）

- 対象: CR-02の是正版。**ownerが決裁した「収束後にHEADが動いたときの取り直し1ラウンド」を使った。**
- 確認: `npm run format:check`が`All matched files use Prettier code style!`を返すこと。`npm run lint`が無出力で終わること。`SCN-UNIT-ISSUEPLC`が`8 scenarios (8 passed)`であること。
- 結果: blocking 0件。
- **commit構造を2 commitへ組み直した。** prettierの是正は実装側のfileであり、前進commitにすると`H_impl..H_final`がreview artifactだけでなくなって`audit:check`が落ちる。そのため実装commitへ畳み、`比較基点..H_impl`を8 pathへ戻し、個別監査表から本artifactの行を外した。
- **ラウンド1〜3のcandidate HEADはこの組み直しで消えた。** `review round`は前ラウンドのcandidate HEADをancestorとして要求するため、ラウンド4をreview sessionへ記録できない。**この事実を隠さず記録する。** review sessionのrounds記録は3件のままであり、本artifactの記述が4ラウンドである点と一致しない。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format`、`npm run test:format` | 2 | 2 | 0 | 0 | pass |
| unit・integration・e2e（runner `cucumber-js`、dialect `en`） | `npm run conformance:check`（内部で`npm test`を実行する） | 1426 | 1410 | 0 | 16 | pass |
| 型・既存一式・配布物 | `npm run lint`・`format:check`・`typecheck`・`source:check`・`trace:check`・`architecture:check`・`skills:check`・`build`・`package:check`・`conformance:check` | 10 | 10 | 0 | 0 | pass |

**`npm test`と`conformance:check`を並行実行していない。** `conformance:check`が内部で`npm test`を`spawnSync`するため、並行させると`dist/`が競合してE2Eが偽陽性で落ちる。**本Issueの作業中に実際に踏み、2件・4件の偽の失敗を観測した。** 上表は排他実行した値である。

**変異試験。** 5件を実施し5件ともkillした。

| ID | 変異 | 結果 | 復元後 |
|---|---|---|---|
| M1 | 上限を5から10へ（6件でも省略が出なくなる） | `8 scenarios (7 passed, 1 failed)` | `8 scenarios (8 passed)` |
| M2 | 上限を5から4へ（5件でも省略が出る） | `8 scenarios (6 passed, 2 failed)` | `8 scenarios (8 passed)` |
| M3 | 診断から字面を落とす | `8 scenarios (5 passed, 3 failed)` | `8 scenarios (8 passed)` |
| M4 | 丸括弧判定を落とす（受理集合が広がる） | `8 scenarios (7 passed, 1 failed)` | `8 scenarios (8 passed)` |
| M5 | angle/brace判定を落とす（受理集合が広がる） | `8 scenarios (6 passed, 2 failed)` | `8 scenarios (8 passed)` |

**復元は複写で行い`git checkout`を使っていない。**

**上限という数量条項をN-1・N・N+1で検査している。** M1とM2が上限を両方向へ動かし、それぞれ別のscenarioが落ちる。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/issue.ts` | **入る**（`files`が`dist/src/`を列挙する） | 未解決placeholderの診断へ原因の字面が加わる |
| `.agent-skill-chain/templates/issue/00_要求定義_quick.md` | **入る**（`files`が`.agent-skill-chain/templates/`を列挙する） | ラベル行2種の字面が変わる。**同時に`TEMPLATE_PARENTHETICAL_PLACEHOLDERS`からその2字面が落ちる**（集合はtemplate自身から導出されるため） |
| `.agent-skill-chain/templates/issue/00_要求定義_poc.md` | **入る**（同上） | 同じラベル行1種の字面が変わる。poc側に静的検査のラベル行は無い |
| `docs/specs/` 3 file | **入る**（`files`が`docs/`を列挙する） | REQ-SQ-008の記述と追跡が延びる |
| `test/` | 入らない | `files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/domain/issue.js`の診断文へ原因の字面が加わる。**受理する文書の集合が広がるのは、言い換えたラベル2字面に限られる。** その2字面は表のcellではなく、値をコロンの後に書く「ラベル（限定句）: 値」の形であり、埋めた文書にも自然に残る。判別規則を足す案を採らなかったのは、**広がりが限定できない**ためである。`npm run package:check`はexit 0である。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **Step 11で観測する。** 本節はPR作成前に書いており、現時点で外部reviewerのcommentもapprovalも存在しない |
| reviewerがPR author・実装commit authorと異なる | いいえ。いずれも`adachi-tatsuru`である |
| 観測したreview commentとapprovalの件数 | 現時点で0件・0件 |

**適用する例外は無い。** `.agent-skill-chain/review-exceptions.json`が持つ例外は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`（kind `reported-success-without-review`）の1件だけであり、PR作成前の本時点では条件の判定自体ができない。

**残る事実を隠さず記録する。** implementerとreviewerが同一sessionであり（0.2節の逸脱1）、approval reviewは0件である。本artifactの`approved`は**AIによる最終裁定**であって人間の独立approvalではない。**mergeはrepository ownerのauthorityに依存する。** 本sessionのmerge authorityはrepository ownerから明示付与されている。

**主観判断を承認根拠にしていないことが緩和である。** AC-01〜04の判定はすべてscenario結果と変異試験の赤・緑に置いた。とりわけ**受理集合を広げていないこと**の根拠は変異M4・M5の赤であり、reviewerの読解ではない。

## 10. 仕様整合性

- 判定: **updated**
- 更新した仕様: `docs/specs/02_要件/04_仕様・品質管理要件.md`（REQ-SQ-008へ字面列挙と上限5件）、`docs/specs/15_要件追跡/00_追跡表.md`（SCN 3件）、`docs/specs/15_要件追跡/01_変更履歴.md`（1行）。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **成立する。** 新規用語を追加していない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。**
- 要件・変更・SCN・テストの追跡: REQ-SQ-008 → AC-SQ-008 → AC-01〜04 → SCN-UNIT-ISSUEPLC-005〜008 → `test/features/unit/issue-template-contract.feature` → `src/domain/issue.ts`。`npm run trace:check`合格。**DISC-003で孤立SCNを解消した後の値である。**
- `no-spec-impact`の場合の限定的根拠: 該当しない。**新しい観測可能な振る舞い（字面の列挙と上限）を足しているため要件本文を延ばした。**
- UI・トークンの判断: いずれも`not-applicable`。2.2節のとおり。

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件。** CR-02はHighだったが本ラウンドでresolvedにした。
- Medium/Lowの記録: ADV-01・ADV-02・ADV-03（いずれもLow、record-only）。AFF-01・CR-01・**CR-02（High）**はresolved。
- 判定: **approved**（AIによる最終裁定。人間の独立approvalは0件であり、9節に事実として記録した）
- 新しい権限が必要な事項: **なし。**
- 残存リスク: 3件。(1) placeholder記法の内側に秘密情報を書いた場合に診断へ現れうる（ADV-01）。(2) full templateと`01`の丸括弧にラベルが残るか未調査（ADV-02）。(3) `docs/reviews/`のrole authority不整合（#1047へ委譲）。
- 次に許可される操作: **Step 11（`pr create`）。** その後CIが緑になってからmergeする。
- 次回の再開地点: pushした後、CIの結果確認から。**mainが動いていた場合、`pr create`を先に済ませてからrebaseする。** 本session中に逆順で行い、review sessionのanchorが古い基点を指して`pr create`が拒否され、stagingの作り直しが必要になった実例がある。
