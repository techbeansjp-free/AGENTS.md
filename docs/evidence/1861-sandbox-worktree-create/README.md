# Claude Codeのsandboxの中のworktree-create（#1861）

開発時の検証資料であり、配布対象に含めない。

## 結論

- #1844のprobe 2の失敗を、モデルを呼ばずに再現した。Claude Code 2.1.323のBashのsandboxは、`<git-common-dir>/worktrees`への書込みを拒む。`git worktree add`はそこに新しいworktreeの記録を作れず、終了code 128で止まる。ASCの`worktree-create`は、そのとき「Migration Git operation failed (exit status 128)」で終了code 1になる。
- 既定の設定（下の「既定の設定」）でも同じに失敗した。利用者への影響がある。Bashをsandboxの中で動かす利用者は、ASCの最初の段で止まり、作業用のbranchと空の`.worktrees`が残る（再実行は「Work branch already exists」で止まる）。
- 直し：`worktree-create`が、作成の前に`<git-common-dir>/worktrees`へ確認用のdirectoryを作れるかを確かめ、作れなければ原因と対処を示して、branchも`.worktrees`も作らずに止まる。支持する手順（利用者が自分のterminalで`worktree-create`を実行し、作られたworktreeでClaude Codeを起動する）を`v05/USAGE.md`に書いた。その手順どおりにすると、sandboxの中で`start`とcommitが成功した。
- sandboxの中で`worktree-create`そのものが成功する設定は見つからなかった（試した設定は下の表）。

## 試験の環境

- macOS（Darwin 25.6.0）、Claude Code 2.1.323（`claude --version`）、git（macOSのCommand Line Tools）、Node 20.12.2。
- 試験用のHOME（`/private/var/tmp/r1861/h-*`。空のdirectoryに`.claude/settings.json`だけを置く）。ownerのHOMEとClaude Codeの設定は使っていない。環境変数は`env -i`から作った（`PATH`、`HOME`、`TMPDIR`、`CLAUDE_CODE_TMPDIR`、`LANG`だけ）。
- モデルを呼ばない方法：Claude Codeを`claude -p`で起動し、`ANTHROPIC_BASE_URL`を127.0.0.1の代役（Messages APIの形で、各turnにBashのtool_useを1つ返し、最後にturnを終える）へ向けた。API keyはダミーで、Anthropicへは要求が届かない。費用は0。commandの結果は、Claude Codeが代役へ返すtool_resultで読んだ。代役と起動は[`shared-harness/claude-sandbox-bash.mjs`](../shared-harness/claude-sandbox-bash.mjs)にまとめた。
- 使わなかった方法：対話画面のBash mode（`!command`）は、2.1.323ではsandboxの外で動いた（`sandbox-exec`の入れ子が成功し、試行の外のfileへ書けた。親processは`claude`）。さらにBash modeの後にモデルへの要求を出した（代役のない宛先にしていたので届いていない）。`claude sandbox status`は方針の概要（`filesystemPolicy: strict`等）だけを出し、規則の中身は出さない。
- 試験用のrepository：`git init`して空のcommitを作り、このbranchの`project-assets --register-claude-skill --apply`でASCを導入した（`project-assets`はlinked worktreeを要求するので、一時のworktreeで導入してmainへfast-forwardした）。probe 2の再現だけは、#1844のfixture（v0.5.128、`/private/var/tmp/asc-eval-1844/fixtures/fixture-R-U`）の写しを使った。

## 既定の設定

試験用のHOMEの`.claude/settings.json`：

```json
{"sandbox":{"enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":true,"allowUnsandboxedCommands":false}}
```

ファイルの読み書きの規則は足していない。Claude Codeはrepository rootで起動した。

## 記録

各行は、Claude CodeのBash toolがsandboxの中で実行したcommandと結果である。gitの文は、commandが`2>"$TMPDIR/git-stderr.txt"`で試験の一時directoryへ書き、試験の後にsandboxの外で読んだ（ASCのCLIの出力には入れていない。#1734）。

| 試行 | 設定・起動場所 | command | 終了code | 結果 |
| --- | --- | --- | --- | --- |
| 既定 | 既定の設定、repository root | `node .agent-skill-chain/managed-runtime/bin/asc-v05.mjs worktree-create . 1861 test probe HEAD` | 1 | `Migration Git operation failed (exit status 128)`。`git worktree list`はmainだけ。branch `test/1861-probe`と空の`.worktrees`が残った |
| 既定 | 同上 | `git worktree add --no-checkout -b test/1861-direct -- .worktrees/direct HEAD` | 128 | gitの文：`Preparing worktree (new branch 'test/1861-direct')` / `fatal: could not create directory of '.git/worktrees/direct': Operation not permitted` |
| probe 2の配置 | #1844のprobe 2の`settings.json`（pathだけを試験用に置き換え、`--settings`で渡す）、同じflag（`--tools`・`--permission-mode acceptEdits`等。modelと予算のflagを除く）、v0.5.128のfixture、`/var/tmp/r61/R-probe-2/work` | `worktree-create . 1844 test probe HEAD` | 1 | `Migration Git operation failed (exit status 128)`。branch `test/1844-probe`と空の`.worktrees`が残った（#1844の試行のdirectoryに残っているものと同じ） |
| probe 2の配置 | 同上 | `git worktree add --no-checkout -b test/1861-direct -- .worktrees/direct HEAD` | 128 | 既定と同じgitの文 |
| `.git`の下の書込み | 既定の設定 | `mkdir .git/worktrees/zz`、`touch .git/refs/heads/zz-probe`、`touch .git/config`、`touch .git/asc-direct-probe` | — | `worktrees`の下と`config`は`Operation not permitted`。`refs/heads`と`.git`の直下は書けた |
| allowWrite | `sandbox.filesystem.allowWrite: ["<repo>/.git/worktrees"]` | `worktree-create`と`git worktree add` | 1、128 | 既定と同じ |
| allowWrite | `sandbox.filesystem.allowWrite: ["<repo>/.git"]` | 同上 | 1、128 | 既定と同じ |
| excludedCommands | `sandbox.excludedCommands`に`worktree-create`のcommandを加えただけ | `worktree-create` | — | 「This command requires approval」（`-p`では承認されない） |
| excludedCommands＋allow | 上に加えて`permissions.allow: ["Bash(node .agent-skill-chain/managed-runtime/bin/asc-v05.mjs worktree-create:*)"]` | `worktree-create`、続けて`start <worktree>` | 0、0 | 作成できた（このcommandはsandboxの外で動く）。続くworktreeの中のcommitは`fatal: Unable to create '<repo>/.git/worktrees/<name>/index.lock': Operation not permitted`（128） |
| 外で作成、rootで起動 | 利用者が自分のshellで`worktree-create`（0）。既定の設定でrepository rootから起動 | `start <worktree>`、worktreeの中のcommit | 0、128 | `start`は成功。commitは上と同じ`index.lock`の文で失敗 |
| 外で作成、worktreeで起動 | 同じworktreeのdirectoryで起動 | `start .`、commit、別の`worktree-create` | 0、0、1 | `start`とcommitが成功。別のworktreeの作成は失敗し、branch `test/1861-second`が残った（直す前のCLI） |
| 直した後・既定 | 既定の設定、このbranchのASC、repository root | `worktree-create . 1861 test probe HEAD` | 1 | `Git worktree records are not writable: <repo>/.git/worktrees (EPERM). …`。branchも`.worktrees`も作られない |
| 直した後・手順どおり | 利用者が自分のshellで`worktree-create`（0）。作られたworktreeで起動 | `start . --path src/x.ts`、commit | 0、0 | `asc-worktree/v1`・`current-host-worktree`。commitが成功し、未追跡のfileは無い |
| gitの文の取り出し | 既定の設定、`claude-sandbox-bash.mjs`で実行 | 上の`git worktree add`（stderrを`$TMPDIR`のfileへ） | 128 | 利用者が試験の後にfileを読み、既定と同じgitの文を得た。tool_resultには`exit=128`だけが入った |

補足の観察：

- sandboxの中でClaude Codeを起動した後、`<repo>/.git/worktrees`が空のdirectoryとして作られていた（起動前には無く、ASCのCLIも作っていない）。Claude Codeが作ったと推測するが、確かめていない。直したCLIは、この場合も中に確認用のdirectoryを作れないことで止まる。
- Claude Code 2.1.323の本体には、sandboxが書込みを拒むpathの一覧に`/.git/worktrees`があり、Agentへの案内として「The repository's `.git/worktrees` is read-only in the sandbox, apart from this session's own worktrees, so `git worktree add` … fail there halfway」という文がある（本体の文字列で確かめた）。「this session's own worktrees」は、上の「worktreeで起動」の試行でcommitできたことと合う。
- 公開のsandbox runtime（srt 0.0.83）での#1844の確認では同じ操作が成功した。srtの既定の禁止に`.git/worktrees`が無いためと推測するが、srtの中身は確かめていない。

## 原因

確かめた事実：Claude Code 2.1.323のBashのsandbox（macOS）は、`<git-common-dir>/worktrees`の下への書込みを拒む。`git worktree add -b`はbranchを作った後、この下にworktreeの記録を作れずに終了code 128で止まる。既定の設定でも、probe 2の配置でも同じである。`allowWrite`に`.git`や`.git/worktrees`を加えても変わらない。

probe 2そのものの試行のgitの文は記録されていないが、同じ配置・同じ版のfixtureで、同じCLIの文・終了code・残ったもの（branchと空の`.worktrees`）を再現し、そのときのgitの文が上のとおりだった。

## 直し

- `src/migration.mjs`：`worktree-create`は、共通の管理領域の確認（#1730）に続けて、`<git-common-dir>/worktrees`の中に確認用のdirectoryを作って消す。`worktrees`が無ければ作り、確認の後に消す。作れなければ（EPERM・EACCES・EROFS）`Git worktree records are not writable: <dir> (<code>)`と、利用者が自分のterminalで実行してworktreeでClaude Codeを起動する対処、Agentは権限を広げないことを示して止まる。gitのstderrは含めない（#1734）。
- `v05/USAGE.md`「Claude Codeのsandboxで作業場所を作る（#1861）」と`skills/asc/references/workspace.md`：手順と、試した設定の結果。`excludedCommands`は、除外したcommandが実行するASCの本体をsandboxの中のAgentが書き換えられるので支持しない。

## 再実行の手順

```sh
# 試験用のHOME（既定の設定）と、ASCを導入した試験用のrepositoryを用意してから
node docs/evidence/shared-harness/claude-sandbox-bash.mjs --claude "$(command -v claude)" \
  --cwd <test-repo> --home <test-home> --tmp <test-tmp> --commands <commands.json> --out <new-dir> \
  --path "<nodeのdirectory>:/usr/bin:/bin:/usr/sbin:/sbin"
```

`commands.json`はcommandの文字列の配列。結果は`<new-dir>/result.json`（各commandのtool_result）。gitの文などAgentに渡さない文は、commandの中で`"$TMPDIR/<name>"`へ書き、試験の後に`<test-tmp>/claude-<uid>/<name>`を読む。`<test-tmp>/claude-<uid>`が44 byteを超えるとClaude Codeは一時directoryを`/tmp/claude-<uid>`へ移す（#1844 probe 1）ので、短いpathにする。
