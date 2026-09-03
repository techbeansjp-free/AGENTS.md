# 133 課題1184のtag駆動release移行レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1184 |
| ラウンド | Step 10 ラウンド1 |
| 比較基点 | `c5650ffbc15d1964c3c53611880b6ba82e65cd76` |
| H_impl | `99613e3db8291b5748e45004be07f4174469d92e` |
| 比較基点の由来 | `origin/main`のtip。**PR作成後に`rebase --onto`で追随した**（#1186のmergeで`scripts/check_file_audit.ts`が競合したため）。追随前の基点は`7a0fff67`である |
| モード | full（Q-01・Q-02・Q-03・Q-05・Q-06・Q-08がfalse） |
| 対象差分 | 20 file、+744 -383。commitは`99613e3d` |
| 対象外 | npm公開そのものの復旧（#984）。`prepack`がgit依存installを妨げる問題（#1187）。`conformance:check`とCIの二重test実行（#1178）。merge直前のrebase（GitHubのstrict status checksが要求するものでASCの所有物ではない） |
| 残り予算 | **2**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで） |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260903_191559_release-を-tag-駆動にして-main-を動かさない |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-003（**改訂**）とREQ-GH-005（**改訂**） |
| 成果物行数 | 製品 **+254 -238行**（`release.yml` +68 -143、`release.ts` +46 -74、`check_file_audit.ts` +85 -13、`plan_release.ts` +34 -8、`inject_publish_version.ts` +104、`package.json`・`package-lock.json` +3 -3）。仕様 **+15 -6行**。支援層 **+387 -134行**（feature +33 -13、steps +354 -121）。**支援層/成果物 = 1.5倍** |
| 縮小の先行評価 | 4案を先に評価した。(1) 案B（base鮮度検査の緩和）は**緩める対象が存在しなかった**。`pr create`はbaseの鮮度を要求していないことを本日 #1169 で実測した。止めているのはGitHubのstrict status checksである。(2) 案C（rebase手順の改善）は部分採用した。PR作成をrebaseより先に行えばreview sessionの破壊は避けられるが、**bumpがmainを動かす頻度そのものは下がらない**。(3) 案D（codexの代案、main SHAを親に持つversion-only commit）は**実consumerがcommit SHA固定であり利点が届かない**ため不採用。(4) `concurrency`の`queue: max`はGitHub公式文書で実在を確認したうえで**追加しない**と判定した。tag駆動では取り消されたpending runを取り戻す必要がない。(5) AC-02は**新規SCNを足さず**既存の`SCN-UNIT-PACKAGE-012`の契約を書き換えて満たした |
| 決裁 | repository ownerの「起票して最優先で行えば今後かなり早くなるのでは」という指示。codexとfableへ独立に諮問 |
| 実施者・日時 | reviewer（claude）、2026-09-03 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する。**ただし設計方針はcodexとfableへ独立に諮問し、両者が私の記述を訂正した** |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、判定の根拠を機械観測に置いたことと、**設計をcodexとfableへ独立に諮問して確定したこと**、および**変異試験が私のassertionの弱さを3回検出したこと**である。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 実害 | `git log --merges` | 2026-09-03のmainのmerge commit 28件のうち11〜12件がrelease/bump PR | 実行記録 |
| 実害 | 作業記録 | 同日rebase 9回、staging作り直し2回 | 実行記録 |
| 実害 | #1169 | `pr create`前のrebaseでreview証跡を移す2経路が両方塞がった | 一次資料 |
| 諮問（codex） | Issue #1184 のコメント | 案Aを条件付き承認。**私の記述の誤り2件を訂正した** | 外部の判断 |
| 諮問（fable） | 同上 | codexの懸念を空振りと判定。**真の破壊点が`scripts/build.ts:99-103`であることを特定した** | 外部の判断 |
| 実consumer | `RUA-PROM/nexus-corporate-website`の`scripts/agent-skill-chain.sh` | `ASC_REF`は**commit SHA固定**。「固定参照の正本は`ASC_REF`であり`managed-assets.json`の version ではない」と明記 | 一次資料 |
| GitHub公式文書 | concurrency制御 | `queue: max`は実在し、既定の`queue: single`ではpending runが置き換えられる | 一次資料 |
| 参照実装 | `techbeansjp/d-pops-inventory`の`release.yml` | tagとReleaseだけを作りmainへpushしない | 一次資料 |
| テスト | `npm run conformance:check` | `1457 scenarios (1441 passed, 16 skipped)` | テスト出力 |
| commit前candidate | 20 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/133_課題1184のtag駆動release移行レビュー.md` | `H_impl` = `99613e3d`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/workflows/release.yml` | M | project | project | `bump_version` job 131行を削除し、stale照合・2-parent判定・tag直前の再照合・version注入を足した | pass。`validateReleaseWorkflow`が本文を検証する一方向である | REQ-GH-003 / AC-01・AC-03〜05 / SCN-INT-AUTORELEASE-001・003・011 | 既定branchへの書き込み経路が無くなる。rollbackは本fileのrevert | pass |
| `src/domain/release.ts` | M | package | package | `AutoReleasePlan.state`から`bump-then-release`を除き、workflow必須条項を差し替えた | pass。`architecture:check`合格 | REQ-GH-003 / AC-01・AC-05 / SCN-UNIT-AUTORELEASE-007、SCN-INT-AUTORELEASE-001・003 | 状態が減る方向であり、未知stateを増やさない | pass |
| `scripts/plan_release.ts` | M | project | project | 自動経路の現在versionを既存tag由来にし、手動経路の版一致をcore一致へ緩めた | pass。`latestReleasedVersion`は手動経路が既に持っていた関数の再利用である | REQ-GH-003 / AC-01 / SCN-E2E-AUTORELEASE-002 | 手動releaseは宣言済みpatch lineの外へ出られない | pass |
| `scripts/inject_publish_version.ts` | A | project | project | 新規。tagからversionを導き、正規bump差分だけであることを検査する | pass。判定は`prepare_release_bump.ts`の`canonicalBumpDiff`を再利用し、判定を二重に持たない | REQ-GH-003 / AC-03・AC-04 / SCN-INT-AUTORELEASE-012・013 | 検査に失敗すると非0で終わり公開へ進まない | pass |
| `scripts/check_file_audit.ts` | M | project | project | 旧bump除外をcutoffのancestorへ限定し、解決不能をfail-closedにした | pass。`cutoff`を引数で受け渡し、環境変数を読まない | REQ-GH-005 / AC-06・AC-07 / SCN-UNIT-AUDITBUMP-005・006 | 除外が狭まる方向である。解決不能は例外にする | pass |
| `package.json` | M | project | project | sentinel versionを入れた | pass | REQ-GH-003 / AC-02 / SCN-UNIT-PACKAGE-012 | `npm run build`のversion整合検査が通ることを確認済み | pass |
| `package-lock.json` | M | project | project | root と`packages[""]`の2箇所へ同じsentinelを入れた | pass | 同上 | 差分は2行のみである | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | project | spec | REQ-GH-003とREQ-GH-005を改訂した | pass | REQ-GH-003、REQ-GH-005 | 記述だけで実行authorityを持たない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | 新規SCN 4件を結線した | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 変更履歴を1行足した | pass | 同上 | 同上 | pass |
| `test/features/e2e/auto-release.feature` | M | package | package | SCN-E2E-AUTORELEASE-002のThen文言をtag由来へ変えた | pass | AC-01 | fixtureは文字列であり外部へ到達しない | pass |
| `test/features/integration/auto-release.feature` | M | package | package | SCN-INT-AUTORELEASE-003・011を書き換え、012・013を足した | pass | AC-01・03・04・05 | 同上 | pass |
| `test/features/unit/audit-bump-exclusion.feature` | M | package | package | SCN-UNIT-AUDITBUMP-005・006を足した | pass | AC-06・07 | 同上 | pass |
| `test/features/unit/auto-release.feature` | M | package | package | SCN-UNIT-AUTORELEASE-006・007の文言を変えた | pass | AC-01 | 同上 | pass |
| `test/features/unit/review-policy-package.feature` | M | package | package | SCN-UNIT-PACKAGE-012の契約をsentinelへ変えた | pass | AC-02 | 同上 | pass |
| `test/steps/audit-artifact-selection.steps.ts` | M | package | package | 隔離fixtureへcutoffを注入する関数を足した | pass | AC-06 | fixtureは`os.tmpdir()`配下だけを対象にする | pass |
| `test/steps/audit-bump-exclusion.steps.ts` | M | package | package | cutoff seamと新規2 scenarioのstepを足した | pass | AC-06・07 | 同上 | pass |
| `test/steps/auto-release.steps.ts` | M | package | package | 書き込み経路の注入、stale・2-parent行の除去、合成検査の対象移動 | pass | AC-01・05 | 実workflowを読むだけで書き換えない | pass |
| `test/steps/publish-version-injection.steps.ts` | A | package | package | 新規。`injectPublishVersion`をseam経由で呼ぶ | pass | AC-03・04 | `npm version`を起動せず外部へ到達しない | pass |
| `test/steps/unit.steps.ts` | M | package | package | 版契約のassertionをsentinelへ変えた | pass | AC-02 | 同上 | pass |

## 2. 受け入れ条件の確認

### 2.0 何が起きていたか

**releaseがversion bump commitをmainへpushするため、open中の全PRが毎回`BEHIND`になっていた。**

| 観測 | 値 | 出典 |
|---|---|---|
| mainのmerge commit（2026-09-03） | 28件 | `git log --merges` |
| うちrelease/bump PR | 11〜12件 | 同上 |
| 同日のrebase | 9回 | 作業記録 |
| 同日のstaging作り直し | 2回 | 作業記録 |

**rebaseの費用は「もう一度push」では済まない。** 同日 #1169 で`pr create`前にrebaseした結果、review証跡を新headへ移す2経路が両方塞がった。`review reanchor`は完全diffのsha256一致を要求し、`audit:check`が要求する`比較基点`・`H_impl`行はrebase後に必ず変わる。収束後の取り直しroundも`observeReviewDiff`が前roundのcandidate HEADをbaseに取るため拒否される。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-INT-AUTORELEASE-003 | `validateReleaseWorkflow` | `21 scenarios (21 passed)` | pass | 書き込み経路5種を1件ずつ注入し、**それぞれの診断文字列が`errors`に現れることを要求する**。変異M1でkill |
| AC-02 | SCN-UNIT-PACKAGE-012 | `scripts/build.ts` | 同上 | pass | **新規SCNを足していない。** 既存の版契約scenarioが「coreがpolicy schemaのpatch lineと一致し、release番号を含まない」を検査する形へ変わった |
| AC-03 | SCN-INT-AUTORELEASE-012 | `injectPublishVersion` | `11 scenarios (10 passed, 1 skipped)` | pass | `apply`/`read` seam経由で**実関数を呼ぶ**。判定関数を直接呼ぶ形では変異M7が生存した |
| AC-04 | SCN-INT-AUTORELEASE-013 | 同上 | 同上 | pass | `integrity`だけを変えた注入が`3 version field以外を変更しました`で拒否される。変異M7でkill |
| AC-05 | SCN-INT-AUTORELEASE-001 | `validateReleaseWorkflow` | `21 scenarios (21 passed)` | pass | 本文から該当行を消し、**その条件が出す診断そのもの**を要求する。変異M2・M3でkill |
| AC-06 | SCN-UNIT-AUDITBUMP-005 | `withinLegacyBumpWindow` | `10 scenarios (10 passed)` | pass | cutoffをbump commit直前へ置くとbumpが除外されず、review境界がbumpになって拒否される。変異M4でkill |
| AC-07 | SCN-UNIT-AUDITBUMP-006 | 同上 | 同上 | pass | 履歴に存在しないcutoffで`cutoff commit … を解決できないため監査できません`と停止する。変異M5でkill |

### 2.2 不変条件

| INV ID | 内容 | 判定 | 証拠 |
|---|---|---|---|
| INV-01 | 既存の検査を1件も外さない | pass | `validate` jobの配布前品質検証・配布digest算出・`[skip ci]` guard、tag/Releaseの冪等確認、Release名一致、npm公開条件、秘密値非出力、日本語step名、permissions、`dry_run`/`publish_npm`既定値の各条項を削っていない。削除したのはbump jobを前提とする5条項だけである |
| INV-02 | version注入は一時checkout内だけで起こる | pass | 注入stepは`npm_publish` jobにのみ存在し、同jobはtagをcheckoutする。版管理下のtreeはsentinelのままである |
| INV-03 | cutoffはimmutableなcommit SHAで固定する | pass | 40桁のcommit SHA定数であり、**環境変数から受け取らない**。第2引数の既定値としてのみ差し替え可能で、隔離fixtureがそれを使う |

## 3. 肯定的評価

- **手段を増やすより既存手段の縮小を先に評価した。** 削除131行に対し追加はstale照合・2-parent判定・version注入の3つで、いずれも**現在存在しないfail-closed条件の追加**である。`queue: max`は実在を確認したうえで不要と判定した。
- **判定を二重に持たない。** version注入の検査は旧bump経路が持っていた`canonicalBumpDiff`をそのまま使う。現在versionの導出は手動release経路が持っていた`latestReleasedVersion`をそのまま使う。
- **AC-02は新規SCNを足さずに満たした。** 既存の版契約scenarioの契約を書き換えている。
- **cutoffを引数にしたことで、隔離fixtureが自分の履歴に存在する境界を渡せる。** 環境変数にしていないため、実行時に除外窓を後ろへずらす経路は無い。

## 4. 敵対的評価

| 観点 | 攻撃 | 結果 |
|---|---|---|
| 除外窓の拡大 | cutoffを消す | `withinLegacyBumpWindow`が例外を投げる（変異M5でkill） |
| 除外窓の拡大 | cutoff判定自体を外す | 変異M4でkill |
| 書き込み経路の復活 | bump jobを足す | 診断つきで拒否（変異M1でkill） |
| 書き込み経路の復活 | `gh pr create --base main`を足す | 同上 |
| 書き込み経路の復活 | `RELEASE_MAIN_PAT`を使う | 同上 |
| stale runの通過 | 照合stepを消す | 診断つきで拒否（変異M2でkill） |
| 非merge commitへのtag | 2-parent判定を消す | 診断つきで拒否（変異M3でkill） |
| 注入の汚染 | `integrity`を同時に変える | `canonicalBumpDiff`が拒否（変異M7でkill） |
| version正本の逆戻り | 現在versionをpackage.jsonへ戻す | 変異M6でkill |
| **assertionの弱さ** | 条件式を`false`へ倒す | **当初M2・M3・M7が生存した。** 3回assertionを強くして塞いだ（5節） |

## 5. 指摘

| ID | severity | 事実 | 観測 | 由来 | 対処 | 判定 | 残余 |
|---|---|---|---|---|---|---|---|
| DISC-101 | Low | **bumpは配布物を変えたmergeでのみ起きる。** 起票時に「mergeのたび」と書いたのは不正確だった | #1169のmerge後にrelease 4 jobがskipしmainが動かなかった | 観測 | 要求定義を訂正した | valid / resolved | なし |
| DISC-102 | Medium | **`checks`配列の`includes`だけでは条件の存在を固定できない。** 条件式を`false`へ倒す変異でもelse側のcheckが積まれる | 変異M2・M3が当初生存した | 変異試験 | 本文から該当行を消して拒否を要求する形へ変えた | valid / resolved | なし |
| DISC-103 | Medium | **`valid === false`の要求では足りない。** 該当行を消すと他の条件も同時に崩れるため、条件を無効化する変異でも`valid`は`false`のままだった | DISC-102の是正後もM2・M3が生存した | 変異試験 | **診断文字列の`includes`**へ変えた | valid / resolved | なし |
| DISC-104 | Medium | **判定関数を直接呼ぶscenarioは合成経路を検査しない。** `canonicalBumpDiff`を呼ぶ形では、注入経路からその呼び出しを消す変異が生存した | 変異M7が生存した | 変異試験 | `injectPublishVersion`へ`apply`/`read` seamを設け、**実関数を呼ぶ**形へ変えた | valid / resolved | なし |
| ADV-01 | Medium | **sentinelは完全固定ではない。** policy schemaが上がるときはcoreを上げるcommitがmainへ入る | `scripts/build.ts`のversion整合検査 | 諮問（fable） | **修正しない。** 設計上の性質として要件本文へ明記した。消えるのはprerelease番号のbumpだけである | valid / record-only | policy schema更新時に1回mainが動く |
| ADV-02 | Medium | **cutoff SHAは本PRのmerge時点でしか確定できない。** 現在値は`7a0fff67`である | `git log --merges` | 設計 | **merge直前に再確認する。** 確定後に新しい旧bumpが着地した場合、そのbumpが除外されず`audit:check`が落ちるため、取り違えは無言では通らない | valid / record-only | 再確認を怠るとCIが赤で気付く |
| ADV-03 | Low | **git依存consumerが読むversionがsentinelになる** | `RUA-PROM/nexus-corporate-website`の`scripts/agent-skill-chain.sh` | 諮問（codex・fable） | **修正しない。** 当該consumerは**commit SHA固定**であり、かつ「固定参照の正本は`ASC_REF`であり`managed-assets.json`の version ではない」と自ら明記している。fableが`src/domain/lifecycle.ts`のinstall・upgrade・uninstall・doctor全経路を読み、**`record.version`を読んで比較する箇所が0件**であることを確認した | valid / record-only | `npm ls`に実versionが出ない |

**未解決のCritical / Highは0件である。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分の20 file。**PR作成後の追随rebaseで`scripts/check_file_audit.ts`の競合を1件解消した。** #1169が同fileへ足した`unsupportedClaimRows`と、本Issueの`checkFileAudit`第2引数の双方を残す形で解消し、`git diff --shortstat`が追随前と同じ`20 files changed, 744 insertions(+), 383 deletions(-)`であることを確認した。
- 確認: 個別監査20行、AC-01〜07、INV-01〜03、肯定4観点、敵対10観点、変異7件。
- 結果: blocking 0件。record-only 3件（ADV-01・02・03）。resolved 4件（DISC-101〜104）。**変異試験で自分のassertionの弱さを3回検出した**（DISC-102・103・104）。

## 7. テスト結果

**表を書く前に1本ずつ実行した。**

| 層・検査 | コマンド | 件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| unit・integration・e2e | `npm run conformance:check`（内部で`npm test`を実行する） | 1465 | 1449 | 0 | 16 | pass |
| 静的検査 | `lint`・`format:check`・`typecheck`・`source:check`・`architecture:check`・`skills:check`・`package:check`・`docs:format`・`test:format`・`trace:check` | 10 | 10 | 0 | 0 | pass |
| 監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

### 7.1 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | bump_version job禁止条項を無効化する | kill（2 scenario失敗） |
| M2 | stale照合stepの要求を無効化する | kill（1 scenario失敗） |
| M3 | 2-parent判定の要求を無効化する | kill（1 scenario失敗） |
| M4 | cutoff判定を外して常に除外する | kill（2 scenario失敗） |
| M5 | cutoff解決不能のfail-closedを外す | kill（1 scenario失敗） |
| M6 | 自動経路の現在versionをpackage.jsonへ戻す | kill（1 scenario失敗） |
| M7 | 注入の正規bump差分検査を外す | kill（1 scenario失敗） |

**7件すべてkill。** うちM2・M3・M7は当初生存し、assertionを3回強くして塞いだ。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/workflows/release.yml` | **入らない**（`files`が`.github/`を列挙しない） | 本repositoryのCIでのみ動く |
| `src/domain/release.ts` | **入る**（`files`が`dist/src/`を列挙する） | `validateReleaseWorkflow`の必須条項が配布される |
| `scripts/` 3 file | **入らない** | 同上 |
| `package.json` | **入る**（`npm pack`に必ず含まれる） | **sentinel versionが配布される。** 5節ADV-03を参照する |
| `package-lock.json` | 入らない | `npm pack`に含まれない |
| `docs/specs/` 3 file | **入る**（`files`が`docs/`を列挙する） | REQ-GH-003・REQ-GH-005の改訂が配布される |
| `test/` 10 file | 入らない | `files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/`・`docs/`・`package.json`が配布境界に入る。**配布digestは変わらない。** `normalizeDistributionContent`が`package.json.version`を削除するため、sentinel化そのものはdigestへ影響しない。`npm run package:check`はexit 0である。

## 9. 独立reviewの成立

**reviewerはimplementerと同一である**（`adachi-tatsuru`）。緩和は次の3点である。

1. **codexとfableへ独立に諮問し、両者が私の記述を訂正した。** codexは起票内容の誤り2件（ASCが既に`queue: max`と後続更新スキップを持つという記述、配布digestがversion非依存である理由）を指摘した。fableはcodexの懸念そのものを空振りと判定し、真の破壊点が`scripts/build.ts`の3箇所version一致検査であることを特定した。**諮問が私と諮問先の双方を訂正している。**
2. **変異試験が私のassertionの弱さを3回検出した**（DISC-102・103・104）。いずれも「テストは緑だが変異が生存する」形であり、コード読解では見つけていない。
3. 外部reviewer（CodeRabbit）のPR reviewを受ける。

## 10. 仕様整合性

- `REQ-GH-003`を改訂した。「version衝突はPR経由でbumpする」を削り、tag駆動・sentinel・version注入・stale停止・2-parent判定を明記した。
- `REQ-GH-005`を改訂した。除外をcutoffのancestorへ限定し、解決不能をfail-closedにすることを明記した。
- 新規SCN 4件（`SCN-UNIT-AUDITBUMP-005`・`006`、`SCN-INT-AUTORELEASE-012`・`013`）を追跡表へ結線した。`trace:check`のorphanは0件である。
- **既存SCNを1件も削除していない。** `bump-then-release`を検査していた6件は、tag駆動での対応する状態遷移を検査する形へ書き換えた。

## 11. 総合判定と再開地点

**判定: 合格。** 未解決のCritical / Highは0件である。

**merge直前に次を確認する。**

1. 旧release runがrunning/pendingでないこと
2. open中の`release/bump-*` PRがないこと
3. `LEGACY_RELEASE_BUMP_CUTOFF`がその時点の最後の旧bump merge commitと一致すること。**一致しない場合は定数を更新してからmergeする**
4. merge後に`RELEASE_MAIN_PAT` secretを撤去すること

再開地点は上の4点である。
