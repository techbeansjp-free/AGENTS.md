# PLAN: 並列テスト中のnpm pack用ビルドがCLI成果物を競合更新する

- Issue: `ISSUE-279`
- 対応する DESIGN: `DESIGN.md`

## 目的・入力・出力

承認済みSPEC/DESIGN/ADRを入力とし、隔離package probe、既存収録契約の移行、決定論的な
race/failure/timeout回帰テストを出力する。実装workerはcodeとunit test結果だけをcheckpointし、
検証workerが全test反復の保存ログとVALIDATIONを別leaseで作る。

## 実装順序・変更単位

| # | 変更単位 | 内容 | AC-ID |
|---|---|---|---|
| 1 | snapshot owner | root copyから4領域を除外し、依存を別copy、相対symlink containment検査 | AC-1, AC-5 |
| 2 | process supervisor | cache/HOME/temp隔離、buffer上限、tree terminate→reap→cleanup | AC-1, AC-5 |
| 3 | pack parser | npm実JSONを返すasync helperへ既存2契約testを移行 | AC-1, AC-2 |
| 4 | bin不変BDD | relative path+bytes digestを成功・prepare失敗・timeoutの前後で比較 | AC-1, AC-5 |
| 5 | race BDD | probe固有marker中にroot CLIのhelpとclean lintを実行し、両側witnessで重なり成立をassert | AC-3 |
| 6 | 障害BDD | descendant timeout、buffer超過、cleanup 4分岐（単独失敗・primary複合・reap不能・watchdog）を検査 | AC-5 |
| 7 | 変更範囲検査 | package/race/failure test、lint test、build、typecheck、静的検査 | AC-1〜AC-5 |
| 8 | 全体反復 | concurrency指定なしの`npm test`を3回以上実行 | AC-4 |

snapshot owner完了後にprocess supervisor、その後に各BDDを実装する。各BDDは同じhelper契約を使うが
状態を共有せず順序は入替可能である。production既定のtimeout/bufferは有限値とし、障害BDDだけ
短い値を注入する。

## BDDと反証観点

- 成功/prepare失敗/timeoutの各Givenでroot `bin` manifestを採取し、When probe終了後に同じ相対path集合と
  bytes digestを要求する。timeoutではdescendantを含むtreeがjoin済みで、temp rootが無いことも確認する。
- 外向き・absolute・破損symlinkをcopy後hookでsnapshotの`node_modules`配下を含む位置へ置くと、
  containment検査がnpm起動前に拒否し、内部相対linkはsnapshot内targetへ解決されることを確認する。
- marker、HOME、cache、TMPDIRはprobeごとに異なり、並列probe間に共有pathがないことを確認する。
- handshakeは親のentered待ちT_e＜子のrelease待ちT_r＜pack上限の順序を保ち、子のentered未作成死亡・
  子が生存したままのT_e失効・親のassert失敗・早すぎるreleaseの4経路が有限時間で失敗報告またはprobe続行へ
  収束することを確認する。T_e失効時の死亡／生存の判別はchild handleの終了観測だけで行い、pid照会は使わない。
- 重なりの成立は推定せず、親側witness（T_e以内のentered検知→root CLI検査完了→release作成）と
  子側witness（entered作成直前にrelease未生成→release検知で正常終了）の両方をprobe終了後にassertする。
  witnessの読取りはreap/join後・cleanup前に行い、後始末順序を変えない。子のentered作成をT_eより遅らせて
  子を生存させたまま完走させるfixtureと、releaseを先に置いて子側witnessだけを偽にするfixtureで、
  npmが0で終了しfilesを返してもrace BDDが失敗することを反証側で確認する。witness不成立のassert失敗は
  primary errorとして扱い、reap不能・cleanup失敗より先頭へ報告する。
- npm JSON欠損、buffer超過、spawn失敗、cleanup失敗を成功扱いせず、primary成功+cleanup失敗、
  primary失敗+cleanup失敗、reap不能による削除抑止、watchdog発火の4分岐でworkspace path付きerrorを観測する。
- package testとlint testへtest concurrencyやlockを追加していないことを静的に確認する。

## checkpoint・適用検査

- design: `DESIGN.md`、`PLAN.md`、proposed ADRをcommit/pushしread-only gateを再通過する。
- ADR finalization: 承認digestを保った専用leaseでstatusだけをacceptedへ更新する。
- implementation: helper/testだけをcommit/pushする。SPEC/DESIGN/PLAN/VALIDATIONは変更しない。
- validation: 全AC、既定並列test 3回以上、build/typecheck、文書/語彙/参照lint、secret scanの
  executor・command・result・evidenceを保存しcommit/pushする。

API、認証、DB、画面、性能、デプロイ、外部publishはproduct境界を変えないため非該当である。
snapshot/copy、process回収、bin manifest、package契約を変える場合はDESIGNを更新して再審査する。
全変更単位とsegmentごとのcheckpointが揃うことを完了条件とし、未決事項はない。
