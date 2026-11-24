# #1800 独立レビューのReviewerの読取り範囲を、主要checkout内とCodex経路でも対象worktreeに限る

## 結論

| 経路 | 判断 | 理由 |
| --- | --- | --- |
| Codex | 実装した | 名前付きpermissions profileで、読取りをOSの最小限と対象worktree等に限れた。起動先（主要checkout）は変えないので、一覧所属は保たれる |
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

## 方法

`setup-fixture.mjs <directory>`で合成fixtureを作る。主要checkout（`repo`、Git管理のfile・Git管理外のfile・AGENTS.md）、その中の対象worktree（`.worktrees/target`）と別のworktree（`.worktrees/other`）、主要checkout外のworktree（`external-target`）、repositoryの外の`outside`を置く。markerは乱数の無害な値である。対象worktreeには、外のfile・directoryと主要checkoutのGit管理外fileを指すsymlinkを置いた。fixtureは一時directoryに作った。

- `probe-run.mjs`：Claude Codeを`host-session`と同じ制限（`--restricted --tools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config`、hook無効、`--no-session-persistence`）で起動し、13件のtool呼出しを依頼する。stream-jsonのtool結果にmarkerが出たかを機械的に判定する。modelはhaiku。
- `listing-probe.mjs`：永続sessionを`host-session`と同じ引数builder（`claudeReviewArguments`・`claudeRenameArguments`）で作り、改名し、主要checkoutから実行IDと表示名で`--resume`する。対象worktreeを削除した後にも同じことを行う。判定基準は測定前に`listing-criteria.md`として固定した（commit `4f6b12d8`、sha256 `da3cc1e9…e0e6`）。
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

| 基準 | 現行 | 案W |
| --- | --- | --- |
| 1 完了時の改名（`済: 自動: …`） | 成功（終了コード0） | 成功（終了コード0） |
| 2 主要checkoutから実行IDで`--resume` | 成功（同じsession ID） | 成功（同じsession ID） |
| 3 主要checkoutから表示名で`--resume` | 成功 | 成功 |
| 4 対象worktreeの削除後の2と3 | 成功 | 成功 |
| 5 保存先projectが主要checkout | 満たす | 満たさない（対象worktreeのprojectに保存された） |

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

| 確認 | 現行（`sandbox: read-only`） | 本変更（profile `asc_review`） |
| --- | --- | --- |
| `activePermissionProfile` | なし | `asc_review` |
| 起動先（thread cwd） | 主要checkout | 主要checkout（変更なし） |
| 自動で読み込まれたproject指示 | 主要checkoutのAGENTS.md | なし |
| 対象worktreeのfile（陽性対照） | 読めた | 読めた |
| 外のfile、外へのsymlink（file・directory） | 読めた | 拒否 |
| 主要checkoutのGit管理file・Git管理外file | 読めた | 拒否 |
| 別worktree、主要checkout外のworktree | 読めた | 拒否 |
| 主要checkoutを指すsymlink | 読めた | 拒否 |
| 一時directory外のfile（このcheckoutの公開AGENTS.md。終了コードだけ記録） | 読めた | 拒否 |
| 対象worktreeへの書込み | 拒否 | 拒否 |
| localhostへの接続 | 拒否 | 拒否 |
| 対象での`git log`・`git status` | 成功 | 成功 |

追加の確認（各1回）：

- 使い捨ての`CODEX_HOME`の設定に`sandbox_mode = "workspace-write"`を置いても、`-c`の指定が優先され`asc_review`が適用された。
- `CODEX_HOME`のuser単位のAGENTS.mdは、profileの下でも読み込まれた（`instructionSources`）。

### 実装（`src/host-session.mjs`）

- app-serverを`-c project_doc_max_bytes=0 -c default_permissions="asc_review" -c permissions.asc_review.filesystem={…}`で起動する（`codexReviewProfileArguments`）。filesystemは`:minimal`の読取り、`/tmp`・`/private/tmp`・`/private/var/tmp`の拒否、`codexReviewReadablePaths`のpath、対象worktreeの読取りである。書込みのentryは無い。
- `codexReviewReadablePaths`は、Codexの実行fileの実体、共有のGit metadata（`git rev-parse --git-common-dir`）、macOSでは`xcode-select -p`の開発toolを返す。理由は次のとおり（いずれも実測）。
  - sandbox内の補助処理（AGENTS.md読込み等）がCodexの実行fileを再実行する。symlink（`/usr/local/bin/codex`等）のpathを許可しても実行できず、symlinkを解決した実体を起動し、その実体を許可すると実行できた（`resolveExecutable`）。
  - `:minimal`には一時directory（`/private/tmp`・`/private/var/tmp`）の読取りが含まれた。fixtureを一時directoryに置いたため、拒否を加えないと外のmarkerを読めた。
  - 対象worktreeの`.git`は共有のGit metadataを指すため、これが無いとgitが使えない。`/usr/bin/git`は開発toolを実行するため、それも必要だった。共有のGit metadataにはcommit済みの履歴・ref・設定が含まれ、主要checkoutや他worktreeの作業treeのfileは含まない。
- 起動先（主要checkout）は読めないため、そこにAGENTS.mdがあると`thread/start`が「failed to load AGENTS.md instructions」で失敗した（実測）。起動先のAGENTS.mdは対象とは別の版でもあるため、`project_doc_max_bytes=0`で自動読込みを止めた。Reviewerは従来どおり指示に従って対象側の規約を読む。
- `initialize`で`experimentalApi`を有効にし、`thread/start`と`turn/start`に`permissions: "asc_review"`を渡す（`sandbox`・`sandboxPolicy`は渡さない）。`thread/start`の応答の`activePermissionProfile.id`が`asc_review`でなければ、turnを始めずに失敗する。

## CIで検査すること

`test/test_host_session.mjs`：

- 偽のCodex Hostが受け取る起動引数が、`codexReviewProfileArguments(対象, codexReviewReadablePaths(…))`と完全に一致する。Git管理の対象では共有のGit metadataが含まれ、主要checkoutは含まれない。
- profileの文字列（`:root`・`write`・`:workspace_roots`を含まない、TOMLの文字列として逃がす、相対pathを拒否する）。
- `thread/start`・`turn/start`が`permissions: "asc_review"`を持ち、`sandbox`・`sandboxPolicy`を持たない。`initialize`が`experimentalApi`を有効にする。
- `activePermissionProfile`が無い応答では、`turn/start`を送らずに失敗する。
- 実行fileをPATHとsymlinkから実体へ解決し、見つからない・実行できない場合は失敗する。

実際のHostでの実測はこのEvidenceだけにあり、CIでは行わない。

## 実測済みと未実測

実測済み（macOS、Claude Code 2.1.323、Codex CLI 0.171.0）：

- Claude Code：現行・案W・案Dの読取り範囲（各3回）。現行と案Wの一覧所属（基準1〜5）。
- Codex：app-serverの`thread/start`でのprofile適用と、`command/exec`での読取り・書込み・localhost接続・gitの結果（各3回）。利用者設定の`sandbox_mode`より優先されること。user単位の指示の読込み。

未実測：

- Codex：modelを呼ぶturnでの読取り（外部serviceへ送らない方針による）。turnのshell実行は`command/exec`と同じprofileの下で動く前提で、`activePermissionProfile`で適用を確かめている。shell以外の組込みtool（画像の表示等）の読取りがprofileに従うか。
- Codex：Linux・Windowsでのprofileの効き方。Nodeのwrapper等、実行fileの再実行ができない導入形態（`thread/start`の失敗で止まる想定）。Homebrew等、`/usr/bin/git`以外のgit。
- Claude Code：案Dの一覧所属。案Wでの指示file（CLAUDE.md等）の読込み元。session pickerの表示。
- `host-session codex`の全経路（turnがmodelを呼ぶため）。起動引数の組立ては偽のHostで検査した。

## 残る制限

- Claude Code経路：主要checkout内のfile（Git管理外のfile、他のworktree）は引き続き読める。ownerの判断後に対応する。
- Codex経路：共有のGit metadata（全branchのcommit済み履歴、ref、`.git/config`）は読める。managed設定やproject設定が同名のprofileを変えた場合の挙動は確認していない（`-c`の指定が優先されることは利用者設定で確認した）。
- Codex経路の`thread/start`・`turn/start`の`permissions`と`activePermissionProfile`は実験的APIの項目で、版により変わりうる。応答に無ければ失敗して止まる。

## 片付け

- 永続sessionの測定で作ったClaude Codeのproject data（合成fixtureのpathのものだけ）は、`claude purge -y <fixtureのpath>`で削除し、`--dry-run`で残りが無いことを確かめた。
- Docker：自分で作ったcontainer（`--rm`）とvolume（`asc-1800-work`、label `asc.worktree`）だけを使い、終了後に削除した。

## 配布物影響

配布境界（`package.json`の`files`）に入る変更path：

- `src/host-session.mjs`、`src/session-rpc.mjs`：Codex経路の起動を変更した。配布物に含まれる。
- `skills/asc/references/host-session.md`、`skills/asc/references/review.md`：Codex経路の読取り範囲の説明を更新した。配布物に含まれる。

配布物に入らない変更path：`test/test_host_session.mjs`、`docs/evidence/1800-review-read-scope-rest/`。

## 品質検査

（下に追記する。）
