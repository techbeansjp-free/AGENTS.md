# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1044 |
| ラウンド | Step 10 ラウンド1〜3 |
| 比較基点 | `d3b3690a652b08806a7b44ee0ad4d321f97ec455` |
| H_impl | `488524290cadfbd8e1e8cef02a77c128bf300b65` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip。**本artifact commitまでの間に`origin/main`は動いていない** |
| モード | full |
| 対象差分 | 20 path。`src/domain/project-choice-shrink.ts`（新規）、`src/domain/enforcement.ts`、`src/domain/policy.ts`、`src/domain/migration.ts`、`src/domain/delivery.ts`、`src/domain/project-choice-diff.ts`、`src/cli.ts`、`src/types.ts`、schema 2件、配布案内1件、仕様4件、test 5件。commitは`4c92cc9a`・`48852429` |
| 対象外 | (a) 適用済み提案の自動削除規則。(b) 対象3 field以外への受理条件の適用。(c) `classifyProjectChoiceDiff`の単調性判定そのものの変更。(d) 提案の登録UI・登録commandの新設。(e) `policy evaluate`とlegacy monolith migrate経路への配線 |
| 残り予算 | **0**（同一範囲で最大3ラウンド。総2ラウンドで設計し予算1を残していたが、**ラウンド3でCI赤の是正に使い切った**。6節を参照する） |
| ラウンド数 | 3。ラウンド1は実装差分、ラウンド2は本artifactを加えた版、**ラウンド3はCI赤の是正**が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260828_233037_利用側project-choiceの縮小を二段階proposalで承認できるようにする |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-003と`docs/specs/10_セキュリティ/01_信頼境界.md`の「project choice差分の信頼境界」表の弱化行。**着手時点でこの2箇所は縮小の受理条件を規定していなかった。** その欠落を埋めることが本Issueの要求の一部である |
| 成果物行数 | 製品 **+343 / −9行**（うち新規file 168行）。仕様・schema・配布案内 **+76 / −3行**。支援層 **+776 / −10行**。**計画の見込みは製品+70行前後であり、実際は約5倍である**（7.3節） |
| 縮小の先行評価 | 6案を先に評価した。(1)提案を専用fileへ置く案は新しいfile・取得機構・配布経路の3つを増やすため不採用。(2)`.github/trusted-quality-proposals.json`へ統合する案は、同fileがrepository固有の品質契約用で利用側へ配布されていないため不採用。(3)**一致判定を「値の完全一致」とする案**は、同値性の主張自体は正しいが、決裁文言「byte単位で一致」を、byte読みが拒否するtextを受理する方向へ再解釈するため不採用。(4)**「対象field値のbyte範囲の一致」とする案**は、範囲抽出に位置情報を返すJSON parserが要り、`parseJsonStrict`が保護file`src/lib/security.ts`にあるため二段階proposalと品質契約の版上げを伴う。第2のparserを書く回避策はbyte比較が消すはずのparser差分を作る自己矛盾になるため不採用。(5)採用したのは**choices fragment fileのraw byte全体のsha256一致**で、`rawEntries`（`src/domain/policy.ts:1205`）と`projectChoices = choices[0]`（同:1174）により新しい機構を1つも増やさない。(6)`compareTrustedPolicy`の署名を変える案は9箇所の呼び出し元へ波及するため不採用とし、既存の第3引数`options`へ任意fieldを2つ足すだけにした |
| 実施者・日時 | reviewer（fable）、coordinator（claude）、2026-08-31〜2026-09-01 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | fable | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは**claude**であり、reviewerは**fable**である。providerとcontextがともに異なる |

**開示する逸脱が3件ある。**

1. **implementerが計画の当初想定と異なる。** `codex exec --full-auto`がhost側のauto mode分類器に拒否され起動できないため、03の0.1節で**implementerをclaudeと先に宣言**したうえで進行役が実装した。**reviewerをfableに固定してclaudeをreviewerに含めていない。** **この帰結（実行時にimplementer identityとreviewerの独立性を検証する機構が無い）は既存の #1040 が所有する。**
2. **codex reviewerを使えなかった。** Step 7の諮問時点では応答したが、`ERROR: Selected model is at capacity`で反復利用できない状態が続いた。Step 10の敵対reviewはfable単独である。**進行役が指摘を受け入れる前に全件を独立に実測して補った。**
3. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts`が`AUDIT_DIRECTORY = "docs/reviews"`を要求する一方、`validateRoleOperation`は実行時に強制されていない。**本Issueでは権限拡大をscope外としてrisk受容し、解消を #1047 へ委譲する。**

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| owner決裁 | https://github.com/techbeansjp-free/AGENTS.md/issues/1044#issuecomment-5446908667 | 2026-08-28に承認済み。対象3 field限定、byte単位一致、提案なしは従来どおり拒否、単調性検知は既定のまま、同一PR自己提案は不可 | 一次資料 |
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1044 、AC-1044-01〜14 | Step 8で00〜03の改定版を同期。`syncDigest`と`readBackDigest`が一致し`sync-verified`のcheckpoint 8へ遷移した | 一次資料 |
| 差分 | `1900497b..d3630255` | **20 file、+1195 / −22行**（`git diff --numstat`の実測値。製品+343/−9、仕様・schema+76/−3、支援層+776/−10の合計と一致する） | 既存コード |
| テスト | `npm test` | `1347 scenarios (1331 passed, 16 skipped)`、失敗0 | テスト出力 |
| 仕様 | `docs/specs/`配下4 file | updated | 既存文書 |
| Phase A artifact | `docs/reviews/104_課題1044のproject-choice縮小proposalレビュー.md` | `H_impl` = `48852429`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する。**本節はPR作成前に書いており、外部証拠はまだ無い** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** `trusted_policy → shrink_proposal → shrink_acceptance → trust_enforcement`の一方向で、`choice_diff`は`shrink_acceptance`の入力だが`shrink_proposal`へ依存しない。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl` = `48852429`は`H_final`のancestorであり、差分は本artifact 1 fileだけである。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: **いいえ。同一である。** 本repositoryの全sessionが単一アカウントで走る。**providerの差はcontextの独立性であってidentityの独立性ではない。** 9節で成立条件を正確に記録した。
- 既定branch追随を行った場合: **行っていない。** 基点`d3b3690a`は`origin/main`のtipであり、追随mergeを作っていない。`比較基点..H_impl`は2 commitの一直線である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/project-choice-shrink.ts` | A | package | package | 受理判定だけを持つ純関数168行。分類器を呼ばない | pass。`project-choice-diff.ts`から型と接頭辞定数を読むだけで、逆方向の依存を作らない | REQ-SQ-003 / AC-1044-01〜05、10、14 / SCN-UNIT-CHOICE-009〜019 | 副作用を持たない。提案は`trustedProposals`引数からのみ受け取る。rollbackは本fileの削除 | pass |
| `src/domain/enforcement.ts` | M | package | package | 受理判定の呼び出し、`acceptedShrinks`の返却、診断文の是正、effective合成での提案の持ち越し | pass。`architecture:check`合格 | REQ-SQ-003 / AC-1044-04、06、07 / SCN-UNIT-CHOICE-012、014、SCN-INT-CHOICE-003、006、007 | **提案は`trusted`引数からのみ読む**（:584）。effective合成は`options.trusted`が真のときだけ持ち越す（:982） | pass |
| `src/domain/policy.ts` | M | package | package | `choicesFragmentSource`と`loadConsumerChoicesFragmentAtCommit`の新設、allowlist 2箇所 | pass | AC-1044-06、11 / SCN-INT-CHOICE-003〜007 | legacy monolith経路では`undefined`を返しfail-closed。rollbackは追加関数の削除とallowlistの復元 | pass |
| `src/domain/migration.ts` | M | package | package | migrate 2経路への配線と`candidateChoicesSource` helper | pass | AC-1044-11 / SCN-INT-CHOICE-004 | fragmented setでない入力では`{}`を返す | pass |
| `src/domain/delivery.ts` | M | package | package | `pr create`への配線。入力型へ任意field 2つ | pass | AC-1044-06 | 省略時は受理が起きない | pass |
| `src/domain/project-choice-diff.ts` | M | package | package | `isStringArray`のexportと理由接頭辞定数のexport。**判定logicを1行も変えていない** | pass | AC-1044-08、09、13 / SCN-UNIT-CHOICE-015、016、018 | 単調性検知は無変更。SCN-UNIT-CHOICE-018と変異M8-a/b/c、M9が維持を反例で固定する | pass |
| `src/cli.ts` | M | package | package | `policy validate`2箇所と`pr create`への配線14行 | pass | AC-1044-06 / SCN-INT-CHOICE-006 | 配線しない4経路はfail-closedのまま | pass |
| `src/types.ts` | M | package | package | `ProjectChoiceShrinkProposal`型とPolicyの任意field | pass | 全AC | 任意fieldであり既存policyは影響を受けない | pass |
| `.agent-skill-chain/schemas/project-policy.schema.json` | M | project | spec | 提案の宣言形式24行 | pass | AC-1044-12 / SCN-INT-CHOICE-005 | `fieldPath`を3値のenumへ閉じ、`afterSha256`を64桁hexへ拘束する | pass |
| `.agent-skill-chain/schemas/project-policy-manifest.schema.json` | M | project | spec | 同上23行 | pass | 同上 | 同上 | pass |
| `.agent-skill-chain/schemas/00_利用案内.md` | M | project | spec | 二段階手順の案内23行 | pass | AC-1044-12 | 記述のみで実行authorityを持たない | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | project | spec | REQ-SQ-003へ受理条件を1文 | pass | REQ-SQ-003 | 同上 | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | project | spec | 弱化行へ受理の例外を1文 | pass | 同上 | 同上 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | project | spec | TERM-ASC-078・079の2行 | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | 追跡2行 | pass | 全SCN | 同上 | pass |
| `test/features/unit/project-choice-diff.feature` | M | package | package | unit scenario 11件 | pass | AC-1044-01〜05、07〜10、13、14 | fixtureは一時値のみ | pass |
| `test/features/integration/project-choice-diff.feature` | M | package | package | integration scenario 5件 | pass | AC-1044-06、11、12 | 実repositoryのpolicy setを読むが書き換えない | pass |
| `test/steps/project-choice-diff.steps.ts` | M | package | package | step定義とhelper 681行 | pass | 全SCN | 実fileを読むだけで書かない | pass |
| `test/features/unit/project-policy-satisfiability.feature` | M | package | package | SCN-UNIT-SAT-015の主張を新しい契約へ改めた2行 | pass | AC-1044-07 | **#1043が固定した「適用経路が無い」という主張は本Issueで偽になった。** 経路が実在するようになったため、拒否理由が登録手順を案内することを測る形へ改めた | pass |
| `test/steps/project-policy-satisfiability.steps.ts` | M | package | package | 同上11行 | pass | 同上 | 同上 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **一致する。** `git diff --name-only 1900497b d3630255`が返す**20 path**が上表の20行と同じである。**本artifactは`H_impl..H_final`にあり監査範囲へ入らない。**
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** 対象3 fieldは`src/domain/project-choice-shrink.ts`の閉じた定数であり、project policyから読まない。owner決裁が3つに限ると定めているためである。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **ラウンド1のfinding 6件のうち5件を修正した。** 修正範囲は`src/domain/enforcement.ts`・`src/domain/project-choice-diff.ts`・`src/domain/project-choice-shrink.ts`・test 2 file・追跡表である。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**着手前の発見が1件、実装中の発見が2件、review中の発見が2件ある。**

1. **DISC-001（Step 6）。** 01のFR-1044-09が定めた「対象field値のraw byte範囲」の比較は、位置情報を返すJSON parserを要し、`parseJsonStrict`が保護fileにあるため品質契約の版上げを伴う。02の12章はこれを「値の完全一致」へ緩める方向で不採用としていたが、それは決裁を広げる再解釈になる。第3の選択肢としてchoices fragment fileのraw byte全体のsha256一致を採り、FR-1044-09とAC-1044-05を改定した。**ACの本数は変わっていない。**
2. **Step 7のB1。** fragmented setではPolicyのtop-level fieldが`manifest.policy`から来るため、提案の物理的な置き場所は`.agent-skill-chain/project-policy.json`の`policy` objectである。そこは`validatePolicy`と`validateProjectPolicyManifest`のallowlist、および`project-policy-manifest.schema.json`の`policy.additionalProperties: false`の3箇所が閉じていた。計画の変更対象へ追加した。
3. **Step 7のB2。** 計画と設計が実在しないCLI経路`policy compare`を名指ししていた。`policy`のsubcommandは`validate`・`evaluate`・`enforce`・`migrate`の4つで、`policy enforce`は`enforceOperation`を呼び`compareTrustedPolicy`を経由しない。配線すべき本命は`policy validate`である。
4. **ラウンド1のF-01。** `resolveEffectivePolicy`が提案を持ち越さないため、`policy validate`2経路と`pr create`のtrustedが常に提案なしになっていた。**新設した経路がゲート経路で機能していなかった。** trusted合成のときだけ持ち越す形にした。
5. **ラウンド1のF-02。** SCN-INT-CHOICE-003が第3引数を渡しておらず、拒否が「候補側の提案が無視されたから」ではなく「rawが無いから」成立していた。

**いずれもAC・scope・security境界・不可逆操作の契約を変えていない。** DISC-001だけがAC本文の文言を改め、Step 8で同期済みである。

### 2.1 受け入れ条件とシナリオ

| AC ID | 内容 | SCN | 観測 |
|---|---|---|---|
| AC-1044-01 | 提案に従って`forbiddenTestFileSuffixes`を空へ縮小できる | SCN-UNIT-CHOICE-009 | 緑。修正前は赤。**分類が弱化のままであることを同一シナリオで確認する** |
| AC-1044-02 | 提案に従って`testLayers`から要素を除去できる | SCN-UNIT-CHOICE-010 | 緑。修正前は赤 |
| AC-1044-03 | 提案に従って`quality.forbiddenTypes`を縮小できる | SCN-UNIT-CHOICE-011 | 緑。修正前は赤 |
| AC-1044-04 | 提案が存在しない縮小は拒否される | SCN-UNIT-CHOICE-012 | 緑。修正前から緑（回帰ガード）。変異M2が殺す |
| AC-1044-05 | byte単位で一致しない縮小は拒否される | SCN-UNIT-CHOICE-013 | 緑。修正前は赤。**値の内側の空白1個の差で不一致になることを実測した** |
| AC-1044-06 | 候補側にだけ存在する提案では受理されない | SCN-INT-CHOICE-003、007 | 緑。修正前は赤。**ラウンド1でrawを渡す形へ是正し、合成経路の007を追加した** |
| AC-1044-07 | 拒否診断に登録先と次の操作が含まれる | SCN-UNIT-CHOICE-014 | 緑。修正前は赤。変異M6が殺す |
| AC-1044-08 | 提案が無い場合の分類結果が変更前と一致する | SCN-UNIT-CHOICE-015 | 緑。修正前から緑（回帰ガード） |
| AC-1044-09 | 対象3 field以外の弱化判定が変更前と一致する | SCN-UNIT-CHOICE-016 | 緑。**列挙はREQ-SQ-003の原文から導出した6件** |
| AC-1044-10 | 提案の欠落・型不正・破損はfail-closedで拒否になる | SCN-UNIT-CHOICE-017 | 緑。修正前は赤。**正当な提案でもraw byte列が無ければ受理されないことを別assertionで測る** |
| AC-1044-11 | `policy migrate`の互換性判定でも同じ受理条件が働く | SCN-INT-CHOICE-004 | 緑。**`planFileMigration`を実際に通す**（7.1節のM7） |
| AC-1044-12 | 提案の宣言形式と案内が配布物に含まれる | SCN-INT-CHOICE-005 | 緑。修正前は赤 |
| AC-1044-13 | 単調性検知そのものが維持されている | SCN-UNIT-CHOICE-018 | 緑。変異M8-a/b/c、M9が殺す |
| AC-1044-14 | 提案があっても対象3 field以外では受理が起きない | SCN-UNIT-CHOICE-019 | 緑。修正前は赤。**合成した弱化entryを直接渡して測る**（7.1節のM1） |

**AC-1044-06の観測経路が2つある。** SCN-INT-CHOICE-003は`compareTrustedPolicy`を直接呼び、SCN-INT-CHOICE-007はeffective合成を経由する。前者だけでは合成での持ち越しの誤りを検出できない。

### 2.2 開発考慮事項の適用判定（必須）

| ID | 判定 | 観測 |
|---|---|---|
| DC-PRIVACY | applicable | 信頼境界の受理条件を新設した。**承認の出所は`trusted`引数のみである。** `grep`で`projectChoiceShrinkProposals`を読む箇所が`enforcement.ts:584`の1つだけであることを確認した。SCN-INT-CHOICE-003と007が候補側の提案を無視することを反例で固定する |
| DC-OBSERVABILITY | applicable | 症状は「宣言を取り除けないのに、拒否理由が実行できない手順を案内する」ことだった。是正後は拒否診断が`projectChoiceShrinkProposals`への登録手順、比較したfragment path、観測sha256、提案sha256、形が不正で無視した提案の件数を返す。SCN-UNIT-CHOICE-013、014が観測する |
| DC-UX | not-applicable | project choiceの`humanCenteredUi`が`not-applicable`である |
| DC-TOKENS | not-applicable | project choiceの`designTokens`が`not-applicable`である |

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | `classifyProjectChoiceDiff`の判定logicを1行も変えていない。変えたのは`isStringArray`と理由接頭辞のexportだけである |
| 価値 | pass | #982と#998が報告した詰まりに、製品の手順としての解を与える。実利用者（`RUA-PROM/nexus-corporate-website`）が現に踏んでいる |
| 実現可能性 | pass | 新しいfile・取得機構・配布経路を1つも増やしていない。`compareTrustedPolicy`の署名も変えていない |
| 整合性 | pass | 既存の`.github/trusted-quality-proposals.json`と同じ二段階・sha256一致の形に揃えた |
| 保守性 | pass | 受理判定を純関数として分離し、分類器と双方向依存を作らない。理由接頭辞のliteral複製をラウンド1で解消した |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例 | pass | 変異11点がいずれも対象scenarioを殺す（7.1節）。うち4点はラウンド1の是正で殺せるようになった |
| 失敗 | pass | 提案の欠落・型不正・raw未取得・fragment path未取得・対象field外のすべてでfail-closedへ倒れる |
| 境界 | pass | 値の内側の空白1個の差、同一fieldPathの複数提案、legacy monolith経路を観測した |
| 悪用 | pass | **候補branchの内容だけを操作して受理を得る経路が無い。** 提案は`trusted`引数からのみ読み、effective合成は`options.trusted`が真のときだけ持ち越す。SCN-INT-CHOICE-007が合成経路で反例を固定する |
| 安全性 | pass | 単調性検知を1行も弱めていない。M8-a/b/cとM9が維持を反例で固定する |
| 損失 | not-applicable | 受理判定は読み取りのみで状態を書かない |
| 復旧 | pass | 受理条件を撤去すれば従来の拒否へ戻る。schemaの任意fieldは残しても判定へ影響しない |
| 範囲 | pass | 対象3 field以外へ受理が及ばない。SCN-UNIT-CHOICE-019と変異M1が固定する |

## 5. 指摘

**ラウンド1で6件、ラウンド2で0件。未解決のCritical/Highは0件である。**

| ID | 深刻度 | 種別 | 状態 | 内容 |
|---|---|---|---|---|
| R1-F01 | High | acceptance-violation | resolved | **`resolveEffectivePolicy`が`projectChoiceShrinkProposals`を持ち越さないため、新設した経路がゲート経路で機能していなかった。** `policy validate`2経路と`pr create`のtrustedは`loadOperationPolicy`を通り、この合成を経由する。実際に動いていたのはmigrate 2経路だけである。方向はfail-closedでありセキュリティ弱化ではないが、Issueの主目的が不達だった。trusted合成のときだけ持ち越す形にした |
| R1-F02 | High | vacuous-assertion | resolved | SCN-INT-CHOICE-003が`compareTrustedPolicy`の第3引数を渡しておらず、拒否が「候補側の提案が無視されたから」ではなく「rawが無いから」成立していた。提案を候補側から読む変異を入れても通る状態だった。rawを渡したうえで拒否されること、および同じ入力で提案の置き場所だけをtrusted側へ移すと受理されることを同一シナリオで測る形へ改め、合成経路のSCN-INT-CHOICE-006と007を追加した |
| R1-F03 | Low | improvement | resolved | 提案の実行時shape検証が無く、大文字sha256やtypoしたfieldPathで登録すると無言で「提案なし」になっていた。**shape検証の追加は採らない。** `isProposal`のfilterでfail-closedは既に成立しており、検証の二重化になる。代わりに**形が不正で無視した提案の件数を診断へ出す**形にした。登録側の誤りに気付ける |
| R1-F04 | Low | improvement | resolved | `SHRINK_REASON_PREFIX`が分類器の文言literalの複製だった。`MONOTONIC_SHRINK_REASON_PREFIX`として分類器からexportし共有した |
| R1-F05 | Low | improvement | resolved | 同一fieldPathの提案が複数あると先頭だけが照合され、旧提案を残したまま再登録すると正しい新提案があっても拒否されていた。全件と照合する形にした |
| R1-F06 | Low | out-of-scope | valid | 「raw byteのsha256」は実際にはUTF-8 decode後の再encode列のhashである。有効なUTF-8のfileではfile byte列のsha256と一致するため実害はなく、不正UTF-8ではhashがずれて拒否へ倒れる。**是正しない。** 受理が広がる方向の乖離ではない |

**R1-F06を根拠に新しいIssueを起こしていない。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象は`1900497b..bd336a65`の実装差分である。
- **敵対reviewをfableの独立invocationで実施した。** implementer（claude）とは別providerである。
- **すべての指摘を受け入れる前に実測で検証した。** R1-F01は`src/domain/enforcement.ts:966-975`の返却literalと`src/domain/policy.ts:1531`の`effectivePolicy`を原文で読み、提案fieldが両方から欠落していることを確認した。R1-F02は当該stepが第3引数を渡していないことを原文で確認した。
- **F-03の提案（実行時shape検証の追加）はそのまま採らなかった。** fail-closedは`isProposal`で既に成立しており、検証の二重化は支援層を成果物より大きくする。指摘が示す実害（登録側の誤りに気付けない）だけを診断で解いた。
- **変異M11は等価変異と判定した。** effective合成でcandidate側の提案も持ち越す変異を入れたが、`projectChoiceShrinkProposals`を読む箇所が`enforcement.ts:584`の`trusted`側1つだけであることを`grep`で確認した。候補側の提案はどこからも読まれないため観測可能な差が生じない。**反射的にfixtureを足さず、等価であることの根拠を記録する。**
- 是正は前進commit `48852429`で積んだ。

### ラウンド2

- 対象は本artifactを加えた版である。
- 0.1節の逸脱3件、5節のR1-F06の未是正、7節の実測値が本文の主張と一致することを確認した。
- **新規findingは0件である。** 未解決blockingは0件である。

### ラウンド3

**CIが赤になったため実施した。** 残していた予算1をここで使った。

| ID | 判定 | 内容 |
|---|---|---|
| R3-F01 | **有効・是正した** | 新設したSCN-INT-CHOICE-006と007が`loadOperationPolicy(process.cwd())`でfloor policyを取っていた。同関数は`origin/HEAD`をtrusted branchとcommit SHAへ解決できることを要求する**authority経路**であり、CIのcheckout形では`origin/HEAD`が無いため`authority operationを停止しました`で失敗する。**手元では`origin/HEAD`が存在するため緑で、CIだけが赤になった。** floor policyの内容だけが要るので、`readPolicyJson`で`.agent-skill-chain/policy/default.json`を直接読む形へ改め、実行環境のGit状態への依存を外した |

**製品差分はラウンド3でも1行も変えていない。** 変えたのはtest 1 fileと本artifactだけである。

**この是正は「赤を通す理屈」ではない。** CIが検出したのは**testが実行環境のGit状態に依存していた**という実在の欠陥であり、判定条件を緩めていない。同じ2 scenarioは是正後も同じ主張を測る。

## 7. テスト結果

| 検証 | 結果 |
|---|---|
| `npm test` | `1347 scenarios (1331 passed, 16 skipped)`、失敗0 |
| CI同順の全chain | `project:quality`→`quality`→`docs:format`→`test:format`→`trace:check`→`architecture:check`→`build`→`package:check`→`conformance:check`の9 commandを**終了値を明示的に見るループで**完走した |

### 7.1 変異試験

**復元はすべて複写で行い`git checkout`を使わない。** ラウンド1の是正後に全件を再実行した。

| 変異 | 内容 | 対象scenarioの結果 |
|---|---|---|
| M1 | 受理判定の条件(a)（3 field限定）を外す | **1件**が赤（SCN-UNIT-CHOICE-019） |
| M2 | 条件(b)（提案の存在）を外す | **2件**が赤 |
| M3 | 条件(c)（sha256一致）を外す | **1件**が赤（SCN-UNIT-CHOICE-013） |
| M4 | raw未取得時に提案のsha256で埋める（fail-open） | **1件**が赤（SCN-UNIT-CHOICE-017） |
| M5 | trusted側でなくcandidate側の提案を読む | **5件**が赤 |
| M6 | 診断の`next`から登録手順を削る | **1件**が赤（SCN-UNIT-CHOICE-014） |
| M7 | `migration.ts`の配線を外す | **1件**が赤（SCN-INT-CHOICE-004） |
| M8-a | `classifyMonotonicArray`の`testLayers`呼び出しだけを消す | **5件**が赤 |
| M8-b | 同`forbiddenTestFileSuffixes`呼び出しだけを消す | **7件**が赤 |
| M8-c | 同`quality.forbiddenTypes`呼び出しだけを消す | **3件**が赤 |
| M9 | `weaken()`を無効化する | **17件**が赤 |
| M10 | effective合成で提案を落とす（R1-F01の再現） | **1件**が赤（SCN-INT-CHOICE-006） |
| M11 | effective合成でcandidate側の提案も持ち越す | **0件**。**等価変異である**（6節） |

**M1・M4・M7は最初に生存した。等価と決めつけず、等価でない最小入力を1件ずつ特定した。**

- **M1**: `classifyMonotonicArray`を呼ぶのが3 fieldだけであり、縮小理由の文言を出す箇所も`project-choice-diff.ts:284`の1つだけであるため、分類器を経由する入力では3 field限定の検査へ到達できない。**合成した弱化entryを直接`acceptApprovedShrinks`へ渡す検査**を足して殺した。将来4つ目の単調性fieldが増えたときに受理が漏れないことを先に固定する意味がある。
- **M4**: 当初の変異（`observedSha256 === undefined`の検査を外す）は、後段のsha256比較が`undefined`を弾くため挙動が同一の等価変異だった。**提案のsha256で埋めるfail-openの形**へ変異を作り直し、正当な提案とraw未取得を組み合わせた検査で殺した。
- **M7**: 原因はSCN-INT-CHOICE-004が`compareTrustedPolicy`を直接呼んでおり、**migrate経路を実際には通っていなかった**ことである。`planFileMigration`を実際に通す形へ書き直して殺した。

**M8は3 field別に1つずつ当てた。** 既存featureは`testLayers`の削除と`forbiddenTypes`の縮小しか持たず、`forbiddenTestFileSuffixes`の削除scenarioが無い。3呼び出しをまとめて消すと、どのfieldの検知が失われても同じ赤になり、field別の検出力を測れない。

### 7.2 差し戻し検証（rollback-validation）

受理判定は読み取りのみで状態を書かないため、不可逆操作のrollback-validationは該当しない。代わりに**受理条件の撤去で従来の拒否へ戻ること**を変異M2・M3で確認した。いずれも受理が起きなくなる方向ではなく、受理が広がる方向の変異であり、対象scenarioが赤になる。

### 7.3 成果物行数の逸脱

**計画の見込みは製品+70行前後であり、実際は+343 / −9行である。約5倍である。** 内訳と理由を記録する。

| 区分 | 行数 | 計画時に見込めなかった理由 |
|---|---:|---|
| 受理判定の純関数（新規file） | +168 | 見込みは60行前後だった。診断へfragment path・両sha256・不正提案件数を載せる`describeRejection`と型ガードが加わった |
| `src/domain/policy.ts` | +63 / −1 | **Step 7のB1で判明**。allowlist 2箇所に加え、`choicesFragmentSource`と`loadConsumerChoicesFragmentAtCommit`の2関数が要った |
| `src/domain/enforcement.ts` | +32 / −3 | 受理呼び出し5行の見込みに対し、診断文の是正とeffective合成の持ち越し（R1-F01）が加わった |
| `src/domain/migration.ts` | +28 / −2 | helper 1つと2経路の配線 |
| `src/cli.ts`・`src/domain/delivery.ts`・`src/types.ts` | +42 / −1 | `pr create`経路の配線。**Step 7のB2で経路名を是正するまで見込みに入っていなかった** |

**支援層は+776 / −10行で、製品の約2.3倍である。** `.agent-skill-chain/docs`の運用命題「支援層は成果物を超えてはならない」に照らすと超過している。ただし内訳の681行は`test/steps/project-choice-diff.steps.ts`のstep定義とfixture helperであり、16 SCNに対する定義である。**縮小を先に評価した**: 既存`ProjectChoiceDiffWorld`と`mapping()`・`choices()`・`policy()` helperを再利用し、新規Worldを作っていない。合成diffのhelperは3行である。

### 7.4 NFR-1044-02の測定

**着手前にbaselineを実測した。** `main` `d3b3690a`で`npm test -- --tags @project-choice-diff`を3回測り、6.55秒・6.11秒・6.26秒、**中央値6.26秒**であった。閾値は115%の7.20秒である。

変更後の同じ手順の測定は6.99秒・7.40秒・7.11秒、**中央値7.11秒**である。**閾値を下回る。**

**この比較は同一作業量ではない。** 当該tagのscenario数は11件から26件へ増えている。増分の大半はscenario数の増加であり、判定経路そのものの費用ではない。**「判定の所要時間の増分をbaselineの15%以内」という要件の文言に対しては合格だが、測定が同一作業量でないことを明記する。** 単一測定で要件の合否を語らず、3回の全値を記録した。

### 7.5 修正前の赤の観測

T01完了時点で**8件が赤**であった。AC-1044-04、08、09、11、12、13に対応する6件は回帰ガードまたは配布契約であり緑で始まる。

| scenario | T01時点の赤の内容 |
|---|---|
| SCN-UNIT-CHOICE-009、010、011 | 受理条件が存在せず`ASC-TRUST-001`で拒否された |
| SCN-UNIT-CHOICE-013 | 同上 |
| SCN-UNIT-CHOICE-014 | 診断の`next`に登録手順が無かった |
| SCN-UNIT-CHOICE-017、019 | 同上 |
| SCN-INT-CHOICE-003 | 型が存在せず`tsc`が失敗した |

## 8. 配布物影響

配布境界へ入る変更pathは次の10件である。いずれも`package.json`の`files`が配布対象とする。`docs/specs/`と`test/`は配布対象外である。

- `src/domain/project-choice-shrink.ts`
- `src/domain/enforcement.ts`
- `src/domain/policy.ts`
- `src/domain/migration.ts`
- `src/domain/delivery.ts`
- `src/domain/project-choice-diff.ts`
- `src/cli.ts`
- `src/types.ts`
- `.agent-skill-chain/schemas/project-policy.schema.json`
- `.agent-skill-chain/schemas/project-policy-manifest.schema.json`
- `.agent-skill-chain/schemas/00_利用案内.md`

判断: 配布物を更新した

根拠: 利用側のproject policyへ`projectChoiceShrinkProposals`という新しい任意fieldを受け入れるようになり、schemaと利用案内が変わる。**既存policyへの影響は無い。** fieldを持たない既存policyの判定は変更前と完全に同一であり、legacy monolith policyでは受理が構造的に起きない。

## 9. 独立reviewの成立

- **reviewerとimplementerのstable actor IDは同一である。** 本repositoryの全sessionが単一のアカウントで走るため、`H_impl`のcommit authorもPR authorもreviewerも同じstable IDになる。**providerがclaudeとfableで異なることはcontextの独立性であって、identityの独立性ではない。**
- **外部reviewerによる独立approvalは0件である。** `.agent-skill-chain/review-exceptions.json`の`exceptions`は`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の1件だけで、本Issueへ適用できる例外区分は存在しない。
- **したがって11節の`approved`は、人間による独立approvalを伴わないAIの最終裁定である。**
- **これは本PR固有の事情ではなく、本repositoryの恒常的な条件である。** 実行時にimplementer identityとreviewerの独立性を検証する機構が無いことは既存の #1040 が所有する。
- 進行役はR1-F01とR1-F02を受け入れる前に原文で実測し、R1-F03は指摘のうち実害だけを解いて提案どおりの是正を採らなかった。M11は等価変異であることを`grep`で確認して記録した。

## 10. 仕様整合性

| 変更 | 更新先 | 追跡 |
|---|---|---|
| 3 fieldの縮小を登録済み提案とraw byte一致で受理する | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-003 | REQ-SQ-003 / AC-SQ-003 |
| 弱化行へ受理の例外と登録手順を足す | `docs/specs/10_セキュリティ/01_信頼境界.md` | 同上 |
| 用語IDの追加 | `docs/specs/01_システム概要/02_用語・略語.md` | TERM-ASC-078、TERM-ASC-079 |
| 追跡行の追加 | `docs/specs/15_要件追跡/00_追跡表.md` | SCN-UNIT-CHOICE-009〜019、SCN-INT-CHOICE-003〜007 |

- **`trace:check`はAC↔SCNの対応の正しさを見ない。** 追加行の各列をscenarioの実体と人が原文で突合した。16件のSCNがすべてFeature fileに実在することを確認した。
- **用語IDの衝突を確認した。** 台帳の現行最大は083だが078と079は欠番であり、両IDを使うstagingは本Issueだけであることを他worktreeを含めて`grep`で確認した。
- **`AC-1044-xx`形式のIDは機械追跡の対象にならない。** `scripts/check_trace.ts`の`ACCEPTANCE_ID`が`AC-[A-Z][A-Z0-9]*-[0-9]{3,}`を要求するため、追跡表では既存のAC-SQ-003へ束ねた。

## 11. 総合判定と再開地点

**approved。** 未解決のCritical/Highは0件、blockingは0件である。**この`approved`は、人間による独立approvalを伴わないAIの最終裁定である**（9節）。

- 再開地点はStep 11の`pr create`である。
- **PR本文で#982と#998は`Relates to`とし、本PRで閉じない。** 両Issueは利用側での適用が済んでから閉じる。
- **`pr create`は作成直後のread-backで`binding_recovery_required`へ落ちることが既知である。** このとき副作用を再送しない。同じ入力で再実行すると`pull_request_complete`へ前進する。
- **CI赤の是正はラウンド3で完了した。予算は0である。** 再度赤になった場合は人へ返す。**赤を通す理屈を作らない。**
