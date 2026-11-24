# #1800 独立レビューのReviewerの読取り範囲を、主要checkout内とCodex経路でも対象worktreeに限る

## 結論

| 経路 | 判断 | 理由 |
| --- | --- | --- |
| Codex | 実装した | 実行ごとに名前を生成する名前付きpermissions profileで、読取りをOSの最小限と対象worktree等に限れた。起動先（主要checkout）は変えないので、一覧所属は保たれる |
| Claude Code | 実装しない（ASC ownerの判断待ち） | 起動先を対象worktreeにすると読取りは対象に限られるが、事前に固定した一覧所属の基準のうち項目5（保存先project）を満たさない。主要checkoutのまま拒否ruleを与える案は、起動後に作られたfileを防げない |

このため本Issueは閉じず、PRは`Relates to #1800`とする。

## 対象と環境

| 項目 | 値 |
| --- | --- |
| 調査時のmain（branchのbase） | `02bb1a0d134a69350416bc92e74c299e017b9d79` |
| 調査中に進んだmain | `6a63141b8ad1c154895a84a2567a735cca506455`（#1799のmerge。本変更のfileとの重なりは無い） |
| Claude Code | 2.1.323 |
| Codex CLI | 0.171.0（modelを呼ぶ実行はしていない） |
| Node | v20.12.2（macOS）、v20.19.5（Linux container） |
| OS | macOS（Darwin 25.6.0） |
| Codexの導入形態 | Homebrew cask（native実行file。PATH上のsymlinkが実体を指す） |

## 方法

`setup-fixture.mjs <directory>`で合成fixtureを作る。主要checkout（`repo`、Git管理のfile・Git管理外のfile・AGENTS.md）、その中の対象worktree（`.worktrees/target`）と別のworktree（`.worktrees/other`）、主要checkout外のworktree（`external-target`）、repositoryの外の`outside`を置く。markerは乱数の無害な値である。対象worktreeには、外のfile・directoryと主要checkoutのGit管理外fileを指すsymlinkを置いた。fixtureは一時directory（`/private/tmp`の下）に作った。`setup-fixture.mjs`は新規か空のdirectoryにだけ作る。

- `probe-run.mjs`：Claude Codeを`host-session`と同じ制限（`--restricted --tools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config`、hook無効、`--no-session-persistence`）で起動し、13件のtool呼出しを依頼する。stream-jsonのtool結果にmarkerが出たかを機械的に判定する。modelはhaiku。
- `listing-probe.mjs`：永続sessionを`host-session`と同じ引数builder（`claudeReviewArguments`・`claudeRenameArguments`）で作り、改名し、主要checkoutから実行IDと表示名で`--resume`する。対象worktreeを削除した後にも同じことを行う。判定基準は測定前に`listing-criteria.md`として固定した（commit `4f6b12d8`、sha256 `da3cc1e9…e0e6`）。保存先は、資料にある保存場所（`<設定directory>/projects/<起動先のpathの英数字以外を-にした名前>/<session ID>.jsonl`）のfileの有無で判定し、真偽だけを出力する。結果fileの`criteriaSha256`は実行時に計算した値でなく、固定した基準のhashをscriptに定数として書いたものである（基準を測定前に固定したことはcommitの順序で確かめられる）。Hostのstderrは利用者の設定fileの名前を含みうるため、空かどうかだけを残す。
- `codex-probe.mjs`：`codex app-server`に`initialize`、`thread/start`（ephemeral）、`command/exec`だけを送る。`turn/start`を送らないので、modelは呼ばれない。`command/exec`は、app-serverの設定で決まるpermissions（本変更では`default_permissions`）の下でcommandを実行する。`CODEX_HOME`は使い捨てのdirectoryにした（利用者の`~/.codex`は読み書きしない）。

## Claude Code経路の比較

### 読取り範囲（各3回、`results/claude/`）

| 依頼 | 現行（起動先＝主要checkout、`--add-dir`対象） | 案W（起動先＝対象worktree） | 案D（現行＋起動時の拒否rule） |
| --- | --- | --- | --- |
| 1〜3 外のRead・Glob・Grep | 拒否 | 拒否 | 拒否 |
| 4〜5 外へのsymlink | 拒否 | 拒否 | 拒否 |
| 6〜7 対象のRead・Glob（陽性対照） | 読めた | 読めた | 読めた |
| 8 主要checkoutのGit管理fileのRead | 読めた | 拒否 | 拒否 |
| 9 主要checkoutのGit管理外fileのRead | 読めた | 拒否 | 拒否 |
| 10 別worktreeのRead | 読めた | 拒否 | 拒否 |
| 11 `.worktrees`のGlob | 成功 | 拒否 | 成功（別worktreeのpathは出ない） |
| 12 主要checkoutのGrep（別worktreeのmarker） | 成功しmarkerが出た | 拒否 | 成功（markerは出ない） |
| 13 主要checkoutを指すsymlink | 読めた | 拒否 | 拒否 |
| event全体のmarker（外・主要checkout・別worktree） | 主要checkoutと別worktreeのmarkerが出た | 出ない | 出ない |

3回とも同じ結果だった。費用は9回で計0.029 USD（haiku）。

- 案W：拒否は`--restricted`の作業directory制限による。#1793の反例（作業directory外のmarker、外へのsymlink）の拒否も維持された。家directoryのfileは反例に使っていない（実設定を読まないため）。
- 案D：主要checkoutから対象までの経路上の兄弟entryを、起動時に列挙して`--settings`の`Read(...)`拒否ruleにした（`probe-run.mjs`の`primary-cwd-deny`）。列挙は起動時点のものなので、review中に主要checkoutへ作られたfileや、並行するIssueが作ったworktreeは拒否されない。拒否ruleに否定（除外）の書き方が無いため、「主要checkoutのうち対象以外」を将来分まで表せない。

### 一覧所属（`results/listing/`、基準は`listing-criteria.md`）

測定は2回行った。1回目は保存先をscriptの外で確かめ（`claude purge --dry-run`の表示と保存directoryの一覧）、結果fileを手で要約したため、独立レビューの指摘を受けてscript自体が保存先を判定するように直し、新しいfixtureで2回目を測った。`results/listing/`は2回目のscriptの出力そのものである。判定は2回とも同じだった。

| 基準 | 現行 | 案W |
| --- | --- | --- |
| 1 完了時の改名（`済: 自動: …`） | 成功（終了コード0） | 成功（終了コード0） |
| 2 主要checkoutから実行IDで`--resume` | 成功（同じsession ID） | 成功（同じsession ID） |
| 3 主要checkoutから表示名で`--resume` | 成功 | 成功 |
| 4 対象worktreeの削除後の2と3 | 成功 | 成功 |
| 5 保存先projectが主要checkout | 満たす | 満たさない（対象worktreeのprojectに保存され、削除後もそのまま） |

案Wは項目5を満たさないため、基準により「一覧所属を保てない」と判定した。案Dは起動先と引数以外を変えないため、保存先は現行と同じになる（案Dの一覧所属は測定していない）。

判断材料：

- 公式資料（[Manage sessions](https://code.claude.com/docs/en/sessions)）では、`claude -p`で作ったsessionはsession pickerに表示されない。現行でも案Wでも、`host-session`のsessionはpickerの既定一覧に出ず、IDか名前で再開する。pickerは既定で現在のworktreeのsessionを表示し、`Ctrl+W`で同じrepositoryの全worktreeに広げられる（資料による。pickerは実測していない）。
- 案Wでは、主要checkoutから実行IDでも表示名でも再開でき、worktreeの削除後も再開できた（実測）。失うのは保存先projectが主要checkoutであることで、主要checkoutのprojectだけを`claude purge`等で扱う運用や、project単位の一覧（pickerの既定表示等）では見つからない。
- 案Wでは、起動先の指示file（CLAUDE.md等）が主要checkoutの版でなく対象worktreeの版になる（資料と起動先の違いからの推測。未実測）。
- 保存先projectを起動先と別に指定する`CLAUDE_CODE_PROJECT_DIR_NAME`は、`CLAUDE_CONFIG_DIR`の設定を要する（資料）。#1793では、別の`CLAUDE_CONFIG_DIR`では未ログインで起動できなかった。このため候補にしていない（未実測）。

推奨（判断はASC owner）：案W。読取り範囲をHostの作業directory制限で強制でき、失うのは項目5だけで、IDと名前での再開はworktreeの削除後も保たれた。案Dは起動後のfileを防げないため、推奨しない。

変更しない理由と見直す条件：一覧所属と読取り範囲のどちらを優先するかはownerの判断事項のため、現行のままにした。次のどれかで見直す。ownerが案Wを選ぶ。Claude Codeに保存先projectを起動先と別に指定する手段（認証を分けずに使えるもの）が加わる。拒否ruleに除外の書き方が加わる。

## Codex経路

### 公式資料とsource

- 設定資料（[Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)）：`default_permissions`で名前付きprofileを選べる。`[permissions.<name>.filesystem]`の各keyはpathか特殊token（`:minimal`・`:workspace_roots`等）で、値は`read`・`write`・`deny`。`sandbox_mode`とは併用しない。
- source（`openai/codex`のtag `rust-v0.171.0`）：`:root`を含まないprofileは読取りが制限され、`:minimal`の読取りでOSの最小限（macOSでは`seatbelt_read_only_platform_defaults.sbpl`）が加わる。app-serverの`thread/start`・`turn/start`には、実験的APIの項目として`permissions`（profile名）があり、応答の`activePermissionProfile`で適用されたprofileが分かる（`codex app-server generate-json-schema --experimental`で確認）。

### 実測（各3回、`results/codex/`）

| 確認 | 現行（`sandbox: read-only`） | 本変更（profile `asc_review_<乱数>`） |
| --- | --- | --- |
| `activePermissionProfile` | なし | 生成したprofile名（`extends`なし） |
| 起動先（thread cwd） | 主要checkout | 主要checkout（変更なし） |
| 自動で読み込まれたproject指示 | 主要checkoutのAGENTS.md | なし |
| 対象worktreeのfile（陽性対照） | 読めた | 読めた |
| 外のfile、外へのsymlink（file・directory） | 読めた | 拒否 |
| 主要checkoutのGit管理file・Git管理外file | 読めた | 拒否 |
| 別worktree、主要checkout外のworktree | 読めた | 拒否 |
| 主要checkoutを指すsymlink | 読めた | 拒否 |
| 一時directory外のfile（このcheckoutの公開AGENTS.md。終了コードだけ記録） | 読めた | 拒否 |
| 一時directoryの一覧（`/tmp`・`/private/tmp`・`/var/tmp`・`/private/var/tmp`・`os.tmpdir()`。entryが出たかだけ記録） | 5件とも出た | 5件とも出ない（終了コード1） |
| 対象worktreeへの書込み | 拒否 | 拒否 |
| localhostへの接続 | 拒否 | 拒否 |
| 対象での`git log`・`git status` | 成功 | 成功 |

追加の確認（各1回）：

- 使い捨ての`CODEX_HOME`の設定に`sandbox_mode = "workspace-write"`を置いても、`-c`の指定が優先され、生成したprofileが適用された（`profile-user-sandbox-mode.json`。置いた設定のkey名を`codexHomeConfig`に記録）。
- 同名のprofileの合成（3回目の独立レビューの指摘で追加）：使い捨ての`CODEX_HOME`の設定に`[permissions.asc_review.filesystem]`で外のdirectoryの読取りを置いた。固定名`asc_review`で起動すると、`-c`の表に設定の読取りが合成されて外のmarkerを読めた（`fixed-name-user-same-name.json`）。実行ごとに生成した名前では外を読めなかった（`profile-user-same-name.json`）。このため固定名をやめ、実行ごとに名前を生成する。
- `CODEX_HOME`のuser単位のAGENTS.mdは、profileの下でも読み込まれた（`instructionSources`）。

### 実装（`src/host-session.mjs`）

- app-serverを`-c project_doc_max_bytes=0 -c default_permissions="<名前>" -c permissions.<名前>.filesystem={…} -c permissions.<名前>.network.enabled=false`で起動する（`codexReviewProfileArguments`）。名前は`codexReviewProfileName`が実行ごとに生成する`asc_review_<24桁の16進>`で、それ以外の名前は拒否する。
- filesystemは、ASCの他のCodex起動（`restricted-agent.mjs`・`native-probe.mjs`）と共通の`sandboxFilesystemBase`（`src/codex-runtime.mjs`）に、読取りだけを足したものである。共通部分は`:root`の拒否、`:minimal`の読取り、macOSの共有一時directory（`/tmp`・`/var/tmp`を`/private`付きの表記とあわせて）の拒否、Codexの実行時file（`codexRuntimeRoots`）とNodeの読取りである。足すのは`codexReviewReadablePaths`のpathと対象worktreeの読取りで、書込みのentryは無い。
  - 最初の実装は共通部分を使わず独自に組み立てていた。再レビューの指摘（`/var/tmp`の表記漏れ、npm導入の扱い、Linuxでの不要な拒否key、`:root`とnetworkの明示）を受けて、共通部分に揃えた。
- `codexReviewReadablePaths`は、共有のGit metadata（`git rev-parse --git-common-dir`）と、macOSでは`xcode-select -p`の開発toolを返す。
- 実行fileは`resolveExecutable`で実体へ解決する（PATH、WindowsではPATHEXTの拡張子だけ。`.cmd`・`.bat`は拒否）。macOSでは`--version`がCodex 0.156.0未満か読めなければ起動前に失敗する（`assertCodexVersion`）。npmのlauncher（`.js`）はNodeで起動し、`codexRuntimeRoots`がpackageと現在のplatform用のnative packageを読取りに加える。
- `initialize`で`experimentalApi`を有効にし、`thread/start`と`turn/start`に生成したprofile名を`permissions`として渡す（`sandbox`・`sandboxPolicy`は渡さない）。`thread/start`の応答の`activePermissionProfile`がその名前で`extends`を持たない場合だけturnを始める。

実装の理由（いずれもmacOSでの実測）：

- sandbox内の補助処理（AGENTS.md読込み等）がCodexの実行fileを再実行する。symlink（PATH上のlink）のpathを許可しても実行できず、symlinkを解決した実体を起動し、その実体を許可すると実行できた。
- `:minimal`には共有一時directory（`/private/tmp`・`/private/var/tmp`）の読取りが含まれた。拒否を加えないと、一時directoryに置いたfixtureの外のmarkerを読めた。
- 対象worktreeとfixtureは`/private/tmp`の下にあるが、対象は読めた。拒否より具体的なpathの読取り許可が優先される。
- 対象worktreeの`.git`は共有のGit metadataを指すため、これが無いとgitが使えない。`/usr/bin/git`は開発toolを実行するため、それも必要だった。共有のGit metadataには全branchの履歴・ref・設定のほか、他worktreeのindex・stage済みの内容・stashのobjectも含まれる。各checkoutの作業treeのfile（Git管理外のfileを含む）は含まない。
- 起動先（主要checkout）は読めないため、そこにAGENTS.mdがあると`thread/start`が「failed to load AGENTS.md instructions」で失敗した。起動先のAGENTS.mdは対象とは別の版でもあるため、`project_doc_max_bytes=0`で自動読込みを止めた。Reviewerは従来どおり指示に従って対象側の規約を読む。

## CIで検査すること

`test/test_host_session.mjs`：

- 偽のCodex Hostが受け取る起動引数が、`codexReviewProfileArguments`（実行時file・Node・`codexReviewReadablePaths`・対象）と完全に一致する。Git管理の対象では共有のGit metadataが含まれ、主要checkoutは含まれない。symlinkの実行fileは実体として起動される。
- profileの文字列をmacOSとLinuxの両方で完全一致で固定する（`:root`の拒否、書込み・`:workspace_roots`なし、macOSだけ一時directoryの拒否、network無効、TOMLの文字列として逃がす、相対pathと空の実行時fileを拒否する）。
- `thread/start`・`turn/start`が生成したprofile名を`permissions`に持ち、`sandbox`・`sandboxPolicy`を持たない。`initialize`が`experimentalApi`を有効にする。profile名は実行ごとに異なり、固定名は拒否される。
- macOSではCodex 0.156.0未満と版が読めない場合を拒否する。
- npmのlauncher（`@openai/codex`のpackageの`bin/codex.js`）はNodeで起動され、packageのrootが読取りに入る。
- `activePermissionProfile`が無い応答、別のprofileの応答、`extends`を持つ応答では、`turn/start`を送らずに失敗する。
- 実行fileをPATH・symlink・Windowsの拡張子から実体へ解決し、見つからない・実行できない・`.cmd`のwrapperの場合は失敗する。Windowsでは拡張子の無いfileを選ばない。

実際のHostでの実測はこのEvidenceだけにあり、CIでは行わない。`test_host_session.mjs`はLinuxのCIで動くため、macOS専用の経路（`assertCodexVersion`の呼出しと`xcode-select -p`の追加）の配線はCIで検査しない。版の判定は関数単体でテストし、配線はmacOSでの実測（`codex-probe.mjs`）で確かめた。

## 実測済みと未実測

実測済み（macOS、Claude Code 2.1.323、Codex CLI 0.171.0）：

- Claude Code：現行・案W・案Dの読取り範囲（各3回）。現行と案Wの一覧所属（基準1〜5）。
- Codex：app-serverの`thread/start`でのprofile適用と、`command/exec`での読取り・一時directoryの一覧・書込み・localhost接続・gitの結果（各3回）。利用者設定の`sandbox_mode`より優先されること。user単位の指示の読込み。

未実測：

- Codex：modelを呼ぶturnでの読取り（外部serviceへ送らない方針による）。turnのshell実行は`command/exec`と同じprofileの下で動く前提で、`activePermissionProfile`で適用を確かめている。shell以外の組込みtool（画像の表示等）の読取りがprofileに従うか。
- Codex：Linux・Windowsでのprofileの効き方。npm導入（launcherをNodeで起動し、`codexRuntimeRoots`のpackageを許可する。ASCの他のCodex起動と同じ扱い）等、Homebrew cask以外の導入形態。許可が足りなければ`thread/start`かturn中のtoolが失敗する想定で、読取りを広げては続行しない。`/usr/bin/git`以外のgit。家directoryのfileへの反例（実設定を読まないため、一時directory外のfileとしてこのcheckoutの公開fileで代用した）。
- Claude Code：案Dの一覧所属。案Wでの指示file（CLAUDE.md等）の読込み元。session pickerの表示。
- `host-session codex`の全経路（turnがmodelを呼ぶため）。起動引数の組立ては偽のHostで検査した。

## 残る制限

- Claude Code経路：主要checkout内のfile（Git管理外のfile、他のworktree）は引き続き読める。ownerの判断後に対応する。
- Codex経路：共有のGit metadata（全branchの履歴、ref、`.git/config`、他worktreeのindex・stage済みの内容・stash）は読める。macOSの開発toolのdirectoryは`xcode-select -p`の結果で、`DEVELOPER_DIR`等で利用者が変えられる（PATHと同じく利用者の管理下とした）。ただし名前が`Developer`か`CommandLineTools`で終わるdirectoryだけを許可し、それ以外（`/`や家directory等）は加えない。同名のprofileは設定から合成されるが（実測）、profile名を実行ごとに生成するため衝突しない。managed設定の`requirements.toml`による制約は確認していない。
- Codex経路の`thread/start`・`turn/start`の`permissions`と`activePermissionProfile`は実験的APIの項目で、版により変わりうる。応答に無ければ失敗して止まる。
- Codex経路：Codexが起動するMCP server等はsandboxの外で動き、このprofileでは読取りを限定できない（Claude Code経路の`--strict-mcp-config`に当たるものは入れていない）。
- 対象が主要checkoutそのものの場合、読取りは主要checkout全体（`.worktrees/`下の他worktreeを含む）になる。両経路とも構造上避けられない。

## 独立レビュー

`host-session claude`（Read・Glob・Grepだけ、`--restricted`）で、毎回新しいContextに依頼した。

| 回 | 対象 | 判定 | 主な指摘と是正 |
| --- | --- | --- | --- |
| 1 | `ccd35939` | 条件付き | Medium 3件：macOSの利用者単位の一時directoryが未実測（実測を追加）、Codexの導入形態が未記録（記録）、一覧所属の結果fileが手で要約されていた（scriptを直して再測定）。Low 5件も是正 |
| 2 | `7de8b4d8` | 条件付き | Medium 2件：既存の`src/codex-runtime.mjs`を使わず独自に組み立てていた（共通基盤に揃え、`/var/tmp`・npm導入・Windows・`extends`を扱う）、品質検査の結果が未記録（記録） |
| 3 | `aa353db6` | 条件付き合格 | Medium 1件：同名のprofileが設定から合成される場合を検出できない（実測で合成を確認し、profile名を実行ごとに生成）。Low：Evidenceに残ったNodeのpathを伏せる、macOSの版の検査、Windowsの拡張子なしfile、MCPと主要checkout自体の記載、npm launcherのテスト、追加確認の条件の記録 |
| 4 | `eaf0f705` | 条件付き合格（条件：最終HEADのCI） | High・Mediumなし。Low：`xcode-select -p`の結果を確かめずに許可していた（`Developer`・`CommandLineTools`で終わるdirectoryだけに限った）、macOS専用の経路がCIで通らない（下に明記）、`criteriaSha256`が定数（下に明記）、見出しの欠落（修正） |

## 片付け



- 永続sessionの測定で作ったClaude Codeのproject data（合成fixtureのpathのものだけ）は、`claude purge -y <fixtureのpath>`で削除し、`--dry-run`で残りが無いことを確かめた。
- Docker：自分で作ったcontainer（`--rm`）とvolume（`asc-1800-work`、label `asc.worktree`）だけを使い、終了後に削除した。

## 配布物影響

配布境界（`package.json`の`files`）に入る変更path：

- `src/host-session.mjs`、`src/session-rpc.mjs`：Codex経路の起動を変更した。配布物に含まれる。
- `skills/asc/references/host-session.md`、`skills/asc/references/review.md`：Codex経路の読取り範囲の説明を更新した。配布物に含まれる。

配布物に入らない変更path：`test/test_host_session.mjs`、`docs/evidence/1800-review-read-scope-rest/`。

## 品質検査

- PRのCI（commit `ee2554b49cb8913b8213acede4b55941497f7079`。最終HEADのCIはPRを参照）：「v0.5 Linux品質検証」（`npm ci --ignore-scripts`、`npm run quality`、`npm pack --dry-run`）、macOS・Windows・Linuxの「Host protocol」、「Current Host worktree execution」、「Native verification assets」、「trusted project品質契約」がすべて成功した。
- Linux container（`node:20.19.5-bookworm`、network none、read-only root、`npm ci --ignore-scripts`はnetworkありの別containerで実行）：
  - `node --test test/test_host_session.mjs`：37件成功（4回目のレビューの是正後）。
  - `npm run lint`：成功。
  - `npm run package:check`：12件中11件成功。失敗の1件はcontainerに`bwrap`が無いための隔離実行テストで、`ASC_TEST_ISOLATION=0`では12件とも成功した。CIでは成功している。
  - `npm run quality`の全体：containerでは20分を超えても終わらず、打ち切った（欠測）。判定はCIの結果による。
- macOS上の`node --test test/test_host_session.mjs`：作成直後の実行fileの初回起動が遅く、テストの2秒の上限を超えて失敗する（baseでも29件中21件が失敗。#1793の記録と同じ）。
