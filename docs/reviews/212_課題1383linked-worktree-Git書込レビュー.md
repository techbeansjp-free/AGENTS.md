# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1383 linked worktree Git書き込み対応 |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | `65fac23421dfac8a46e5671bffe172aee8e5a911` |
| 比較基点 | `d6ab005f992126dec33e4de1936ee8958f08973e` |
| H_impl | `65fac23421dfac8a46e5671bffe172aee8e5a911` |
| 対象差分 | 19 path |
| 対象外 | Codex自身のsandbox実装、利用者指定の任意write root、role contract、read-onlyのwrite権限、Git以外の外部metadata、Windows |
| 残り予算 | 5 counted round |
| ラウンド数 | 1 |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260913_223745_routing-linked-worktree-git-write` |
| 仕様の所有箇所 | `docs/specs/01_システム概要/02_用語・略語.md`、`02_要件/01_ワークフロー要件.md`、`04_機能/01_ワークフローv0.3.md`、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`10_セキュリティ/01_信頼境界.md`、`12_運用保守/00_運用設計.md`、`14_開発・品質/02_テスト標準.md`、`15_要件追跡/` |
| 成果物行数 | Git numstat: runtime source・dist +436/-0、仕様・test +535/-0、合計 +971/-0 |
| 縮小の先行評価 | gitDirのみではobjects・refs・reflog等のcommon書込みを満たさない。任意path flagを設けず、Gitが返し相互検証したgitDir/commonDirの固定配送へ限定した |
| 実施者・日時 | Claude Opus read-only reviewer、2026-09-14T06:09:00+09:00 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、exact-head | critical | Claude | `claude:provider_recommended_default:high:default`、`opus`、high、実効`claude-opus-5` | Critical/High未解決または実効model不一致なら停止 | implementerと別provider process・context、session `4c3342a4-f5fb-42f4-8a82-36e08ceac934`、Read/Grep/Globのみ、candidate変更0件 |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1383 staging | AC-1383-01〜04、INV-1383-01〜03、staging digest `4389f5c5a9d4d3d047b2a7c1facc3d952cf5fa2e7d4bd8f448df7eba15e14f9e` | staging |
| 差分 | `d6ab005f992126dec33e4de1936ee8958f08973e`..`65fac23421dfac8a46e5671bffe172aee8e5a911` | 19 path、review前後でproduct path変更0件 | Git |
| テスト | exact H_impl | 対象4 scenarios / 20 steps成功、canonical macOS 11 / 55成功、mutation kill、実Codex linked index書込成功 | Cucumber・実行観測 |
| 仕様 | 上記8領域 | `updated`、TERM-ASC-115とAC/SCN追跡あり | 既存文書 |
| commit前candidate | 変更19 path | H_impl `65fac23421dfac8a46e5671bffe172aee8e5a911` | Git |
| Phase A artifact | 本file | H_impl後のartifact-only commitで固定予定 | Git |
| review session | staging `review-session.json` | session `fe212bc20c7cf0a066eadc149642127e46409534c7036c5cb99d2e8af5542078`、Round 1 digest `06f61650f5316836484685dcdfcdba4d692c6b6a09000e8f2a8758d196b7347d`、converged | 耐久session |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAはない。Issue→RQ/INV→resolver→argv→execution result→test/reviewの一方向である。
- `H_impl`はartifact-only `H_final`の親としてcommit後に再確認する。
- reviewerの独立性はcontext-isolatedを満たす。Claude CLIは別sessionでexact H_implを固定し、Read/Grep/Globだけを使い、対象差分を変更していない。
- Phase BのPR、CI、provider reviewはPR作成後に`review evidence`とdelivery stateへ記録する。
- 既定branch追随は行っていない。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/01_システム概要/02_用語・略語.md` | M | spec owner | domain terminology | TERM-ASC-115定義 | 要件から仕様へ | 全AC | deprecatedなし | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec owner | requirements | workspace-write契約 | 要件→実装/test | AC-1383-01〜04 | M-1383-01/02記録 | pass |
| `docs/specs/04_機能/01_ワークフローv0.3.md` | M | spec owner | feature | routing launch挙動 | 要件を参照 | AC-1383-01〜03 | fail-closed | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | spec owner | interface | CLI結果・argv契約 | adapterへ一方向 | AC-1383-01〜04 | 任意flagなし | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | security owner | security | Git path信頼境界 | resolverへ一方向 | INV-1383-01〜03 | M-1383-03記録 | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | operations owner | operations | rejection復旧 | result契約を参照 | AC-1383-02 | L-1383-05記録 | pass |
| `docs/specs/14_開発・品質/02_テスト標準.md` | M | quality owner | quality | test証拠限界 | SCNを参照 | 全SCN | 実sandbox非代替を明示 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | trace owner | trace | AC→SCN→実装 | verified-by/satisfied-by | 全AC/SCN | orphan 0 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | trace owner | history | Issue #1383変更記録 | 現行仕様を参照 | 全AC/SCN | revert基点保持 | pass |
| `src/adapters/codex-execution.ts` | M | runtime owner | adapter | fixed Codex argv | resolver rootsのみ受領 | AC-1383-01/03 | shell不使用、generic error | pass |
| `src/adapters/codex-launch.ts` | M | routing owner | application | preflight・再検証・dispatch | resolver→policy→provider→execute | AC-1383-02/04 | dispatch前拒否 | pass |
| `src/adapters/git-workspace.ts` | A | routing owner | adapter | Git topology resolver | result/reviewへ逆依存なし | 全AC/INV | symlink・TOCTOU・envをfail-closed、M/L記録 | pass |
| `test/features/integration/codex-launch.feature` | M | test owner | integration | linked成功例 | public launchを観測 | SCN-INT-ROUTING-1383-001 | isolated fixture | pass |
| `test/features/unit/codex-launch.feature` | M | test owner | unit | rejection・回帰例 | public launchを観測 | SCN-UNIT-ROUTING-1383-002〜004 | hostile topology | pass |
| `test/steps/git-workspace.steps.ts` | A | test owner | test adapter | argv・結果・Git observable | feature→runtime | 全SCN | leakage/call count assertion、L-1383-04記録 | pass |
| `test/support/git-workspace-fixture.ts` | A | test owner | test support | real linked topology fixture | test専用 | 全SCN | repository外tmp、L-1383-06記録 | pass |

- 基準SHAとの差分path集合と表の19 pathは完全一致する。
- package、spec、test、evidenceの責務越境はない。
- Medium/LowはASCのrecord-only契約に従いproduct差分を自動拡大していない。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1383-001 | source調査とCodex CLI helpがgitDir/commonDir配送設計を支持 | 全AC | なし | failing regressionから実装 | Red 3 failure→Green 4/4、mutation kill、実Codex dogfood | updated | pass |
| DISC-1383-002 | fresh baseでTERM-ASC-114が既使用と判明 | 用語台帳 | なし | 新語をTERM-ASC-115へ前向き訂正 | assess-discovery continue、台帳・追跡一致 | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1383-01 | SCN-INT-ROUTING-1383-001 | resolver→`--add-dir`反復配送 | pass | pass | linked fixtureでexact argvとindex更新、実Codex `git add`成功 |
| AC-1383-02 | SCN-UNIT-ROUTING-1383-002 | provider観測前rejection | pass | pass | hostile topology 16種とmid-flight mutation 3種、observation/execution 0 |
| AC-1383-03 | SCN-UNIT-ROUTING-1383-003 | read-only・primaryのlegacy argv | pass | pass | byte-exact argv、既存primary SCN-INT-AM-006 |
| AC-1383-04 | SCN-UNIT-ROUTING-1383-004 | generic rejection | pass | pass | prompt・stderr・HOME・private sentinel非包含 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | sandbox filesystem境界を変更する | Git由来path、相互link、symlink祖先、env override、TOCTOU再検証、漏洩反例SCN |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | false successを起動前rejectionへ変える | `state=rejected`、`dispatched=false`、CLI exit 1、generic復旧理由 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | GUI/Web/支援技術向け画面契約を持たないNode CLI変更 | UI source・視覚状態・a11y対象なし。JSON状態とerrorはCLI契約で検証 |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | theme、component、layoutを変更しない | token/UI pathなし |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | linkedだけへ検証済み2 rootを配送し、不成立をdispatch前拒否する | pass | resolver、launch、executionの三責務と4 SCN |
| 価値 | P-01専用worktreeとStep 9のGit書込みを両立する | pass | 実Codex dogfoodでindex.lock errorなし、`git add`成功 |
| 実現可能性 | 新規runtime依存なし、固定Git/Codex argvで成立 | pass | Git/Codex CLI、timeout 10秒、64KiB上限 |
| 整合性 | source/dist/spec/test/traceが一致する | pass | build・format・trace成功、全19 path監査 |
| 保守性 | resolver、launch判断、argv/processを分離する | pass | 逆依存・cycleなし、rejection定数共有 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | forged registration、別repository、bare、separate、subdirectory、非Git | pass | 相互forward/reverse/common照合とnegative variants |
| 失敗経路 | Git失敗、provider観測中変化、spawn失敗 | pass | 観測前拒否、二段再検証、既存failed/unknown維持 |
| 境界値 | 空・複数行・16KiB超・Unicode Cc/Cf・重複root | pass | readLink上限、path/argv validator、variant SCN |
| 悪用 | traversal、symlink ancestor、fake Git、shell injection | pass | component walk、O_NOFOLLOW、filesystem corroboration、argv array |
| 安全性 | 最小由来、秘密非漏洩、権限過大 | finding | INVはpass。commonDir全体のhooks/configを含む残差をM-1383-03へ記録 |
| データ損失 | preflightがGit状態を書き換えない | pass | `GIT_OPTIONAL_LOCKS=0`、read-only query、rollbackは単一commit revert |
| ロールバック | 失敗時にprocess未起動で保持し再要求できる | pass | generic rejectionと新要求契約 |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | finding | 非Git互換性・Git版・WindowsをM/Lとして記録、Critical/Highなし |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-1383-01 | Medium | `GIT_CONFIG.*`拒否はpath overrideより広くprimaryも拒否し得る | `git-workspace.ts:14-21` | workspace-write | PR本文で制約を明示 | valid / record-only | 環境変数設定hostで保守的拒否 |
| M-1383-02 | Medium | 非Git root等を新たに拒否し、上流の既存動作維持と緊張 | `git-workspace.ts:89-130`、00 §2.3 | 非Git・subdirectory・separate root | 仕様上はfail-closedとして確定済み。PR本文で互換性狭窄を明示 | valid / record-only | 非Git workspace-write利用者はrejected |
| M-1383-03 | Medium | commonDir全体の許可はhooks/configの遅延実行も可能にする | `git-workspace.ts:167` | primaryとsibling worktree | Git書込み成立に必要な採用済みtrade-offとして明示 | valid / record-only | task単位Git認可ではない |
| L-1383-04 | Low | 自動testのGit操作は実Codex sandbox内ではない | test steps 104-121 | evidence strength | test標準の既存disclaimerと実dogfoodで補完 | valid / record-only | 実CLI contractのCI自動検知なし |
| L-1383-05 | Low | `--path-format=absolute`はGit 2.31以上 | resolver 99-115 | 旧Git host | generic fail-closed、PR本文で条件を明示 | valid / record-only | 診断がversionを特定しない |
| L-1383-06 | Low | fixtureを保持して一時容量を消費 | fixture 8-11,55-66 | CI tmp | 今回の削除禁止制約として保持 | valid / record-only | 繰返し実行時のtmp増加 |
| L-1383-07 | Low | Windows path separatorは未実測で拒否の可能性 | resolver 116-125 | Windows | POSIX前提の対象外 | valid / out-of-scope | Windowsではfail-closedの可能性 |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。staging 00〜03、19 path、隣接CLI/result/testを確認した。
- 指摘を確定した: Medium 3、Low 4。すべてrecord-only。
- 次ラウンド対象のCritical/High: なし。

### ラウンド2

- 未解決Critical/High: 該当なし。
- 修正差分: 該当なし。
- 修正で触れた隣接範囲: 該当なし。
- 既承認・未変更範囲を再走査していない: 該当なし。

### ラウンド3

- 全指摘の最終分類: Round 1で収束。
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: workspace-writeかつ相互検証済みlinked topologyだけへ追加rootを限定。
- 同じ範囲の予算を自動更新していない: はい。
- AIによる最終裁定: Critical/High 0のためapproved。

## 7. テスト結果

- 実行したcommandの一覧: `cucumber --tags @routing-1383`、canonicalized `TMPDIR`で`cucumber --tags @codex-launch`、`npm run typecheck`、`npm run lint`、`npm run format`、`npm run docs:format`、`npm run test:format`、`npm run trace:check`、Docker native filesystemで`npm run verify:distribution`、実`routing launch --sandbox=workspace-write` dogfood。
- 全layerの合計: 対象4 scenarios / 20 steps成功。canonical macOS 11 scenarios / 55 steps成功。mutationは`--add-dir`除去で1件失敗し復元後4/4成功。Linux broadは1975 scenarios（1947 pass、16 skip、12 fail）で、12件は変更外の既存PoCが固定`/usr/bin/bwrap`欠落で失敗した環境制約。macOS非canonical `TMPDIR=/var/...`の334件はsymlink祖先拒否であり、canonical `/private/var/...`再実行で対象11/55成功したため変更由来の失敗証拠として扱わない。
- runner・Gherkin方言: Cucumber.js、en、unit/integration/e2e。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/codex-execution.ts` | 入る | linked topology時の固定`--add-dir` argv |
| `src/adapters/codex-launch.ts` | 入る | provider観測前のGit境界拒否と再検証 |
| `src/adapters/git-workspace.ts` | 入る | primary/linked topologyの判定とwrite roots導出 |
| `dist/src/adapters/codex-execution.js` | 入る | 上記execution sourceの配布生成物 |
| `dist/src/adapters/codex-launch.js` | 入る | 上記launch sourceの配布生成物 |
| `dist/src/adapters/git-workspace.js` | 入る | 上記resolver sourceの配布生成物 |
| `docs/specs/` 9 path | 入る | 用語、CLI、security、運用、test、追跡の成立中仕様 |
| `test/` 4 path | 入らない | package品質証拠。runtimeには同梱しない |

判断: 配布物を更新した

根拠: packageのcompile対象sourceと`dist/src/adapters/`生成物を同期し、外部観測可能なCLI・sandbox境界変更を仕様9 pathへ反映した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementer Codex executionとは別provider process/contextのClaude Code session `4c3342a4-f5fb-42f4-8a82-36e08ceac934`がexact H_implを評価。実効modelは`claude-opus-5` |
| reviewerが対象差分を変更していないこと | はい。ClaudeにはRead/Grep/Globだけを許可し、review前後のproduct path変更0件。作業tree差分は本review artifactだけ |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: 用語、workflow要件、機能、CLI、信頼境界、運用、test標準、追跡表、変更履歴。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: TERM-ASC-115を要求→要件→仕様→実装/testへ一方向に追跡した。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass。TERM-ASC-114衝突はDISC-1383-002で115へ前向き訂正済み。
- 要件・変更・SCN・テストの追跡: AC-1383-01〜04とSCN 4件がsource/testへ到達し、`trace:check`はvalid。
- `no-spec-impact`の場合の限定的根拠: 該当なし。
- UI・トークンの判断: DC-UX/DC-TOKENSともnot-applicable。UI・layout・themeの変更pathなし。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし。
- Medium/Lowの記録: Medium 3件、Low 4件をRound 1 digest `06f61650f5316836484685dcdfcdba4d692c6b6a09000e8f2a8758d196b7347d`へrecord-onlyで保存。
- 判定: approved
- 新しい権限が必要な事項: branch pushとPR作成は外部書込み承認が必要。merge・release・cleanupは別authority。
- 残存リスク: commonDirのhooks/configを含む広い権限、非Git等のworkspace-write互換性狭窄、Git 2.31未満のgeneric rejection、実Codex `--add-dir`のCI自動検証なし。
- 次に許可される操作: 本artifactだけをcommitしてH_finalを作り、Step 10を記録後、承認されたbranch pushとPR作成へ進む。
- 次回の再開地点: H_final作成と`workflow record --step=10`。
