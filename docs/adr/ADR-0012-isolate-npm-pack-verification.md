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

重なりの最中に何を確かめるかを、回帰testの合格条件として固定する。合格は「親側CLI検査の全assert成功・
親子両側witnessの成立・npmの0終了とpack結果取得・共有生成物manifestの前後一致・回収と後始末の成功」の
論理積であり、1つでも欠ける場合と判定できない場合を失敗にする。親側CLI検査は、共有CLIの`--help`が
終了コード0とusage出力（probe開始前のbaselineとの一致）を返すこと、probeが所有するclean入力への
`lint vocab`が終了コード0を返すこと、両起動のstderrにmodule解決・link失敗の署名が無いことを要求する。
「重なりが成立した」ことだけをassertし、共有CLIの実際の成否を合格条件から落とすと、本Issueの症状
（生成途中のmodule graphによる異常終了）が起きても回帰testが成功しうるため、この2点を明示的に含める。
CLIエントリがdispatch tableを、dispatch tableが全コマンドmoduleを静的importする構造のため、この2点の
成立はコマンドモジュールgraphが完全にloadされたことの十分な証拠になる。

handshakeの待ち時間は「親のentered待ち + 親側CLI検査の上限 ＜ 子のrelease待ち ＜ packの上限」を不変条件と
する。親がreleaseを作るのはCLI検査の完了後であるため、検査時間へ上限を与えないと、子がreleaseを受け取れる
保証も検証全体の有限性も成立しないからである。上限を超えた検査は打ち切り、releaseの作成を打ち切り処理の
先頭に置いて子の待機を先に解き、その後にCLI childを回収する。打ち切りは検証本体の失敗として扱う。
子はrelease未達時に自らprepare失敗として終了する。tree killを正常系の回収手段にしないためである。
markerの検知はplatform差のあるfs watchではなく短間隔pollingとし、検知遅れの上限を保証する。

重なりが実際に成立したことは推定せず、親子両側のwitnessで明示的に判定する。親側witnessは自身の観測
（上限内のentered検知→上限内のCLI検査完了→release作成）として保持し、fileを介さない。自分の観測を
自分が読むためにI/Oを挟むと失敗経路が増えるだけで証跡価値が無いためである。子はprocess境界を越えるため、
「entered作成直前にreleaseが未生成であり、その後releaseを検知して正常終了した」ことをnonce付きの固定形式で
witness fileへrename書込みする。子側witnessの判定はfail-closedとし、不在・読取り失敗・読取り上限超過・
部分内容・形式不一致・nonce不一致・偽を区別せず全て「偽」とする。「判定不能」を第3の状態として認めると、
実装がassertの省略と解釈でき、silent passを塞ぐという導入目的そのものが失われるためである。witness判定は
spawnを試みた全終了経路（回収不能を含む）で必ず実施し、位置はreap/join後・cleanup前に固定する。回収不能時は
削除を抑止するためwitness fileは読める状態にあり、読めなくてもfail-closedで偽になる。

entered待ちの上限が失効した時点では、子が死亡したのか生存したまま遅いのかを、child handleの終了観測
だけで判別する。pid存在確認は再利用と権限差で誤判定するため使わない。失敗報告のprimary errorは親側の
決定表（spawn失敗 → CLI検査失敗・打ち切り → 重なり不成立 → npm異常 → manifest不一致 → witness偽）で
一意に確定させる。早すぎるreleaseを見た子はdeadlock回避のため待たず続行してよく、そのreleaseの由来
（親の回復動作か反証fixtureの先置きか）を子は判別しない。由来ごとに報告順序を決める規則にすると、
成立しうる組合せの一部で順序が定まらないため、確定主体を親の決定表へ一本化する。これらの経路はいずれも
待機を無限化せず、既存の「tree終了 → reap/join → witness判定 → cleanup」と失敗の優先順位へ合流する。
npmはdry-runでcacheも隔離されるため、共有publish lockやtest順序制御は導入しない。

## Consequences

- 並列probeとCLI利用testは書込みpathを共有せず、実行順に依存しない。
- 実際のprepare、現在sourceからのbuild、npmのpack files算出をまとめて検査できる。
- 内部相対symlinkの解決意味を保ちつつ、rootの共有生成物と依存treeへ到達するlinkをpack起動前に拒否できる。
- 待ち時間の順序（親側CLI検査の上限を含む）と自律timeout、および上限超過時の打ち切りにより、handshakeの
  どの失敗経路でもhangせず有限時間で失敗を報告できる。
- 両側witnessと生存判定により、重なりが成立しないまま回帰testが静かに成功する経路が塞がれる。
  代償として、遅いCI環境ではfixture不良としての失敗が起こり得るため、entered待ち・CLI検査・release待ちの
  各上限は不変条件を保ったまま実行環境に応じて注入で調整できる必要がある。
- 共有CLIの`--help`と`lint vocab`の成否を合格条件へ含めたため、回帰testは「重なりの成立」だけでなく
  本Issueの症状そのもの（並列build中のCLI異常終了）を直接検知する。共有CLIのusage出力を変更する場合は
  baseline比較のため回帰testの期待値更新が必要になる。
- 子側witnessのfail-closedにより、witness fileのI/O障害は成功ではなく失敗へ倒れる。稀なI/O障害が
  race BDDの偽陽性失敗を生みうるが、silent passを許すより安全側である。
- 失敗の優先順位と集約順序が固定されるため、cleanup失敗が本来の失敗原因を隠さない。
- copy、build、tree supervisionにより時間・一時disk・platform別process処理は増える。
- helper/testを戻すと既知raceが復活するため、rollback前に同等の隔離策を必要とする。
