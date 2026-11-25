# ASCのSkillが読まれる仕組みの測定の準備（#1814）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 現在の状態

**モデルを呼ばない準備だけを終えた段階である。モデルの実行（隔離の確認を含む）はまだ1回も行っていない。測定の結果は無い。**

- 測定の計画：[EVAL_PLAN.md](EVAL_PLAN.md)。条件はR（登録だけ）・P（`CLAUDE.md`に文例）・H（SessionStartのhookで文例を注入）。PH（両方）・S（強い文面のhook）は費用の上限の外に置いた。
- 合格の水準と判定の規則：[decision-criteria.md](decision-criteria.md)。ownerの決定（費用の上限30 USD、Claude Codeだけ、本文の読込み80%以上かつ手順の適用が現状より多い、該当しない依頼での過剰な読込みは現状＋1試行まで）を反映した。
- 依頼とgold：[cases.json](cases.json)（14件。#1783の9件を変えずに使い、asc-3・ui-1・es-1・do-1・neg-3を追加）。条件：[conditions.json](conditions.json)。導入するrelease：[release.json](release.json)（v0.5.106、tarballのsha256）。
- harness：[harness/](harness/)。モデルを呼ばずに、release tarballからの導入・入口の照合・条件の適用・hookの出力・配置の検査・試行の計画までを通せる。
- 改善の設計案：[IMPROVEMENT_DESIGN.md](IMPROVEMENT_DESIGN.md)（未実装）。

## 実施したこと（モデルを呼ばない）

| 項目 | 結果 | 記録 |
| --- | --- | --- |
| 採点器・隔離の判定器・配置の検査の試験（合成の記録） | 22件すべて合格 | [results/harness-tests.txt](results/harness-tests.txt) |
| 全体のdry run | 合格。導入（16件の入口がすべてあり、`distribution.json`の記録と一致し、本文へのlinkだけの薄い入口で、本文がpackageと一致）、goldのSkill本文とreferenceがreleaseにある、依頼が名指すfileがある、sample projectと条件ごとの複製の配置が合格、5条件の適用（`CLAUDE.md`の文例の有無、hookの出力が文例と一致・終了コード0・発火のlog）、試行の計画116試行・計画の費用25.04 USD | [results/dry-run.json](results/dry-run.json) |
| `run-trial.mjs`の拒否 | 許可の環境変数が無い`--run`は起動しない。このrepositoryの下・実HOMEの下・祖先に`CLAUDE.md`等がある場所は拒否した | 下の「dry runで使ったtarball」 |

dry runで使ったtarball：**releaseの本物ではない。** このworktreeのHEAD（`51c3e022`、v0.5.106の対象commitと同じ）を`npm pack`で作った代用品（版の表記は0.5.0、sha256 `8a01707f…`）である。GitHubからのdownloadを、この準備の段階では行わないため。測定では[release.json](release.json)のtarballを取得し、sha256を照合してから使う。

導入の手順はUSAGEのとおり「Git管理済みの対象では専用worktreeで実施する」に従った（最初の試行で、main checkoutに直接`project-assets`を実行すると`Use a dedicated Git worktree`で止まったため、sample projectの中に作業用worktreeを作って導入・commitし、mainへ取り込む形にした）。

## ownerの決定と、残る確認事項

| 事項 | 状態 |
| --- | --- |
| 費用の上限 | 決定：30 USD（Hostの計算値） |
| 測定するHost | 決定：Claude Codeだけ。Codexは対象外 |
| 改善の合格の水準 | 決定：[decision-criteria.md](decision-criteria.md) |
| 改善で標準にする仕組みの採否 | 測定の後にownerが決める |
| 測定に使うmodel | 統括の確認事項。推奨は`claude-sonnet-4-5`（理由は[EVAL_PLAN.md](EVAL_PLAN.md#実装者が決めた技術的な事項理由付き)） |
| 認証の渡し方 | 統括の確認事項。試行ごとの空のHOMEではOSの資格情報の保管場所を使わないため、`CLAUDE_CODE_OAUTH_TOKEN`または`ANTHROPIC_API_KEY`を実行するshellの環境変数で渡す |
| releaseの取得・実HOMEへの目印fileの作成 | 測定の開始時に行う（[EVAL_PLAN.md](EVAL_PLAN.md#手順)） |

## 費用の見込み

計画の単価（#1783・#1801の実績から1試行0.22 USD、隔離の確認1回0.1 USD）で、段階0〜3の合計116試行・25.04 USD（上限30 USD）。各条件2回の反復にしたのは、3回では段階3（改善の後）が上限を超えるため。段階ごとに実績の単価で残りを見積もり、上限を超える見込みなら次の段階へ進まずに報告する。

## 行っていないこと

- モデルの実行（隔離の確認・段階1〜3）。認証・modelの確定と、統括の許可を待つ。
- releaseのtarballの取得（dry runは代用品）。
- 実HOMEへの目印fileの作成。
- 改善の実装（不足の有無とownerの採否が決まってから）。
- Codexの測定（ownerの決定で対象外）。

## 未解決の懸念

- `claude -p`を空のHOMEで動かしたときに、projectのSessionStart hookが発火するか、projectの信頼（trust）がどう扱われるかは、隔離の確認で初めて分かる。発火しなければ条件Hは測れない（`hookMatchesCondition`で検出する）。
- init eventに`skills`が無い版では、Skillの一覧の確認が成り立たない（`ascListed`が不合格になり、測定へ進まない）。
- 200k Contextのmodelでは、#1801の観測で一覧の予算の余裕がほぼ無い。同梱Skillが増えた版ではASCの説明文が省かれ得る。隔離の確認の説明文の照合で検出する。
- 各条件2回では、水準の境界付近（該当する22試行で18試行前後）の判定がぶれ得る。
- 試行のsample projectの外への読書きの拒否はClaude Codeの権限の仕組みによる（OSの境界ではない）。隔離の確認の反例で確かめる。

## file

| file | 内容 |
| --- | --- |
| [EVAL_PLAN.md](EVAL_PLAN.md) | 測定の計画（環境・条件・依頼・測る値・段階と費用・隔離の確認・手順・限界） |
| [decision-criteria.md](decision-criteria.md) | 合格の水準と判定の規則（モデル実行の前に固定） |
| [cases.json](cases.json) | 依頼とgold、数え方 |
| [conditions.json](conditions.json) | 条件の定義（文例は導入したreleaseのUSAGEから取り出す） |
| [release.json](release.json) | 導入するreleaseの版とsha256 |
| [IMPROVEMENT_DESIGN.md](IMPROVEMENT_DESIGN.md) | `project-assets`で読む契機を提案する設計案（未実装） |
| [harness/make-fixture.mjs](harness/make-fixture.mjs)・[harness/install-asc.mjs](harness/install-asc.mjs) | sample projectの作成とreleaseからの導入・入口の照合 |
| [harness/apply-condition.mjs](harness/apply-condition.mjs) | 条件の適用（文例・hook） |
| [harness/guard.mjs](harness/guard.mjs) | 配置の検査 |
| [harness/run-trial.mjs](harness/run-trial.mjs) | 1試行の起動（既定はdry run） |
| [harness/probe-check.mjs](harness/probe-check.mjs)・[harness/markers.mjs](harness/markers.mjs) | 隔離の確認の判定と目印file |
| [harness/collect.mjs](harness/collect.mjs)・[harness/score.mjs](harness/score.mjs) | 記録の取り出し（local pathの置換）と採点・判定 |
| [harness/dry-run.mjs](harness/dry-run.mjs) | モデルを呼ばない全体の確認 |
| [harness/score.test.mjs](harness/score.test.mjs)・[harness/probe.test.mjs](harness/probe.test.mjs) | 合成の記録による試験 |
| [results/](results/) | dry runと試験の結果 |
