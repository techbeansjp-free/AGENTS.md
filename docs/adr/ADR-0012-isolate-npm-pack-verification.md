# ADR

```yaml
id: ADR-0012
status: proposed
title: npm pack検証を使い捨てsource snapshotへ隔離する
tags: [testing, npm, concurrency]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

package files統合テストはnpmが算出する実際の収録内容を検証する必要がある。一方、repository rootで
`npm pack --dry-run`を動かすと`prepare`が共有`bin/`を再生成し、並列テストが生成途中のCLIを読む。

直列化やprocess内mutexは別processを含む共有可変状態を残す。`--ignore-scripts`は公開時のlifecycleと
現在sourceからのCLI生成を検証せず、productionのbuild出力先変更はpackage契約へ影響する。

## Decision

package内容検証はOS一時rootのsource snapshotをcwdとして、通常の
`npm pack --dry-run --json`を実行する。package rootはGit metadata、worktree、共有`bin`、
`node_modules`を除外して一度copyし、依存は別に一度物理copyする。元package rootへのsymlinkや書込み
可能な共有pathは作らないため、境界はsymlinkの透過性ではなく実体の物理分離で成立する。

依存treeはdereference copyにしない。自己参照linkやcycleで無限展開・実体重複を招き、pack対象の算出
意味も変わるためである。内部相対linkはNode解決規則を保つため維持し、安全性はcontainment検査で担保する。
検査対象は両copyの全域（`node_modules`配下を含む）、タイミングはnpmのspawn前、失敗時はpackを起動せず
probeを拒否する。absolute・破損・snapshot外を指すlinkを拒否する。検査後にlinkを差し替えるTOCTOUは、
snapshot pathがprobeごとに一意で他probeとも元package rootとも共有されず、snapshot完成後にその配下へ
書き込む主体がprobeの起動したnpm childだけである以上、差し替えの主体が存在しないため成立しない。

HOME、npm cache、temp、markerはprobe専用pathへ隔離する。npm childは独立process treeで起動し、
timeoutまたはbuffer超過時はtreeを終了、有限時間でreap/joinしてからcleanupする。出力buffer、
pack、終了grace、reap、cleanupはそれぞれ有限上限を持つ。
失敗は「primary error ＞ reap不能（削除を抑止しfatal）＞ cleanup失敗」の優先順位で報告し、複数段が
失敗した場合はworkspace絶対path、残存有無、primary error、reap error、cleanup errorの順で集約する。
cleanup単独失敗も非成功にする。残存はOS temp配下のprobe専用workspaceに限られ、repository内へ生成物を
残さない。

隔離の証明はroot `bin`全fileの相対pathとbytes digestを成功、prepare失敗、timeoutの前後で直接比較する。
外向き相対link・absolute link・破損linkを仕込んだsnapshotではpack起動前に拒否されることを反証側で示す。
lifecycle中の一意markerでroot CLIのhelp/lintを重ね、timeoutではdescendantを含むtree回収を検査する。

重なりのhandshakeは待ち時間を「親のentered待ち ＜ 子のrelease待ち ＜ packの上限」の順序で設計し、
子はrelease未達時に自らprepare失敗として終了する。tree killを正常系の回収手段にしないためである。
markerの検知はplatform差のあるfs watchではなく短間隔pollingとし、検知遅れの上限を保証する。

重なりが実際に成立したことは推定せず、親子両側のwitnessで明示的に判定する。親は「entered待ちの上限内に
enteredを検知し、その後にroot CLIの検査を完了してからreleaseを作った」ことを、子は「entered作成直前に
releaseが未生成であり、その後releaseを検知して正常終了した」ことをそれぞれwitnessとして残し、回帰testは
npmの成功／失敗判定に加えて両witnessの成立をassertする。witnessの読取りはreap/join後・cleanup前に行う。
これは、重なりが一度も成立しないまま回帰testが恒久的に成功し続ける（実質何も検証しない）状態を、
機械的に排除するためである。

entered待ちの上限が失効した時点では、子が死亡したのか生存したまま遅いのかを、child handleの終了観測
だけで判別する。pid存在確認は再利用と権限差で誤判定するため使わない。死亡なら子の非0終了やJSON欠損が
失敗を示す。生存したまま遅い場合は死亡と同一視せず、releaseで待機を解いたうえで「重なり不成立」を
fixture不良として検証本体の失敗（primary error）に確定させ、その後に子が0で終了しても成功へ戻さない。
早すぎるreleaseを見た子はdeadlock回避のため待たず続行してよいが、witnessは偽として記録し、
npmが成功しても回帰testを失敗させる。これらの経路はいずれも待機を無限化せず、既存の
「tree終了 → reap/join → cleanup」と失敗の優先順位へそのまま合流する。
npmはdry-runでcacheも隔離されるため、共有publish lockやtest順序制御は導入しない。

## Consequences

- 並列probeとCLI利用testは書込みpathを共有せず、実行順に依存しない。
- 実際のprepare、現在sourceからのbuild、npmのpack files算出をまとめて検査できる。
- 内部相対symlinkの解決意味を保ちつつ、rootの共有生成物と依存treeへ到達するlinkをpack起動前に拒否できる。
- 待ち時間の順序と自律timeoutにより、handshakeの失敗経路でもhangせず有限時間で失敗を報告できる。
- 両側witnessと生存判定により、重なりが成立しないまま回帰testが静かに成功する経路が塞がれる。
  代償として、遅いCI環境ではfixture不良としての失敗が起こり得るため、entered待ちの上限は
  実行環境に応じて注入で調整できる必要がある。
- 失敗の優先順位と集約順序が固定されるため、cleanup失敗が本来の失敗原因を隠さない。
- copy、build、tree supervisionにより時間・一時disk・platform別process処理は増える。
- helper/testを戻すと既知raceが復活するため、rollback前に同等の隔離策を必要とする。
