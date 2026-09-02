# 110 課題1117 Step skillから規範文書へのlink検証 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**#1115で新設した規範節へStep 9 skillが張ったlinkが、検査されていなかった問題の是正である。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1117 |
| ラウンド | Step 10 ラウンド2（外部review反映） |
| 比較基点 | `cc545bbf76c96ee9964ce83170cb64a743114f8e` |
| H_impl | `c8b2be567a80978ab69e7b95b72c869557760cbe` |
| 対象差分 | 検査script、test 2 file、要件、追跡表、変更履歴の6 file。**ラウンド2の是正をH_implへ畳んだ** |
| 対象外 | `docs/specs/`のlink検証、見出し命名規則の変更、新規scriptの新設、`templates/`向けlink検査の判定変更 |
| 残り予算 | Step 10の上限3ラウンドのうち1を残す |
| ラウンド数 | 2（Step 10のラウンド1と2）。**Step 7のreadiness checkは3ラウンド予算に数えない** |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260902_162936_skills-checkがStep-skillからdocsへの相対linkを検証しない |
| モード | full（Q-01とQ-05が偽。外部観測可能な判定結果とCI gateの合否条件を変える） |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-008。**本文を1文延ばして新規SCNへ到達可能にする** |
| 成果物行数 | 製品: `scripts/check_skill_templates.ts` +115行。test +209行。仕様 +5行。支援層: staging 00〜03が31985文字 |
| 縮小の先行評価 | 実施済み。**関数を2個に抑えた。** Markdown parserの導入、対象範囲の拡大、GitHub slug規則の完全再現の3案を不採用にし、根拠と残存リスクを02の§12へ記録した |
| authority | 変更しない。検査はread-onlyであり、trust境界の判定入力に触れない |
| 実施者・日時 | reviewer、2026-09-02（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | advanced（`minimumTierByRisk`のmedium） | claude（`modelMapping.roles.reviewer.provider`） | Opus 5、effort high | 未解決Critical/Highがあれば停止し、是正後に同sessionの次ラウンドで再review | implementerとreviewerはいずれも本sessionのAI agentであり、**Git commit authorも同一である。§9に実態どおり記録し、独立性が成立したとは主張しない** |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 再現手順1（anchor不在） | Issue #1117記載の`sed`と`npm run skills:check` | 変更前は`valid: true`。**変更後は`valid: false`で`リンク先に見出しがありません`** | 実行観測 |
| 再現手順2（file不在） | 同上 | 変更前は`valid: true`。**変更後は`valid: false`で`リンク先がありません`** | 実行観測 |
| 現行skillの合格 | `npm run skills:check` | 変更前後ともに`valid: true`、`skills: 12` | 実行観測 |
| 検査対象のlink実態 | `grep`で全skillの`../../docs/`向けlinkを列挙 | file 1件（`01_開発ワークフロー.md`）、anchor 3種、anchorなし1件 | 実測 |
| 変異試験 | 新規codeへ変異9件を注入し`SCN-UNIT-PACKAGE-017〜019`を実行 | **9件すべてkill。** 呼び出し削除で2件失敗、他は1件ずつ失敗。ラウンド2で足したdocs root境界判定とanchor復号の2件も個別にkillした | 実行観測 |
| 既存診断の不変 | `git diff` | `templates境界外です`、`リンク先がありません`、`symlinkでtemplates境界外です`の3診断とその判定条件に変更が無い | 静的読解 |
| 差分の限定 | `git diff --name-only` | 6 fileのみ | 実測 |
| 所有要件 | `docs/specs/15_要件追跡/00_追跡表.md` | `SCN-UNIT-PACKAGE-013`がREQ-WF-005、REQ-SQ-005、REQ-SQ-008、REQ-SQ-009へ結ばれている。skill契約の内容はREQ-SQ-008が所有する | 静的読解 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`check_skill_templates → docs_link_check → heading_slug`の一方向。artifact本文へ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl`が直前commitであり、`H_impl..HEAD`の差分は本artifact 1 fileのみ
- reviewer stable IDがPR author/観測済み`H_impl` author stable IDと異なる: **異ならない。** §9に実態を記録した
- 既定branch追随: **実施済み。** `rebase --onto origin/main`で追随し、`15_要件追跡/01_変更履歴.md`の衝突を両側の行を保存する形で解消した

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `scripts/check_skill_templates.ts` | M | package | package | `headingSlug`が照合keyの導出を、`checkDocumentLinks`が到達性判定を単独で持つ。既存ループへ1呼び出しだけ足す。**docs root自身の境界判定を関数の先頭に置く** | 新規関数は引数だけに依存する。既存関数からの逆参照なし。循環なし | AC-1117-01〜03。SCN-UNIT-PACKAGE-017〜019 | read-onlyであり状態を変えない。revertで完全に戻る | pass |
| `test/features/unit/review-policy-package.feature` | M | package | package | 4境界（file不在、anchor不在、docs境界外、symlink脱出）を3 Scenarioへ割り当てる | featureはstep定義へ一方向。循環なし | 同上 | test追加のみ | pass |
| `test/steps/unit.steps.ts` | M | package | package | `DOCUMENT_LINK_BREAKS`が壊し方を宣言的に持ち、fixture生成を1箇所へ集約する | step定義は製品へ一方向。循環なし | 同上 | 同上 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | package | spec | REQ-SQ-008へ1文追記し、根拠と実装欄へ本件を足す | 要件文のみ。循環なし | AC-1117-01〜03 | 追記の削除で復旧する | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | spec | REQ-SQ-008を含む行へSCN 3件と実装1件を足す | 追跡表のみ。循環なし | SCN-UNIT-PACKAGE-017〜019 | 1行の差し替えで復旧する | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | spec | 非変更範囲を実際に維持した契約へ限定して記録する | 履歴のみ。循環なし | 該当なし | 1行の削除で復旧する | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-status`が`M`6件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 製品差分の修正は発生していない

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1117-SYMLINK-001 | 変異試験の1周目で、`realpath`によるsymlink境界判定を無効化する変異が生存した。当初のfixtureにsymlink脱出の例が無かった | 検出力の穴 | なし | **等価変異と即断せず**、docs配下に見えて境界外を指すsymlinkのfixtureを足した。再実行でkillした | 変異試験の再実行結果 | no-spec-impact | pass |
| DISC-1117-PLACEHOLDER-001 | `issue validate --stage=design`が、02に残ったtemplate由来の括弧placeholder 2件を拒否した | readiness checkの不合格 | なし | 「設計中に発見した未定義語・意味変更」と「性能・負荷確認」の見出し括弧を答えへ置き換えた | 再実行で`valid: true` | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1117-01 | SCN-UNIT-PACKAGE-017 | `checkDocumentLinks`のfile実在判定とdocs境界判定 | pass | pass | §7 |
| AC-1117-02 | SCN-UNIT-PACKAGE-018 | `headingSlug`とanchor照合 | pass。**file不在の診断へ倒れていないことまで検証する** | pass | §7 |
| AC-1117-03 | SCN-UNIT-PACKAGE-019 | 実package rootでの判定 | pass。`valid: true`、`skills: 12` | pass | §7 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | not-applicable | 認証情報も個人情報も扱わず、trust境界の判定入力を変えない | 変更対象がread-onlyのlink照合であること |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | どのskillのどのlinkが壊れたか診断だけで特定できることが目的である | 3診断がいずれもskill名とlink文字列を含み、絶対pathとfile内容を含まない |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないCLI検査である | `projectKind`が`cli` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たない | `capabilities.designTokens`が`not-applicable` |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | Issue記載の再現手順2件が変更前後で逆転し、現行12 skillは合格したままである |
| 価値 | 利用者・運用上の目的を満たすか | pass | 配布されるskillの参照先が実在することがmerge前に保証される |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 追加依存が無く、file読み取りだけで完結する |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の3コンポーネントがそのまま2関数と1呼び出しになり、AC 3件とSCN 3件が1対1で対応する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | slug規則の所有者が`headingSlug`1箇所である。壊し方は`DOCUMENT_LINK_BREAKS`が宣言的に持つ |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | anchorなしlink、anchor空文字、docs境界外、link先symlink脱出、**docs root自身のsymlink脱出**、**不正なpercent-encoding**の6条件を実測した |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 1 linkの失敗で他のlinkの検証を止めず、errorを積んで継続する。読み取り失敗と**anchorの復号失敗**をいずれも`try`で捕らえ未捕捉throwにしない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | link一覧は重複除去して整列する。anchorは`decodeURIComponent`で正規化してから照合する。**記号を含む見出しへのlinkは現行に存在せず、slug規則を近傍に限定した判断を02の§12へ残した** |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | `../../docs/../../etc/passwd`形式の脱出をdocs境界判定が拒否する。docs配下に見えるsymlinkは`realpath`が拒否する。**docs root自体がnamespace外を指すsymlinkの場合も、境界の基準を取る前に拒否する。** 3件すべてをassertionが観測する |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 診断へ絶対pathとfile内容を含めない。外部processを起動しない。書き込みを行わない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 読み取り専用の検査である。破壊系Scenarioは一時directoryへ複製したrootだけを変更する |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | merge前後ともrevertで戻る。保護対象fileを変更しないため二段階承認を要しない |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `scripts/`と`test/`は配布境界に入らない（§8）。**検査対象は配布物であるskillだが、検査code自体は配布されない** |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | anchor照合規則がGitHubの見出しslug規則の一部しか再現しない | `headingSlug`の実装 | 記号を含む見出しへlinkした場合の誤判定 | **本PRでは広げない。** 現行7 skillのlinkに該当が無いことを実測した。02の§12へ不採用理由を記録済み | valid（記録のみ） | **残存する。** 該当linkが現れたら規則を広げる |
| M-02 | Medium | 検査対象を`../../docs/`接頭辞へ限定している | `checkDocumentLinks`の抽出正規表現 | 将来別境界へのlinkが増えたとき検出できない | **本PRでは広げない。** `docs/specs/`は所有者が異なる | valid（out-of-scope。record-only） | 残存する |
| L-01 | Low | 変異試験1周目でsymlink境界判定の変異が生存した | 変異試験の記録 | 検出力 | **本PRで解いた。** symlink脱出のfixtureを足してkillした | fixed | なし |

**Critical/High 0件。**

## 6. ラウンド固有の確認

### ラウンド1（Step 10、2026-09-02、candidate HEAD = `H_impl`）

- 全評価基準を確認した: はい。肯定5観点・敵対8観点をすべて評価した
- 指摘を確定した: はい。M-01、M-02は記録のみ、L-01は本PRで是正済み。**ラウンド2でR2-H01からR2-H03を追加確定し、いずれも是正した**
- 次ラウンド対象のCritical/High: **なし**
- blocking: 0件

### ラウンド2（Step 10、2026-09-02、本ラウンド、外部review反映）

**CodeRabbitがMajor 3件を投稿し、いずれも有効だった。** 2件は製品の欠陥、1件は仕様追跡の欠落である。

| ID | 重大度 | 内容 | 対応 |
|---|---|---|---|
| R2-H01 | Major | **`docsRoot`自体がnamespace外へのsymlinkなら境界判定を素通りする。** 個別linkの`realpath`判定は境界の基準をdocs rootから取るため、基準そのものが外へ出ると全linkが「境界内」になる | `realpath(docsRoot)`が`realpath(namespaceRoot)`配下であることを関数の先頭で検証し、満たさなければ他の判定へ進まず拒否する。docs rootごとsymlinkへ置換するfixtureを足した |
| R2-H02 | Major | **`#bad%`のような不正なpercent-encodingで`decodeURIComponent`が例外を投げる。** 対象skillとlinkを含む構造化診断を返せず異常終了する | 復号失敗を`anchorを復号できません`の診断へ変換した。fixtureを足した |
| R2-H03 | Major | REQ-SQ-008の実装欄と追跡表の実装欄に`scripts/check_skill_templates.ts`が無い | 両方へ追加し、REQ-SQ-008の根拠へ`#1117`を足した |

**是正をH_implへ畳んだ。** 修正対象が製品codeとtestであり、前進commitにすると`H_impl..current`がreview artifact以外を含んで`audit:check`が落ちる。既定branch追随のrebaseと同じcommitへまとめ、2 commit構造を保った。

- 未解決Critical/High: なし
- 修正差分: `scripts/check_skill_templates.ts`、`test/steps/unit.steps.ts`、仕様3 file
- 修正で触れた隣接範囲: なし。既存の`templates/`向け3診断は不変
- 変異試験: 追加した2つのガードへ変異を個別に注入し、いずれもkillした
- blocking: 0件

### ラウンド3

- 未実施。同一範囲の予算3のうち1を残している

### 手順上の逸脱の記録

**Step 10 journalのreview session bindingと`pr create`が固定したdelivery stateは旧HEADを指したまま陳腐化している。**

理由は2つある。第一に、既定branchが本PRの作成後に3回動き、そのたびにrebaseが必要だった。rebaseは前ラウンドのcandidate HEADを到達不能にするため、review sessionへ次ラウンドを追記できない。第二に、ラウンド2の是正対象が製品codeとtestであり、前進commitにすると`H_impl..current`がreview artifact以外を含んで`audit:check`が落ちる。

`pr reanchor`は内容等価性を要求するため、内容が変わる是正には使えない。**この経路の欠落はIssue #1074と#1101が扱う既知の構造欠陥であり、本PRのscopeでは是正しない。** 実体としてのreviewは本artifactが記録するラウンド1と2であり、`audit:check`が`比較基点`・`H_impl`・個別監査表・`H_impl..current`の一致を現HEADで検証している。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---|---|---|---|
| 本件の対象検査 | `npm run skills:check` | 1 | 1 | 0 | 0 | pass。`valid: true`、`skills: 12` |
| 文書・受け入れ形式 | `npm run docs:format` / `test:format` | 2 | 2 | 0 | 0 | pass |
| 静的検査・整形・型 | `npm run lint` / `format:check` / `typecheck` / `source:check` | 4 | 4 | 0 | 0 | pass |
| repository固有policy | `npm run project:quality` | 1 | 1 | 0 | 0 | pass |
| 追跡・構造 | `npm run trace:check` / `architecture:check` | 2 | 2 | 0 | 0 | pass。孤立0件 |
| 配布物 | `npm run package:check` | 1 | 1 | 0 | 0 | pass |
| 全test層（unit・integration・e2e、runnerはcucumber-js） | `npm test` | 1407 scenarios | 1391 | 0 | 16 | pass |
| レビュー成果物の監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

**skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する。** 本差分はこの経路に触れない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `scripts/check_skill_templates.ts` | 入らない | なし |
| `test/`配下2 file | 入らない | なし |
| `docs/specs/`配下3 file | 入らない | なし |

判断: 配布物を更新しない

根拠: `package.json`の`files`は`dist/`、`.agent-skill-chain/`配下の6項目、`README.md`、`AGENTS.md`だけを列挙する。**変更した6 fileはいずれもこの集合に入らない。**

**releaseの起動と計画は分けて記録する。** `.github/workflows/release.yml`は`main`への`push`で起動するため、**workflow自体は起動する。** その後`planAutoRelease`が現行tagの存在と配布digest一致で計画を`skipped`とする。**「発火しない」ではなく「起動するが計画がskipされる見込み」が正確である。** merge後に実観測する。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **CodeRabbitのreviewを1件観測した。** Major 3件はいずれも有効で、すべて本PRで是正した |
| reviewerがPR author・実装commit authorと異なる | **異ならない。** implementerもreviewerも本sessionの同一AI agentであり、Git commit authorも同一である |
| 観測したreview commentとapprovalの件数 | 本session内のreview 2ラウンド（Medium 2・Low 1は記録のみ、Major 3は是正済み）。**GitHub reviewはCodeRabbitが1件** |

**`02_品質基準.md`の「独立reviewが成立しない場合」に従う。** 同節は「既定は停止ではなく、無記録での通過の禁止である」と定める。

**PR作成後の外部reviewを待つ。** ただし直前の#1123ではCodeRabbitがfree limitに達し詳細reviewを出力できなかった。**同じ状態が続く場合は、その事実をPRへ記録したうえでmergeする。** 未解決threadが0件であることは「指摘なし」と「まだ来ていない」を区別しないため、merge条件にしない。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-008、`15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。新規用語を導入していない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass
- 要件・変更・SCN・テストの追跡: REQ-SQ-008 → AC-1117-01〜03 → SCN-UNIT-PACKAGE-017〜019。**要件本文を1文延ばしたため、新規SCNは要件行から到達できる**
- UI・トークンの判断: UIを所有しないためdesign token・layout tokenは対象外。ADRを追加しない

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし**
- Medium/Lowの記録: M-01（slug規則の範囲）、M-02（検査対象の範囲）、L-01（是正済み）。**Major R2-H01からR2-H03はすべて是正済み**
- 判定: approved（Step 10 ラウンド2）
- 新しい権限が必要な事項: mergeは別authority
- 残存リスク:
  1. **記号を含む見出しへlinkした場合にslug照合が誤判定しうる。** 現行linkに該当が無いことを実測した
  2. **`docs/specs/`と将来の別境界へのlinkは検査対象外である**
  3. 本検査はreviewではなくCIが強制する。**規範文書側の見出し改名は、この検査が失敗することで初めて可視化される**
- 次に許可される操作: push、PR作成、外部reviewの到着確認、必須check 2件の全緑確認、およびownerが承認したauthorityによる**通常merge commit方式**でのmerge。**squash mergeを使わない**
- 次回の再開地点: PR作成から
