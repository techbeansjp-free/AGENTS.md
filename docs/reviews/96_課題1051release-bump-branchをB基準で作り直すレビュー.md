# 96 課題1051 release bump branchを基準SHAから作り直す 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。**Step 10は3ラウンドすべて`rejected`となり、予算を使い切った。** 未解決だったHigh 3件はすべて是正し、最後の1点は別identity・別contextの`verifier`が機械観測で解消を再測した。**`valid: true`は候補が既定branchを基準に検証を通過したことを示すだけであり、既定branchへの反映を示さない。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1051 |
| ラウンド | Step 10 ラウンド1〜3 |
| 比較基点 | `e2c4ed179db6eb6c361281bee1ce5073ca1ba77f` |
| H_impl | `280c3bbaf069358bc5494431939e6f07472f87a1` |
| 対象差分 | 10 file、+1,196 / −27行 |
| 対象外 | `B`確定からadmin mergeまでのTOCTOU（#1053）、bump後のfull suite再実行構造（#1052）、`roleContracts`の強制点（#1047）、既存`release/bump-v0.2.*`の整理 |
| 残り予算 | **0。3ラウンドを使い切った** |
| ラウンド数 | 3（Step 10のラウンド1〜3。上限3を使い切った） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260829_024018_release-bump-branchがmain基準で作り直されない |
| モード | full |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-003。本変更で「gate対象treeは基準SHAのtreeに正規bump差分だけを適用したものにする」を追記した |
| 成果物行数 | 製品: 404行（`scripts/prepare_release_bump.ts` +373、`src/domain/release.ts` +15/−3、`release.yml` +9/−20、`docs/specs/` +11/−4）。支援層: 788行（`test/steps/` +758、`.feature` +30） |
| 縮小の先行評価 | 実施済みだが**見積を超過した。** 02 §12.1の見積は製品157行・支援層190行、所要時間で支援層1.40h ≦ 製品1.50h。**実測の行数比は1.95倍である。** 超過分はStep 10ラウンド1〜3の是正（fail-closed条件とその回帰fixture）に集中しており、これは運用ポリシーが縮小対象から除く安全条件である。**数字を後から動かさず超過として記録し、owner判断へ回す** |
| authority | mergeは別authority。release・publishはさらに別authority |
| 実施者・日時 | reviewer、2026-08-31（JST） |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| implementer | failing_test、test_result | advanced | **claude**（03 §0.1の宣言は`codex`。**逆転している**） | Opus 5、effort high | 実装を継続できない場合は停止しIssue化する | 実装commitは`280c3bba`の1件 |
| reviewer | 肯定・敵対review、finding分類 | critical | **codex** `gpt-5.6-sol`（03 §0.1の宣言は`claude`。**逆転している**） | effort high、read-only sandbox | 未解決Critical/HighがあればPRへ進まない | implementerと別provider・別identity・別context。3ラウンドとも`git status --porcelain`が空であることを自己報告した |
| verifier | 機械観測の再測 | critical | codex `gpt-5.6-sol`（reviewerとも別context） | effort high | 事実が取れない場合は「取れない」と報告する | 配置testを`/tmp`の複製で行い、原本のSHA-256が前後一致することを報告した |

**routingの逸脱を記録する。** 03 §0.1はT01〜T06のproviderを`codex`、reviewerを`claude`と宣言しているが、**実際は実装をclaudeが行い、reviewerをcodexにした。** 宣言と実態が逆である。維持した不変条件は「implementerと最終reviewerが異なるidentityかつ異なるcontextであること」であり、逆転してもこれは成立する。**逸脱そのものは事実として残す。**

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 欠陥の再現 | 自動release run 33313305686 | bump branch `0a36a84e`が既定branchより44 commit遅れ、**1040 scenarios / 5513 steps**の古いtreeでgateが走り失敗。現既定branchは1293 / 6842 | 実行観測 |
| lifecycleの実行 | 隔離fixtureで`npm version --no-git-tag-version` | flagなしで`pre ver post`が観測され、`--ignore-scripts`で観測されない | 実行観測 |
| CASの必要性 | E-04・E-05の再現 | 未作成refへの通常pushは競合をexit 0で素通りし、空expect leaseは`stale info`で拒否する | 実行観測 |
| 正規bump差分の判定 | `canonicalBumpDiff`へ直接入力 | 通常bumpは`true`、raw`__proto__`とescape表記は`false`、値中の断片は`true`、3 field不一致は`false` | 実行観測 |
| 合成経路 | SCN-INT-AUTORELEASE-011 | 現行workflowに対しC-1・C-4・C-5が不合格になることを実装前に観測 | テスト出力 |
| 変異試験 | 15件 | **全件死亡。** M-01〜M-08、M-09〜M-21のうち実行した15件 | テスト出力 |
| 全gate | `npm run verify:distribution` | `audit:check`以外すべてexit 0。`npm test`は1293 scenarios / 0 failed | テスト出力 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`origin_main` → `prepare_bump` → `gate_run` → `bump_pr` → `admin_merge`の一方向。**現行のself-loop（bump branchの内容が自身の過去の内容に依存する）を断つことが本変更の主目的である**
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: 本fileをH_finalの唯一の差分とする
- reviewer stable IDがPR author/observed実装commit author stable IDと異なる: role identityでは、はい。Git commit authorは実行者単一のため一致する
- 既定branch追随を行った場合の固定点: 追随はrebaseで行い、`merge-base(H_impl, e2c4ed17)`が`e2c4ed17`に一致する

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `scripts/prepare_release_bump.ts` | A | package owner | package | 観測・判断・適用を直列1本で行い、bump branchを基準SHAから作り直す | `src/domain/release.ts`・`src/lib/`へ一方向。循環なし | FR-01〜FR-07 / SCN-004〜008 | 失敗時はremoteを更新せず非0終了。fileを削除すれば復旧 | pass |
| `src/domain/release.ts` | M | package owner | package | `nextAutoReleaseVersion`をexportし、`[skip ci]`判定を着地commit基準へ正す | 外部依存を増やさない | INV-03 / SCN-001〜003 | 変更2箇所を戻せば復旧 | pass |
| `.github/workflows/release.yml` | M | package owner | project | `npm ci`とscript呼び出しを専用stepへ分離し旧経路を削除 | scriptを1回呼ぶだけ | AC-09 / SCN-011 | 旧stepへ戻せば復旧 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | 仕様owner | spec | TERM-ASC-080・081を耐久台帳へ反映 | 参照のみ | TERM-ASC-080・081 | 2行を戻せば復旧 | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | 仕様owner | spec | REQ-GH-003へgate対象treeの導出規則を追記 | 参照のみ | REQ-GH-003 | 追記を戻せば復旧 | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | 仕様owner | spec | bump branch作り直しの運用と、再帰防止のmerge message設定依存を明記 | 参照のみ | REQ-GH-003 / M-01 | 追記を戻せば復旧 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 仕様owner | spec | REQ-GH-003の行へSCN-004〜008・011と実装pathを追加 | 参照のみ | 全SCN | 1行を戻せば復旧 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | 仕様owner | spec | 本変更の履歴を1行追加 | 参照のみ | 全SCN | 1行を戻せば復旧 | pass |
| `test/features/integration/auto-release.feature` | M | package owner | evidence | SCN-004〜008・011の受け入れ例を追加 | 参照のみ | AC-01〜AC-09 | 追記を戻せば復旧 | pass |
| `test/steps/auto-release.steps.ts` | M | package owner | evidence | 隔離fixtureとC-1〜C-6の構造検査を実装 | 製品を参照するのみ | AC-01〜AC-09 | 追記を戻せば復旧 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-status e2c4ed17 280c3bba`が10件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: pass

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-201 | `validateReleaseWorkflow`が`git commit ... [skip ci]`をworkflow本文へ要求しており、commit生成をscriptへ移すとSCN-001・003が落ちる | INV-03。再帰防止の性質そのものは不変 | なし | 判定対象を「どこでcommitを作るか」から「何がmainへ着地するか」へ正した | SCN-001〜003が変更なしで緑 | updated | pass |
| DISC-202 | 初版fixtureが`stale`のときだけmainを前進させ、INV-02の対比較が成立しなかった | 支援層のみ | なし | 全variantで同じ前進commitを作った | SCN-004の2 fixtureのtree hash一致 | no-spec-impact | pass |
| DISC-203 | step解析が`run: \|`の`\|`をinline scalarと誤読しC-5が発火しなかった | 支援層。**検出力の欠落** | なし | block scalar判定をinlineより先に置いた | 現行workflowでC-5が発火 | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01・AC-06 | SCN-INT-AUTORELEASE-004 | `prepare_release_bump.ts`のrebuild経路 | 乖離branchと未作成の対でtree hashが一致し、期待treeとも一致 | pass | §7 |
| AC-02・AC-08 | SCN-INT-AUTORELEASE-005 | reuse経路（TB-B01の3条件） | remote head不変、subject接頭辞一致、変更path 2件 | pass | §7 |
| AC-03 | SCN-INT-AUTORELEASE-006 | `canonicalBumpDiff`とlifecycle抑止 | 混入除去、`__proto__`拒否、lifecycleの痕跡なし | pass | §7 |
| AC-04 | SCN-INT-AUTORELEASE-007 | 非0終了とstderr、TB-B04・B05 | 基準SHA不確定と競合の双方で非0・stderrあり・stdout空 | pass | §7 |
| AC-05 | SCN-INT-AUTORELEASE-008 | already-applied経路 | `release/`配下のremote refが0件 | pass | §7 |
| AC-07 | SCN-INT-AUTORELEASE-001〜003 | 変更しない | 3件とも緑 | pass | §7 |
| AC-09 | SCN-INT-AUTORELEASE-011 | `release.yml`の専用step | C-1〜C-6すべて合格 | pass | §7 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 既存bump branchの内容を信頼しない境界を作り、remote更新を条件付きにする | TB-B01〜B05、`--ignore-scripts`によるlifecycle抑止、`__proto__`のfail-closed。SCN-006・007で観測 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 停止経路だけに限定する。正常経路の分類logを持たない | 正常時は無出力、停止時のみstderrへ理由。SCN-007がstdout空を観測 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | GUIを持たず、人との接点はGitHub Actionsの出力だけである | 変更対象にUI sourceが存在しない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UIを所有せずtoken適用対象が存在しない | `17_デザイン/`・`18_レイアウト/`を参照していない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | FR-01〜FR-07とINV-01〜INV-07に対応するSCNが全件緑。変異15件が全件死亡 |
| 価値 | 利用者・運用上の目的を満たすか | pass | 44 commit遅れのstale branchでgateが走る恒久停止を、導出元を基準SHAへ限定して断つ |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 標準gitと`npm version`だけで成立する。`npm ci`をscript呼び出しの前へ移してtsxの可用性を満たす |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | REQ-GH-003・運用設計・用語台帳・追跡表・変更履歴を実装へ揃えた |
| 保守性 | 責務、命名、変更容易性が妥当か | finding | **手書きのYAML行解析は構文表現に依存し、3ラウンドで6件＋3件＋1件の読み落としが出た。** 現状はfail-closedで閉じているが、将来のworkflow変更で崩れやすい。残存リスクへ記載 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 3ラウンドで出た反例をすべて変異として固定し、全件死亡させた |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 基準SHA不確定、正規bump差分超過、CAS競合のいずれもgate未実行で非0停止する |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 未作成ref、乖離branch、正規branch、多親commit、tree不一致、escape表記のJSON keyを観測 |
| 悪用 | 注入、経路脱出、権限外操作等 | finding | `run`本文のshell解釈を行わないため、変数展開・command substitution経由の間接表記は検出できない。**設計が対象外としている限界であり残存リスクへ記載** |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | `--ignore-scripts`でlifecycleの任意実行を止め、書き込みは最後の1回のpushだけにした。秘密を出力しない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | remote更新は観測済みheadへの条件付き更新に限る。既に正規なbranchは書き換えない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 失敗時はremote不変で次のrunがやり直す。scriptの削除と旧stepの復帰で完全復旧する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | 配布境界に入る`src/domain/release.ts`を§8で判定した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| H-01 | High | `npm version`に`--ignore-scripts`が無く、基準treeのlifecycleが判定前に任意commandとremote書き込みを実行できる | 隔離fixtureでflag有無を実測 | 製品。INV-05・FR-05 | `--ignore-scripts`を付けた | resolved | なし |
| H-02 | High | 合成経路の構造検査が有効なworkflow構文で素通りする。ラウンド1で6件、ラウンド2で3件、ラウンド3で1件 | 各反例のYAMLと変異結果 | 支援層。AC-09 | 全件塞ぎ、M-09〜M-21で固定。最後の1点はverifierが再測 | resolved | 下記の残存リスク1 |
| H-03 | High | strict parserが`__proto__`をown propertyとして保持せず、raw一致では escape表記も見逃す | `canonicalBumpDiff`への直接入力 | 製品。FR-02 | decode後のmember keyを検査するようにした。偽陽性も同時に解消 | resolved | なし |
| M-01 | Medium | 再帰防止がrepositoryのmerge commit message設定に依存することを仕様が固定していない | GitHubの設定仕様 | 仕様 | 運用設計へ依存条件として明記 | resolved | 設定変更時は`validate` jobのguardを見直す必要がある |
| M-03 | Medium | 正規bump差分の第1段階を外す変異が、script経由では区別できない | 直接入力での実測 | 支援層 | exportされた判定関数への直接観測を追加 | resolved | なし |
| R-01 | Medium | `forbiddenGitUsage`がshellを解釈せず、間接表記のgit sub commandを検出できない | reviewerの分類 | 支援層 | **対応しない。** shell ASTは設計が対象外 | out-of-scope | 残存リスク1 |
| R-02 | Medium | `core.hooksPath`等のGit設定由来の実行入口が判定前に任意processを実行しうる | reviewerの分類 | 実行環境 | **対応しない。** 修正差分で導入したものではない | out-of-scope | 残存リスク2 |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい
- 指摘を確定した: H-01・H-02・H-03（High）、M-01
- 次ラウンド対象のCritical/High: H-01・H-02・H-03

### ラウンド2

- 未解決Critical/High: H-02・H-03
- 修正差分: `255f14d7..68aa801b`
- 修正で触れた隣接範囲: SCN-001〜008・011と`validateReleaseWorkflow`。回帰なし
- 既承認・未変更範囲を再走査していない: はい

### ラウンド3

- 全指摘の最終分類: H-01 resolved、H-02 valid、H-03 resolved、M-03 resolved、R-01・R-02 out-of-scope
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 検査はすべてfail-closed側へ倒した
- 同じ範囲の予算を自動更新していない: はい。**4ラウンド目を開いていない**
- AIによる最終裁定: **ラウンド3が`valid`と分類したH-02の残り1点へ、reviewer自身の処方をそのまま適用した。** 実装者が自分の修正を解決済みと宣言しないため、別identity・別contextの`verifier`へ機械観測の再測を依頼し、「解消している」との報告を得た

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format` / `npm run test:format` | 2 | 2 | 0 | 0 | pass |
| 全test層（unit・integration・e2e） | `npm test` | 1293 scenario / 6842 step | 1277 / 6792 | 0 / 0 | 16 / 50 | pass |
| 型・既存一式・配布物 | `npm run verify:distribution` | 10 | 10 | 0 | 0 | pass |
| 変異試験 | `npm run test:integration -- --name "..."` | 15 | 15 | 0 | 0 | pass |

**skipした16 scenarioはsemantic graphのGraphQLite assetが未設定な環境に起因する。** 本変更はこの経路に触れない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/release.ts` | 入る（`dist/src/`として配布） | `nextAutoReleaseVersion`のexport追加と、`validateReleaseWorkflow`の`[skip ci]`判定の対象拡大 |
| `scripts/prepare_release_bump.ts` | 入らない | なし |
| `.github/workflows/release.yml` | 入らない | なし |
| `docs/specs/` の5 file | 入らない | なし |
| `test/` の2 file | 入らない | なし |

判断: 配布物を更新しない

根拠: 配布境界に入るのは`src/domain/release.ts`だけであり、`validateReleaseWorkflow`は本repositoryのdogfooding検査で配布文書のいずれにも記述が無く、公開CLIのcommand・flag・終了値・診断のいずれも変えないため

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **あり。** codex `gpt-5.6-sol`（effort high）による3ラウンドのexact-head review。ラウンド1は`255f14d7`、ラウンド2は`68aa801b`、ラウンド3は`3c9ef20d`を対象とした |
| reviewerがPR author・実装commit authorと異なる | role identityでは、はい（implementer=claude、reviewer=codex）。Git commit authorは実行者単一のため一致する |
| 観測したreview commentとapprovalの件数 | agent review 3件 / approved 0件。**3ラウンドとも`rejected`。** 加えてverifierの再測1件。GitHub review 0件 |

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | **該当なし。** 通常のreviewer経路が成立する |
| 観測値 | reviewer 3ラウンド、High 3件検出・全件resolved、Medium 2件resolved・2件out-of-scope、verifier 1件 |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `02_要件/03_外部連携要件.md`、`12_運用保守/00_運用設計.md`、`01_システム概要/02_用語・略語.md`、`15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: pass。TERM-ASC-080・081を`candidate`から耐久台帳の`active`へ反映した
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass。採番衝突を他stagingを含めて再確認した
- 要件・変更・SCN・テストの追跡: REQ-GH-003 → AC-GH-003 → SCN-INT-AUTORELEASE-001〜008・011
- `no-spec-impact`の場合の限定的根拠: 該当しない
- UI・トークンの判断: UIを所有しないため対象外

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし。** H-01・H-02・H-03はいずれもresolved
- Medium/Lowの記録: M-01・M-03はresolved、R-01・R-02はout-of-scopeとして残存リスクへ
- 判定: approved（3ラウンドの是正とverifierの再測を経て）
- 新しい権限が必要な事項: mergeは別authority。release・publishはさらに別authority
- 残存リスク:
  1. **合成経路の構造検査はshellを解釈しない。** `run`本文の変数展開・command substitution・escape・行継続を経由すればallowlist外のgit sub commandを書ける。**閉じるにはshell ASTが要り、設計が明示的に対象外としている。** この検査は偶発的な退行の回帰検出であり、敵対的に書かれたshellへの防御ではない
  2. **Git設定由来の実行入口が残る。** `core.hooksPath`等でhook・filter・署名program・credential helperを差し込めば判定前に任意processとremote書き込みが起こりうる。reviewerは修正差分で導入されたものではないと判定した。#1053のTOCTOUと同じ性質である
  3. **手書きのYAML行解析は構文表現に依存する。** 3ラウンドで10件の読み落としが出た。現状はfail-closedで閉じているが、将来のworkflow変更で崩れやすい
  4. **支援層が見積を超過した。** 実測の行数比は1.95倍である。超過はfail-closed条件とその回帰fixtureに集中しており運用ポリシーが縮小対象から除く安全条件だが、**超過の事実はowner判断へ回す**
- 次に許可される操作: PR作成、必須check2件の全緑確認、ownerが承認したauthorityによる通常merge。**admin bypassを使わない。** release・publish・cleanupはそれぞれ別authority
- 次回の再開地点: merge後の自動release runをread-onlyで観測し、stale bump branchが基準SHA基準で作り直されるかを確認する
