# 113 課題1035 merge.branchesの3役明記と警告base候補の限定 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**実利用者からの報告に基づく。** squash専用運用で事実に反する警告が常時点灯していた。

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1035 |
| ラウンド | Step 10 ラウンド1 |
| 比較基点 | `f8ec54c13bab8f4f9576429c869a7023f28fba56` |
| H_impl | `2808b4caa435fb960a950fc09082ee26dea8133d` |
| 対象差分 | 判定code、test 2 file、配布規範文書、schema、policy利用案内、要件、用語台帳、追跡表、変更履歴の10 file |
| 対象外 | fieldの分離（`merge.headBranches`新設）、役割2の判定変更、`authorizeMerge`、`branchMethods`がglobalを超えられない検証 |
| 残り予算 | Step 10の上限3ラウンドのうち2を残す |
| ラウンド数 | 1（Step 10のラウンド1）。**Step 7のreadiness checkは3ラウンド予算に数えない** |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260902_200053_merge.branchesのhead-allowlist役割が文書に無く長命branch警告が誤発火する |
| モード | full（Q-01が偽。policy validateの警告出力が変わる） |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-004。**当初REQ-WF-008と書いていたが実測で誤りと判明し訂正した** |
| 成果物行数 | 製品: `src/domain/policy.ts` +23行。test +115行。配布文書 +33行。仕様 +4行 |
| 縮小の先行評価 | 実施済み。**述語を1つ足すだけにした。** field分離案は既存policyの互換性を壊すため採らない |
| authority | 変更しない。**`warn`強度の助言の発火条件だけを変える。`valid`と`errors`は不変である** |
| 実施者・日時 | reviewer、2026-09-02（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | advanced | claude | Opus 5、effort high | 未解決Critical/Highがあれば停止し、是正後に同sessionの次ラウンドで再review | implementerとreviewerはいずれも本sessionのAI agentであり、**Git commit authorも同一である。§9に実態どおり記録し、独立性が成立したとは主張しない** |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 3役の実在 | `src/domain/delivery.ts`の`authorizeMerge`、`resolveMergeMethod`、`src/domain/policy.ts:173` | head allowlistは`branchMatches`のワイルドカード照合、長命branchペアは`.includes()`の完全一致、警告のbase候補は全要素を評価 | 静的読解 |
| 文書の欠落 | `.agent-skill-chain/docs/01_開発ワークフロー.md`の変更前 | `merge.branches`を長命branch集合としてのみ説明。**head allowlistの記述が0件** | 実測 |
| 誤警告の再現 | globだけを列挙した一時policy fileへ`policy validate`を実行 | **変更前は警告あり。変更後は警告なし** | 実行観測 |
| 既存発火の維持 | 具体名2件の構成 | 変更前後ともに警告あり | 実行観測 |
| 混在時の限定 | globと具体名の混在構成 | `reasons`と`scope`に具体名だけが載り、globが載らない | 実行観測 |
| 境界 | 除外後の候補が1件の構成 | 警告なし。**長命branch「間」のmergeは2件以上でしか成立しない** | 実行観測 |
| 変異試験 | 変異5件を注入し`SCN-INT-MERGEMETHOD-001〜006`を実行 | **5件すべてkill。** 1周目は`length < 2`の変異が生存し、境界Scenarioを足してkillした | 実行観測 |
| 認可判定の非変更 | `git diff` | `src/domain/delivery.ts`に**変更0行** | 実測 |
| 差分の限定 | `git diff --name-only` | 10 fileのみ | 実測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`policy → 判定 → 診断`の一方向。artifact本文へ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl`が直前commitであり、`H_impl..HEAD`の差分は本artifact 1 fileのみ
- reviewer stable IDがPR author/観測済み`H_impl` author stable IDと異なる: **異ならない。** §9に実態を記録した
- 既定branch追随: **実施済み。** `rebase --onto origin/main`で追随し、`15_要件追跡/01_変更履歴.md`の衝突をmain側を基準に再構築して解消した

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/policy.ts` | M | package | package | `isMergeBaseCandidate`がbase候補の判定を単独で持つ。既存judgementに触れない | 述語は文字列だけに依存する純関数。循環なし | AC-1035-01〜03。SCN-INT-MERGEMETHOD-004〜006 | 読み取り専用の助言。revertで完全に戻る | pass |
| `test/features/integration/merge-method-policy.feature` | M | package | package | globだけ・混在・除外後1件の3境界へ1 Scenarioずつ | featureはstep定義へ一方向。循環なし | 同上 | test追加のみ | pass |
| `test/steps/merge-method-policy.steps.ts` | M | package | package | 3つのfixtureと2つの検証stepを足す。**`reasons`と`scope`の内容まで見る** | step定義は製品へ一方向。循環なし | 同上 | 同上 | pass |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | package | package | 3役を表で示し、主用途がhead allowlistであることと`worktree.allowedBranchTypes`との整合を述べる | 規範文書は実装を参照しない。循環なし | AC-1035-04 | 追記の削除で復旧する | pass |
| `.agent-skill-chain/schemas/project-policy.schema.json` | M | package | package | `branches`へ`description`を1件足す。**制約を変えない** | 宣言schema。循環なし | AC-1035-04 | 1行の削除で復旧する | pass |
| `.agent-skill-chain/policy/00_利用案内.md` | M | package | package | squash専用構成の記入例を足す。既存sampleを壊さない | 利用案内。循環なし | AC-1035-05 | 追記の削除で復旧する | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | package | spec | REQ-GH-004へ3役とbase候補の限定を追記する。要件IDを増やさない | 要件文のみ。循環なし | AC-1035-01〜03 | 追記の削除で復旧する | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package | spec | TERM-ASC-088を1件足す | 宣言データ。循環なし | 該当なし | 1行の削除で復旧する | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | spec | REQ-GH-004の行へSCN 3件を足す | 追跡表のみ。循環なし | SCN-INT-MERGEMETHOD-004〜006 | 1行の差し替えで復旧する | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | spec | 非変更範囲を実際に維持した契約へ限定して記録する | 履歴のみ。循環なし | 該当なし | 1行の削除で復旧する | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-status`が`M`10件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: DISC-1035-RULEID-001の是正で配布3文書を再監査した

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1035-REQID-001 | 00〜03で所有要件を`REQ-WF-008`と書いていたが、実測すると`SCN-INT-MERGEMETHOD-001`はREQ-GH-004へ結ばれている | 仕様追跡の誤り | なし | 4文書すべてを訂正した。**要件本文を読む前にID を書いていたことが原因である** | 追跡表54行の実測 | no-spec-impact | pass |
| DISC-1035-BOUNDARY-001 | 変異試験の1周目で`length < 2`を`< 0`にする変異が生存した | 検出力の穴 | なし | 「除外後の候補がちょうど1件」の境界Scenarioを足した。**`< 3`への変異も併せてkillすることを確認した** | 変異試験の再実行結果 | no-spec-impact | pass |
| DISC-1035-RULEID-001 | 配布規範文書とschemaへ`ASC-MERGE-METHOD-001`をliteralで書いたところ、**project ruleとして21件目に数えられ**`SCN-INT-CANON-003`と`SCN-INT-LEDGER-001`が落ちた | 既存Scenarioの失敗 | なし | 配布3文書からID表記を外し、振る舞いの説明へ置き換えた。**`buildRuleCoverage`は`.agent-skill-chain/docs`と`schemas`の本文から`ASC-`形式IDを機械抽出する** | 2 Scenarioの回復 | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1035-01 | SCN-INT-MERGEMETHOD-004、SCN-INT-MERGEMETHOD-006 | `isMergeBaseCandidate`と件数ガード | pass。**006は除外後の候補が1件の境界を担う** | pass | §7 |
| AC-1035-02 | SCN-INT-MERGEMETHOD-001 | 既存判定 | pass。回帰なし | pass | §7 |
| AC-1035-03 | SCN-INT-MERGEMETHOD-005 | 同上 | pass。`reasons`と`scope`にglobが載らない | pass | §7 |
| AC-1035-04 | 該当なし | 規範文書とschema | 3役と`*`の意味が読み取れる | pass | §1 |
| AC-1035-05 | 該当なし | policy利用案内 | squash専用構成の記入例がある | pass | §1 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | not-applicable | 認可判定に触れない。変更対象は`warn`強度の助言である | `src/domain/delivery.ts`への変更0行 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 警告そのものが観測面であり、事実に反する警告を止めることが目的である | SCN-INT-MERGEMETHOD-005が`reasons`と`scope`の内容を検証する |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないCLIである | `projectKind`が`cli` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たない | `capabilities.designTokens`が`not-applicable` |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | Issue記載の構成で警告が消え、危険な構成では従来どおり出る |
| 価値 | 利用者・運用上の目的を満たすか | pass | 実利用者が「既知の1件」として恒常的に抑止する運用が不要になる |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 追加依存が無く、述語1つで完結する |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の2コンポーネントがそのまま実装になり、AC 5件とSCN 3件が対応する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | base候補の判定が`isMergeBaseCandidate`1箇所にある |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | globだけ・混在・除外後1件・具体名2件の4条件を実測した |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 判定は純関数であり失敗経路を持たない |
| 境界値 | 除外後の候補数 | pass | **0件・1件・2件を検査した。** 1周目で生存した`length < 2`の変異を、1件の境界Scenarioを足してkillし、`< 3`への変異も併せてkillすることを確認した。**重複・Unicode・最大件数は検査していない。** `uniqueItems`と`maxItems: 32`はschemaが担い、本変更は要素の値を解釈しないため実証範囲に含めない |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | **除外を広げて危険な構成を隠していない。** 具体名2件のsquash専用は従来どおり警告する。除外条件は「ワイルドカードを含む」という構文だけである |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | `authorizeMerge`と`resolveMergeMethod`に変更0行。`valid`と`errors`が不変 |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 読み取り専用の助言である |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | **repository状態はrevertで戻る。** 配布物であるため、merge後に自動releaseが成立するとtagとGitHub Releaseはrevertで取り消せない（§8） |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | 配布3文書へ同じ内容を書いた。**IDのliteral記載がproject rule台帳を汚す性質はDISC-1035-RULEID-001で是正済み** |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | **`merge.branches`の3役の兼務そのものは残る。** 文書化と警告の限定で回避できるようにしただけである | Issue #1035の案1 | 設定の表現力 | **本PRでは解かない。** field分離は既存policyの互換性を壊し移行手順が要る。利用者は案3だけでも回避できると述べている | valid（out-of-scope。record-only） | 残存する |
| M-02 | Medium | 除外条件が構文だけである。実在しないbranch名は除外できない | `isMergeBaseCandidate`の実装 | 誤警告の残存 | **本PRでは解かない。** 判定側は既定branch名を知らず、policyも宣言しない | valid（記録のみ） | 残存する |
| L-01 | Low | 変異試験1周目で境界変異が生存した | 変異試験の記録 | 検出力 | **本PRで解いた。** 境界Scenarioを足してkillした | fixed | なし |
| L-02 | Low | 配布文書へrule IDをliteralで書き、project rule台帳を汚した | `SCN-INT-CANON-003`の失敗 | 既存Scenario | **本PRで解いた。** ID表記を外した | fixed | なし |

**Critical/High 0件。**

## 6. ラウンド固有の確認

### ラウンド1（Step 10、2026-09-02、candidate HEAD = `H_impl`）

- 全評価基準を確認した: はい。肯定5観点・敵対8観点をすべて評価した
- 指摘を確定した: はい。M-01とM-02は記録のみ、L-01とL-02は本PRで是正済み
- 次ラウンド対象のCritical/High: **なし**
- blocking: 0件

### ラウンド2

- 本artifactのcommitでHEADが動くため、次ラウンドで再固定する

### ラウンド3

- 未実施。**外部reviewの指摘があれば本ラウンドで扱う**

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---|---|---|---|
| 文書・受け入れ形式 | `npm run docs:format` / `test:format` | 2 | 2 | 0 | 0 | pass |
| 静的検査・整形・型 | `npm run lint` / `format:check` / `typecheck` / `source:check` | 4 | 4 | 0 | 0 | pass |
| repository固有policy | `npm run project:quality` | 1 | 1 | 0 | 0 | pass |
| 追跡・構造 | `npm run trace:check` / `architecture:check` | 2 | 2 | 0 | 0 | pass。孤立0件 |
| 配布物 | `npm run build` / `package:check` / `skills:check` | 3 | 3 | 0 | 0 | pass |
| conformance | `npm run conformance:check` | project rule 20件 | 20 | 0 | 0 | pass。orphan 0件 |
| 全test層（unit・integration・e2e、runnerはcucumber-js） | `npm test` | 1413 scenarios | 1397 | 0 | 16 | pass |
| レビュー成果物の監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

**skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する。** 本差分はこの経路に触れない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/policy.ts` | **入る**（`dist/src/`として） | 警告の発火条件が狭くなる |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | **入る** | 3役の説明が加わる |
| `.agent-skill-chain/schemas/project-policy.schema.json` | **入る** | `description`が1件加わる |
| `.agent-skill-chain/policy/00_利用案内.md` | **入る** | squash専用の記入例が加わる |
| `test/`配下2 file | 入らない | なし |
| `docs/specs/`配下4 file | 入らない | なし |

判断: 配布物を更新した

根拠: `package.json`の`files`は`dist/src/`と`.agent-skill-chain/docs/`、`schemas/`、`policy/`を含む。**配布digestが変わるため、mergeで自動releaseの計画が成立する見込みである。**

**releaseの起動と計画は分けて記録する。** `.github/workflows/release.yml`は`main`への`push`で起動する。その後`planAutoRelease`が配布digestの差分を見て計画を決める。**本変更は配布digestを変えるため、version bumpとtagが作られる見込みである。** merge後に実観測する。**npm公開は自動経路では発火しない。**

**ロールバックの対象範囲を分けて記録する。**

| 対象 | revertで戻るか | 実行者 | 手順 | 完了確認 |
|---|---|---|---|---|
| repository状態（`src/`、`test/`、`docs/specs/`、`.agent-skill-chain/`） | **戻る** | 実行役 | 打ち消しPRを通常mergeする | `git diff`が元の状態と一致する |
| 公開済みtag `v0.3.1-beta.N` | **戻らない** | repository owner | tagを削除しない。次のbump（`beta.N+1`）で前進する | `gh release list`に新tagが載る |
| GitHub Release | **戻らない** | repository owner | 該当Releaseへ「本versionの警告条件は`beta.N+1`で置き換えた」と追記する。Release自体を削除しない | Release本文に追記が載る |
| npm registryの公開物 | **公開されない** | 該当しない | **本経路では公開しない。** npm公開は`workflow_dispatch`で`publish_npm: true`を明示指定し承認した場合だけ実行される | `npm view`に該当versionが無い |

**「次versionでの前進」は既存artifactを無効化しない。** tagとReleaseは残り、利用者が`beta.N`を参照し続けることは可能である。**無効化ではなく非推奨化である。** 利用者への通知経路はGitHub Releaseの追記だけであり、push通知は無い。

**本変更の場合、rollbackの実際の必要性は低い。** 変わるのは`warn`強度の助言の発火条件だけで、`valid`と`errors`は不変である。誤って警告が出なくなった場合の影響は、長命branch間のsquash運用に対する助言を1件失うことに留まる。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **本artifact作成時点では無い。** exact-headは`H_final`。immutable GitHub reviewは0件 |
| reviewerがPR author・実装commit authorと異なる | **異ならない。** implementerもreviewerも本sessionの同一AI agentであり、Git commit authorも同一である |
| 観測したreview commentとapprovalの件数 | 本session内のreview 1ラウンド（Critical/High 0、Medium 2・Low 2）。GitHub review 0件 |

**`02_品質基準.md`の「独立reviewが成立しない場合」に従う。** 同節は「既定は停止ではなく、無記録での通過の禁止である」と定める。

**PR作成後の外部reviewを待つ。** CodeRabbitがfree limitで出力できない場合は、その事実をPRへ記録したうえで判断する。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-004、`01_システム概要/02_用語・略語.md`、`15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。TERM-ASC-088を`active`で追加した。**耐久台帳の最大が087であり、他Issueのstagingが採番していないことを実測した**
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass
- 要件・変更・SCN・テストの追跡: REQ-GH-004 → AC-GH-004 → SCN-INT-MERGEMETHOD-004〜006。**要件本文を1文延ばしたため、新規SCNは要件行から到達できる**
- UI・トークンの判断: UIを所有しないためdesign token・layout tokenは対象外。ADRを追加しない

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし**
- Medium/Lowの記録: M-01（3役の兼務が残る）、M-02（構文だけの除外）、L-01とL-02（是正済み）
- 判定: approved（Step 10 ラウンド1）
- 新しい権限が必要な事項: mergeは別authority
- 残存リスク:
  1. **`merge.branches`の3役の兼務そのものは残る。** field分離は互換性を壊すため別Issueの範囲である
  2. **除外条件は構文だけである。** 実在しないbranch名をbase候補から外せない
  3. **配布digestが変わるため自動releaseの計画が成立する見込みである。** 公開済みtagはrevertで取り消せない
- 次に許可される操作: push、PR作成、外部reviewの到着確認、必須check 2件の全緑確認、およびownerが承認したauthorityによる**通常merge commit方式**でのmerge。**squash mergeを使わない**
- 次回の再開地点: PR作成から
