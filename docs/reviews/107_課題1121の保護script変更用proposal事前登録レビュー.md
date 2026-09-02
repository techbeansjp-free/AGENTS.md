# 107 課題1121 保護script変更用proposalの事前登録 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**#1111のblockerであり、proposal registryへのentry追加だけを含む。** 適用は#1111の実装PRが行う。

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1121（#1111のblocker） |
| ラウンド | Step 10 ラウンド3（外部review反映） |
| 比較基点 | `b85a2f5a2a92e5d94f50fb69fdc0c44fb8b2bcb1` |
| H_impl | `85f2ba9bb9dfa1e43b5c0d70473588ed225b1b97` |
| 対象差分 | `.github/trusted-quality-proposals.json`へproposal 1件（23行） |
| 対象外 | #1111の是正内容、`PROTECTED_FILES`の増減、`qualityContractVersion`の実際の引き上げ、`allowedPaths`の乖離是正（#1047） |
| 残り予算 | **0。** Step 10の上限3ラウンドを使い切った |
| ラウンド数 | 3（Step 10のラウンド1から3）。**Step 7のreadiness checkは3ラウンド予算に数えない** |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260902_150603_1111の保護script変更用proposalを事前登録する |
| モード | full（Q-03が偽。trust境界の判定入力を変えるsecurity-boundary変更） |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-006とREQ-SQ-012。**本件は要件文を変えずregistryへentryを足す** |
| 成果物行数 | 製品: registry +23行。支援層: staging 00〜03が39952文字 |
| 縮小の先行評価 | 実施済み。**恒久Scenarioを新設しない。** registryはappend-onlyで増え続けるため、特定entryの存在をassertするtestは登録のたびに保守対象になる。schemaと判定規則は既存の`SCN-UNIT-PROPFIELD-001`〜`008`が検査する |
| authority | trust境界の判定入力を変える。**登録は適用と分離しており、本PRは保護fileを変更しない** |
| 実施者・日時 | reviewer、2026-09-02（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | critical（`minimumTierByRisk.authority`） | claude（`modelMapping.roles.reviewer.provider`。上限はOpus） | Opus 5、effort high | 未解決Critical/Highがあれば停止し、是正後に同sessionの次ラウンドで再review | implementerとreviewerはいずれも本sessionのAI agentであり、**Git commit authorも同一である。§9に実態どおり記録し、独立性が成立したとは主張しない** |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 登録が必須であること | `check_project_quality.ts --trusted-root=<main>`を#1111 branchで実行 | `candidateのtrusted品質契約変更はbaseで事前登録済みのversioned staged proposalと完全一致しません` | 実行観測 |
| 同一PRで登録できないこと | `scripts/check_project_quality.ts:422-432` | 「新たに保護対象へ加えるfileを、同じPRで変更させない」を明記。2026-08-27にbackdoor入りfileが`valid: true`で通った実測が根拠として書かれている | 静的読解 |
| afterSha256の一致 | `sha256sum`を#1111 branchの`scripts/check_project_quality.ts`へ実行 | `0702604760f7eb6b3083467a34e6c0b1319f5e3d4b4c1f0f560b71d13f9a1305`。registryの`afterSha256`と**完全一致** | 実測 |
| beforeSha256の一致 | mainの同file | `13e98bff1ed8d5b62a98003da9c335fffa40961cd1c94f82802ac22c9739150c` | 実測 |
| version遷移のhash | `sha256("10")`と`sha256("11")` | `4a44dc15…`と`4fc82b26…`。registryの`packageField` targetと一致 | 実測 |
| 既存entryの不変 | `git diff origin/main...HEAD` | 23行の追加のみ。既存12件の`proposalId`が不変 | 実測 |
| 差分の限定 | `git diff --name-only` | registry 1 fileのみ | 実測 |
| 許可pathの乖離 | `validateRoleOperation`へ実contractを注入 | `.github/trusted-quality-proposals.json`は`許可path外`。`scripts/check_project_quality.ts`は許可（#1113で追加済み） | 実行観測 |
| 先例 | `TQP-PROTECTED-READ-DIAGNOSIS-001`・`002`、Issue #1102 | 同型の別Issue登録が2件ある | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`#1111の実装 → hash計測 → #1121 → merge → #1111のPR作成可能`の一方向。artifact本文へ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl`が直前commitであり、`H_impl..HEAD`の差分は本artifact 1 fileのみ
- reviewer stable IDがPR author/観測済み`H_impl` author stable IDと異なる: **異ならない。** §9に実態を記録した
- 既定branch追随: **未実施。** `比較基点`は`origin/main`のtipと一致する

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository owner | project | 保護fileの変更に対する事前承認を1件足す。判定側のcodeを変更しない | registryは宣言データで呼び出しを持たない。循環なし | AC-1121-01〜04。SCN対応なし。既存`SCN-UNIT-PROPFIELD-001`〜`008`が回帰 | **merge後は削除できない。** 誤登録は適用しないまま残し、代替proposalを次番号で追加する | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-status`が`M`1件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 製品差分の修正は発生していない

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1121-ROLE-PATH-001 | `.github/trusted-quality-proposals.json`はimplementerの宣言済み`allowedPaths`に含まれない。`validateRoleOperation`が`許可path外`を返す | 宣言と実態の乖離。**ただし実施は妨げられない。** 強制点が存在しない（製品側の呼び出しが0件） | なし | **本作業のscope内では是正しない。** `01_開発ワークフロー.md`の新設節に従い3条件で軽微と判定した。既存の#1047へ帰属させ新規起票はしない | `validateRoleOperation`の実行結果。#1113のreview artifactが強制点の不在を記録 | no-spec-impact | pass |

**この判定は#1115で新設した規則の最初の自己適用である。** 3条件（是正せずにACを充足できる、成果物を歪めない、安全条件・authority分離・fail-closed不変条件に触れない）をすべて満たすため軽微とした。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1121-01 | 該当なし | registryの`proposals` | 13件で追加が`TQP-SNAPSHOT-OUTER-READ-001` | pass | registryの読み取り |
| AC-1121-02 | 該当なし | 追加entryの`afterSha256` | `0702604760f7…`が#1111 branchの実blobと完全一致 | pass | `sha256sum`との突合 |
| AC-1121-03 | 該当なし | 既存12件 | `proposalId`が不変。差分は追加のみ | pass | `git diff` |
| AC-1121-04 | 該当なし | 本PRの変更file集合 | registry 1件のみ。`scripts/check_project_quality.ts`を含まない | pass | `git diff --name-only` |
| AC-1121-05 | SCN-UNIT-PROPFIELD-001〜008、SCN-UNIT-LOCKPROT-001〜008 | 既存実装 | 変更なしで合格 | pass | §7 |
| AC-1121-06 | 該当なし | 判定規則 | **merge後に観測する。未成立** | not-applicable（本PRの範囲外。merge後にT05で確認する） | 観測時点はmerge後 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 保護fileの変更に対する事前承認そのものであり、trust境界の判定入力を変える | AC-1121-02のhash突合、AC-1121-04の差分確認。個人情報・秘密情報を扱わない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | not-applicable | ログ出力、相関情報、保持、rotation、監視、障害対応のいずれも追加・変更しない | 変更file集合がregistry 1件であること |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないJSON registryの変更である | `projectKind`が`cli`、`capabilities.humanCenteredUi`が`not-applicable` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たない | 同上 |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | hashが実blobと完全一致し、version遷移10→11が連続する。schemaを満たす |
| 価値 | 利用者・運用上の目的を満たすか | pass | #1111のblockerを解く。登録前は`valid: false`だった |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 先例2件と同じ形。判定側のcodeを変更しない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 00〜03とH_implの差分が一致する。新規SCNを追加せずACとSCNの追跡を実際の検査内容より強く見せていない |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | `proposalId`が用途を示す。既存entryへ触れない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | hashが1文字でもずれれば適用時に拒否される。実測で完全一致を確認した |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 単一fileへの追記で部分適用が残らない。schema不正は`project:quality`が拒否する |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `fromVersion` 10と`toVersion` 11が連続する。`proposalId`がregistry内で一意。`rationale`と`rollback`は日本語本文で制御文字を含まない |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | **`afterSha256`は内容の同一性だけを示す。登録権限と登録内容の真正性は保証しない。** 候補blobと登録済み`afterSha256`が不一致なら候補側のvalidatorが拒否するため、誤ったhashで任意の内容が承認済みになることはない。**登録の真正性はPR reviewとbranch保護が担い、hashは担わない。** AC-1121-02の実測突合は、誤登録によって#1111が適用時に拒否される事態を事前に防ぐためのものである。同一PRで保護fileを変更する自己参照はAC-1121-04が防ぐ |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 判定側のcodeを変更しない。`PROTECTED_FILES`も変えない。registryに認証情報が無いことを全文読取で確認した |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | append-onlyの追加のみ。既存12件が不変 |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | merge前はrevert。**merge後は削除できない。** `rollback`欄が代替proposalによる前進だけが復旧経路であると明記している |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | 配布境界に入らない（§8）。`allowedPaths`の乖離は#1047へ帰属させ記録した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | **merge後のentryは削除できない。** 誤登録が恒久的に残る | registryの`rollback`欄と先例`TQP-PROTECTED-READ-DIAGNOSIS-001`が適用されないまま残っている | registryの内容 | **本PRでは解かない。** append-onlyはregistryの設計であり、merge前のreviewが唯一の防御である。hashの実測突合を§1へ残した | valid（out-of-scope。record-only） | **残存する。** 設計上の性質 |
| M-02 | Medium | `.github/trusted-quality-proposals.json`がimplementerの許可path外である | `validateRoleOperation`の実行結果 | 宣言と実態の乖離 | **本PRでは解かない。** #1047へ帰属させる。強制点が存在しないため実施は妨げられない | valid（out-of-scope。record-only） | 残存する |

**Critical/High 0件。** Medium 2件はいずれも`out-of-scope`であり、有限レビュー契約に従い現ラウンドのscopeを拡大せず記録だけにする。

## 6. ラウンド固有の確認

### ラウンド1（Step 10、2026-09-02、candidate HEAD = `H_impl`）

- 全評価基準を確認した: はい。肯定5観点・敵対8観点をすべて評価した
- 指摘を確定した: はい。M-01、M-02。いずれも`out-of-scope`でrecord-only
- 次ラウンド対象のCritical/High: **なし**
- blocking: 0件

### ラウンド2（Step 10、2026-09-02、本ラウンド、candidate HEAD = `H_final`）

**本artifactをcommitするとHEADが動く。** 製品はartifact commitより前の`H_impl`で固定されるが、review sessionのcandidate HEADはcurrent HEADと一致する必要がある。したがって**本artifact自身が本ラウンドの対象差分である。**

- 未解決Critical/High: なし
- 修正差分: **review artifact 1 fileのみ。** 製品差分は無修正で`H_impl`のまま
- 修正で触れた隣接範囲: なし
- 収束の確認: `docs:format`、`audit:check`、`SCN-UNIT-ENTRY-001`がいずれも合格
- blocking: 0件

### ラウンド3（Step 10、2026-09-02、本ラウンド、外部review反映）

**CodeRabbitがMinor 2件を投稿し、いずれも本artifactの記述の誤りだった。** #1116では外部reviewの到着前にmergeして指摘を受け取れなかった。**本PRでは投稿を確認してから扱った。**

| ID | 内容 | 対応 |
|---|---|---|
| R3-L01 | `afterSha256`の因果説明が誤り。「誤ったhashで任意の内容を承認済みにできる、それを実測突合が防ぐ」と書いたが、**不一致なら候補側のvalidatorが拒否する。** `afterSha256`は内容の同一性だけを示し、登録権限と真正性は保証しない | 因果を訂正し、真正性はPR reviewとbranch保護が担うと明記した |
| R3-L02 | 「配布digestが変わらず自動releaseは発火しない」が不正確。**`release.yml`は`main`へのpushで起動する。** `planAutoRelease`が現行tagの存在とdigest一致で計画を`skipped`にする | 起動と計画を分けて記述し、`src/domain/release.ts`の実装で確認した |

- 未解決Critical/High: なし
- 修正差分: **review artifact 1 fileのみ。** 製品差分は無修正で`H_impl`のまま
- blocking: 0件
- **予算を使い切った。** これ以降にHEADが変わる是正が必要になった場合は`budget-exhausted`として扱う

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---|---|---|---|
| 文書・受け入れ形式 | `npm run docs:format` / `npm run test:format` | 2 | 2 | 0 | 0 | pass |
| 静的検査・整形・型 | `npm run lint` / `format:check` / `typecheck` | 3 | 3 | 0 | 0 | pass |
| repository固有policy・source契約 | `npm run project:quality` / `source:check` | 2 | 2 | 0 | 0 | pass |
| 追跡・構造 | `npm run trace:check` / `architecture:check` | 2 | 2 | 0 | 0 | pass。孤立0件 |
| 配布物 | `npm run build` / `package:check` | 2 | 2 | 0 | 0 | pass |
| conformance | `npm run conformance:check` | project rule 20件 | 20 | 0 | 0 | pass。orphan 0件 |
| 全test層（unit・integration・e2e、runnerはcucumber-js） | `npm test` | 1392 scenarios / 7349 steps | 1376 / 7299 | 0 / 0 | 16 / 50 | pass |
| レビュー成果物の監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

**skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する。** 本差分はJSON registryだけでこの経路に触れない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | なし |

判断: 配布物を更新しない

根拠: `package.json`の`files`は`.github/`を含まない。したがって本変更は配布digestを変えない。

**releaseの起動と計画は分けて記録する。** `.github/workflows/release.yml`は`main`への`push`で起動するため、**workflow自体は起動する。** その後`planAutoRelease`（`src/domain/release.ts`）が、現行tagが存在し現在と前回の配布digestが一致する場合に計画を`skipped`とする。本変更は配布digestを変えないため、**現行tag `v0.3.1-beta.57`が存在する前提で計画は`skipped`となり、version bump・tag・GitHub Releaseは作られない見込みである。** 現行tagが無い場合はdigest比較の前にrelease計画になる。**「発火しない」ではなく「起動するが計画がskipされる」が正確である。**

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **本artifact作成時点では無い。** exact-headは`H_final`。immutable GitHub reviewは0件 |
| reviewerがPR author・実装commit authorと異なる | **異ならない。** implementerもreviewerも本sessionの同一AI agentであり、Git commit authorも同一である |
| 観測したreview commentとapprovalの件数 | 本session内のreview 2ラウンド（Critical/High 0、Medium 2はいずれも`out-of-scope`）。GitHub review 0件 |

**`02_品質基準.md`の「独立reviewが成立しない場合」に従う。** 同節は「既定は停止ではなく、無記録での通過の禁止である」と定め、既定branchへのmergeには門を置かないと規定している。

**PR作成後の外部reviewを必ず待つ。** 直前の#1116では外部reviewer CodeRabbitがMajor 4件・Minor 1件を投稿したが、**mergeが11秒先行して指摘を受け取れなかった。** 同じ失敗を繰り返さないため、本PRは**CodeRabbitのreviewが投稿されたことを確認してからmergeする。** 未解決threadが0件であることは「指摘なし」と「まだ来ていない」を区別しないため、merge条件にしない。

## 10. 仕様整合性

- 判定: no-spec-impact
- 更新した仕様: なし
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。新規用語を導入していない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass
- 要件・変更・SCN・テストの追跡: FR-1121-01〜04 → AC-1121-01〜06。AC-1121-05 → 既存`SCN-UNIT-PROPFIELD`・`SCN-UNIT-LOCKPROT`群
- `no-spec-impact`の場合の限定的根拠: **REQ-SQ-006とREQ-SQ-012は二段階承認の枠組みだけを定め、個々のproposal内容を列挙していない。** 先例`TQP-PROTECTED-READ-DIAGNOSIS-001`・`002`の登録でも仕様は更新されていない
- UI・トークンの判断: UIを所有しないためdesign token・layout tokenは対象外。ADRを追加しない

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし**
- Medium/Lowの記録: M-01（append-onlyで削除不能）、M-02（許可path外）。いずれも`out-of-scope`
- 判定: approved（Step 10 ラウンド3。**予算を使い切った**）
- 新しい権限が必要な事項: mergeは別authority
- 残存リスク:
  1. **merge後のentryは削除できない。** 誤登録が恒久的に残る。merge前のreviewが唯一の防御である
  2. **hash計測時点と適用時点の間に#1111 branchが変わると陳腐化する。** 本件merge後に#1111の`scripts/check_project_quality.ts`を変更しないことで防ぐ。変更が必要なら代替proposalを次番号で追加する
  3. `.github/trusted-quality-proposals.json`が許可path外である（#1047）
  4. **AC-1121-06はmerge後にしか観測できない。** 効かない場合は代替proposalで対処する
- 次に許可される操作: push、PR作成、**CodeRabbitのreview投稿を確認**、必須check2件の全緑確認、およびownerが承認したauthorityによる**通常merge commit方式**でのmerge。**squash mergeを使わない**
- 次回の再開地点: PR作成とCodeRabbitのreview到着確認から
