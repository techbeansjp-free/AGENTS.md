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
| AC-3 | Controlled race fixture | lifecycle中にroot CLIのhelp/lintを起動、handshakeの時間契約、重なり成立witnessの両側assert |
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
固定引数で行う。順序は必ず「terminate tree → reap/join → cleanup」であり、親だけをkillしない。

pack timeout、termination grace、reap timeout、10秒のcleanup watchdog、buffer上限、cleanup関数、
race fixtureのentered待ちT_eとrelease待ちT_rはtest seamで注入できる（T_e＜T_r＜pack上限の順序は
注入値でも保つ）。timeout経路の全体上限は77秒（pack 60 + grace 2 + reap 5 + cleanup 10）である。

失敗の報告は「primary error（検証本体の失敗＝spawn・pack・parse・assertのいずれか）＞ reap不能
＞ cleanup失敗」の優先順位に固定する。reap不能は生存childと削除が競合するため削除自体を抑止し、
fatalとして扱う（後続のcleanup失敗より重い）。複数段が失敗した場合は`AggregateError`とし、含める情報と
順序をworkspaceの絶対path、残存有無、primary error、reap error、cleanup errorの順で固定する。
cleanup単独失敗も成功扱いしない。cleanup失敗時と削除抑止時に残るのはOS temp配下のprobe専用workspace
だけであり、repository内へ検証用生成物を残さないという要件と両立する。workspace絶対path付きのerrorは
必ずtest出力へ現れ、保存されるtest logが残存の所在と原因を示す証跡になる（AC-5）。

## Assertions と回帰fixture

`package-files.test.ts`は`before`で成功probeを1回実行し、2つの契約testが不変なfilesを共有する。
helper内で収録規則を模倣せず、npm JSONの`files[].path`だけを必須・禁止集合と照合する。

root `bin`は再帰walkし、各fileのrootからの相対pathとbytesのSHA-256をsortしたmanifestにする。
成功、snapshot内prepare失敗、snapshot内prepare timeoutの各BDDでprobe前後manifestを直接
deep-equalし、追加・削除・内容変更を検出する。failure/timeout注入はcopy後のsnapshotだけを変える。

race fixtureはprobe固有の予測不能なentered/release/witness markerを絶対pathで子へ渡す。snapshotのprepareが
snapshot CLIを不正化してenteredを作りreleaseまで有限待機する間に、親はroot CLIの`--help`とclean
入力への`lint vocab`を実行する。`finally`でreleaseし、supervisorへjoin/killを委ねる。子はwitness fileへ
自身の重なり成立可否を残し、親は自身のwitnessと併せてassertする。timeout fixtureは
descendantも起動し、tree回収後にworkspaceが消えることを検査してscheduler依存のhangを反証する。

### race handshakeの時間契約と回復経路

markerの検知はfs watchではなく50ms間隔のpolling（存在確認）で行う。watchの通知意味と遅延がplatform間で
異なり待ちの上限を保証できないためで、pollingなら検知遅れが常に1間隔以内に収まる。待ち上限は「親の
entered待ちT_e = 20秒 ＜ 子のrelease待ちT_r = 30秒 ＜ packの既定上限60秒」を不変とする。子はT_r到達時に
自らprepare失敗として非0終了するため、supervisorのtree killは正常系の回収手段ではなく最終手段になる。

重なりが実際に成立したかは暗黙に仮定せず、probeが両側のwitnessで明示判定する。親側witnessは「T_e以内に
enteredを検知し、その後にroot CLIの`--help`とclean入力への`lint vocab`を完了し、その完了後にreleaseを
作った」ことである。子側witnessは「entered作成の直前に確認した時点でreleaseが未生成であり、その後
releaseを検知して自ら正常終了した」ことであり、子はこの真偽をmarker領域のwitness fileへ書く。race BDDは
npmの成功／失敗判定に加えて両witnessが真であることをassertし、いずれかが偽ならassert失敗として扱う。
witness fileの読取りはreap/join完了後・cleanup開始前に行い、後始末の順序自体は変えない。

T_e失効時、親は子が死亡したのか生存したまま単に遅いのかを、supervisorが保持するchild handleの終了観測
（`exit`/`close`の受領有無とexit code/signal）だけで判別する。pidの存在確認やprocess table照会は、
pid再利用と権限差で誤判定するため判定根拠にしない。

経路ごとの回復契約は次の4つで尽きる。

- 子がentered未作成のまま死亡（T_e失効時に終了観測済み）：親はT_eで待ちを打ち切り`finally`でreleaseを
  作る（待つ主体が居ないため無害）。probeはnpm childの非0終了またはJSON欠損をerrorとして失敗を検知する。
  親側witnessは偽であり、この経路が成功へ落ちることはない。
- 子が生存したままT_e以内にenteredを作れない（T_e失効時に終了未観測）：死亡ではなく遅延であるため前経路と
  区別する。親は`finally`でreleaseを作って子の待機を無条件に解いたうえで、「重なり不成立：entered未検知の
  ままT_e失効、子は生存」をfixture不良のassert失敗としてprimary errorに確定させる。npm childがこの後に
  0で終了しfilesのJSONを返しても成功へ戻さない。T_e（20秒）はT_r（30秒）より早いため子は自律的に待機を
  解けるが、解けない場合も既存のtimeout経路と同じくtree終了で回収する。
- 親のassertが失敗：`finally`でreleaseを作ってからjoinする。子は待機を解いて終了し、assert failureが
  primary errorになる。
- 子がenteredを作る前にreleaseが既存：子は待たず続行してよい（早すぎるreleaseで子を停止させると
  deadlockになるため）。ただし子側witnessは偽として記録し、probeはnpmが成功してもrace BDDを失敗させる。
  この状況は親が既にreleaseを作った後にしか起こらず、その時点で親側は「子が生存したままのT_e失効」または
  「親のassert失敗」としてprimary errorを確定させているため、報告は親側errorを先頭に置き、子側witnessの
  偽は同じ失敗の付随情報として集約する。

いずれの経路も既存の「terminate tree → reap/join → cleanup」へ合流し（witness読取りはreap/joinと
cleanupの間に入るだけで順序を崩さない）、失敗報告は「primary error ＞ reap不能 ＞ cleanup失敗」の
優先順位に従う。witness不成立によるassert失敗はprimary errorの位置を占め、reap不能やcleanup失敗より
先頭へ置かれる。race fixtureの最悪経路（子がT_rまで待ってprepare失敗、またはpack上限へ到達）でも所要は
timeout経路の全体上限77秒の内側に収まる。

### 反証fixture

- copy後hookでsnapshotへ、source外を指す相対link・absolute link・破損linkをそれぞれ仕込み、
  containment検査がnpmをspawnする前にprobeを拒否することを確認する。root共有生成物のmanifestが
  probe前後で一致することも同時に検査し、拒否経路でも書込みが起きないことを示す（AC-1）。
- 重なりが成立しないまま静かに成功する経路が無いことを反証する（AC-3）。copy後hookで子のentered作成を
  T_eより遅らせ、子は生存したままprepareを完走させると、probeが「重なり不成立、子は生存」のprimary error
  で失敗することを確認する。同じくreleaseを先に置いて子側witnessだけを偽にした場合も、npmが0で終了し
  filesを返すにもかかわらずrace BDDが失敗することを確認する。
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
