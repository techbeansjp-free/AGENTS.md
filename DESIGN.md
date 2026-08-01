# DESIGN: 並列テスト中のnpm pack用ビルドがCLI成果物を競合更新する

- Issue: `ISSUE-279`
- 対応する SPEC: `SPEC.md`

## 目的・入力・出力・前提

npmの実lifecycleとpack算出を維持し、package検証の全書込みを使い捨て領域へ閉じ込める。
入力は読取り専用のpackage root、出力はnpmが返すfiles一覧である。通常build済みの共有CLIと
`node_modules`を前提とし、CLI本体、package manifest、test runnerの並列度は変更しない。

## 要件 → 設計要素

| AC-ID | 設計要素 | 検証 |
|---|---|---|
| AC-1 | Isolated package probe / 境界containment検査 | root `bin` manifestの前後一致、外向き・absolute・破損link fixtureのprobe拒否 |
| AC-2 | Pack result parser | npmのJSON filesと収録契約を照合 |
| AC-3 | Controlled race fixture | lifecycle中にroot CLIのhelp/lintを起動し、CLI結果assert・時間契約・両側witnessの成立を全て要求 |
| AC-4 | 既定test command | concurrency指定なしで3回以上実行 |
| AC-5 | Process supervisor / workspace owner | failure・timeout・cleanup複合障害の4分岐とworkspace path付きerror |

## Isolated package probe

`test/helpers/npm-pack.ts`はprobeごとに次を行う。

1. OS一時rootにsource、HOME、npm cache、TMPDIRと一意なmarker領域を作る。
2. package rootをsourceへ一度だけcopyする。`.git`、`.worktrees`、`bin`、`node_modules`を除外し、
   fileは新しい実体とする。`node_modules`はsource直下へ別に一度だけ物理copyする。元package rootの
   `node_modules`を指すsymlinkも、書込み可能な共有pathも作らない。snapshotとrootの依存treeは
   別実体であり、snapshot側の書込みがroot側の`node_modules`へ透過する経路は存在しない。
3. 内部の相対symlinkはNode解決規則を保つためsymlinkのまま維持する。dereference copyにしないのは、
   依存treeの自己参照linkやcycleが無限展開・実体重複を招きpack対象の算出意味も変えるためで、
   安全性は物理分離とcontainment検査で担保する。検査対象は両copyの全域（source本体と`node_modules`
   配下を含む全entry）、検査タイミングはnpmのspawn前、検査失敗は即probe拒否（packを起動しない）とする。
   各linkはabsoluteを拒否し、targetの`realpath`がsourceの`realpath`からの相対pathで`..`で始まらず
   absoluteでもないことを要求し、破損linkとsource外targetを拒否する。
   検査とpack実行の間にlinkを差し替えるTOCTOUは成立しない。snapshot pathはprobeごとに一意で他probeとも
   元package rootとも共有せず、完成後にその配下へ書き込む主体はprobeが起動したnpm childだけである。
   差し替える外部主体が存在せず、守るべき境界（root共有生成物とrootの依存tree）はsnapshotの外側に別実体
   として在るため、checkとuseの間に境界が変化しない。
4. `HOME`、`npm_config_cache`、`TMPDIR`、`TMP`、`TEMP`を専用領域へ固定する。package lock、
   lifecycle出力、npm cache、temp fileのいずれもrootへ書き戻せない。
5. sourceをcwdとして、shellを介さず固定引数`npm pack --dry-run --json`をspawnする。
   stdout/stderrは合計8 MiB、packは60秒を既定上限とし、testから短縮注入できる。
6. child回収後にJSONをparseしてfilesを返し、最後にworkspaceを再帰削除する。

copy後だけに作用するtest hookでsnapshotの`package.json`を変更できる。成功経路ではhookを使わず、
実際のmanifestとsourceを検証する。元package rootへ書込みAPIを公開せず、別probe間でpath、
environment、markerを共有しない。dry-runはpublishせずcacheも隔離されるため、process間mutex、
共有publish lock、実行順制御は不要である。

## Process supervisor / workspace owner

childは独立したprocess group/treeとして起動する。通常終了では`close`をjoinしてからcleanupする。
timeoutまたはbuffer超過時はtree全体へ終了要求を送り、2秒のgrace後も残れば強制終了し、5秒以内に
`close`をjoinしてからcleanupする。POSIXはgroupへのTERM→KILL、Windowsは同等のtree terminationを
固定引数で行う。順序は必ず「terminate tree → reap/join → witness判定（race fixtureのみ）→ cleanup」で
あり、親だけをkillしない。

pack timeout、termination grace、reap timeout、10秒のcleanup watchdog、buffer上限、cleanup関数、
race fixtureのentered待ちT_e・親側CLI検査上限T_c・release待ちT_r・witness読取り上限T_w・marker polling
間隔・親側CLI検査の起動commandはtest seamで注入できる。注入値でも不変条件`T_e + T_c ＜ T_r ＜ pack上限`
を保たねばならず、満たさない注入はprobe起動前に設定errorとして拒否する。timeout経路の全体上限は79秒
（pack 60 + grace 2 + reap 5 + witness読取り 2 + cleanup 10）である。

失敗の報告は「primary error（検証本体の失敗＝spawn・pack・parse・assertのいずれか）＞ reap不能
＞ cleanup失敗」の優先順位に固定する。reap不能は生存childと削除が競合するため削除自体を抑止し、
fatalとして扱う（後続のcleanup失敗より重い）。削除を抑止する経路でもrace fixtureのwitness判定は
省略しない——workspaceが残るためwitness fileは読める状態にあり、読めない場合も後述のfail-closedで
「偽」に確定するため、reap不能がwitness判定を隠すことはない。複数段が失敗した場合は`AggregateError`とし、含める情報と
順序をworkspaceの絶対path、残存有無、primary error、reap error、cleanup errorの順で固定する。
cleanup単独失敗も成功扱いしない。

reap不能時の削除抑止は、AC-5が要求する「一時作業領域は後始末され...副作用が残らない」という後始末
要件そのものに対する例外的除外事項である。生存中のchildが使用中の領域を削除処理と競合させると、
child側のファイルI/Oが破損しうる、またはchildがcrashしうるため、この設計は削除を安全側に倒し、
後始末より生存childの整合性を優先する。この除外はAC-5がその後始末要件によって守ろうとしている意図
（CLI公開動作・package収録契約・repository状態へ副作用を残さないこと）を損なわない。削除を抑止した
場合でもrepository内への書込みは一切発生せず、残存するのはOS temp配下のprobe専用workspace（source
snapshotのcopyと`node_modules`のcopy）だけであり、それ自体はCLIの公開動作にもnpm packageの収録契約
にも影響しないためである。cleanup失敗時と削除抑止時に残るのはOS temp配下のprobe専用workspace
だけであり、repository内へ検証用生成物を残さないという要件と両立する。workspace絶対path付きのerrorは
必ずtest出力へ現れ、保存されるtest logが残存の所在と原因を示す証跡になる（AC-5）。reap不能が繰り返し
発生する運用では、削除されないworkspaceがOS temp配下に蓄積し得る。これはOS temp領域自体の運用（定期
的な外部clean等）に属する既知のtrade-offであり、本設計が保証する不変条件（repository内非残存・AC-5の
意図の保全）の範囲外として受け入れる。

## Assertions と回帰fixture

`package-files.test.ts`は`before`で成功probeを1回実行し、2つの契約testが不変なfilesを共有する。
helper内で収録規則を模倣せず、npm JSONの`files[].path`だけを必須・禁止集合と照合する。

root `bin`は再帰walkし、各fileのrootからの相対pathとbytesのSHA-256をsortしたmanifestにする。
成功、snapshot内prepare失敗、snapshot内prepare timeoutの各BDDでprobe前後manifestを直接
deep-equalし、追加・削除・内容変更を検出する。failure/timeout注入はcopy後のsnapshotだけを変える。

race fixtureはprobe固有の予測不能なentered/release/witness markerと一意なnonceを絶対pathで子へ渡す。
snapshotのprepareがsnapshot CLIを不正化してenteredを作りreleaseまで有限待機する間に、親はroot CLIを
検査する。`finally`でreleaseし、supervisorへjoin/killを委ねる。検査対象・時間契約・witness判定・
失敗確定規則は「race fixtureの合格条件」以降で定める。timeout fixtureはdescendantも起動し、tree回収後に
workspaceが消えることを検査してscheduler依存のhangを反証する。

### race fixtureの合格条件

race fixtureが検査するのは「lifecycle buildが共有生成物を書き換えている最中でも、root CLIが完全に
動作すること」である。合格は次の6条件の論理積とし、1つでも成立しない場合、および成立を確認できない
場合はrace BDDを失敗させる。「判定できなかった」を成功側へ倒す経路は設けない。

1. 親側CLI検査の全assertが成功する。
2. 親側witnessが真である。
3. 子側witnessが真である。
4. npm childが0で終了し、pack結果のJSON filesが得られる。
5. root `bin` manifestがprobe前後で一致する。
6. reapとcleanupが成功する。

### 親側CLI検査

親はenteredを検知した後、snapshotのprepareが走っている間にroot `bin/agents-md.js`をshellを介さず
固定引数で2回起動し、次を全てassertする。これがAC-3のThenが要求する「コマンドモジュールgraphの完全
load・`--help`の終了コード0とusage出力・cleanな入力への`lint vocab`の終了コード0」の実体である。

- `--help`：終了コードが0であること、stdoutがprobe開始前に採取したbaseline出力とbyte等価であること、
  stderrが空であることを要求する。baselineはusage見出しと全コマンド名一覧を含み、AC-1により共有生成物は
  probe中も不変であるため、等価性を要求できる。
- `lint vocab`：probe専用temp配下に禁止語を含まないclean入力fileを作り、そのpathを引数に起動して
  終了コード0を要求する。判定を対象repositoryの現在の内容へ依存させないため、入力はprobeが所有する。
- 両起動とも、stderrにmodule解決・link失敗の署名（`ERR_MODULE_NOT_FOUND`、`Cannot find module`、
  `does not provide an export named`、`SyntaxError`）が現れないことを個別にassertする。

この2つでコマンドモジュールgraphの完全loadを判定できるのは、CLIエントリがdispatch tableを、dispatch
tableが全コマンドmoduleをそれぞれ静的importしており、graphのどこか1つでもlinkに失敗すれば起動時例外に
なって「終了コード0かつbaseline一致のusage出力」が成立しないためである。`--help`だけでは、export欠落で
handlerがundefinedになってもusageは印字されうるので、実dispatchを伴う`lint vocab`の成功を併せて要求する。

### race handshakeの時間契約

markerの検知はfs watchではなく50ms間隔のpolling（存在確認）で行う。watchの通知意味と遅延がplatform間で
異なり待ちの上限を保証できないためで、pollingなら検知遅れが常に1間隔以内に収まる。上限は4つ置く。

- T_e = 20秒：親のentered待ち上限（probe開始が起点）。
- T_c = 5秒：親側CLI検査の上限（entered検知が起点、2回の起動の合計wall clock）。
- T_r = 30秒：子のrelease待ち上限（子がenteredを作った時刻が起点）。
- pack上限 = 60秒。

不変条件は`T_e + T_c ＜ T_r ＜ pack上限`とし、注入値でも保つ。これは「子がreleaseを待ち始めてから親が
releaseを作るまで」がT_r未満であることを保証する——親がreleaseを作るのは、entered検知（子のentered作成
から高々1 polling間隔後、かつprobe開始からT_e以内）の後、CLI検査に高々T_cを費やした時点だからである。

親側CLI検査がT_c内に完了しない場合、親は検査を打ち切る。打ち切りの順序は「先にreleaseを作り、その後に
CLI childへterminate → reap/joinを行う」ことに固定する。releaseの作成をCLI childの回収より後に置くと、
回収時間がrelease到達を遅らせてT_rを侵しうるためである。打ち切りは親側CLI検査のassert失敗としてprimary
errorになり、親側witnessは偽になる。CLI childの回収は既存のgrace・reap上限に従い、npm childのjoin待ちと
並行に行うため全体上限を押し上げない。

子はT_r到達時に自らprepare失敗として非0終了するため、supervisorのtree killは正常系の回収手段ではなく
最終手段になる。probe全体の最悪所要はtimeout経路の全体上限79秒の内側に収まる。親側の待ちT_e + T_c = 25秒は
pack上限60秒より小さく、npm childの実行と並行するため、この上限へ加算されない。

### witness契約

重なりが実際に成立したかは暗黙に仮定せず、親子両側のwitnessで明示判定する。

- 親側witnessは「T_e以内にenteredを検知し、その後T_c以内に親側CLI検査を完了し、その完了後にreleaseを
  作った」ことであり、親process内の観測として保持する。初期値は偽で、3条件が順に満たされたときだけ真へ
  更新する。親は自身の観測の唯一の読み手であるため、fileを介さず追加のI/O失敗経路を作らない。
- 子側witnessは「entered作成の直前に確認した時点でreleaseが未生成であり、その後releaseを検知して自ら
  正常終了した」ことである。process境界を越えるためmarker領域のwitness fileへnonceと真偽を1行の固定
  形式で書き、temp fileへ書いてからrenameする（部分書込みを構造的に排除するため）。書込みに失敗した子は
  非0で終了する。

子側witnessの判定はfail-closedとする。親が真と見なすのは「fileが存在し、T_w = 2秒以内に読取りが完了し、
内容が期待形式に完全一致し、nonceが当該probeのものであり、値が真である」場合に限る。不在・読取りerror・
読取りtimeout・空・部分内容・形式不一致・nonce不一致・値が偽は、区別せず全て「偽」として扱う。「判定
不能」という第3の状態は持たせない。

witness判定は、npm childのspawnを試みた全ての終了経路（成功・pack失敗・timeout・assert失敗・reap不能を
含む）で必ず実施し、省略しない。実施位置は「terminate tree → reap/join」の後、cleanupの前に固定する。
reap不能の経路でも判定を飛ばさない——削除を抑止するためwitness fileは残って読めるが、読めない場合も
fail-closedで偽になる。spawnへ到達せずmarker領域が存在しない経路（copy失敗・containment拒否・spawn失敗）
でも、witnessは規定どおり偽であり、成功へ落ちる経路は無い。

### 回復経路とprimary errorの決定

報告主体は常に親（probeを実行するtest process）である。親は自身の観測（時刻・child handleの終了観測・
CLI検査結果）と子側witnessから、次の決定表を上から順に評価し、最初に一致した項目をprimary errorに
確定させる。経路の発生原因（誰がreleaseを先に作ったか等）へ依存しないため、実際に成立しうる全パターンで
primaryが一意に決まる。

1. copy・containment検査・spawnの失敗（npm childが起動していない）。
2. 親側CLI検査のassert失敗、またはT_c超過による打ち切り。
3. 重なり不成立（fixture不良）：enteredを検知しないままT_eが失効し、その時点で子の終了が未観測である。
4. npm childの非0終了、JSON欠損、parse失敗。
5. root `bin` manifestのprobe前後不一致。
6. witnessの偽（両方偽なら親側・子側の順に列挙する）。

確定後の報告順序は「primary error ＞ reap不能 ＞ cleanup失敗」に従う。witness偽によるassert失敗はprimary
の位置を占め、reap不能やcleanup失敗より先頭へ置かれる。

待ちを無限化しないための回復動作は次の3つで尽きる。

- 親は経路を問わず`finally`でreleaseを作る。enteredを待たずに終了する場合も、assertが失敗した場合も、
  CLI検査を打ち切った場合も同じである。待つ主体が居なければ無害であり、居れば待機が解ける。
- T_e失効時、親は子が死亡したのか生存したまま遅いのかを、supervisorが保持するchild handleの終了観測
  （`exit`/`close`の受領有無とexit code/signal）だけで判別する。pidの存在確認やprocess table照会は
  pid再利用と権限差で誤判定するため判定根拠にしない。死亡していれば決定表の4がprimaryを与え、生存して
  いれば決定表の3がprimaryを与える。いずれの場合も、その後に子が0で終了しfilesのJSONを返しても成功へ
  戻さない。
- 子はentered作成の直前にreleaseが既存であることを見つけたら、待たずに続行する（早すぎるreleaseで子を
  停止させるとdeadlockになるため）。既存releaseの由来は「親が先の回復動作でreleaseを作った」場合と
  「反証fixtureが意図的に先置きした」場合の両方がありうるが、子は由来を判別せず、どちらでも自身の
  witnessを偽として記録するだけでよい。primaryの確定は親側の決定表が行うため、由来の別は報告順序へ
  影響しない。

いずれの経路も既存の「terminate tree → reap/join → witness判定 → cleanup」へ合流する。

### 反証fixture

- copy後hookでsnapshotへ、source外を指す相対link・absolute link・破損linkをそれぞれ仕込み、
  containment検査がnpmをspawnする前にprobeを拒否することを確認する。root共有生成物のmanifestが
  probe前後で一致することも同時に検査し、拒否経路でも書込みが起きないことを示す（AC-1）。
- 重なりが成立しないまま、またはroot CLIが壊れたまま静かに成功する経路が無いことを反証する（AC-3）。
  (i) copy後hookで子のentered作成をT_eより遅らせ、子は生存したままprepareを完走させると、probeが
  「重なり不成立、子は生存」のprimary errorで失敗する。(ii) releaseを先に置いて子側witnessだけを偽に
  すると、npmが0で終了しfilesを返してもrace BDDが子側witness偽で失敗する。(iii) witness fileを子の終了後・
  親の読取り前に削除する場合と不正内容へ書き換える場合の双方で、fail-closedにより偽と判定されて失敗する。
  (iv) 親側CLI検査へ非0終了・baseline不一致のstdout・module解決失敗署名を含むstderrをseam経由でそれぞれ
  注入すると、npmが0で終了してもrace BDDがCLI検査のassert失敗で失敗する。(v) 親側CLI検査をT_c超過まで
  hangさせると、releaseが先に作られて子はT_rを待たずに解放され、probeは打ち切りをprimary errorとして
  有限時間で失敗する。
- cleanup契約は4分岐で反証する（AC-5）。(i) primary成功かつcleanup失敗→結果を非成功とし、workspace
  絶対path付きerrorを出す。(ii) primary失敗かつcleanup失敗→両errorを保持し、primaryを先頭に置く。
  (iii) reap不能→削除を抑止し、fatalとpathを報告する。(iv) cleanup watchdog発火→削除を中断し、
  path付きerrorを出す。いずれもrepository内へ生成物を残さないことを併せて確認する。

## 依存・代替案・障害・ロールバック

```text
package assertions / race / failure BDD → isolated probe → temp snapshot → npm pack
                                              ↑ physical files + contained relative links
```

`--ignore-scripts`は公開時のprepareを検査せず、直列化/mutexは共有可変状態を残し、rootのoutDir変更は
production契約へ影響するため不採用。copy・containment・spawn・buffer・timeout・parse・cleanupの
失敗は全て非成功とする。ロールバックはhelper/testだけを戻すが、既知raceを復活させるため代替隔離策を
先に要求する。未決事項はなく、全AC、既定並列test 3回以上、型検査、規約lintの成功を完了条件とする。

```yaml
related_adrs: [ADR-0012]
```
