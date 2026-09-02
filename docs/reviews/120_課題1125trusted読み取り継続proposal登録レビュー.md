# 120 課題1125 trusted-quality読み取り失敗時の継続proposal登録 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**保護fileの是正に必要な二段階手順の1段目である。本PRは何も有効化しない。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1125 |
| 比較基点 | `9cc694c9b5b43a4a839d72aaba80e88855f6502c` |
| H_impl | `63ab1e8c80b6f5f153fd5f635f667083ba7a2ff6` |
| 対象差分 | `.github/trusted-quality-proposals.json` の1 file |
| 対象外 | **保護fileの内容変更。** `scripts/check_project_quality.ts` を1バイトも変更しない。`agentSkillChain.qualityContractVersion` も11のまま |
| 残り予算 | Step 10の上限3ラウンドのうち1を残す |
| ラウンド | Step 10 ラウンド2 |
| ラウンド数 | 2（Step 10のラウンド1〜2）。**quickにStep 7は無い** |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260903_072830_trusted-quality読み取り失敗時の継続proposalを事前登録する |
| モード | quick（Q-01〜Q-08がすべて真。`status`が`staged`であり何も有効化しない） |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-030「保護対象の読み取り失敗をtrusted側と候補側に区別した構造化errorで報告する」 |
| 成果物行数 | registryへ23 insertions。**製品codeへの変更0行** |
| 縮小の先行評価 | 実施済み。**新規Scenarioを足さない。** 契約fieldの不変性と記述fieldの更新可否は既存の`SCN-UNIT-PROPFIELD-001`から`008`が検査する。特定のproposalIdの存在をassertするtestは、そのproposalが適用されたら不要になる保守対象を作る |
| authority | **本PRでは何も変更しない。** `status`が`staged`であり、適用はPR-2で行う |
| 実施者・日時 | reviewer、2026-09-03（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | routine（riskがlow） | claude | Opus 5、effort high | `beforeSha256`が既定branchの内容と一致しなければ停止する | implementerとreviewerはいずれも本sessionのAI agentであり、**Git commit authorも同一である。§9に実態どおり記録し、独立性が成立したとは主張しない** |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 欠陥の現存 | `scripts/check_project_quality.ts:778-787` | `if ("reason" in trustedRead) { ... return { valid, errors, checks }; }` が現存する。**workflow本文に依存しない`validateTrustedQualityMigration`（同806行）まで実行されない** | 実測 |
| `beforeSha256`の一致 | 既定branchの`scripts/check_project_quality.ts` | sha256が`0702604760f7eb6b3083467a34e6c0b1319f5e3d4b4c1f0f560b71d13f9a1305`であり、registryの`beforeSha256`と完全一致する | 実測 |
| `afterSha256`の由来 | 是正後の内容 | prettier適用後のsha256が`403607b341ca5586852750ee430675c47dd3e5e43e005fd8de8ca0a1972595f9`である | 実測 |
| 保護fileの非変更 | `git diff --name-only` | 変更は`.github/trusted-quality-proposals.json`の1 fileのみ | 実測 |
| 既存proposalの非変更 | registryの読み取り | 既存13件を1件も変更せず、末尾へ1件追記した。合計14件 | 実測 |
| 版の連続性 | 既存proposalの`toVersion` | 直前の`TQP-SNAPSHOT-OUTER-READ-001`が`toVersion: 11`。本proposalは`fromVersion: 11`、`toVersion: 12`で連続する | 実測 |
| `project:quality` | コマンド実行 | `valid: true` | 実行観測 |
| 全gate | `npm test`、`conformance:check` | 1415 scenario、0失敗。project rule 20件、orphan 0件 | 実行観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。**`beforeSha256`を既定branchの内容から取った。** 候補側から取ると自己申告になる
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl`が直前commitであり、`H_impl..HEAD`の差分は本artifact 1 fileのみ
- reviewer stable IDがPR author/観測済み`H_impl` author stable IDと異なる: **異ならない。** §9に実態を記録した
- 既定branch追随: **実施済み。** 本artifactを作る前に`origin/main`へ追随し、`beforeSha256`が追随後の内容とも一致することを再確認した

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | project | project | proposal 1件の末尾追記。既存13件へ触れない | registry → 適用PRの一方向。登録は適用を参照しない | AC-01からAC-04。SCN-UNIT-PROPFIELD-001 | **登録済みproposalは削除できない。** 適用しなければ`staged`のまま無害である | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-only origin/main H_impl`が1件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 修正は§2.0のとおり1件

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | 是正内容の整形結果がprettierに依存する。手で書いた`else`分岐のインデントをprettierが直す | `afterSha256`が整形前後で変わる | なし | **`afterSha256`はprettier適用後の内容から取った。** PR-2では同じprettier設定で整形する | PR-2で`format:check`が合格すること | no-spec-impact | pass |

**#1002 で同型の失敗が起きている。** `afterSha256`が適用時の実際の内容と食い違うと、proposalが適用不能になり登録し直しになる。整形を先に済ませてからhashを取った。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-PROPFIELD-001 | `fromVersion: 11`、`toVersion: 12`、`status: staged` | registryの読み取りで確認 | pass | §1 |
| AC-02 | SCN-UNIT-PROPFIELD-001 | `beforeSha256` | 既定branchの内容と完全一致 | pass | §1 |
| AC-03 | SCN-UNIT-PROPFIELD-001 | 保護fileと`qualityContractVersion`の非変更 | `git diff --name-only`が1件 | pass | §1 |
| AC-04 | SCN-UNIT-PROPFIELD-001 | schema適合 | `project:quality`が`valid: true` | pass | §7 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 保護境界の二段階承認手順そのものである | `beforeSha256`を既定branchから取った。保護fileへの変更0行 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | `rationale`がPR-2で何を変えるかの唯一の事前記録になる | `rationale`が早期returnの位置と影響と是正方針を述べる |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないJSON registryである | `projectKind`が`cli` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たず、色・間隔・typographyの決定を含まない | `capabilities.designTokens`が`not-applicable` |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | `beforeSha256`が既定branchの内容と完全一致する |
| 価値 | 利用者・運用上の目的を満たすか | pass | **本PR単独では価値を生まない。** PR-2の前提を作る |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | registryへの1件追記で成立する |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 版が11から12へ連続し、直前proposalの`toVersion`と接続する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | `proposalId`が既存の命名規則に従う |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | `project:quality`が`valid: true`で通る |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 1 fileの追記であり部分適用が残らない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `proposalId`が既存14件と重複しない |
| 悪用 | **登録だけで保護境界を緩める** | pass | `status`が`staged`であり、適用はPR-2でbase checkoutのvalidatorが照合する。**登録は何も有効化しない** |
| 悪用 | `beforeSha256`を候補側の内容から取って自己申告にする | pass | **既定branchの内容から取った。** 追随後の内容とも一致することを再確認した |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 保護fileへの変更0行 |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 既存13件を1件も変更していない |
| ロールバック | 復旧参照、状態保持、再開可能性 | **記録する** | **登録済みproposalは削除できない。** 適用しなければ`staged`のまま無害である。適用後に戻す場合は次versionの新規proposalとして同じ二段階を通す |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `package.json`の`files`に`.github/`を含まないため配布境界へ入らない |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | **`afterSha256`がPR-2の実際の内容と食い違うと適用不能になる。** #1002で同型の失敗が起きている | 実測 | PR-2 | 是正後の内容を先に作りprettierを適用してからhashを取った。PR-2では同じ内容をそのまま置く | valid（record-only） | 残存する |
| L-01 | Low | **本PR単独では欠陥が直らない。** `trusted-quality.yml`欠損時のfail-openはPR-2まで残る | 手順の構造 | 是正の完了時期 | 二段階手順の制約であり、登録と適用を同一PRにできない | valid（out-of-scope。record-only） | 残存する |

**Critical/High 0件。**

## 6. ラウンド固有の確認

### ラウンド1（Step 10、2026-09-03、candidate HEAD = `H_impl`）

- 全評価基準を確認した: はい。肯定5観点・敵対9観点をすべて評価した
- 指摘を確定した: はい。M-01とL-01はいずれも記録のみ
- 次ラウンド対象のCritical/High: **なし**
- blocking: 0件

### ラウンド2

- 本artifactのcommitでHEADが動くため、次ラウンドで再固定する

### ラウンド3

- 未実施。**予算1を外部reviewの是正のために残す**

## 7. テスト結果

**承認証拠は成功CI runである。** 手書きの件数表はそれ自体が自己申告であり、承認証拠にならない。

実行したcommand: `docs:format`、`test:format`、`lint`、`format:check`、`typecheck`、`source:check`、`trace:check`、`architecture:check`、`skills:check`、`build`、`package:check`、`project:quality`、`npm test`、`conformance:check`、`audit:check`、`issue validate`

全layerの合計: **1415 scenario、1399 成功、0 失敗、16 skip。** `conformance:check`はproject rule 20件・orphan 0件で合格。`project:quality`は`valid: true`。

失敗またはskipがある層: **skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する。** 本差分はこの経路に触れない。

対応する成功CI run: PR作成後に取得し、merge前に現`H_final`へ束縛する。

**変異試験を行わない。** 本PRはregistryへの宣言的な1件追記であり、判定logicを持たない。変異させる対象が無い。**PR-2で早期returnの是正に対して変異試験を行う。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | `package.json`の`files`に`.github/`を含まない |

判断: 配布物を更新しない

根拠: `package.json`の`files`は`dist/bin/`、`dist/src/`、`dist/vendor/`、`.agent-skill-chain/00_利用案内.md`、`.agent-skill-chain/skills/`、`.agent-skill-chain/templates/`、`.agent-skill-chain/schemas/`、`.agent-skill-chain/policy/`、`.agent-skill-chain/docs/`、`README.md`、`AGENTS.md`である。**`.github/` を含まない。**

**releaseの起動と計画は分けて記録する。** `.github/workflows/release.yml`は`main`への`push`で起動する。その後`planAutoRelease`が配布digestの差分を見て計画を決める。**本変更は配布digestを変えないため、version bumpとtagは作られない見込みである。** merge後に実観測する。

**ロールバックの対象範囲を分けて記録する。**

| 対象 | revertで戻るか | 実行者 | 手順 | 完了確認 |
|---|---|---|---|---|
| repository状態 | **戻る** | 実行役 | 打ち消しPRを通常mergeする | `git diff`が元の状態と一致する |
| 登録済みproposal | **削除できない** | 該当しない | 適用しなければ`staged`のまま無害である | `project:quality`が`valid: true`のまま |
| 公開済みtagとGitHub Release | **作られない見込み** | 該当しない | 配布digestが変わらない | `gh release list`に新tagが載らない |
| npm registryの公開物 | **公開されない** | 該当しない | 本経路では公開しない | `npm view`に該当versionが無い |

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **本artifact作成時点では無い。** exact-headは`H_final`。immutable GitHub reviewは0件 |
| reviewerがPR author・実装commit authorと異なる | **異ならない。** implementerもreviewerも本sessionの同一AI agentであり、Git commit authorも同一である |
| 観測したreview commentとapprovalの件数 | 本session内のreview 2ラウンド（Critical/High 0、Medium 1、Low 1）。GitHub review 0件 |

**`02_品質基準.md`の「独立reviewが成立しない場合」に従う。** 同節は「既定は停止ではなく、無記録での通過の禁止である」と定める。

**本PRの安全性は登録が何も有効化しないことに依存している。** 適用時にはbase checkoutのvalidatorが候補側の内容を`beforeSha256`と`afterSha256`へ照合する。**その照合は候補側のcodeを実行しない。** 同一PR内での自己承認は成立しない。

**PR作成後の外部reviewを待つ。** 予算1ラウンドを残してある。**`pr create`後の指摘は同じPRへ取り込まず、判定と分離先をreviewスレッドへ返信する。**

## 10. 仕様整合性

- 判定: no-spec-impact
- 限定的根拠: **REQ-SQ-030の本文が要求する挙動を変えない。** 同要件は「その値に依存する検査だけを飛ばして残りを続行する」と定めており、現状の実装がこれに反している。本PRはその是正に必要な二段階手順の1段目であり、**要件・SCN・追跡のいずれも変更しない。** 充足の回復はPR-2で行い、そこで仕様の充足状況を記録する
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。新規用語を導入していない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass。`versioned staged proposal`という既存語をそのまま使う
- 要件・変更・SCN・テストの追跡: REQ-SQ-030 → AC-SQ-030 → 既存`SCN-UNIT-QUALITY-011`から`018`。**本PRで追跡表を変更しない**
- UI・トークンの判断: UIを所有しないためdesign token・layout tokenは対象外。ADRを追加しない

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし**
- Medium/Lowの記録: M-01（`afterSha256`の食い違いリスク）、L-01（本PR単独では欠陥が直らない）
- 判定: approved（Step 10 ラウンド2）
- 新しい権限が必要な事項: mergeは別authority
- 残存リスク:
  1. **`afterSha256`がPR-2の実際の内容と食い違うと適用不能になる。** #1002で同型の失敗がある
  2. **本PR単独では`trusted-quality.yml`欠損時のfail-openが残る。** PR-2まで残存する
  3. **登録済みproposalは削除できない。** 適用しない選択をしても`staged`として残る
- 次に許可される操作: push、PR作成、外部reviewの到着確認、必須check 2件の全緑確認、およびownerが承認したauthorityによる**通常merge commit方式**でのmerge。**squash mergeを使わない**
- 次回の再開地点: PR作成から。merge後にPR-2（適用）へ進む
