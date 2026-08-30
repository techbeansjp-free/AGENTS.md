# 95 課題1054 implementerの許可pathへ2 fileを宣言する 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**#1054を2本へ分割したうちのPR-2であり、project choiceの宣言変更だけを含む。** 照合規則の是正はPR-1（#1055のPR #1056）が持ち、既定branchへmerge済みである。**`valid: true`は候補が既定branchを基準に検証を通過したことを示すだけであり、既定branchへの反映を示さない。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1054のPR-2（#1051のblocker） |
| ラウンド | Step 10 ラウンド2 |
| 比較基点 | `d9146c4c4bd7772c3e7662e2f9e9b078c2d04fc0` |
| H_impl | `0bef0a6241d5f8b0d2426c5287efc007c9ec1fe3` |
| 対象差分 | `.agent-skill-chain/project/choices/development.json`（`implementer.allowedPaths`へ2要素） |
| 対象外 | 強制点の実装（#1047）、directory全体の許可、他role・他field、`weakened`分類規則（#1059で既定branch側が所有）、#1051の是正内容 |
| 残り予算 | Step 10の上限3ラウンドのうち1を残す |
| ラウンド数 | 3（Step 7が1、Step 10が2。Step 10の予算3のうち1を残す） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260828_195937_implementerのallowedPathsにscriptsとgithubを追加し宣言を実態へ合わせる |
| モード | full（Q-03が偽。implementer roleの許可pathを拡大するsecurity-boundary変更） |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md:107-113`のREQ-WF-007。同要件は6 roleの許可path・操作・禁止操作・必要証拠を検証する枠組みだけを定め、**個々のpath値を列挙していない**（`grep -rn 'allowedPaths' docs/specs/`は0件） |
| 成果物行数 | 製品: `development.json` +8/-1行（実質は配列要素2件の追加）。支援層: 0行 |
| 縮小の先行評価 | 実施済み。**directory全体（`scripts/`・`.github/`）を足さず、#1051が変更する2 fileだけに限った。** より広い許可は別のowner決裁を要する。設定値を固定するtestは新設しない（01 §9.1）。AC-08・AC-09の回帰固定は既定branch側の`SCN-UNIT-ROLE-005`が担う |
| authority | **本変更自体がauthorityを広げる操作である。** repository ownerが2026-08-29に4択から明示選択した決裁を根拠とする。**owner決裁は提案する権限であって、発効は既定branchへのmerge後である** |
| 製品CLIの経路 | **通常経路で成立する。** 既定branchが`d9146c4c`の時点で`policy validate`が`valid: true`（`trustedProvenance.commitSha`が同SHA）。PR作成時点（2026-08-29）は`ASC-TRUST-001`が本差分を拒否しており`gh pr create`で作成した。その迂回は履歴上の事実として残す |
| 実施者・日時 | reviewer、2026-08-30（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | critical（`minimumTierByRisk.authority`） | claude（`modelMapping.roles.reviewer.provider`。上限はOpus） | Opus 5、effort high（`tierMapping.claude-opus-5`が`critical`） | 未解決Critical/Highがあれば停止し、是正後に同sessionの次ラウンドで再review | implementerはcodex `gpt-5.6-sol`。reviewerはclaudeで別identity・別context。reviewerは読み取り専用で作業し、`git status --porcelain`が空、`d9146c4c..HEAD`の差分path集合が対象2 fileと完全一致することを実測した |

**旧ラウンドのartifactはreviewerをcodex `gpt-5.6-sol`と記載していたが、project choiceの`modelMapping.roles.reviewer.provider`は`claude`であり不整合だった（M-01）。** 本ラウンドはproject choiceのmappingどおりclaudeで実施した。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| owner決裁 | 2026-08-29のowner明示選択（#1054のIssue本文と`00_要求定義.md`が保持） | 4択から「allowedPathsを先に修正」と「2本に分割する」を選択 | 人間判断 |
| 変更前の値 | `development.json` | `["src/", "test/", "docs/specs/", ".agent-skill-chain/"]` | 実測 |
| 変更後の値 | 同上 | 上記4件に`scripts/prepare_release_bump.ts`と`.github/workflows/release.yml`を加えた6件。**末尾スラッシュ無し** | 実測 |
| 差分の限定 | `git diff --numstat d9146c4c 0bef0a62` | `development.json`のみ、+8/-1。他role・他fieldに変更なし | 実測 |
| trust境界 | `node dist/bin/agent-skill-chain.js policy validate .agent-skill-chain/project-policy.json` | `valid: true`、`errors: []`、`trustedProvenance.commitSha = d9146c4c…` | 実行観測 |
| 分類変更の所在 | `git log --oneline ca08ecc2..d9146c4c` | `ec407833 Merge pull request #1060`が含まれる。**分類器の変更はtrusted側にあり、candidateは触れていない** | Git観測 |
| 照合規則の所在 | 同上 | `05e63657 Merge pull request #1056`が含まれる。非`/`終端要素の完全一致照合が既定branchで成立済み | Git観測 |
| 完全一致照合の実装 | `src/domain/role.ts:151-173` | 非`/`終端のprefixは`normalized === normalizedPrefix`のみ成立 | 静的読解 |
| 強制点の不在 | `grep -rn "validateRoleOperation" src/` | 定義`src/domain/role.ts:175`のみ。製品側呼び出し0件。CLIが使うのは`validateRoleAssignment`で`allowedPaths`を参照しない | 静的読解 |
| 保護境界 | `scripts/check_project_quality.ts:38-51` | `development.json`は`PROTECTED_FILES`に含まれない。二段階proposalは不要。`release.yml`も含まれないため保護の迂回にならない | 静的読解 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`owner決裁 → 分類変更(#1060、既定branch) → 本PR → merge → #1051`の一方向。artifact本文へ自身のcommit SHA（H_final）を書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl`がancestorであること、差分が本fileだけであることを実測した。PR・CI・GitHub reviewの外部証拠はpush後に成立する
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: role identityでは分離している（implementer=codex、reviewer=claude）。Git commit authorは実行者単一のため一致する
- 既定branch追随を行った場合、取り込みがreview artifact commitより前にあり、`比較基点`が取り込んだ既定branch tip、`H_impl`がartifact直前の最新commitを指し、個別監査表を`比較基点..H_impl`から再生成した: pass。**追随はmerge commitではなく`git rebase --onto d9146c4c ca08ecc2`で行い、2 commit構造を保った。** `merge-base(H_impl, d9146c4c)`は`d9146c4c`に一致する

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/project/choices/development.json` | M | project owner | project | implementerの許可pathへ2 fileを宣言する。repository固有pathをpackage層の`DEFAULT_ROLE_CONTRACTS`へ持ち込まない | 宣言のみで呼び出しを持たない。循環なし | AC-01・AC-02・AC-03。AC-08・AC-09は既定branch側の`SCN-UNIT-ROLE-005`が固定 | 2要素を除去すれば完全復旧する。`DEFAULT_ROLE_CONTRACTS`は不変 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-status d9146c4c 0bef0a62`が`M`1件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 製品差分の修正は発生していない

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-101 | rebaseにより旧review証拠（`ca08ecc2`/`28b2c7ba`/`47af86a9`）が失効し、`audit:check`が`valid: false`を返した | review artifactのみ。製品差分に影響なし | なし | 比較基点とH_implを新SHAへ直し、個別監査表を`比較基点..H_impl`から再生成した | `npm run audit:check`が`valid: true` | no-spec-impact | pass |
| DISC-102 | PR-1（#1056）が既定branchへmerge済みとなり、「PR-1を先にmergeする」制約が消滅した | 残存riskの1件が解消 | なし | 残存riskから削除し、前提が満たされた事実を記す | `git log --oneline ca08ecc2..d9146c4c`に`05e63657` | no-spec-impact | pass |
| DISC-103 | 旧artifactの「実態の変更回数 `scripts/`56回・`.github/`47回」が記載commandで再現しない | 証拠表の信頼性 | なし | **行ごと削除した。** 権限の根拠にしないと断っている数値を証拠表に残さない | 再現試行で3件・1件（`-30`）、全履歴でも一致する数え方を特定できず | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | 該当なし | `development.json`の`implementer.allowedPaths` | 配列に対象2要素が存在する | pass | `git diff d9146c4c 0bef0a62` |
| AC-02 | 該当なし | 同上 | 既存4要素が残り6要素。新規2要素はdirectory接頭辞でない | pass | 同上 |
| AC-03 | 該当なし | 同上 | 差分が当該配列に限られる | pass | `git diff --name-status`が1件 |
| AC-04 | SCN-UNIT-ROLE-001〜004、SCN-UNIT-CHOICE-001〜005 | 既存実装 | 変更なしで合格 | pass | `npm test`が0 failed |
| AC-05 | 該当なし | PR本文 | authority拡大の明示とowner決裁への参照を記載 | pass | PR #1057本文 |
| AC-06 | unit / integration / e2e | 既存gate | `project:quality`・`format:check`・`npm test`がexit 0 | pass | §7 |
| AC-07 | 該当なし | #1051のbranch基点 | **本PRのmerge後に確認する。未成立** | not-applicable（本PRの範囲外。#1051側で確認する） | AC-07の観測時点はmerge後 |
| AC-08 | SCN-UNIT-ROLE-005 | `src/domain/role.ts:151-173` | 配下path・拡張子追加・兄弟fileがいずれも拒否される | pass | §4 境界値。既定branch側のscenarioが回帰固定 |
| AC-09 | SCN-UNIT-ROLE-005 | 同上 | `/`終端要素のdirectory接頭辞一致が不変 | pass | 同上 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | roleの許可範囲を広げる変更であり信頼境界に触れる | 完全一致照合により対象2 fileだけを許可する（§4 悪用・境界値）。個人情報・秘密情報を扱わない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | not-applicable | 宣言値の変更だけでlog出力、相関、保持、rotationのいずれも変えない | `grep -rn "validateRoleOperation" src/`が定義1件のみで、実行時経路を持たない |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たない設定fileの値変更である | `package.json`の`files`に`.agent-skill-chain/project/`が無く、利用者向け表示に現れない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たない | 同上 |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | REQ-WF-007は契約fieldの枠組みだけを規定し値を列挙しない。schema（array / uniqueItems / minLength 1）を満たし、完全一致規則の下で意図どおり2 fileだけを許可する |
| 価値 | 利用者・運用上の目的を満たすか | pass | #1051（自動releaseの恒久停止）のblockerを解く。#1058が記録した循環は#1060の既定branch投入で解消し、本PRがその経路に乗った |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 前提である#1056の完全一致照合と#1060の分類変更が、いずれも現既定branchの祖先として実在する |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 旧artifactのSHA・reviewer欄・残存riskの乖離を本ラウンドで是正した（§5） |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 変更はproject層1 fileに閉じ、package層の`DEFAULT_ROLE_CONTRACTS`へrepository固有pathを持ち込んでいない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 是正前はH-01（`audit:check`が`valid: false`）という反例が実在した。是正後は`valid: true` |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | `pathAllowed`は空文字・絶対path・`..`を含む候補をすべて`false`へ倒す（`src/domain/role.ts:153-158`）。fail-openする経路を見つけられなかった |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `scripts/prepare_release_bump.ts/child`、同`/nested/deep.ts`、同`.bak`、`.github/workflows/release.yml.tmp`、`release.yaml`、`release.yml/`、`scripts/`、`scripts`、`.github/workflows/ci.yml`、`.//`と`././`の多重前置、`..`混入、絶対path、大文字小文字、`\`区切り、NFD・全角をすべて評価し、**過大許可へ倒れる例は0件。** `pathAllowed`は`normalize()`を呼ばず追加2要素は純ASCIIのため、正規化差はすべて拒否側へ倒れる |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | file単位宣言のためdirectory権限への昇格経路が無い。`.github/workflows/`をdirectoryとして宣言していれば`PROTECTED_FILES`の`ci.yml`・`trusted-quality.yml`を巻き込んでいた。`release.yml`自体は`PROTECTED_FILES`に含まれないため保護の迂回にもならない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 分類器の変更はtrusted側（`ec407833`、現既定branchの祖先）にあり、candidateは触れていない。CIのdogfood stepは`--trusted-commit=${{ github.event.pull_request.base.sha }}`をtrustedとして読む（`.github/workflows/ci.yml:56-66`）。同一PRでの自己緩和は成立していない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | not-applicable | 配列への2要素追加のみ。既存4要素・他5 role・他3 fieldはいずれも不変 |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 2要素を除去すれば完全復旧する。`DEFAULT_ROLE_CONTRACTS`は4要素のまま不変 |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | 配布境界に入らない（§8）。旧artifactの範囲漏れ4件（M-01・M-02・L-01・L-02）は本ラウンドで是正した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| H-01 | High | review artifact本文のH_impl・比較基点がrebase前のSHAのままで、必須checkに含まれる`audit:check`が失敗する | `check_file_audit.ts`が`review artifact本文のH_impl 28b2c7ba… が…導出したH_impl 0bef0a62… と一致しません`を返した | review artifactのみ。製品差分は健全 | 比較基点を`d9146c4c…`、H_implを`0bef0a62…`へ直し、個別監査表を再生成した。**新規commitではなくartifact commitの`--amend`で畳んだ** | resolved | なし |
| M-01 | Medium | reviewer欄がcodex `gpt-5.6-sol`だが、project choiceの`modelMapping.roles.reviewer.provider`は`claude`。旧ラウンド時点で既に不整合だった | `development.json`の`modelMapping.roles.reviewer`が`ca08ecc2`・`d9146c4c`の双方で`claude` | 独立性主張の基礎となる欄 | 本ラウンドをmappingどおりclaudeで実施し、§0.1へ記録した | resolved | なし |
| M-02 | Medium | 残存riskの記述2件が現況と乖離。(a)「構造の是正は#1047・#1044の範囲」は#1058が誤りと明示的に訂正済み。(b)「PR-1を先にmergeする」はPR #1056がmerge済みで消滅 | #1058本文「2026-08-29に私が『#1047・#1044の範囲』と述べたのは誤りであり、本Issueで訂正する」。`git log --oneline ca08ecc2..d9146c4c`に`05e63657` | PR本文とartifactの残存risk節 | (a)承認経路の所有を#1058へ付け替えた。(b)当該項目を削除した | resolved | なし |
| L-01 | Low | 「実態の変更回数 `scripts/`56回・`.github/`47回」が記載commandで再現しない | 再現試行で3件・1件（`-30`）。全履歴でも一致する数え方を特定できず | 証拠表の信頼性 | **行ごと削除した。** 権限の根拠にしないと断っている数値を証拠として残さない | resolved | なし |
| L-02 | Low | review artifactの連番`91_`が既定branchの`91_課題1061…`と衝突する。rebase区間で既定branch側に91〜94が入ったため | `git ls-tree --name-only d9146c4c docs/reviews/`に`91_課題1061…`が存在する | 文書の識別性のみ。`AUDIT_NAME_PATTERN`は一意性を強制しないためcheckは落ちない | `95_`へ改番した | resolved | なし |

## 6. ラウンド固有の確認

### ラウンド1（Step 10、2026-08-29、旧head）

- 全評価基準を確認した: はい。Critical/High 0件、Low-01のみ
- 指摘を確定した: はい
- 次ラウンド対象のCritical/High: なし
- **rebaseによりこのラウンドの証拠は失効した。** 旧SHAへ束縛されているため、本artifactは判定を引き継がず再実施した

### ラウンド2（Step 10、2026-08-30、本ラウンド）

- 未解決Critical/High: なし（H-01は本ラウンドで是正済み）
- 修正差分: review artifactのみ。製品差分（`development.json`）は無修正
- 修正で触れた隣接範囲: なし。artifactはevidence-only pathであり製品を参照しない
- 既承認・未変更範囲を再走査していない: **再走査した。** 既定branch追随の契約が個別監査表を`比較基点..H_impl`から再生成することを要求するため、範囲全体を対象とした

### ラウンド3

- 未実施。同一範囲の予算3のうち1を残している

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format` / `npm run test:format` | 2 | 2 | 0 | 0 | pass |
| unit / integration / e2e（`ja`方言、cucumber-js） | `npm test` | 1287 scenarios / 6812 steps | 1271 / 6762 | 0 / 0 | 16 / 50 | pass |
| 型・既存一式・配布物 | `npm run verify:distribution` | 10 | 10 | 0 | 0 | pass |

**skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する**（`test/steps/semantic-graph-store.steps.ts:388`、`test/steps/semantic-graph-runtime-evidence.steps.ts:251`が未設定時に`skipped`を返す）。本差分はrole宣言のJSONだけで、この経路に触れない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/project/choices/development.json` | 入らない | なし |

判断: 配布物を更新しない

根拠: 変更したproject choiceは`package.json`の`files`に含まれず、公開CLIの振る舞い、schema、templateのいずれも変えないため

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **あり。** claude reviewer（Opus 5、effort high、tier critical）のcurrent session応答。exact-headは`0bef0a62`。immutable GitHub reviewは0件 |
| reviewerがPR author・実装commit authorと異なる | role identityでは、はい（implementer=codex `gpt-5.6-sol`、reviewer=claude）。Git commit authorは実行者単一のため一致する |
| 観測したreview commentとapprovalの件数 | agent review 1件 / approved 1件（High 1・Medium 2・Low 2を検出し全件resolved、製品差分の変更要求0件）。GitHub review 0件 |

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | **該当なし。** 通常のclaude reviewer経路が成立する |
| 観測値 | claude reviewer 1件、approved 1件、未解決Critical/High 0件、製品code変更要求0件 |

**外部reviewサービスの承認を要件にしない。** `02_品質基準.md`の「独立reviewが成立しない場合」は「外部reviewサービスの利用有無は要件ではない。要件は、PR authorとobserved implementation commit authorのどちらとも異なるreviewerによるexact-head reviewである」と定め、既定branchへのmergeには門を置かないと規定している。ruleset `main-protection`の`required_approving_review_count`も0である。

## 10. 仕様整合性

- 判定: no-spec-impact
- 更新した仕様: なし
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。新規用語を導入していない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass
- 要件・変更・SCN・テストの追跡: FR-01・FR-02・FR-03・FR-06 → AC-01・AC-02・AC-03。AC-08・AC-09 → `SCN-UNIT-ROLE-005`（既定branch側）
- `no-spec-impact`の場合の限定的根拠: **`grep -rn 'allowedPaths' docs/specs/`が0件。** 仕様は契約fieldの枠組みだけを規定し値を列挙していないため、値の変更は枠組みを変えない
- UI・トークンの判断: UIを所有しないためdesign token・layout tokenは対象外。ADRを追加しない

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: M-01・M-02・L-01・L-02をいずれも本ラウンドで是正した
- 判定: approved（Step 10 ラウンド2）
- 新しい権限が必要な事項: mergeは別authority。releaseとpublishはさらに別authority
- 残存リスク:
  1. **宣言と実態を突き合わせる強制点は存在しない**（#1047）。`validateRoleOperation`の製品側呼び出しは0件であり、本変更は実行時の強制を増やしも減らしもしない
  2. `DEFAULT_ROLE_CONTRACTS`（配布される既定契約）と`development.json`が本変更で乖離する。**repository固有のfile pathを配布既定値へ持ち込まないための意図的な判断**だが、一致を強制する機構は無い
  3. 本PRが通る理由は「拡大が本質的に安全だから」ではなく、**#1060で`roleContracts`が単調性判定の対象から外れたためである。** 以後`allowedPaths`の拡大は`ASC-TRUST-001`の防御対象ではない。承認経路の復元は#1058が所有し、#1047が強制点を結線する前提となる
  4. **#1051の開始条件（本PRのmerge済み、かつ#1051が更新後の既定branchを基点とすること）が守られないとcandidate側の自己緩和になる**（AC-07、BR-04）
- 次に許可される操作: push、必須check2件（`日本語文書・Gherkin・型・配布物の品質検証`、`base validatorで品質自己緩和を拒否`）の全緑確認、およびownerが承認したauthorityによる通常merge。**admin bypassを使わない。release・publish・cleanupはそれぞれ別authority**
- 次回の再開地点: 必須check2件（`日本語文書・Gherkin・型・配布物の品質検証`、`base validatorで品質自己緩和を拒否`）の結果観測から
