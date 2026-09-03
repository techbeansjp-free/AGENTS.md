# 134 課題1184のtag駆動release移行レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1184 |
| ラウンド | Step 10 ラウンド1 |
| 比較基点 | `c5650ffbc15d1964c3c53611880b6ba82e65cd76` |
| H_impl | `af4f91453c647c4b99e7af33974b4e2f415c25e8` |
| 比較基点の由来 | `origin/main`のtip。**PR #1189 を閉じてmain起点で再構築した**（下の逸脱を参照） |
| モード | full（Q-01・Q-02・Q-03・Q-05・Q-06・Q-08がfalse） |
| 対象差分 | 22 file、+913 -384。commitは`af4f9145` |
| 対象外 | npm公開そのものの復旧（#984）。`prepack`がgit依存installを妨げる問題（#1187）。CIの二重test実行（#1178）。merge直前のrebase |
| 残り予算 | **2**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで） |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260903_211725_release-を-tag-駆動にして-main-を動かさない-再実施- |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-003（**改訂**）とREQ-GH-005（**改訂**） |
| 成果物行数 | 製品 **+316 -238行**（`release.yml` +72 -143、`release.ts` +90 -68、`check_file_audit.ts` +105 -13、`plan_release.ts` +34 -8、`inject_publish_version.ts` +104、manifest +3 -3）。仕様 **+20 -11行**。支援層 **+469 -135行**。**支援層/成果物 = 1.5倍** |
| 縮小の先行評価 | 5案を先に評価した。(1) 案B（base鮮度検査の緩和）は**緩める対象が存在しなかった**。`pr create`はbaseの鮮度を要求していないことを #1169 で実測した。(2) 案C（rebase手順の改善）は部分採用した。ただし**bumpがmainを動かす頻度そのものは下がらない**。(3) 案D（codexの代案、main SHAを親に持つversion-only commit）は**実consumerがcommit SHA固定であり利点が届かない**ため不採用。(4) `concurrency`の`queue: max`はGitHub公式文書で実在を確認したうえで**追加しない**と判定した。(5) AC-02は**新規SCNを足さず**既存の`SCN-UNIT-PACKAGE-012`の契約を書き換えて満たした |
| 決裁 | repository ownerの「起票して最優先で行えば今後かなり早くなるのでは」という指示。codexとfableへ独立に諮問 |
| 実施者・日時 | reviewer（claude）、2026-09-03 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する。**設計はcodexとfableへ独立に諮問し、PR #1189 では外部reviewerがCriticalを検出した** |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、設計をcodexとfableへ独立に諮問したこと、**PR #1189 で外部reviewerがCriticalを含む6件を検出し全件validだったこと**、変異試験が私のassertionの弱さを検出したことである。
2. **本PRは PR #1189 の再構築である。** #1189 はStep 11記録後にCriticalを受け、内容非等価な是正が必要になった。codexへ諮問し「同一PRでのamendは不可、壊れたままのmergeも不可、main起点でやり直す」判定を得た。**#1189 は閉じた。**
3. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 実害 | `git log --merges` | 2026-09-03のmainのmerge commit 28件のうち11〜12件がrelease/bump PR | 実行記録 |
| 実害 | #1169 | `pr create`前のrebaseでreview証跡を移す2経路が両方塞がった | 一次資料 |
| 外部review | PR #1189 | **Critical 1件、Major 2件、Minor 3件。全件validと判定した** | 外部の判断 |
| 諮問（codex） | Issue #1184 のコメント | 案Aを条件付き承認。**私の記述の誤り2件を訂正した** | 外部の判断 |
| 諮問（fable） | 同上 | codexの懸念を空振りと判定。**真の破壊点が`scripts/build.ts`の3箇所version一致検査であることを特定した** | 外部の判断 |
| 諮問（codex） | 工程順序 | **「#1189内では是正しない。壊れたままmergeもしない。main起点でやり直す」** | 外部の判断 |
| 実consumer | `RUA-PROM/nexus-corporate-website` | `ASC_REF`は**commit SHA固定**。「固定参照の正本は`ASC_REF`」と明記 | 一次資料 |
| GitHub公式文書 | concurrency制御 | `queue: max`は実在し、既定の`queue: single`ではpending runが置き換えられる | 一次資料 |
| テスト | `npm run conformance:check` | `1466 scenarios (1450 passed, 16 skipped)` | テスト出力 |
| commit前candidate | 22 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/134_課題1184のtag駆動release移行レビュー.md` | `H_impl` = `af4f9145`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/workflows/release.yml` | M | project | project | bump job 131行を削除し、stale照合・2-parent判定・tag直前の再照合（**checkoutの後**）・version注入を足した | pass。`validateReleaseWorkflow`が本文を検証する一方向である | REQ-GH-003 / AC-01・AC-03〜05 / SCN-INT-AUTORELEASE-001・003・011 | 既定branchへの書き込み経路が無くなる。rollbackは本fileのrevert | pass |
| `src/domain/release.ts` | M | package | package | `bump-then-release`を除き、workflow必須条項を差し替えた。tip照合を**2箇所別々**に要求し、**checkout順序**も検査する | pass。`architecture:check`合格 | REQ-GH-003 / AC-01・AC-05 / SCN-UNIT-AUTORELEASE-007、SCN-INT-AUTORELEASE-001・003 | 状態が減る方向であり、未知stateを増やさない | pass |
| `scripts/plan_release.ts` | M | project | project | 自動経路の現在versionを既存tag由来にし、手動経路の版一致をcore一致へ緩めた | pass。`latestReleasedVersion`は手動経路が既に持っていた関数の再利用である | REQ-GH-003 / AC-01 / SCN-E2E-AUTORELEASE-002 | 手動releaseは宣言済みpatch lineの外へ出られない | pass |
| `scripts/inject_publish_version.ts` | A | project | project | 新規。tagからversionを導き、正規bump差分だけであることを検査する | pass。判定は`canonicalBumpDiff`を再利用し二重に持たない | REQ-GH-003 / AC-03・AC-04 / SCN-INT-AUTORELEASE-012・013 | 検査に失敗すると非0で終わり公開へ進まない | pass |
| `scripts/check_file_audit.ts` | M | project | project | 旧bump除外をcutoffのancestorへ限定し、**監査開始時に1回だけ解決**してfail-closedにする | pass。`cutoff`を引数で受け渡し、環境変数を読まない | REQ-GH-005 / AC-06・AC-07 / SCN-UNIT-AUDITBUMP-005〜007 | 除外が狭まる方向である。解決不能は例外にする | pass |
| `package.json` | M | project | project | sentinel versionを入れた | pass | REQ-GH-003 / AC-02 / SCN-UNIT-PACKAGE-012 | `npm run build`のversion整合検査が通ることを確認済み | pass |
| `package-lock.json` | M | project | project | root と`packages[""]`の2箇所へ同じsentinelを入れた | pass | 同上 | 差分は2行のみである | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | project | spec | REQ-GH-003とREQ-GH-005を改訂し、**廃止したbump経路の記述を整理した** | pass | REQ-GH-003、REQ-GH-005 | 記述だけで実行authorityを持たない | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | project | spec | 自動release計画、bump branch手順、再帰trigger防止の3節をtag駆動へ更新した | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | 新規SCN 5件を結線した | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 変更履歴を1行足した | pass | 同上 | 同上 | pass |
| `test/features/e2e/auto-release.feature` | M | package | package | SCN-E2E-AUTORELEASE-002をtag由来へ変えた | pass | AC-01 | fixtureは文字列であり外部へ到達しない | pass |
| `test/features/integration/auto-release.feature` | M | package | package | SCN-INT-AUTORELEASE-003・011を書き換え、012・013を足した | pass | AC-01・03・04・05 | 同上 | pass |
| `test/features/unit/audit-bump-exclusion.feature` | M | package | package | SCN-UNIT-AUDITBUMP-005〜007を足した | pass | AC-06・07 | 同上 | pass |
| `test/features/unit/auto-release.feature` | M | package | package | SCN-UNIT-AUTORELEASE-006・007の文言を変えた | pass | AC-01 | 同上 | pass |
| `test/features/unit/review-policy-package.feature` | M | package | package | SCN-UNIT-PACKAGE-012の契約をsentinelへ変えた | pass | AC-02 | 同上 | pass |
| `test/steps/audit-artifact-selection.steps.ts` | M | package | package | 隔離fixtureへcutoffを注入する関数を足した | pass | AC-06 | fixtureは`os.tmpdir()`配下だけを対象にする | pass |
| `test/steps/audit-bump-exclusion.steps.ts` | M | package | package | cutoff seamと新規3 scenarioのstepを足した | pass | AC-06・07 | 同上 | pass |
| `test/steps/auto-release.steps.ts` | M | package | package | 書き込み経路の注入9件、tip行の**位置指定**除去、checkout順序の反例、合成検査の対象移動 | pass | AC-01・05 | 実workflowを読むだけで書き換えない | pass |
| `test/steps/merge-integrity.steps.ts` | M | package | package | 隔離fixtureへcutoffを渡す | pass | AC-07 | 同上 | pass |
| `test/steps/publish-version-injection.steps.ts` | A | package | package | 新規。`injectPublishVersion`をseam経由で呼ぶ | pass | AC-03・04 | `npm version`を起動せず外部へ到達しない | pass |
| `test/steps/unit.steps.ts` | M | package | package | 版契約のassertionをsentinelの**字面一致**へ変え、隔離fixtureへcutoffを渡す | pass | AC-02・07 | 同上 | pass |

## 2. 受け入れ条件の確認

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-INT-AUTORELEASE-003 | `validateReleaseWorkflow` | `21 scenarios (21 passed)` | pass | 書き込み経路**9種**を1件ずつ注入し、それぞれの診断文字列が`errors`に現れることを要求する。変異M1・M9でkill |
| AC-02 | SCN-UNIT-PACKAGE-012 | `scripts/build.ts` | 同上 | pass | **新規SCNを足していない。** `${core}-managed-by-tag`の字面一致を要求する |
| AC-03 | SCN-INT-AUTORELEASE-012 | `injectPublishVersion` | `11 scenarios (10 passed, 1 skipped)` | pass | `apply`/`read` seam経由で**実関数を呼ぶ**。変異M7でkill |
| AC-04 | SCN-INT-AUTORELEASE-013 | 同上 | 同上 | pass | `integrity`だけを変えた注入が拒否される |
| AC-05 | SCN-INT-AUTORELEASE-001 | `validateReleaseWorkflow` | `21 scenarios (21 passed)` | pass | tip照合2箇所を**位置で1件ずつ**消し、それぞれの診断を要求する。checkout前へ戻す反例も置く。変異M2a・M2b・M8でkill |
| AC-06 | SCN-UNIT-AUDITBUMP-005 | `withinLegacyBumpWindow` | `11 scenarios (11 passed)` | pass | cutoffをbump commit直前へ置くとbumpが除外されない。変異M4でkill |
| AC-07 | SCN-UNIT-AUDITBUMP-006・007 | `resolveLegacyBumpCutoff` | 同上 | pass | bumpのある履歴と**bumpを含まない履歴の両方**で、解決不能なcutoffが停止する。変異M5b・M5cでkill |

### 2.2 不変条件

| INV ID | 内容 | 判定 | 証拠 |
|---|---|---|---|
| INV-01 | 既存の検査を1件も外さない | pass | `validate` jobの配布前品質検証・配布digest算出・`[skip ci]` guard、tag/Releaseの冪等確認、Release名一致、npm公開条件、秘密値非出力、日本語step名、permissions、既定値の各条項を削っていない。削除したのはbump jobを前提とする5条項だけである |
| INV-02 | version注入は一時checkout内だけで起こる | pass | 注入stepは`npm_publish` jobにのみ存在し、同jobはtagをcheckoutする |
| INV-03 | cutoffはimmutableなcommit SHAで固定する | pass | 40桁のcommit SHA定数であり、**環境変数から受け取らない** |

## 3. 肯定的評価

- **手段を増やすより既存手段の縮小を先に評価した。** 削除131行に対し追加はstale照合・2-parent判定・version注入の3つで、いずれも**現在存在しないfail-closed条件の追加**である。`queue: max`は実在を確認したうえで不要と判定した。
- **判定を二重に持たない。** version注入の検査は旧bump経路の`canonicalBumpDiff`、現在versionの導出は手動release経路の`latestReleasedVersion`をそのまま使う。
- **AC-02は新規SCNを足さずに満たした。**
- **cutoffを引数にしたことで、隔離fixtureが自分の履歴に存在する境界を渡せる。** 環境変数にしていないため、実行時に除外窓を後ろへずらす経路は無い。
- **cutoffの開始時解決により、全呼び出し元がcutoffを渡す必要が生じた。** 4 fileの変更を要したが、**「解決不能なcutoffで合格しうる経路」がbumpの有無によらず消えた。**

## 4. 敵対的評価

| 観点 | 攻撃 | 結果 |
|---|---|---|
| 除外窓の拡大 | cutoffを消す | 監査開始時に例外（変異M5b・M5cでkill） |
| 除外窓の拡大 | cutoff判定自体を外す | 変異M4でkill |
| 書き込み経路の復活 | bump jobを足す | 診断つきで拒否（変異M1でkill） |
| 書き込み経路の復活 | `--force`・`-C <dir>`・`HEAD:main`・`+main` | 診断つきで拒否（変異M9でkill） |
| stale runの通過 | validate側のtip照合を消す | 変異M2aでkill |
| stale runの通過 | tag側のtip照合を消す | 変異M2bでkill |
| **実行不能な配置** | tip再照合をcheckout前へ戻す | 変異M8でkill。**外部reviewerが実物で検出した** |
| 非merge commitへのtag | 2-parent判定を消す | 変異M3でkill |
| 注入の汚染 | `integrity`を同時に変える | 変異M7でkill |
| version正本の逆戻り | 現在versionをpackage.jsonへ戻す | 変異M6でkill |

## 5. 指摘

| ID | severity | 事実 | 観測 | 由来 | 対処 | 判定 | 残余 |
|---|---|---|---|---|---|---|---|
| DISC-102 | **Critical** | **tag jobの再照合stepが`actions/checkout`より前にあり、workspaceにrepositoryが無い状態で`git ls-remote origin`を実行して必ず失敗していた** | PR #1189 の外部review | 外部review | checkoutの後へ移し、空の観測値も明示停止させ、**validatorが順序を検査する** | valid / resolved | なし |
| DISC-103 | Major | remote tip照合の要求が**存在件数を見ていなかった**。どちらか1件だけを残したworkflowが通った | 同上 | 外部review | 2箇所を別々の条件にし、**位置で1件ずつ消す反例**を置いた | valid / resolved | なし |
| DISC-104 | Major | cutoffの解決がrelease bump transitionを見つけた後にだけ行われ、**bumpを含まない履歴では解決不能なcutoffでも合格した** | 同上 | 外部review | 監査開始時に1回だけ解決する形へ変え、`SCN-UNIT-AUDITBUMP-007`を追加した | valid / resolved | なし |
| DISC-105 | Minor | 既定branch push検査が`--force`・`-C <dir>`・`HEAD:main`・`main:main`・`+main`を素通しした | 同上 | 外部review | 到達する形をまとめて拒否し、反例5件を置いた | valid / resolved | なし |
| DISC-106 | Minor | sentinel検証が`-beta.N`でないことだけを見ており、`0.3.1`でも通った | 同上 | 外部review | 字面一致を要求する形へ変えた | valid / resolved | なし |
| DISC-107 | Minor | REQ-GH-003と運用設計に廃止済みbump経路の記述が残っていた | 同上 | 外部review | 記述を整理し、`prepare_release_bump.ts`を`canonicalBumpDiff`の提供元としてのみ位置づけた | valid / resolved | なし |
| DISC-101 | Low | **bumpは配布物を変えたmergeでのみ起きる。** 起票時に「mergeのたび」と書いたのは不正確だった | #1169のmerge後にrelease 4 jobがskipした | 観測 | 要求定義を訂正した | valid / resolved | なし |
| DISC-108 | Medium | **PR作成後のrebaseは内容等価でなければ成立しない。** #1189 では`delivery-state.json`の`create.headSha`がPR HEADと一致しない状態になっていた | codexへの諮問 | 諮問 | **#1189 を閉じてmain起点でやり直した。** memoryを訂正した | valid / resolved | なし |
| ADV-01 | Medium | **sentinelは完全固定ではない。** policy schemaが上がるときはcoreを上げるcommitがmainへ入る | `scripts/build.ts` | 諮問（fable） | **修正しない。** 設計上の性質として要件本文へ明記した | valid / record-only | policy schema更新時に1回mainが動く |
| ADV-02 | Medium | **cutoff SHAはmerge時点でしか確定できない。** 現在値は`7a0fff67` | `git log --merges` | 設計 | **merge直前に再確認する。** 取り違えると`audit:check`が落ちるため無言では通らない | valid / record-only | 再確認を怠るとCIが赤で気付く |
| ADV-03 | Low | git依存consumerが読むversionがsentinelになる | consumerの取得script | 諮問（codex・fable） | **修正しない。** 当該consumerはcommit SHA固定であり「正本は`ASC_REF`」と明記している | valid / record-only | `npm ls`に実versionが出ない |

**未解決のCritical / Highは0件である。**

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分の22 file。
- 確認: 個別監査22行、AC-01〜07、INV-01〜03、肯定5観点、敵対10観点、変異10件。
- 結果: blocking 0件。record-only 3件（ADV-01〜03）。resolved 8件（DISC-101〜108）。**うち6件は外部reviewerがPR #1189 で検出したものである。**

## 7. テスト結果

**表を書く前に1本ずつ実行した。**

| 層・検査 | コマンド | 件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---:|---:|---:|---|
| unit・integration・e2e | `npm run conformance:check`（内部で`npm test`を実行する） | 1466 | 1450 | 0 | 16 | pass |
| 静的検査 | `lint`・`format:check`・`typecheck`・`source:check`・`architecture:check`・`skills:check`・`package:check`・`docs:format`・`test:format`・`trace:check` | 10 | 10 | 0 | 0 | pass |
| 監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

### 7.1 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | bump_version job禁止条項を無効化 | kill |
| M2a | validate側のtip照合の要求を無効化 | kill |
| M2b | tag側のtip照合の要求を無効化 | kill |
| M3 | 2-parent判定の要求を無効化 | kill |
| M4 | cutoff判定を外して常に除外 | kill |
| M5b | cutoffの開始時解決を外す | kill |
| M5c | cutoffの解決を除外判定の内側へ戻す | kill |
| M6 | 現在versionをpackage.jsonへ戻す | kill |
| M7 | 注入の正規bump差分検査を外す | kill |
| M8 | checkout順序の要求を無効化 | kill |
| M9 | push検査を旧regexへ戻す | kill |

**11件すべてkill。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/workflows/release.yml` | **入らない**（`files`が`.github/`を列挙しない） | 本repositoryのCIでのみ動く |
| `src/domain/release.ts` | **入る**（`files`が`dist/src/`を列挙する） | `validateReleaseWorkflow`の必須条項が配布される |
| `scripts/` 3 file | **入らない** | 同上 |
| `package.json` | **入る**（`npm pack`に必ず含まれる） | **sentinel versionが配布される。** 5節ADV-03を参照する |
| `package-lock.json` | 入らない | `npm pack`に含まれない |
| `docs/specs/` 4 file | **入る**（`files`が`docs/`を列挙する） | REQ-GH-003・REQ-GH-005の改訂と運用設計が配布される |
| `test/` 11 file | 入らない | `files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/`・`docs/`・`package.json`が配布境界に入る。**配布digestは変わらない。** `normalizeDistributionContent`が`package.json.version`を削除するためである。`npm run package:check`はexit 0である。

## 9. 独立reviewの成立

**reviewerはimplementerと同一である**（`adachi-tatsuru`）。緩和は次の4点である。

1. **codexとfableへ独立に諮問し、両者が私の記述を訂正した。** codexは起票内容の誤り2件を、fableはcodexの懸念そのものを訂正した。
2. **外部reviewer（CodeRabbit）がPR #1189 でCriticalを含む6件を検出し、全件validだった。** うち Critical 1件は**機構そのものが動かない**欠陥であり、私の変異試験でもgateでも検出できていなかった。**YAMLの字面を検査するscenarioは、stepの実行可能性を検査しない。**
3. **工程順序の判断をcodexへ諮問し、自分の見立てを訂正した。** 「`pr create`を再実行しなければ迂回ではない」は誤りだった。**内容変更でHEADを動かすだけでStep 10・テスト・PR証拠が失効する**（`.agent-skill-chain/docs/01_開発ワークフロー.md:125`）。
4. 本PRも外部reviewerのreviewを受ける。

## 10. 仕様整合性

- `REQ-GH-003`を改訂した。bump経路の記述を廃止済みとして整理し、tag駆動・sentinel・version注入・stale停止・2-parent判定・**再照合のcheckout後配置**を明記した。
- `REQ-GH-005`を改訂した。除外をcutoffのancestorへ限定し、解決不能をfail-closedにすることを明記した。
- `docs/specs/12_運用保守/00_運用設計.md`の3節を更新した。
- 新規SCN 5件を追跡表へ結線した。`trace:check`のorphanは0件である。
- **既存SCNを1件も削除していない。**

## 11. 総合判定と再開地点

**判定: 合格。** 未解決のCritical / Highは0件である。

**merge直前に次を確認する。**

1. 旧release runがrunning/pendingでないこと
2. open中の`release/bump-*` PRがないこと
3. `LEGACY_RELEASE_BUMP_CUTOFF`がその時点の最後の旧bump merge commitと一致すること。現在値は`7a0fff67`。**一致しない場合は定数を更新してからmergeする**
4. merge後に`RELEASE_MAIN_PAT` secretを撤去すること
