# #1800 独立レビューのReviewerの読取り範囲を、主要checkout内とCodex経路でも対象worktreeに限る

## 結論

| 経路 | 判断 | 理由 |
| --- | --- | --- |
| Codex | 実装した | 実行ごとに名前を生成する名前付きpermissions profileで、読取りをOSの最小限と対象worktree等に限れた。起動先（主要checkout）は変えないので、一覧所属は保たれる |
| Claude Code | 実装した（2回目のPR、ASC ownerの判断による） | 起動先を対象worktreeにする案Wを採用した。読取りは対象に限られる。事前に固定した一覧所属の基準のうち項目5（保存先project）は満たさないが、ASC ownerがこれを受け入れて案Wを選んだ（2026-11-24） |

1回目のPR（#1802）はCodex経路だけを実装し、`Relates to #1800`とした。Claude Code経路はownerの判断後に2回目のPRで実装し、そのPRで本Issueを閉じる（[Claude Code経路の実装](#claude-code経路の実装案wの採用)）。

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

3回とも同じ結果だった。費用は9回で計0.029 USD（haiku）。結果fileの`listedOutside`・`listedOtherWorktree`は、拒否のメッセージに要求したpathが出た場合も真になっている（測定時のscript）。表はこれらでなく、各呼出しの成否（`isError`）とmarkerの出現から作った。scriptは、成功したGlobの結果だけで判定するように後から直した。

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
- 案Wでは、起動先の指示file（CLAUDE.md等）が主要checkoutの版でなく対象worktreeの版になる（資料と起動先の違いからの推測。未実測）。採用後の実測では対象・主要checkoutのどちらの`CLAUDE.md`の内容も報告されず、確定していない（下の「指示fileの自動読込み」の節）。
- 保存先projectを起動先と別に指定する`CLAUDE_CODE_PROJECT_DIR_NAME`は、`CLAUDE_CONFIG_DIR`の設定を要する（資料）。#1793では、別の`CLAUDE_CONFIG_DIR`では未ログインで起動できなかった。このため候補にしていない（未実測）。

推奨（判断はASC owner）：案W。ownerは2026-11-24に推奨どおり案Wを選んだ（[Claude Code経路の実装](#claude-code経路の実装案wの採用)）。読取り範囲をHostの作業directory制限で強制でき、失うのは項目5だけで、IDと名前での再開はworktreeの削除後も保たれた。案Dは起動後のfileを防げないため、推奨しない。

1回目のPRで変更しなかった理由：一覧所属と読取り範囲のどちらを優先するかはownerの判断事項だったため。見直す条件のうち「ownerが案Wを選ぶ」が満たされ、2回目のPRで実装した。

## Claude Code経路の実装（案Wの採用）

### owner判断と判定基準の扱い

- ASC ownerは2026-11-24に「全部推奨どおりでよい」と回答し、推奨した案Wを採用した。保存先projectが主要checkoutでなくなること（基準の項目5）を受け入れた。
- `listing-criteria.md`は測定前に固定した基準として変更しない（sha256 `da3cc1e9…e0e6`のまま）。基準による判定は「一覧所属を保てない」のままであり、案Wの採用は基準の判定を変えたものではなく、項目5をownerの判断で要件から外したものである。項目1〜4（完了時の改名、主要checkoutから実行ID・表示名での再開、worktree削除後の再開）は採用後も維持すべき要件とし、下の実測で確かめた。
- 対象：2回目のPRのbaseは`7392653cb0075b68d06c5547d02fdb74ab5c15a3`（#1802のmerge後のmain）。

### 変更（`src/host-session.mjs`）

- `runHostSession`は、Claude Codeでは起動先（`cwd`）を対象worktreeにし、本体と完了時の改名（`--resume <ID> -n '済: …'`）の両方をそこで起動する。`status.json`の`cwd`は実際の起動先（対象worktree）になる。
- `claudeReviewArguments`は起動先と対象を受け取らず、`--add-dir`を付けない。`--restricted`・`--tools Read,Glob,Grep`・`--permission-mode dontAsk`・`--strict-mcp-config`・hook無効は従来どおり。
- Codexは変えない（起動先は主要checkout、読取りは名前付きprofile）。
- 主要checkoutの解決（bare構成・壊れたGit metadataで起動前に停止）と対象HEADの確認（本体後・改名後）は両Hostで従来どおり行う。対象が主要checkoutそのもの・非Gitの場合は、従来から起動先＝対象であり変わらない。

### 実測（`host-session-probe.mjs`、各1回×3、`results/host-session/`）

実装した`host-session claude`のCLIそのもの（`node bin/asc-v05.mjs host-session claude <対象worktree> --model haiku --rename-model haiku`）を、合成fixture（`setup-fixture.mjs`、実行ごとに新規）で起動した。依頼は`probe-run.mjs`と同じ13件のtool呼出しである。`host-session`の出力（JSON）はtool結果を含まないため、各呼出しの成否とmarkerは、保存されたsessionのtranscript（合成fixtureのものだけ）から判定した。transcriptでは同じtool結果が2回記録されたため、`tool_use_id`ごとに1件として数えた。その後、主要checkoutから実行IDと表示名（`済: 自動: …`）で`--resume`し、対象worktreeを削除して再度行った。

| 確認 | 3回の結果 |
| --- | --- |
| `host-session`の終了コード、`status`・`naming` | 0、`completed`・`completed`（3回とも） |
| `status.json`の`cwd` | 対象worktree（主要checkoutではない）、`targetHead`は対象のHEADと一致 |
| 1〜5 外のRead・Glob・Grep、外へのsymlink | 拒否 |
| 6〜7 対象のRead・Glob（陽性対照） | 成功（6のReadで対象のmarkerが出た。7のGlobはfile名だけを返すためmarkerを含まない） |
| 8〜13 主要checkoutのGit管理・Git管理外file、別worktree、`.worktrees`のGlob、主要checkoutのGrep、主要checkoutを指すsymlink | 拒否 |
| transcriptと出力全体のmarker | 対象のmarkerだけ（外・主要checkoutのGit管理/管理外・別worktreeは出ない） |
| 保存先project | 対象worktreeのproject（主要checkoutのprojectには無い） |
| 主要checkoutから実行ID・表示名で`--resume`（削除前・削除後） | 4件とも成功し、同じsession |

本体の費用は1回あたり約0.0036 USD（haiku、3回の`total_cost_usd`）。最初の1回はtranscriptの重複を数え分けないscriptで行ったため結果を採らず、scriptを直して3回を測り直した（判定は同じだった）。測定後、fixtureのsessionを`claude purge -y <fixtureの主要checkout>`で削除し（入れ子の対象worktreeのprojectも削除された）、`--dry-run`で残りが無いことを確かめた。

### 指示fileの自動読込み（`instructions-probe.mjs`、各1回×3、`results/instructions/`）

1回目の独立レビューの指摘（主要checkoutが起動先の祖先になるため、祖先の`CLAUDE.md`が読み込まれうる）を受けて測った。主要checkoutと対象worktreeのそれぞれに乱数の合言葉を書いた`CLAUDE.md`を置き、`host-session`と同じ引数（非永続）で対象worktreeから起動し、toolを使わずに与えられた合言葉を答えさせた。

- 3回とも、どちらの合言葉も報告されず`NONE`と答えた（費用は計約0.0019 USD）。
- 読み込まれた場合の陽性対照は無く、報告されないことは読み込まれなかったことの弱い根拠にとどまる。`--restricted`がproject指示の自動読込みも止めている可能性があるが、確定していない。少なくとも主要checkoutの`CLAUDE.md`だけが読み込まれる結果は出なかった。
- このため配布文書では、file toolでの拒否を実測として書き、指示fileの自動読込みは確定していないと書いた。Reviewerは従来どおり対象側の規約をfile toolで読む。

### CIで検査すること（追加分）

`test/test_host_session.mjs`：

- Claude Codeでは、本体と改名の両方が対象worktreeで起動され、`status.json`の`cwd`が対象worktreeである。どの呼出しにも`--add-dir`が無い。追加指示に対象のpathとHEADがあり、主要checkoutのpathは無い。改名は同じIDに`-n '済: 自動: …'`を送る。
- Codexでは従来どおり起動先が主要checkoutで、profileは対象と共有のGit metadataだけを読ませる。
- 対象が主要checkoutそのもの・非Gitのdirectoryの場合、両Hostで起動先＝対象になる。
- `claudeReviewArguments`は永続・非永続とも`--add-dir`を含まない。

### 独立レビュー（2回目のPR）

`host-session claude`（本変更後の経路。Read・Glob・Grepだけ、`--restricted`、起動先は対象worktree）で新しいContextに依頼した。Reviewerは対象worktreeしか読めないため、git差分（結果fileを除く）を依頼文に添えた。

| 回 | 対象 | 判定 | 主な指摘と是正 |
| --- | --- | --- | --- |
| 1 | `c96e2b91` | 条件付き合格（条件：help文の是正か根拠、最終HEADのCI） | High・Mediumなし。Low：CLIのhelp文が「repository rootから起動」のまま（直した）、陽性対照のGlobにmarkerは出ない（表を直した）、祖先の`CLAUDE.md`の自動読込みが未実測なのに配布文書が「読めない」と断定（実測を追加し、文書をfile toolの範囲に限定）、Claude Codeへの追加指示が「sessionRootは一覧用」のまま（起動先＝対象のときは文言を変え、unit testで固定） |
| 2 | `15abb0ca`（1回目の是正だけ） | 合格 | High・Mediumなし。Low：比較の節に残った採用前の推測へ実測の参照を追加、主要checkout・非Gitの入力での追加指示の文言をunit testで固定（いずれも是正。振る舞いは変えていない） |

### 品質検査（2回目のPR）

- Linux container（`node:20.19.5-bookworm`、network none、read-only root）：`node --test test/test_host_session.mjs`は38件成功。
- その他の結果はPRに記録する。

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
- filesystemは、ASCの他のCodex起動（`restricted-agent.mjs`・`native-probe.mjs`）と共通の`sandboxFilesystemBase`（`src/codex-runtime.mjs`）に、読取りだけを足したものである。共通部分は`:root`の拒否、`:minimal`の読取り、macOSの共有一時directory（`/tmp`・`/var/tmp`を`/private`付きの表記とあわせて）の拒否、Codexの実行時file（`codexRuntimeRoots`）とNodeの読取りである。足すのは`codexReviewReadablePaths`のpathと対象worktreeの読取りで、書込みのentryは無い。足すentryは`"<path>"={"."="read"}`の形にする。`"<path>"="read"`の形では、pathに`[`・`]`等があるとCodexがglobと解釈し、globの読取りを拒否して起動できなかった（PRのCodeRabbitの指摘を受けて実測。`<path>={"."="read"}`の形では読めた。`profile-bracket-path.json`は角括弧を含むpathのfixtureでの結果で、`fixtureHasGlobChars`が真。拒否された方の出力は`bracket-bare-form.txt`）。
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
- Claude Code：案Dの一覧所属。案Wでの指示file（CLAUDE.md等）の読込み元は陽性対照が無く確定していない（上の節）。session pickerの表示。Linux・Windowsでの案W（起動先の解決はunit testで検査した）。
- `host-session codex`の全経路（turnがmodelを呼ぶため）。起動引数の組立ては偽のHostで検査した。

## 残る制限

- Claude Code経路：sessionは対象worktreeのprojectに保存され、主要checkoutのproject単位の一覧（`claude purge <主要checkout>`等の操作、pickerの既定表示）では見つからない。主要checkoutから実行IDか表示名で再開する（ownerが受け入れた制限）。
- Codex経路：共有のGit metadata（全branchの履歴、ref、`.git/config`、他worktreeのindex・stage済みの内容・stash）は読める。macOSの開発toolのdirectoryは`xcode-select -p`の結果で、`DEVELOPER_DIR`等で利用者が変えられる（PATHと同じく利用者の管理下とした）。ただし名前が`Developer`か`CommandLineTools`で終わるdirectoryだけを許可し、それ以外（`/`や家directory等）は加えない。判定は名前だけなので、`DEVELOPER_DIR`を家directoryの下の`Developer`等の同名directoryに向けると、その全体が読取りに入る（利用者の設定の誤りが必要なため、構造の判定は加えていない）。この判定はmacOSでしか動かず、単体テストでは固定していない。同名のprofileは設定から合成されるが（実測）、profile名を実行ごとに生成するため衝突しない。managed設定の`requirements.toml`による制約は確認していない。
- Codex経路の`thread/start`・`turn/start`の`permissions`と`activePermissionProfile`は実験的APIの項目で、版により変わりうる。応答に無ければ失敗して止まる。
- Codex経路：Codexが起動するMCP server等はsandboxの外で動き、このprofileでは読取りを限定できない（Claude Code経路の`--strict-mcp-config`に当たるものは入れていない）。
- 共通基盤のentry（Codexの実行時file・Node）は`"<path>"="read"`の形のままで、これらのpathに`[`等があると起動が拒否される（範囲は広がらない）。共通基盤は他のCodex起動と共有するため変えていない。
- 対象が主要checkoutそのものの場合、読取りは主要checkout全体（`.worktrees/`下の他worktreeを含む）になる。両経路とも構造上避けられない。

## 独立レビュー

`host-session claude`（Read・Glob・Grepだけ、`--restricted`）で、毎回新しいContextに依頼した。

| 回 | 対象 | 判定 | 主な指摘と是正 |
| --- | --- | --- | --- |
| 1 | `ccd35939` | 条件付き | Medium 3件：macOSの利用者単位の一時directoryが未実測（実測を追加）、Codexの導入形態が未記録（記録）、一覧所属の結果fileが手で要約されていた（scriptを直して再測定）。Low 5件も是正 |
| 2 | `7de8b4d8` | 条件付き | Medium 2件：既存の`src/codex-runtime.mjs`を使わず独自に組み立てていた（共通基盤に揃え、`/var/tmp`・npm導入・Windows・`extends`を扱う）、品質検査の結果が未記録（記録） |
| 3 | `aa353db6` | 条件付き合格 | Medium 1件：同名のprofileが設定から合成される場合を検出できない（実測で合成を確認し、profile名を実行ごとに生成）。Low：Evidenceに残ったNodeのpathを伏せる、macOSの版の検査、Windowsの拡張子なしfile、MCPと主要checkout自体の記載、npm launcherのテスト、追加確認の条件の記録 |
| 4 | `eaf0f705` | 条件付き合格（条件：最終HEADのCI） | High・Mediumなし。Low：`xcode-select -p`の結果を確かめずに許可していた（`Developer`・`CommandLineTools`で終わるdirectoryだけに限った）、macOS専用の経路がCIで通らない（下に明記）、`criteriaSha256`が定数（下に明記）、見出しの欠落（修正） |
| 5 | `1df1fcf6`（4回目の是正だけ） | 条件付き合格（条件：最終HEADのCI） | High・Mediumなし。Low：開発toolの判定が名前だけ、判定の単体テストが無い、空行（いずれも記述で対応し、判定は変えていない） |
| 6 | `4204ddac`（PRのCodeRabbitの指摘3件の是正だけ） | 条件付き合格（条件：最終HEADのCI） | High・Mediumなし。Low：角括弧の実測を結果fileで検証できない（`fixtureHasGlobChars`と拒否時の出力を保存）、共通基盤のentryの扱い（残る制限に記載） |

## 片付け

- 永続sessionの測定で作ったClaude Codeのproject data（合成fixtureのpathのものだけ）は、`claude purge -y <fixtureのpath>`で削除し、`--dry-run`で残りが無いことを確かめた。
- Docker：自分で作ったcontainer（`--rm`）とvolume（`asc-1800-work`、label `asc.worktree`）だけを使い、終了後に削除した。

## 配布物影響

配布境界（`package.json`の`files`）に入る変更path：

- `src/host-session.mjs`、`src/session-rpc.mjs`：Codex経路の起動を変更した。配布物に含まれる。
- `skills/asc/references/host-session.md`、`skills/asc/references/review.md`：Codex経路の読取り範囲の説明を更新した。配布物に含まれる。

配布物に入らない変更path：`test/test_host_session.mjs`、`docs/evidence/1800-review-read-scope-rest/`。

2回目のPR（Claude Code経路）で配布境界に入る変更path：

- `src/host-session.mjs`：Claude Code経路の起動先を対象worktreeにし、`--add-dir`を外した。配布物に含まれる。
- `skills/asc/references/host-session.md`：起動先・読取り範囲・一覧の確認方法の説明を実態に合わせた。配布物に含まれる。
- `v05/USAGE.md`：`host-session`の起動先の説明を実態に合わせた。配布物に含まれる。
- `bin/asc-v05.mjs`：`host-session`のhelp文の起動先を実態に合わせた（1回目の独立レビューの指摘）。配布物に含まれる。

`skills/asc/references/review.md`は、Claude Code経路の一覧所属や`--add-dir`に触れる記述が無いため変更していない。2回目のPRで配布物に入らない変更path：`test/test_host_session.mjs`、`docs/evidence/1800-review-read-scope-rest/`（`README.md`、`host-session-probe.mjs`、`instructions-probe.mjs`、`results/host-session/`、`results/instructions/`）。

## 品質検査

- PRのCI（commit `ee2554b49cb8913b8213acede4b55941497f7079`。最終HEADのCIはPRを参照）：「v0.5 Linux品質検証」（`npm ci --ignore-scripts`、`npm run quality`、`npm pack --dry-run`）、macOS・Windows・Linuxの「Host protocol」、「Current Host worktree execution」、「Native verification assets」、「trusted project品質契約」がすべて成功した。
- Linux container（`node:20.19.5-bookworm`、network none、read-only root、`npm ci --ignore-scripts`はnetworkありの別containerで実行）：
  - `node --test test/test_host_session.mjs`：37件成功（4回目のレビューの是正後）。
  - `npm run lint`：成功。
  - `npm run package:check`：12件中11件成功。失敗の1件はcontainerに`bwrap`が無いための隔離実行テストで、`ASC_TEST_ISOLATION=0`では12件とも成功した。CIでは成功している。
  - `npm run quality`の全体：containerでは20分を超えても終わらず、打ち切った（欠測）。判定はCIの結果による。
- macOS上の`node --test test/test_host_session.mjs`：作成直後の実行fileの初回起動が遅く、テストの2秒の上限を超えて失敗する（baseでも29件中21件が失敗。#1793の記録と同じ）。
