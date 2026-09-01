# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1102 |
| ラウンド | Step 10 ラウンド1 |
| ラウンド数 | 1。**総1ラウンドで設計している。** commit前に独立reviewerへconsultationを行い、指摘を畳み込んでからラウンド1の対象にする。予算3のうち2を残す |
| 比較基点 | `34c89551113b9e40267d762e8402d9e30a937800` |
| H_impl | `7b4c96338aabe7265e8e03d57d1e02f1ad462289` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip。PR #1103（先行proposal 001の登録）のmerge commitである。前へ進めていない |
| Step 10のreview session ID | ラウンド1記録時に確定し、`review-session.json`が正本になる |
| モード | full |
| 対象差分 | `.github/trusted-quality-proposals.json` の23行追記1件のみ。commitは`7b4c9633` |
| 対象外 | **先行proposal `TQP-PROTECTED-READ-DIAGNOSIS-001` の削除や変更。** REQ-SQ-012が契約fieldの不変と削除の拒否を定める。001は適用されないまま残る。是正本体の適用と版上げは #1017 のPRが行う |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260902_042727_保護対象読み取り診断の代替proposalを登録する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-006「品質契約変更はtrusted proposalの二段階適用に限定する」とREQ-SQ-012「登録済み品質proposalの契約fieldを不変にする」。**両要件の本文は変えない** |
| 成果物行数 | 製品 **+0 / −0行**。仕様 **+0 / −0行**。データ **+23 / −0行**（registry JSON）。支援層 **+0 / −0行** |
| 縮小の先行評価 | **本PRが存在すること自体が縮小の失敗の帰結である。** 先行proposal 001を登録する前に、製品fileの内容を独立reviewへ通していれば1周で済んだ。実際には登録後のreviewでsource commentの因果誤りが出た。**採った縮小は「代替proposalの登録に留め、001の取り消しや機構の変更を試みない」である。** 不採用は(1)001を削除して登録し直す案（REQ-SQ-012が削除を拒否する）、(2)誤ったcommentを残して再登録を避ける案（安全不変条件の誤った説明を保護fileへ固定する） |
| 実施者・日時 | reviewer（codexのread-only sandbox起動）、統合はcoordinator（claude）、2026-09-02 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | standard | codex | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは本session（claude）。reviewerは**codexの別invocation**である。read-only sandboxで起動しfileを1つも変更していない |

**開示する逸脱が3件ある。**

1. **implementerとcoordinatorが同一sessionである。** reviewerとの分離は成立している。findingの採否判断をcoordinatorが行っており`roleContracts.coordinator.forbiddenOperations`の`self_approve`に接する。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts`が同directoryを要求する一方、`validateRoleOperation`は実行時に強制されていない。解消を #1047 へ委譲する。
3. **Issue #1102 は先行proposalの登録で一度closeされ、本PRのために再openした。** 同一trackerを2本のPRで使っている。**#1104 が扱うStep 4の本文置換問題と隣接するが、本Issueの本文は自分の成果物なので保全対象を持たない。**

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1102 | Step 8で35266文字の本文を同期し`sync-verified`・`checkpoint: 8`で確定 | 人間判断 |
| 差分 | `34c89551..7b4c9633` | 1 file、23行追記 | 既存コード |
| テスト | `npm run quality` | 1388 scenarios、1372 passed、0 failed、16 skipped | テスト出力 |
| 配布物 | `npm run package:check` | `実行・配布ファイル342件`で合格。**`quality`はこれを内包しないため個別に実行した** | テスト出力 |
| 実entryの受理 | `checkProjectQualityContract(H_impl, 34c89551)` | `{"valid": true, "errors": []}` | 実行結果 |
| after hashの対応先 | `.worktrees/20260902_034528-1017-protected-read-diagnosis` の `H_impl` | `sha256sum scripts/check_project_quality.ts` が `13e98bff…`。**登録する`afterSha256`と一致する** | 実行結果 |
| 仕様 | 変更なし | `no-spec-impact` | 既存文書 |
| commit前candidate | 対象差分1 path | `git status --short`が意図しないpath 0件 | Git index |
| Phase A artifact | `docs/reviews/105_課題1102保護対象読み取り診断の代替proposal登録レビュー.md` | `H_impl..H_final`は本artifact 1 fileだけ | Git観測 |
| commit後external | PRは本artifact確定後に作成する | Step 11で観測する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** trusted registry → candidate registry の一方向であり、candidateがtrustedを書き換える経路が存在しない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **`H_impl = 7b4c9633`は本artifact commitの親である。**
- reviewer stable IDがPR author/`H_impl` author stable IDと異なる: **未観測。** PRはStep 11で作成するため、trusted provider由来のreviewer actor IDをまだ観測していない。**別providerであることはstable IDの差を証明しない。** 9節を参照する。
- 既定branch追随を行った場合: **行っていない。**

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | package | package | staged proposal 1件の追記。既存11件とschemaVersionへ触れない | pass。実行codeを持たないデータであり依存を1つも増やさない | REQ-SQ-006・REQ-SQ-012 / AC-01〜03 / SCN-UNIT-QUALITY-008・009 | merge前は`git checkout`で戻せる。**merge後は戻せない**（append-only） | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **`比較基点..H_impl`すなわち`34c89551..7b4c9633`は`.github/trusted-quality-proposals.json`の1 pathで、本表の1行と一致する。** 本artifactは`H_impl`の後に置くため本表には現れない。`H_impl..H_final`は本artifactの1 fileだけである。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。**
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 該当する是正が出た場合に記載する。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | **先行proposal 001が予告していた事象が実際に起きた。** artifact 103 の残存リスク3は「PR-2のreviewで製品fileの修正が必要になれば、同じ`9→10`の代替proposalを追加登録することになる」と書いていた | proposal登録が1周増える。目的・scope・AC・security境界・不可逆操作はいずれも変わらない | なし（`continue`） | 代替proposal 002を登録する。001は適用せず残す | `TQP-POC-SANDBOX-CI-001`と`-APPARMOR-001`が同じ`8→9`で共存する先例と同型である | no-spec-impact | pass |

**予告された残存リスクが現実になった。** artifact 103 は同時に「登録前に全gateを通してbyteを確定させたが、**reviewで指摘が出る可能性は残る**」とも書いており、**その可能性の側が実現した。** 予告を書いたこと自体は正しかったが、**予告は防止ではない。**

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-QUALITY-008 | registry data | pass | pass | 事前登録済みproposalと完全一致するcandidateだけが有効化できる |
| AC-02 | SCN-UNIT-QUALITY-009 | 同上 | pass | pass | candidate自身だけが登録したproposalによる自己承認が拒否される |
| AC-03 | ― | 作業tree全体 | pass | pass | `npm run quality`が1388 scenariosで失敗0件 |

**既存2 scenarioは「二段階手順そのもの」の受理側と拒否側を担う。** 一時rootへ独自fixture registryを書き込んで上書きするため、**今回追記した実entryを意味的に検証しない。** 実entryの受理は `checkProjectQualityContract(H_impl, 34c89551)` を直接実行して確かめた。

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 品質契約の保護境界の変更を承認する宣言であり信頼境界に触れる | targetが`PROTECTED_FILES`・`PROTECTED_PACKAGE_FIELDS`へ閉じることをtarget境界検証が機械的に強制する |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | not-applicable | log出力、相関情報、保持期間、rotation、監視、復旧手順のいずれも追加・変更しない | 変更は静的JSONへの23行追記だけで、実行時の出力経路を1つも通らない |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 画面、状態遷移、keyboard・touch、支援技術のいずれも持たない | project choicesにUI capabilityの選択が無く、成果物が静的宣言JSONである |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 意味token、component state、breakpoint、layout不変条件のいずれも持たない | 描画対象が存在しない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | `afterSha256`の`13e98bff…`が、#1017のPR-2 worktreeにある完成済みfileの`sha256sum`と一致することを実測した。**先行proposalで立証できなかった値が、本PRでは立証済みである** |
| 価値 | 利用者・運用上の目的を満たすか | pass | 安全不変条件の誤った説明を保護fileへ固定せずに是正を有効化できる |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | JSONへの追記のみ。codeも依存も追加authorityも要さない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | `no-spec-impact`の根拠をREQ-SQ-006とREQ-SQ-012の原文で示した |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | `rationale`が「なぜ001では足りないか」を具体的に述べる。次に読む者が001と002の関係を復元できる |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | `readProposalRegistry`が未知field、型、ID書式・重複、版の1段階性、hash書式、before≠afterを全件検証する |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | schema違反は例外で登録全体を拒否し、正しいentryだけを部分受理しない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `proposalId`は`^TQP-[A-Z0-9][A-Z0-9-]*$`、hashは`^[a-f0-9]{64}$`。001と002はIDが異なるため`ids.has`に掛からない |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | `targets[].name`はallowlist照合であり任意pathを受け付けない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | before hashをtrusted側の実内容から再計算する既存経路に従う。registryに秘密情報を書かず`owner`は役割名である |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 既存11件を1文字も変えていない。`git diff`が追記23行のみであることを確認した |
| ロールバック | 復旧参照、状態保持、再開可能性 | **finding** | **R1-N01。merge後は戻せない。** さらに**未適用のproposalが2件残る状態を作る。** 001と002はどちらも`9→10`で有効であり、**先に適用された方が勝つ** |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding** | **R1-N02。001が未適用のまま残ることの影響を、registryだけを読む者は判定できない。** `rationale`に001との関係を書いたが、**機械が両者の優先を決める仕組みは無い** |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| R1-N01 | Medium | 未適用の`9→10` proposalが2件並存する | `validateTrustedQualityMigration`は新規proposalごとに独立に判定し、同一版の複数proposalを許す。`2→3`と`8→9`に先例がある | registry | **記録のみ。** 001の内容は002の内容と互いに排他であり、`afterSha256`が異なるため両方が同時に適用されることはない | valid（記録） | **001の内容を持つcandidateが将来現れれば、それも受理される。** 現時点でそのようなcandidateは存在しない |
| R1-N02 | Low | registryだけを読んでも001と002の優先関係が分からない | registry schemaはproposal間の関係を表現しない | registry | `rationale`へ「先行proposal 001の…を是正した」と明記した。**これは記述fieldであり機械判定には使われない** | valid（対象外） | **人が読む前提の記述に依存する** |

## 6. ラウンド固有の確認

### commit前のconsultation（review roundではない）

**記録するreview roundを1つに保つため、commitの前に独立reviewerへconsultationを行う。** findingの`source`は`consultation`である。結果はラウンド1の記録前に本節へ反映する。

### ラウンド1

- 全評価基準を確認した: ラウンド1の記録時に確定する。
- 指摘を確定した: ラウンド1の記録時に確定する。
- 全指摘の最終分類: ラウンド1の記録時に確定する。
- 同じ範囲の予算を自動更新していない: **成立する。** 総1ラウンドで打ち切り、2を残す。
- AIによる最終裁定: ラウンド1の記録時に確定する。

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format` | 1 | 1 | 0 | 0 | pass |
| lint・format・型・source品質・全test | `npm run quality` | 1388 | 1372 | 0 | 16 | pass |
| 配布物 | `npm run package:check` | 1 | 1 | 0 | 0 | pass（342件） |
| 監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |
| 実entryの受理 | `checkProjectQualityContract(H_impl, 34c89551)` | 1 | 1 | 0 | 0 | pass（`errors: []`） |
| after hashの対応先 | `sha256sum`（#1017 PR-2 worktree） | 1 | 1 | 0 | 0 | pass（`13e98bff…`が一致） |

**`npm run quality`は`package:check`・`audit:check`を内包しない。** それぞれ個別に実行した。実行結果はHEADへ耐久化されていないため、独立の再確認はCIの同名jobが行う。

### 7.1 変異試験

**本PRでは行っていない。理由を述べる。**

本PRはcodeを1行も変更しておらず、変異させる判定logicが差分に存在しない。registry dataへの変異は、本PRが変更していない既存の`readProposalRegistry`と`validateTrustedQualityMigration`の検査になる。

**是正本体の変異試験は #1017 のPRが行い、そのreview artifactが正本として記録する。** ここでその結果を`afterSha256`の妥当性の根拠に使わない。**本PRの`H_final`から監査できないためである。**

**ただし`afterSha256`が指す実体は本PRの時点で検証済みである。** #1017 のPR-2 worktreeの`H_impl`で`sha256sum scripts/check_project_quality.ts`が`13e98bff…`を返すことを実測した。**先行proposal 001の登録時（artifact 103の残存リスク2）は、この照合ができなかった。** 対応するfileがどのcommitにも存在しなかったためである。**今回は存在する。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | `package.json`の`files`は`dist/bin/`・`dist/src/`・`dist/vendor/`・`.agent-skill-chain/`配下・`README.md`・`AGENTS.md`を列挙し、`.github/`を含まない |
| `docs/reviews/105_課題1102保護対象読み取り診断の代替proposal登録レビュー.md` | 入らない | なし |

判断: 配布物を更新しない

根拠: 変更した2 pathはいずれも`package.json`の`files`が列挙する配布境界の外にある。**codeを1行も変更していないため`dist/`の内容も変わらない。** `npm run package:check`を実際に実行し342件で合格することを確認した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | Step 11のPR作成後に観測する |
| reviewerがPR author・実装commit authorと異なる | codexは別provider・別contextである。**stable IDの差は未観測である** |
| 観測したreview commentとapprovalの件数 | Step 11で観測する |

**外部reviewerのcheckがpassでもreview commentとapprovalの実体を観測する。** 両方0件だった場合だけ`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の条件に当たる。**現時点では例外を適用していない。**

## 10. 仕様整合性

- 判定: no-spec-impact
- 更新した仕様: なし。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **用語の追加・変更・廃止はない。**
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。**
- 要件・変更・SCN・テストの追跡: REQ-SQ-006・REQ-SQ-012 → AC-SQ-006・AC-SQ-012 → SCN-UNIT-QUALITY-008・009。
- `no-spec-impact`の場合の限定的根拠: **REQ-SQ-006とREQ-SQ-012が本手順を既に所有している。** 本PRはその手順の実行例を1件足すだけである。**ただし「振る舞いに差分が無い」は厳密には強すぎる。** 登録により、`13e98bff…`のhashに完全一致する`9→10` candidateを許可するauthority集合が増える。要件本文が述べる手順そのものは変わらないため`no-spec-impact`と判定するが、この点を隠さず記録する。
- UI・トークンの判断: UI無し。tokenは`not-applicable`。

## 11. 総合判定と再開地点

- 未解決Critical/High: ラウンド1の記録時に確定する。
- Medium/Lowの記録: R1-N01（未適用proposalの並存）、R1-N02（優先関係が機械判定されない）。
- 判定: ラウンド1の記録時に確定する。
- 新しい権限が必要な事項: **なし。** 品質契約の版上げはrepository ownerが2026-09-02に承認済みである。
- 残存リスク: 3件。
  1. **登録のmergeは不可逆である。** 001も002も削除できない。
  2. **未適用の`9→10` proposalが2件並存する。** 001の内容を持つcandidateが将来現れれば受理される。**現時点でそのようなcandidateは存在せず、001の内容は002によって置き換えられている。**
  3. **`npm run package:check`・`audit:check`の出力はHEADへ耐久化されていない。** 独立の再確認はCIの同名jobが行う。
- 次に許可される操作: Step 11のPR作成。
- 次回の再開地点: `pr create`。
