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
| 5 | race BDD | probe固有marker中にroot CLIのhelpとclean lintを実行し、CLI結果・両側witness・時間契約をassert | AC-3 |
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
- race BDDの合格は「親側CLI検査の全assert成功・親側witness真・子側witness真・npm 0終了とJSON取得・
  root bin manifest一致・reap/cleanup成功」の論理積とし、1つでも欠ける場合と判定できない場合を失敗にする。
  親側CLI検査は`--help`の終了コード0とbaseline一致のstdoutとstderr空、probe所有のclean入力への
  `lint vocab`の終了コード0、両起動でmodule解決・link失敗署名がstderrに無いことを要求し、これがAC-3の
  Thenが言うコマンドモジュールgraph完全loadの判定実体であることを確認する。
- handshakeは`T_e + T_c ＜ T_r ＜ pack上限`（T_c=親側CLI検査上限）を注入値でも保ち、違反する注入が
  probe起動前に設定errorで拒否されることを確認する。CLI検査がT_cを超えた場合はrelease作成→CLI child
  terminate/reapの順で打ち切り、打ち切り自体がprimary errorになることを確認する。子のentered未作成死亡・
  子が生存したままのT_e失効・親のassert失敗・打ち切り・早すぎるreleaseのいずれも、有限時間で失敗報告
  またはprobe続行へ収束することを確認する。T_e失効時の死亡／生存の判別はchild handleの終了観測だけで
  行い、pid照会は使わない。
- 重なりの成立は推定せず、親側witness（T_e以内のentered検知→T_c以内のCLI検査完了→release作成、親process
  内保持・初期値偽）と子側witness（entered作成直前にrelease未生成→release検知で正常終了、nonce付き1行を
  rename書込み）の両方をassertする。子側witnessはfail-closedで、不在・読取り失敗・T_w超過・形式不一致・
  nonce不一致を全て偽として扱い「判定不能」を作らないことを確認する。witness判定はspawnを試みた全終了経路
  （reap不能を含む）でreap/join後・cleanup前に必ず実施し、省略されないことを確認する。反証は、entered作成を
  遅らせ子を生存完走させるfixture、releaseを先置きするfixture、witness fileの削除・改変、CLI検査結果の
  異常注入、CLI検査のT_c超過hangの各々で、npmが0で終了してもrace BDDが失敗することで示す。primary errorは
  親側の決定表（spawn失敗→CLI検査失敗→重なり不成立→npm異常→manifest不一致→witness偽）で一意に確定し、
  reap不能・cleanup失敗より先頭へ報告する。
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
