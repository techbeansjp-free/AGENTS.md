# PR #1599 全体整合性監査

対象: `93130644`を基点とするPR #1599。README/v05の文書照合から、全追跡領域へ対象を拡張した。以下は確認範囲の記録であり、全コードの監査完了・現行製品の安全性証明ではない。

## 確認範囲

| 領域 | 実施内容 | 留保 |
| --- | --- | --- |
| 追跡ファイル | 開始時708件を棚卸し。旧dist123件の現行実行・配布・CI参照を確認して削除 | 一覧化だけを内容監査としない |
| README/v05 | 現行CLI・配布生成・Host標準経路と照合。歴史ADR、承認例、Goal/受入記録に対象範囲を明示 | 過去実験を現HEADの実績に更新しない |
| Markdown | 372件の相対ファイルリンク走査。歴史資料以外79件に欠落なし | アンカー・外部URL・意味内容の全件監査ではない |
| docs履歴 | reviews/evidence/issuesの293 Markdownを歴史資料として分類。185番レビューに旧仕様書への引用リンク1件 | 過去記録は対象commitで読む。全本文を逐語監査したとはしない |
| src/bin | Controller、Workflow、Goal/Issue実行・再開、候補反映、レビュー診断、配布入口、移行、GitHub提出をソース照合 | 全環境・全分岐の実走ではない |
| Host/隔離 | 独立ReviewerがHost起動、native probe、資産、検証Git、資源、Agent lifecycleを確認 | macOS/Windows実機、任意Hostの子孫終了は今回未実証 |
| CI/release/package | workflow、version選択・配布生成・実パッケージ検査を確認 | 外部サービスへ新しいreleaseは行っていない |
| Skill/設定 | 現行入口とプロジェクト参照・非Git/worktree・レビュー・後始末の説明を照合 | Skill指示自体は実行保証ではない |
| 旧品質互換資産 | base側validatorの起動分岐・静的import閉包、JSON38件、manifest24参照、validator実走を独立確認 | 正規入力の実走と例外条件の反例試験を区別。旧rule21件はstagedであり現行製品の保証ではない |
| ignored/local | ローカル設定・runtime・作業treeを製品配布対象から区別 | 秘密設定の本文を監査報告へ収集せず、利用者資産を削除しない |

## 確定した修正

- 参照されない旧v0.4 `dist/` 123ファイルを削除。ソース履歴は保持。
- 同梱本体`managed-runtime`をGit共有する契約に反する本repoのignoreを解除。
- CLAUDEの旧Step Skill、Project運用の存在しない`issue start`、非Gitにもworktreeを要求する説明を修正。
- 旧公開ADRと過去受入記録を現行手順・現在の合格証明から区別。
- SHA-256 Gitの候補再開とレビュー診断を受理。現契約・変更範囲の検査、再検証・独立レビューは維持。
- CI成功に先行・遅行する空/部分ジョブ一覧を再観測し、100件超もページ取得。部分Evidenceを成功とせず、PR同一性・requiredChecks・owner期限の検査を維持。

## 検証

- 新規反例3件は修正前ソースの別コピーで失敗し、修正後に成功。
- 関連13テスト: 成功13、skip0、失敗0。実SHA-256 Gitで候補反映を実行。
- `npm run quality`: 成功300、skip9、失敗0（約105秒）。skipを隔離成功として数えない。
- `npm run package:check`: 成功7、失敗0。旧dist非混入と実配布物を検査。
- 独立レビュー: 追加差分に重大な残存欠陥なし。外部GitHub APIの実サービス観測は今回再実行していない。
- 同PRの文書/配布修正ではネットワークを分離した合成利用者でtarballのinstall/update/rollback/remove/reinstallと同梱startを検証済み。モデル開発速度やtoken削減の実証とはしない。

## 追加確認（Windows CI・品質契約試験）

- Windows CIで大容量Git出力試験の210字ファイル名がGitのpath制限に当たり、`git add`で停止した。80字の名前を12,000件生成する形に変更し、NUL区切り1MiB超の検証条件を維持。修正後のWindows/macOS/Linux worktree CIは成功。
- `test/v05_quality_transition.ts`は削除済み`cucumber.mjs`を要求し単独実走で失敗。標準`npm test`の対象外だった旧移行試験を、`test/test_quality_contract.mjs`の現行base/candidate試験へ置換した。未承認のscript/helper/CI変更、候補checkerの不実行、base欠落、壊れたregistry、事前登録済みの正当な変更とexact bytes、設定の欠落/間接参照、JSON特殊キーを検証する。
- root側ignored資産は内容を読まず分類した。Host設定、依存関係、worktree、ローカル記録、旧生成物を含む。rootに残るignoredファイルの削除は、tracked配布元の整理とは別であり実施していない。
- 互換libのentrypoint/package-root/process/security/version、Provider capability/reviewer、rule廃止処理を追加読取。現行公開CLIへの適用と旧互換処理を区別した。

## 監査の限界

全追跡領域を棚卸しし、現行の入口・実装・テスト・配布・文書の整合性を照合した。全ファイルの逐語査読、全schema項目・全分岐の実走、過去293文書の事実の再立証、全外部URLの可用性検証を意味しない。歴史記録と旧互換形式を現在の保証へ昇格させず、実機・実案件・外部レビュー製品との同条件比較も今回の結果に含めない。


## 現行検査と旧互換処理の区別

`check_source_quality`のV8 coverageを取得し、正規入力で実行された設定検査とmodule初期化だけの旧処理を分類した。現行経路はmanifestの通常ファイル検査・参照一覧の完全一致、strict JSON parse、choices/rules/provider/conformanceの形検査へ到達する。正規入力1件のcoverageは、全分岐の正しさや未到達関数が不要であることの証明ではない。

独立Reviewerはpolicy/enforcement/conformance/routing-independenceの全文を追加確認し、現行経路に新たな確定欠陥は見つからなかった。旧conformanceには現在存在しないファイルへの参照があるが、現行checkerはその参照を実装済みの証拠として解決していない。移行用資産として保持し、現行機能の保証には使わない。互換依存を「最小」と断定する説明を修正した。

`2da141a29`のGitHub CIではLinux、Host protocolの3 OS、worktreeの3 OS、Mac native sandbox/dependencies、base品質検査が成功。これは各jobの試験範囲の成功であり、任意Host・全利用者環境の保証ではない。評価スクリプトについても、旧固定パス切替fixture・現行tarballライフサイクル・合成画面oracle・履歴JSON・tokens集計の用途を`v05/REVIEW.md`で区別した。

独立Reviewerは残りのproject-choice-diff、staging、staging-layout、worktree-removal-safety、verification-run、atomic、typesも全文確認した。現行base検査に到達する走査対象・設定の形・安全なprefix検査に確定した追加欠陥はなかった。

旧互換処理の留保として、policy validatorが受理する`ollama` supplement reviewerを、旧`project-choice-diff`分類器が未知fieldとして弱化判定する不一致を合成入力で再現した。現行CLI・base検査はこの分類器を呼ばない。旧比較処理を再利用する場合は修正が必要であり、v0.5で有効な機能として扱わない。本PRで未到達の旧機構を改修・再導入することはしない。
