# 112 課題1101 pr mergeの再観測を実効HEADへ束縛する 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**`pr reanchor`のdelivery層が追記する記録を読む判定が1つも無く、記録が書き込み専用になっていた欠陥の是正である。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1101 |
| ラウンド | Step 10 ラウンド1 |
| 比較基点 | `88aafd5c828810322cf8893a00143f3118f70927` |
| H_impl | `7dc8e29842ddce72878bbdc0ed6a8ec5f2beca04` |
| 対象差分 | CLI、feature、step定義、追跡表、変更履歴の5 file |
| 対象外 | 再固定で許す`method`の拡大、内容等価性判定の変更、Issue #1074、delivery stateの書き換え、review層の`assertCurrentReviewJournalBinding` |
| 残り予算 | Step 10の上限3ラウンドのうち2を残す |
| ラウンド数 | 1（Step 10のラウンド1）。**Step 7のreadiness checkは3ラウンド予算に数えない** |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260902_174126_pr-mergeの再観測が再固定chainの実効HEADを参照しない |
| モード | full（Q-01・Q-03・Q-06が偽。不可逆操作の認可判定の入力を変える） |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-005。**本文を変えない。** 同要件は既に「照合対象を新headへ移す」「`pr create`後は`pr reanchor`が受け持つ」と定めており、実装が要件へ達していなかった |
| 成果物行数 | 製品: `src/cli.ts` +31行。test +121行。仕様 +2行 |
| 縮小の先行評価 | 実施済み。**実効HEADの導出を`deriveEffectiveHead`へ委ね、新しい導出logicを書かない。** 呼び出し元それぞれで計算する案は導出が4箇所へ散るため不採用にした |
| authority | **merge認可のTOCTOU再照合の入力を変える。** 受理するheadの集合が、再固定記録を持つstagingでだけ広がる |
| 実施者・日時 | reviewer、2026-09-02（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | critical（`minimumTierByRisk.authority`） | claude（`modelMapping.roles.reviewer.provider`） | Opus 5、effort high | 未解決Critical/Highがあれば停止し、是正後に同sessionの次ラウンドで再review | implementerとreviewerはいずれも本sessionのAI agentであり、**Git commit authorも同一である。§9に実態どおり記録し、独立性が成立したとは主張しない** |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 到達不能性 | 変更前の`src/cli.ts`で`readEvidenceReanchorChain`と`deriveEffectiveHead`の全出現を機械抽出 | **5箇所。** import 2件、`assertCurrentReviewJournalBinding`内2件、`pr reanchor`の出力1件。**delivery層の記録を読む判定は0件** | 実測 |
| 仕様の要求 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-005 | 「照合対象を新headへ移す」「`pr create`前は`review reanchor`、`pr create`後は`pr reanchor`が受け持つ」と明記 | 静的読解 |
| 変更前の拒否 | SCN-INT-REANCHOR-006相当の入力を変更前codeへ与える | 固定済みheadと異なる再観測が`PR再観測が固定済みrepository・PR・base ref・headと一致しません`で拒否される | 実行観測 |
| 変更後の通過 | 内容等価な再固定記録を積んで同じ入力を与える | 通過する | 実行観測 |
| 空chainの同値性 | 記録0件で新headを与える | **変更前と同じ理由で拒否される。** 判定が変わらない | 実行観測 |
| 連鎖破綻の扱い | 先頭の`oldHeadSha`が固定済みheadと一致しない記録を置く | 破綻位置以降を導出に使わず拒否される | 実行観測 |
| 変異試験 | 変異3件を注入し`SCN-INT-REANCHOR-001〜007`を実行 | **3件すべてkill。** 照合対象の巻き戻しで1件、chain空固定で1件、head照合削除で2件が失敗 | 実行観測 |
| 安全条件の非変更 | `git diff` | `src/domain/evidence-reanchor.ts`と`src/adapters/evidence-reanchor.ts`に**変更0行。** 内容等価性判定と`METHODS`列挙が不変 | 実測 |
| 差分の限定 | `git diff --name-only` | 5 fileのみ | 実測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`再固定記録 → 実効HEAD導出 → PR再観測の照合`の一方向。artifact本文へ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl`が直前commitであり、`H_impl..HEAD`の差分は本artifact 1 fileのみ
- reviewer stable IDがPR author/観測済み`H_impl` author stable IDと異なる: **異ならない。** §9に実態を記録した
- 既定branch追随: **実施済み。** `rebase --onto origin/main`で追随し、`15_要件追跡/01_変更履歴.md`の衝突を両側の行を保存する形で解消した

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/cli.ts` | M | package | package | `assertBoundPullRequestObservation`が照合を、`deriveEffectiveHead`が導出を持つ。**導出を1箇所に保つため`staging`を引数で通す** | 照合側から導出側への一方向。逆参照なし。循環なし | AC-1101-01〜03。SCN-INT-REANCHOR-005〜007 | 受理するheadの集合が広がる。**広がる条件は内容等価性を満たす記録の存在だけである。** **repository状態はrevertで戻る。** merge後に自動releaseが成立した場合、公開済みのtagとGitHub Releaseはrevertでは取り消せない（§8） | pass |
| `test/features/integration/evidence-reanchor.feature` | M | package | package | 通過・空chain・連鎖破綻の3境界へ1 Scenarioずつ | featureはstep定義へ一方向。循環なし | 同上 | test追加のみ | pass |
| `test/steps/evidence-reanchor.steps.ts` | M | package | package | `observedPullRequest`が固定済みidentityと同じ内容を組み立て、**headだけを引数で変える** | step定義は製品へ一方向。循環なし | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | spec | REQ-WF-005の行へSCN 3件を足す | 追跡表のみ。循環なし | SCN-INT-REANCHOR-005〜007 | 1行の差し替えで復旧する | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | spec | 非変更範囲を実際に維持した契約へ限定して記録する | 履歴のみ。循環なし | 該当なし | 1行の削除で復旧する | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-status`が`M`5件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 製品差分の修正は発生していない

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1101-EXPORT-001 | `assertBoundPullRequestObservation`が非exportで、integration層から直接呼べない | 検証経路 | なし | **exportした。** 既に同じ理由で`assertCurrentReviewJournalBinding`がexportされている先例に倣う。exportは判定を変えない | `SCN-INT-REANCHOR-005〜007`が製品関数を直接呼ぶ | no-spec-impact | pass |
| DISC-1101-FIXTURE-001 | 連鎖破綻したchainは`pr reanchor`経由では作れない。等価性を要求するため | fixtureの作り方 | なし | 記録fileへ直接1行置く形にした。**製品の受理条件を緩めずに破綻状態を作る** | `SCN-INT-REANCHOR-007` | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1101-01 | SCN-INT-REANCHOR-005 | 実効HEADとの照合 | pass | pass | §7 |
| AC-1101-02 | SCN-INT-REANCHOR-006 | 空chainでの同値性 | pass。**変更前と同じ拒否文言であることまで検証する** | pass | §7 |
| AC-1101-03 | SCN-INT-REANCHOR-007 | 連鎖条件の遵守 | pass | pass | §7 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | mergeという不可逆操作の認可判定の入力を変える | `src/domain/evidence-reanchor.ts`と`src/adapters/evidence-reanchor.ts`への変更が0行であること |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 拒否理由から何を直すか判断できる必要がある | 拒否文言を変更していない。SCN-INT-REANCHOR-006が文言まで検証する |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 人が触れるUIを持たないCLIである | `projectKind`が`cli` |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI componentもthemeも持たない | `capabilities.designTokens`が`not-applicable` |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | REQ-WF-005が定める「照合対象を新headへ移す」が`pr merge`経路で成立する |
| 価値 | 利用者・運用上の目的を満たすか | pass | rebase後も正規経路でmergeでき、認可・TOCTOU再照合・delivery終端記録を失わない |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | `pr merge`は`--staging`を必須にしており、追加の入力を要求しない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の3コンポーネントがそのまま実装になり、AC 3件とSCN 3件が1対1で対応する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 導出は`deriveEffectiveHead`1箇所のままである |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 通過・空chain・連鎖破綻の3条件を実測した。**空chainでの同値性が最重要であり、拒否文言まで一致させた** |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 記録の形式不正は既存の`isEvidenceReanchorRecord`が拒否する。連鎖破綻は破綻位置以降を使わない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | chain 0件で変更前と同一。比較対象は40桁小文字のSHAであり正規化の余地がない |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | **受理するheadが広がる条件は、内容等価性を満たす記録の存在だけである。** 等価性判定と`METHODS`列挙に変更0行。未reviewの内容を持つheadは`appendEvidenceReanchor`が記録を拒否するため照合対象にならない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | repository・PR番号・head ref名・base refの照合を維持する。**headだけが実効HEADへ変わる。** previewとapply直前で同じ導出を使うためTOCTOUの窓を広げない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 読み取りだけである。`appendEvidenceReanchor`がdelivery stateを書き換えない設計を維持した |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | **repository状態はrevertで既存判定へ戻る。** 記録を持たないstagingは判定が変わらないため、revertの影響範囲も再固定を使ったstagingに限られる。**配布物は別である。** merge後に自動releaseが成立するとtagとGitHub Releaseが作られ、revertでは取り消せない。無効化はdeprecateまたは次versionでの前進であり、公開済みartifactの削除ではない |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `assertBoundPullRequestObservation`の呼び出し元4箇所すべてへ`staging`を通した。型検査が漏れを検出する。配布物への影響は§8 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | **provider副作用を伴う実行観測を行っていない。** 実PRに対する初回適用は未観測である | 本artifactの§7 | 実運用での初回適用 | **本PRでは行わない。** 実PRを作らずにstub providerで判定を観測できる。実運用での初回適用時に観測する | valid（記録のみ） | 残存する |
| M-02 | Medium | 内容が変わる是正（review予算超過後のCI赤など）は依然として正規経路を持たない | Issue #1074 | rebase以外の是正 | **本PRでは解かない。** #1074が扱う別事象である。本件は内容等価なrebaseだけを扱う | valid（out-of-scope。record-only） | 残存する |
| L-01 | Low | `assertBoundPullRequestObservation`をexportした | `src/cli.ts` | API表面 | **意図的である。** 先例`assertCurrentReviewJournalBinding`と同じ理由であり、判定を変えない | valid（記録のみ） | なし |

**Critical/High 0件。**

## 6. ラウンド固有の確認

### ラウンド1（Step 10、2026-09-02、candidate HEAD = `H_impl`）

- 全評価基準を確認した: はい。肯定5観点・敵対8観点をすべて評価した
- 指摘を確定した: はい。M-01、M-02、L-01はいずれも記録のみ
- 次ラウンド対象のCritical/High: **なし**
- blocking: 0件

### ラウンド2

- 本artifactのcommitでHEADが動くため、次ラウンドで再固定する

### ラウンド3

- 未実施。**外部reviewの指摘があれば本ラウンドで扱う**

### 手順上の逸脱の記録

**Step 10 journalのreview session bindingと`pr create`が固定したdelivery stateは旧HEADを指したまま陳腐化している。**

PR作成後に既定branchが動き、`git diff`が衝突する状態になったためrebaseした。rebaseは前ラウンドのcandidate HEADを到達不能にするため、review sessionへ次ラウンドを追記できない。`review reanchor`は内容等価性を要求するが、追随でreview artifactのSHA行と変更履歴のbase列が変わるため等価にならない。

**これは本PRが是正しようとしている欠陥のreview層版である。** 本PRはdelivery層（`pr merge`の再観測）だけを扱う。review層の同型の欠落と、内容が変わる是正の正規経路はIssue #1074が扱う。**本PRのscopeでは是正しない。**

実体としてのreviewは本artifactが記録するラウンド1と2であり、`audit:check`が`比較基点`・`H_impl`・個別監査表・`H_impl..current`の一致を現HEADで検証している。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---|---|---|---|
| 文書・受け入れ形式 | `npm run docs:format` / `test:format` | 2 | 2 | 0 | 0 | pass |
| 静的検査・整形・型 | `npm run lint` / `format:check` / `typecheck` / `source:check` | 4 | 4 | 0 | 0 | pass |
| 追跡・構造 | `npm run trace:check` / `architecture:check` | 2 | 2 | 0 | 0 | pass。孤立0件 |
| 配布物 | `npm run build` / `package:check` | 2 | 2 | 0 | 0 | pass。実行・配布file 342件 |
| conformance | `npm run conformance:check` | project rule 20件 | 20 | 0 | 0 | pass。orphan 0件 |
| 全test層（unit・integration・e2e、runnerはcucumber-js） | `npm test` | 1407 scenarios | 1391 | 0 | 16 | pass |
| レビュー成果物の監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

**skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する。** 本差分はこの経路に触れない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/cli.ts` | **入る**（`dist/src/`として） | `pr merge`が受理するheadの集合が、再固定記録を持つstagingでだけ広がる |
| `test/`配下2 file | 入らない | なし |
| `docs/specs/`配下2 file | 入らない | なし |

判断: 配布物を更新した

根拠: `package.json`の`files`は`dist/src/`を含む。`src/cli.ts`の変更はbuild後の配布物へ反映される。**配布digestが変わるため、mergeで自動releaseの計画が成立する見込みである。**

**releaseの起動と計画は分けて記録する。** `.github/workflows/release.yml`は`main`への`push`で起動する。その後`planAutoRelease`が配布digestの差分を見て計画を決める。**本変更は配布digestを変えるため、version bumpとtagが作られる見込みである。** merge後に実観測する。**npm公開は自動経路では発火しない。**

**ロールバックの対象範囲を分けて記録する。**

| 対象 | revertで戻るか | 戻らない場合の手段 |
|---|---|---|
| repository状態 | 戻る | 該当しない |
| 公開済みtagとGitHub Release | **戻らない** | 削除ではなく、次versionでの前進で無効化する |
| npm registryの公開物 | 該当しない | **本経路では公開しない** |

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **本artifact作成時点では無い。** exact-headは`H_final`。immutable GitHub reviewは0件 |
| reviewerがPR author・実装commit authorと異なる | **異ならない。** implementerもreviewerも本sessionの同一AI agentであり、Git commit authorも同一である |
| 観測したreview commentとapprovalの件数 | 本session内のreview 1ラウンド（Critical/High 0、Medium 2・Low 1）。GitHub review 0件 |

**`02_品質基準.md`の「独立reviewが成立しない場合」に従う。** 同節は「既定は停止ではなく、無記録での通過の禁止である」と定める。

**PR作成後の外部reviewを待つ。** 本変更はmerge認可の判定入力を変えるため、**外部reviewの到着を特に重視する。** CodeRabbitがfree limitで出力できない場合は、その事実をPRへ記録したうえで判断する。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`。**REQ-WF-005の本文は変えていない**
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。新規用語を導入していない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass
- 要件・変更・SCN・テストの追跡: REQ-WF-005 → AC-WF-005 → SCN-INT-REANCHOR-005〜007。**要件本文が既に「照合対象を新headへ移す」と定めているため、新規SCNは要件行から到達できる**
- UI・トークンの判断: UIを所有しないためdesign token・layout tokenは対象外。ADRを追加しない

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし**
- Medium/Lowの記録: M-01（実行観測の不在）、M-02（#1074は別事象）、L-01（export）
- 判定: approved（Step 10 ラウンド1）
- 新しい権限が必要な事項: mergeは別authority
- 残存リスク:
  1. **provider副作用を伴う実行観測を行っていない。** 実運用での初回適用時に観測する
  2. **内容が変わる是正は依然として正規経路を持たない（#1074）**
  3. **配布digestが変わるため自動releaseの計画が成立する見込みである。** merge後に観測する。**公開済みtagとGitHub Releaseはrevertで取り消せない。** 無効化は次versionでの前進による
- 次に許可される操作: push、PR作成、**外部reviewの到着確認**、必須check 2件の全緑確認、およびownerが承認したauthorityによる**通常merge commit方式**でのmerge。**squash mergeを使わない**
- 次回の再開地点: PR作成から
