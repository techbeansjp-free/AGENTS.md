# 89 課題1049 保護file前提のHEAD基準化 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。release bump時に必ず不合格になっていた前提assertionを、HEAD基準へ是正した内部監査証拠である。**`valid: true`は候補が既定branchを基準に検証を通過したことを示すだけであり、既定branchへの反映を示さない。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #1049（#1024から派生） |
| 比較基点 | `70e2900612022a36b1b1c148181c12c7772019f2` |
| H_impl | `4aacb27548fe5f4329a4569e45413b43348a4541` |
| reviewer | codex（implementerと別context）。ラウンド1でHigh 2件、ラウンド2でHigh 1件（新規H-03）、ラウンド3でapproved |
| 実施日 | 2026-08-29（JST）。UTCでは2026-08-28。commitのauthor dateはUTC表記である |
| ラウンド数 | 3 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260829_001741_release-bumpで保護file検査が必ず落ちる |
| モード | quick（Q-01〜Q-08すべて真・根拠付き。変更fileはtest配下のみでquick失格patternに一致しない） |
| 仕様の所有箇所 | `docs/specs/11_非機能/00_非機能要件一覧.md`のREQ-SQ-005「Node.js 20以上とlockfileで再現し全gateを通す」。本変更は同要件が満たせない状態からの復旧である |
| 成果物行数 | **製品0行。** 変更はtest 2 fileと追跡表1行のみ |
| 縮小の先行評価 | 新しい機構を足さず、既存の前提assertionの比較基準を1点変えるだけで解いた。`PROTECTED_FILES`の縮小、`release.yml`の変更、Thenのdigest比較の緩和はいずれも採らず、計画の対象外として明記した |

## 1. 入力証拠

| 観測 | 出所 | 内容 | 種別 |
|---|---|---|---|
| 自動releaseの停止 | run 33180991785 | `version bumpをPR経由でmainへ反映する` jobが失敗し、tag・Release・publishがskipped。`1040 scenarios (1039 passed, 1 failed)` | 実測 |
| 失敗箇所 | 同run log | `test/steps/consumer-acceptance.steps.ts:985`。`package-lock.json`のversionがmerge-baseと不一致 | 実測 |
| 再現 | 作業tree | `package-lock.json`のversionを1つ進めるとSCN-INT-CONSUMER-002が落ちる | 実測 |
| bump jobのcommit順序 | `.github/workflows/release.yml:288-293` | `npm version`→`git add`→`git commit`→`git push`の後に`npm ci`以降のgateが走る | 静的読解 |
| 保護対象 | `scripts/check_project_quality.ts:38-50` | `PROTECTED_FILES`に`package-lock.json`を含む | 静的読解 |

## 変更ファイル個別監査

| ファイル | 種別 | 所有 | 層 | 責務 | 依存方向 | 対応SCN | 復旧 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `test/steps/consumer-acceptance.steps.ts` | M | package owner | package | 前提判定をHEAD基準へ変更し、独立した4観測を持つstepを実装する | 実装へ単方向 | SCN-INT-CONSUMER-002、SCN-INT-CONSUMER-010 | 変更を戻せば従来のmerge-base比較へ戻る | pass |
| `test/features/integration/consumer-acceptance.feature` | M | package owner | package | Givenの文言変更とSCN-INT-CONSUMER-010の追加 | 実装へ単方向 | SCN-INT-CONSUMER-010 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | REQ-SQ-027 integration行へSCN-INT-CONSUMER-010を追加 | 追跡のみ | — | 行を戻す | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（`git diff --name-only 70e29006 4aacb275`が3件）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 計画の対象外（`PROTECTED_FILES`、`.github/workflows/release.yml`、Thenのdigest比較、`scripts/`、`src/`）に触れていない: pass

## 配布物影響

配布境界へ入るpathは存在しない。変更は`test/`配下と`docs/specs/15_要件追跡/00_追跡表.md`だけであり、`package.json`の`files`（`dist/bin/`、`dist/src/`、`.agent-skill-chain/`配下、`README.md`、`AGENTS.md`）のいずれにも含まれない。

判断: 配布物を更新しない
根拠: 変更したtestと追跡表は配布物へ含まれず、公開CLIの振る舞い、schema、templateのいずれも変えないため

## 3. ラウンド別の指摘と是正

| ラウンド | 判定 | finding | 是正 |
|---|---|---|---|
| 1 | changes-requested | H-01 `git show`失敗のfail-closedを実Git経路で観測していない。H-02 AC-1049-05のoracleが配布scriptのHEAD基準を固定しない | 既定readerの実失敗経路を追加。合成repositoryの2 commit間で`prepare` scriptを変更 |
| 2 | rejected | H-03 H-01是正で追加したHEAD欠落fileが残ったまま注入reader観測へ進むため、注入reader観測を削除しても合格する | 観測後に状態を戻して前提の再成立を確認し、注入reader callbackの呼び出し回数をassertする |
| 3 | approved | 新規findingなし。変異Fはoracle自己改変のため非actionable | H-01〜H-03すべてresolved |

**H-03はH-01の是正が作り込んだ欠陥である。** 是正が新しい生存変異を生む例であり、ラウンドごとに変異試験をやり直す必要を示している。

## 4. 実測値

| 対象 | 値 |
|---|---|
| `npm test` | 1041 scenarios / 5518 steps 全通過 |
| `conformance:check` | 合格（project rule 20件、orphan 0件） |
| `lint`・`typecheck`・`trace:check`・`architecture:check`・`package:check` | すべて合格 |
| AC-1049-04 | release bump同型のcommitを作りSCN-INT-CONSUMER-002が合格 |
| AC-1049-03 | 観測が保護fileを1 byte変更する故障注入でThenが不合格 |
| 変異試験 | 6件。A〜Eは死亡、Fのみ生存 |

**変異Fの扱い。** `defaultGitShowFailureRejected`へ期待値を直接代入する変異は生存する。これはoracle自身の書き換えであり、既定readerがfallbackする回帰は変異Bの死亡で押さえられている。reviewerが非actionableと判定した。

**当初AC-1049-03の観測方法を「assertionを削除する変異」と書いていたが、実測で生存を確認した。** 条件が真である限りassertionの削除は不合格を作れず、oracleとして不成立である。故障注入へ改め、上流の計画へ戻して是正した。

## 5. 判定

- 未解決Critical/High: なし
- 判定: approved（ラウンド3）
- 残存リスク: release経路そのものをmerge前に実行する手段が無いため、同型の欠陥は次のrelease実行まで検出できない。SCN-INT-CONSUMER-010は前提判定の機構を固定するが、release workflowの実行順序が変わった場合の追随は保証しない
- 次に許可される操作: PR作成とその後の人間レビュー。merge・release・publish・cleanupはそれぞれ別authority
