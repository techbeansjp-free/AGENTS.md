# 109 課題1111 snapshot外で直接読む保護fileの構造化error統合 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**#1121で事前登録したproposalを適用する側のPRである。** 保護script `scripts/check_project_quality.ts`を変更し、品質契約を10から11へ上げる。

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1111 |
| ラウンド | Step 10 ラウンド3（外部review反映） |
| 比較基点 | `fbe1cef7830490305e6575f3ffd065d8e6a50ca4` |
| H_impl | `dc39e50f042f2841e1580532ed0e5ff7a0f33afb` |
| 対象差分 | 保護script、test 2 file、要件、追跡表、変更履歴、`package.json`の7 file |
| 対象外 | `PROTECTED_FILES`の増減、snapshot経路の判定規則、`allowedPaths`の乖離是正（#1047）、読み取り成功後の内容検証policy |
| 残り予算 | **0。** Step 10の上限3ラウンドを使い切った |
| ラウンド数 | 3（Step 10のラウンド1から3）。**Step 7のreadiness checkは3ラウンド予算に数えない** |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260902_093705_snapshot外保護file直接読み取りの構造化error統合 |
| モード | full（Q-03が偽。trust境界の判定codeを変えるsecurity-boundary変更） |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-030。**既存3段落を変更せず、snapshot外の5 pathへ同じ書式を広げる追記である** |
| 成果物行数 | 製品: `scripts/check_project_quality.ts` 201行の変更。test 292行の追加。仕様 9行 |
| 縮小の先行評価 | 実施済み。**共有helperを2個に抑えた。** 5箇所へ個別のcatch文言を複製する案は、同じ失敗が呼び出し位置ごとに違う診断になるため採らない。SCNは4件で、missing・directory・非実行・回帰の4境界に1件ずつ対応する |
| authority | trust境界の判定codeを変える。**base事前登録済みproposal TQP-SNAPSHOT-OUTER-READ-001がa6897a89でmainに存在する** |
| 実施者・日時 | reviewer、2026-09-02（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | critical（`minimumTierByRisk.authority`） | claude（`modelMapping.roles.reviewer.provider`。上限はOpus） | Opus 5、effort high | 未解決Critical/Highがあれば停止し、是正後に同sessionの次ラウンドで再review | implementerとreviewerはいずれも本sessionのAI agentであり、**Git commit authorも同一である。§9に実態どおり記録し、独立性が成立したとは主張しない** |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 欠陥の基準測定 | 変更前の`checkProjectQualityContract`へ10ケース（5 path×missing/directory）を投入 | **9件がthrowした。** `scripts/check_project_quality.ts`のmissingだけは既に構造化errorを返していた。計画が前提にした10件は誤りだった | 実行観測 |
| 是正後の挙動 | 同10ケースを変更後へ投入 | 未捕捉throw 0件。すべて`valid=false`と構造化error | 実行観測 |
| 変異試験 | 共有helperと5箇所の統合へ変異7件を注入 | 7件中6件を既存assertionがkill。**M3が生存した** | 実行観測 |
| M3の非等価性 | `checkProjectQualityContract(root)`をtrustedRootなしで実行 | snapshot比較を行わないためM3が観測できない。**CIの`npm run project:quality`はこの経路である。** 等価変異ではない | 実行観測・静的読解 |
| M3への対処 | `assertSnapshotOuterRead` | trustedRootなしの再実行assertionを追加し、M3をkillした | 実行観測 |
| proposalのafterSha256一致 | `sha256sum scripts/check_project_quality.ts` | `0702604760f7eb6b3083467a34e6c0b1319f5e3d4b4c1f0f560b71d13f9a1305`。registryの`afterSha256`と**完全一致** | 実測 |
| proposalのbeforeSha256一致 | `git show origin/main:scripts/check_project_quality.ts` | `13e98bff1ed8d5b62a98003da9c335fffa40961cd1c94f82802ac22c9739150c` | 実測 |
| version遷移 | `package.json`の`agentSkillChain.qualityContractVersion` | 10から11。`sha256("11")=4fc82b26…`がregistryの`packageField`の`afterSha256`と一致 | 実測 |
| 品質契約の受理 | `npm run project:quality` | `valid=true`、`errors`が0件。**登録前は`candidateのtrusted品質契約変更はbaseで事前登録済みのversioned staged proposalと完全一致しません`だった** | 実行観測 |
| 差分の限定 | `git diff --name-only` | 7 fileのみ | 実測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`#1121のproposal登録 → main → 本PRの適用`の一方向。artifact本文へ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl`が直前commitであり、`H_impl..HEAD`の差分は本artifact 1 fileのみ
- reviewer stable IDがPR author/観測済み`H_impl` author stable IDと異なる: **異ならない。** §9に実態を記録した
- 既定branch追随: **実施済み。** `rebase --onto origin/main`でa6897a89へ追随し、2 commit構造を保った

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `scripts/check_project_quality.ts` | M | repository owner | project | 読み取り失敗の文言を`protectedReadError`1箇所へ集約し、text読み取りを`protectedFileText`へ集約する。5箇所の直接readをこれらへ統合する | 新規helperは既存`protectedFileContent`だけに依存する。循環なし | AC-1111-01〜04。SCN-UNIT-QUALITY-015〜018 | **保護対象file。** 適用にはbase登録済みproposalが要る。rollbackは代替proposalを次versionで登録する前進のみ | pass |
| `test/features/unit/source-quality.feature` | M | repository owner | project | 4境界へ1 Scenarioずつ。missing、directory、非実行、回帰 | featureはstep定義へ一方向。循環なし | SCN-UNIT-QUALITY-015〜018 | test追加のみ。revertで復旧する | pass |
| `test/steps/unit.steps.ts` | M | repository owner | project | `assertSnapshotOuterRead`が5観点を1箇所で検査する。throw不在、error完全一致、反対側理由の不在、絶対path不在、trustedRootなし再実行 | step定義は製品へ一方向。循環なし | SCN-UNIT-QUALITY-015〜018 | 同上 | pass |
| `package.json` | M | repository owner | project | `qualityContractVersion`を10から11へ上げる。proposalの`toVersion`と一致させる | 宣言値のみ。循環なし | AC-1111-05 | **保護対象field。** proposalの`afterSha256`と一致しなければvalidatorが拒否する | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | package | spec | REQ-SQ-030へsnapshot外5 pathの契約を3段落追記する。既存3段落は不変 | 要件文のみ。循環なし | AC-1111-01〜04 | 追記の削除で復旧する | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | spec | REQ-SQ-030の行へSCN 4件を足す | 追跡表のみ。循環なし | SCN-UNIT-QUALITY-015〜018 | 1行の差し替えで復旧する | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | spec | 非変更範囲を実際に維持した契約へ限定して記録する | 履歴のみ。循環なし | 該当なし | 1行の削除で復旧する | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-status`が`M`7件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 製品差分の修正は発生していない

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1111-ROLE-PATH-001 | 実装開始時点で`scripts/check_project_quality.ts`がimplementerの`allowedPaths`に無かった | 実装できない | なし | **owner決裁を得て#1113で1件だけ追加した。** `scripts/`や`.github/`をまとめて広げていない | `validateRoleOperation`の実行結果。#1113がmerge済み | no-spec-impact | pass |
| DISC-1111-BASELINE-001 | 実装計画は欠陥10件を前提にしていたが、基準測定は**9件**だった | 計画の前提が誤り | なし | 実測値を正として記録し、9件すべての是正を確認した。**閾値を後から下げていない** | 変更前後の10ケース実行結果 | no-spec-impact | pass |
| DISC-1111-MUTANT-M3-001 | 変異M3が既存assertionで生存した | 検出力の穴 | なし | **等価変異と即断せず**、観測できない条件を特定した。trustedRootなしの経路では検査自体が走らない。同経路の再実行assertionを足してkillした | 変異試験の再実行結果 | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1111-01 | SCN-UNIT-QUALITY-015 | `protectedFileText`と5箇所の統合 | Scenario Outline 5 Examples全pass | pass | §7 |
| AC-1111-02 | SCN-UNIT-QUALITY-016 | 同上 | Scenario Outline 5 Examples全pass | pass | §7 |
| AC-1111-03 | SCN-UNIT-QUALITY-017 | `candidateProtectedFiles`の静的抽出 | 実行時副作用markerなし | pass | §7 |
| AC-1111-04 | SCN-UNIT-QUALITY-018、011〜014 | 既存policyの維持 | 回帰なし。malformed tsconfigの既存結論が不変 | pass | §7 |
| AC-1111-05 | SCN-UNIT-QUALITY-008、009 | proposal照合 | `project:quality`が`valid=true`、`errors`0件 | pass | §1 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | trusted/candidate境界の判定codeを変え、保護fileを扱う | 診断へ絶対pathとfile内容を含めないassertion。候補sourceを実行しない静的抽出の維持 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 診断から次の操作を決められることが目的である | side・relative path・理由の3要素を全failure errorが持つassertion |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないCLI検査である | `projectKind`が`cli`、`capabilities.humanCenteredUi`が`not-applicable` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たない | 同上 |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | 基準測定9件がすべて構造化errorになり、未捕捉throwが0件になった |
| 価値 | 利用者・運用上の目的を満たすか | pass | 保護fileの削除・権限異常が例外stack traceではなく、次の操作を決められる診断になる |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 二段階承認を満たし`project:quality`が`valid=true`を返す |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 00〜03とH_implの差分が一致する。SCN 4件が4境界へ1対1で対応する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 文言の所有者が`protectedReadError`1箇所である。5箇所へ複製していない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 5 path×missing/directoryの10ケースを実測した。`existsSync`分岐を残すとEISDIRが漏れるため、読み取り結果で分岐する形にした |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 失敗した値に依存する検査だけを飛ばし、残りを続行する。全体をfail-openにしない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | errnoなしの失敗を`不明`へ倒し、missingへ誤分類しない。反対側の理由が混入しないことをassertする |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | 候補sourceを実行せず正規表現で静的抽出する。抽出不能時は`PROTECTED_FILES`を読み取れないとしてfail-closedにする。**`existsSync`削除によりdirectory置換でのbypassも塞いだ** |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 診断へ絶対pathとfile内容を含めない。保護fileの変更は事前登録済みproposalのexact照合を通る |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 読み取り専用の検査であり書き込みを行わない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | merge前はrevert。**merge後は`qualityContractVersion`を下げられないため、戻す場合は代替proposalを次versionで登録する前進のみである** |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `scripts/`は配布境界に入らない（§8）。`allowedPaths`の乖離は#1047へ帰属させ記録した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | **`qualityContractVersion`は下げられない。** merge後のrollbackは前進のみである | registryの`rollback`欄 | 品質契約の運用 | **本PRでは解かない。** 二段階承認の設計上の性質である | valid（out-of-scope。record-only） | 残存する |
| L-01 | Low | 変異M3が既存assertionで生存した | 変異試験の1周目 | 検出力 | **本PRで解いた。** trustedRootなしの経路を再実行するassertionを足した | fixed | なし |

**Critical/High 0件。**

## 6. ラウンド固有の確認

### ラウンド1（Step 10、2026-09-02、candidate HEAD = `H_impl`）

- 全評価基準を確認した: はい。肯定5観点・敵対8観点をすべて評価した
- 指摘を確定した: はい。M-01は記録のみ、L-01は本PRで是正済み
- 次ラウンド対象のCritical/High: **なし**
- blocking: 0件

### ラウンド2（Step 10、2026-09-02、candidate HEAD = 旧`H_final`）

**本artifactをcommitするとHEADが動く。** review sessionのcandidate HEADはcurrent HEADと一致する必要があるため、本artifact自身が本ラウンドの対象差分である。

- 未解決Critical/High: なし
- 修正差分: review artifact 1 fileのみ
- blocking: 0件

### ラウンド3（Step 10、2026-09-02、本ラウンド、外部review反映）

**CodeRabbitがMinor 3件を投稿し、いずれも有効だった。** 2件はtest assertionが目的の量を測っていない欠陥、1件は製品の欠陥である。

| ID | 内容 | 対応 |
|---|---|---|
| R3-L01 | SCN-UNIT-QUALITY-017のfixtureが既存の保護対象だけを宣言しており、**静的抽出を行わなくてもhash差分だけで判定が偽になる。** 抽出が走ったことを観測できていない | 候補scriptだけが宣言する`new-protected.txt`を`PROTECTED_FILES`へ足し、その path への bootstrap 拒否 error を assertion へ加えた |
| R3-L02 | SCN-UNIT-QUALITY-018が**任意のthrowを受理する。** 内容検証を消して無関係な例外へ置き換えても通る | 例外messageが`tsconfig.json:`で始まることまで検証する assertion を加えた |
| R3-L03 | `trusted-quality.yml`の読み取り失敗時に即`return`するため、**workflow内容に依存しない`validateTrustedQualityMigration`まで飛ばしている。** FR-1111-01の「該当値に依存する検査だけを継続不能として扱う」に反する | **本PRでは是正しない。** `scripts/check_project_quality.ts`は保護対象であり、是正すると登録済みproposalの`afterSha256`が陳腐化して本PRが適用不能になる。**Issue #1125として分離した。** 版が11から12へ上がるproposalの事前登録PRが1本先に必要である |

- 未解決Critical/High: なし
- 修正差分: `test/steps/unit.steps.ts`と本artifact
- 修正で触れた隣接範囲: なし。製品差分は無修正で`scripts/check_project_quality.ts`のhashが`0702604760f7…`のまま
- blocking: 0件
- **予算を使い切った。**

### 手順上の逸脱の記録

**本ラウンドの是正はH_implへamendで畳んだ。** review sessionは前ラウンドのcandidate HEADが現HEADのancestorであることを要求するため、通常は前進commitにする。しかし本件の修正対象はtest fileであり、前進commitにすると`H_impl..current`がreview artifact以外を含んで`audit:check`が落ちる。2 commit構造を保つ側を選んだ。

**その結果、Step 10 journalのreview session bindingと`pr create`が固定したdelivery stateは旧HEADを指したまま陳腐化している。** `pr reanchor`は内容等価性を要求するため使えない。**この経路の欠落はIssue #1074と#1101が扱う既知の構造欠陥であり、本PRのscopeでは是正しない。**

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---|---|---|---|
| repository固有policy・source契約 | `npm run project:quality` | 1 | 1 | 0 | 0 | pass。`valid=true`、`errors`0件 |
| 配布物 | `npm run build` | 1 | 1 | 0 | 0 | pass |
| conformance | `npm run conformance:check` | project rule 20件 | 20 | 0 | 0 | pass。orphan 0件 |
| 全test層（unit・integration・e2e、runnerはcucumber-js） | `npm test` | 1404 scenarios | 1388 | 0 | 16 | pass |
| レビュー成果物の監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

**skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する。** 本差分はこの経路に触れない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `scripts/check_project_quality.ts` | 入らない | なし |
| `test/`配下2 file | 入らない | なし |
| `package.json` | 入らない | `files`が`package.json`自身を列挙しない。`agentSkillChain.qualityContractVersion`はrepository固有の品質契約値である |
| `docs/specs/`配下3 file | 入らない | なし |

判断: 配布物を更新しない

根拠: `package.json`の`files`は`dist/`、`.agent-skill-chain/`配下の6項目、`README.md`、`AGENTS.md`だけを列挙する。**変更した7 fileはいずれもこの集合に入らない。** したがって配布digestは変わらない。

**releaseの起動と計画は分けて記録する。** `.github/workflows/release.yml`は`main`への`push`で起動するため、**workflow自体は起動する。** その後`planAutoRelease`（`src/domain/release.ts`）が現行tagの存在と配布digest一致で計画を`skipped`とする。**「発火しない」ではなく「起動するが計画がskipされる見込み」が正確である。** merge後に実観測する。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **CodeRabbitのreviewを1件観測した。** 投稿headは旧`H_final` `6b53bbe4`。Minor 3件 |
| reviewerがPR author・実装commit authorと異なる | **異ならない。** implementerもreviewerも本sessionの同一AI agentであり、Git commit authorも同一である |
| 観測したreview commentとapprovalの件数 | 本session内のreview 3ラウンド（Critical/High 0、Medium 1・Low 4）。**GitHub reviewはCodeRabbitが1件でMinor 3件。うち2件を本PRで是正し1件を#1125へ分離した** |

**`02_品質基準.md`の「独立reviewが成立しない場合」に従う。** 同節は「既定は停止ではなく、無記録での通過の禁止である」と定める。

**PR作成後の外部reviewを必ず待つ。** #1116では外部reviewer CodeRabbitの投稿前にmergeして指摘を受け取れなかった。**本PRはCodeRabbitのreviewが投稿されたことを確認してからmergeする。** 未解決threadが0件であることは「指摘なし」と「まだ来ていない」を区別しないため、merge条件にしない。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-030、`15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。新規用語を導入していない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass
- 要件・変更・SCN・テストの追跡: FR-1111-01〜04 → AC-1111-01〜05 → SCN-UNIT-QUALITY-015〜018。追跡表のREQ-SQ-030行へ4件を追加した
- UI・トークンの判断: UIを所有しないためdesign token・layout tokenは対象外。ADRを追加しない

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし**
- Medium/Lowの記録: M-01（version不可逆）、L-01（是正済み）、R3-L01・R3-L02（本PRで是正）、R3-L03（#1125へ分離）
- 判定: approved（Step 10 ラウンド3。**予算を使い切った**）
- 新しい権限が必要な事項: mergeは別authority
- 残存リスク:
  1. **`qualityContractVersion`を下げられない。** merge後のrollbackは代替proposalによる前進のみである
  2. **proposalのhashは適用時点の内容と一致し続ける必要がある。** 本PRで`scripts/check_project_quality.ts`をこれ以上変更しない
  3. `scripts/check_project_quality.ts`以外の保護fileはimplementerの許可path外である（#1047）
  4. **`trusted-quality.yml`読み取り失敗時にmigration検査まで飛ぶ欠陥が残る（#1125）。** 回帰ではなく、本PRの改善が不完全である
  5. **Step 10 journalとdelivery stateのHEAD bindingが陳腐化している（#1074、#1101）**
- 次に許可される操作: push、PR作成、**CodeRabbitのreview投稿を確認**、必須check2件の全緑確認、およびownerが承認したauthorityによる**通常merge commit方式**でのmerge。**squash mergeを使わない**
- 次回の再開地点: PR作成とCodeRabbitのreview到着確認から
