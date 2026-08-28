# 88 課題1024 配布artifactのconsumer acceptance 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。配布境界を越えた検査が0件だった件について、packed artifactを隔離環境へ導入して公開入口を起動する検査をrelease前の必須gateにした内部監査証拠である。**`valid: true`は候補が既定branchを基準に検証を通過したことを示すだけであり、既定branchへの反映を示さない。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #1024（親 #1025 第2層） |
| 比較基点 | `3df4598098346c9eb5e3c43e9be3910eda6c5b9a` |
| H_impl | `48f1e3a1d11dff190052d41f6a9f0239f5af2d26` |
| reviewer | codex（implementerと別context）。ラウンド1でHigh 3件・Medium 3件、ラウンド2でapproved |
| 実施日 | 2026-08-28 |
| ラウンド数 | 2 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260828_004005_配布artifactのconsumer-acceptanceをrelease前の必須gateにする |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-027。**配布境界を越えた検査の不在を埋める要件であり、既存の信頼モデルは変えない** |
| 成果物行数 | **製品 1,043行**（`scripts/check_consumer_acceptance.ts` 1,038行、`src/lib/process.ts` +5、`scripts/check_package_contents.ts` +18）。支援層はtest 1,455行、仕様 12行、証跡 3 file、workflow +59行 |
| 縮小の先行評価 | **機構3を一度「既存のSCN-INT-WTSURVEY-012が同条件を回帰検出している」として対象外にしたが、同日差し戻した。** 同SCNはsourceからtsx経由でCLIを起動しており配布境界を越えていない。fixture生成も152 msで費用見積りが過大だった。**T08の予算超過に対しては、SCN-INT-CONSUMER-001の注入前実行の削除と不合格確定後の短絡で16.4秒→10.8秒へ縮小してから、閾値改定をownerへ諮った** |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 配布境界を越えた検査が0件 | Issue #1025の診断 | source buildだけを検査し、packed artifactの導入と起動は誰も検査していなかった | 既存分析 |
| 既存SCNは配布境界を越えない | `test/steps/worktree-survey.steps.ts:136-140` | `runCli`が`bin/agent-skill-chain.ts`をsourceからtsxで起動し`cwd`がsource repository | 既存コード |
| `npm publish <tarball>`は`prepack`を実行しない | npm実装とdry-run | 検査済みartifactをそのまま公開でき、TOCTOUを消去できる | 実測 |
| pnpmは`package.json`の`allowBuilds`を読まない | 実pnpm 11.24.0 | `pnpm-workspace.yaml`が必要。**seamベースのtestでは出ない事実** | 実測 |
| CIはPRのmerge refをcheckoutする | run 33170475236 | `HEAD^`はmainのtipであり実装commitではない | 実測 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/workflows/release.yml` | M | repository maintainer | project | pack・acceptance・同一性確認・publishを同一jobで直列化する | workflow→検査→artifactの単方向 | FR-1024-04・06、AC-1024-11・12・15、SCN-INT-CONSUMER-009 | 4 stepの除去で戻る。失敗時publish未到達 | pass |
| `docs/evidence/1024-consumer-acceptance/mechanism-1-git-dependency.md` | A | change owner | evidence | 機構1の故障注入証跡。実npm・実pnpmの3条件 | なし | FR-1024-07、AC-1024-16、SCN-INT-CONSUMER-005 | file削除で戻る。変異は複写で復元済み | pass |
| `docs/evidence/1024-consumer-acceptance/mechanism-2-packed-bin.md` | A | change owner | evidence | 機構2の故障注入証跡 | なし | 同上 | 同上 | pass |
| `docs/evidence/1024-consumer-acceptance/mechanism-3-scale-output.md` | A | change owner | evidence | 機構3の故障注入証跡 | なし | 同上 | 同上 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package owner | spec | TERM-ASC-074・075を耐久台帳へ追加する | なし | REQ-SQ-027 | 2行の除去で戻る | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | package owner | spec | REQ-SQ-027を要件一覧へ追加する | なし | REQ-SQ-027 | 1行の除去で戻る | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | package owner | spec | REQ-SQ-027の本文とAC-SQ-027 | なし | REQ-SQ-027、AC-SQ-027 | 1節の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | unit・integrationの追跡行とSCN-UNIT-PROC-004の追記 | なし | 全consumer SCN | 行の除去で戻る | pass |
| `scripts/check_consumer_acceptance.ts` | A | package owner | package | 隔離条件の検証・3機構の観測・純関数の判定・CLI入口 | scripts→src/libのみ。循環なし | FR-1024-01〜08、全consumer SCN | 一時領域をfinallyで破棄。判定不能はfail-closed | pass |
| `scripts/check_package_contents.ts` | M | package owner | package | 自身が作ったtarballを機構2・3のacceptanceへ渡す | check_consumer_acceptanceへ単方向 | FR-1024-06、AC-1024-12、SCN-INT-CONSUMER-001 | 呼び出し1箇所の除去で戻る | pass |
| `scripts/check_test_determinism.ts` | M | package owner | package | SCN-INT-CONSUMER-002が実`package.json`を読むための例外を1件追加する | なし | AC-1024-13 | 1 entryの除去で戻る。**必要性は変異試験で確認済み** | pass |
| `src/lib/process.ts` | M | package owner | package | `ProcessOptions`へ`env`を足し、隔離envを実processへ渡す | なし | SCN-UNIT-PROC-004 | 既定は`process.env`のまま。後方互換 | pass |
| `test/features/integration/consumer-acceptance.feature` | A | package owner | package | 実行入口・実install・証跡・offline・release結線の受け入れ例 | なし | SCN-INT-CONSUMER-001〜009 | 一時fixtureのみ | pass |
| `test/features/unit/consumer-acceptance.feature` | A | package owner | package | 隔離条件と判定の受け入れ例 | なし | SCN-UNIT-CONSUMER-001〜016 | 純関数のみ | pass |
| `test/features/unit/process-boundary.feature` | M | package owner | package | 明示envが実processへ届くことの受け入れ例 | なし | SCN-UNIT-PROC-004 | 1 scenarioの除去で戻る | pass |
| `test/steps/consumer-acceptance.steps.ts` | A | package owner | package | consumer featureのstep実装と証跡検証器 | 実装へ単方向 | 全consumer SCN | 一時領域はworld管理 | pass |

## 配布物影響

配布境界へ入る変更pathは `src/lib/process.ts` の1件である。`ProcessOptions` へ `env` を足し、
呼び出し側が明示しない場合の既定を `process.env` のままとした。既存の呼び出しは1件も挙動が変わらない。
`scripts/` と `test/` と `docs/` は `package.json` の `files` に含まれず配布されない。

判断: 配布物を更新した

根拠: `src/lib/process.ts` は `dist/src/` として配布されるため、`ProcessOptions` への `env` 追加は配布境界の変更である。既定値を `process.env` に保ち省略時の挙動を変えないため後方互換であり、SCN-UNIT-PROC-004 が明示envの伝播を固定している。

## 3. ラウンド別の指摘と是正

| ラウンド | 判定 | finding | 是正 |
|---|---|---|---|
| 1 | changes-requested | H-01 releaseの機構1がnpm 1回だけでFR-1024-03のpnpm 2条件を実行しない。H-02 証跡がexact headではなくbase SHAを指す。H-03 release用tarballへ機構3が実行されない。M-01〜M-03 | 3観測の複合集約、証跡の再生成と検証器の強化、`--mechanisms`へscale-output追加、上流正本の再同期 |
| 2 | approved | 新規findingなし | H-01〜H-03、M-01〜M-03すべてresolved |
| PR後の外部review | 対応済み | CodeRabbit: 生成seam 3件が拡張子なしfileにESM構文を書く。Node 22.7未満では拡張子なしfileはCommonJS既定でSyntaxErrorになる | `import`を`require`へ戻した。repo内の実行seamは既存6箇所すべてが`require`であり、本PRの3件だけが逸脱していた |

**H-01とH-03はcoordinatorの指示が承認済み要件に反していたことが原因である。** セグメント7で「release経路が観測するpackage managerはnpm 1件だけにする」と指示したが、FR-1024-03は「npmとpnpmの双方で観測する」と定めていた。

## 4. 実測値

| 対象 | 値 |
|---|---|
| `npm test` | 1040 scenarios 全通過 |
| `conformance:check` | 合格（5513 steps 全通過） |
| NFR-1024-04 | main 151.309秒 → 候補 168.846秒、増分11.6%（予算はbaselineの15%以内） |
| `npm run package:check` | main 1.984秒 → 候補 5.727秒 |
| 変異試験 | 8件。いずれも対象SCNが落ちることを確認 |
| Node 22.7未満相当（`--no-experimental-detect-module`） | 是正前はSCN-INT-CONSUMER-007が落ち、是正後は既定・pre-22.7相当の双方でpass |

**測定は並行processを止めた状態でmainと交互に3回ずつ行い中央値で判定した。** 汚染された測定では増分が約2倍に見え、一度は誤った数値でownerへ諮っている。

## 5. 判定

- 未解決Critical/High: なし
- 判定: approved（ラウンド2）
- 残存リスク: 実publishとGitHub Actions上のprovenance生成は初回releaseで確認する。`roleContracts`の`allowedPaths`に強制点が無い件は#1047が所有する
- 次に許可される操作: PR作成とその後の人間レビュー。merge・release・publish・cleanupはそれぞれ別authority
