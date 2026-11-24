# #1793 host-sessionのReviewerの読取り範囲を起動設定で限定する

## 結論

`host-session claude`の本体の起動引数に`--restricted`を加え、`--allowedTools Read,Glob,Grep`を外した（`src/host-session.mjs`の`claudeReviewArguments`）。修正後は、作業directory外の合成markerをRead・Glob・Grep・symlink経由のどれでも読めず、worktree内は読める。修正前の同じ起動では外部のmarkerを読めた。

外部読取りの原因は2つあり、どちらか一方だけで読める。

- user設定の読取り許可（許可ruleと追加の作業directory）の継承。
- `--allowedTools Read,Glob,Grep`。pathを指定しない許可なので、user設定を読まなくても作業directory外の読取りを許す。

## 対象と環境

| 項目 | 値 |
| --- | --- |
| 調査時のmain（branchのbase） | `6247dc9df3bc872242475d4aea87fff7ab2178d1` |
| Claude Code | 2.1.323 |
| Codex CLI | 0.171.0（modelは呼んでいない） |
| Node | v20.12.2 |
| OS | macOS（Darwin 25.6.0） |

修正前の`host-session`の対照（下の「host-sessionでの実測」）は、主要checkoutのmain（`d9defa8d435b65718a3d172f56b41071e367729e`）から起動した。base以降、`src/host-session.mjs`と`bin/`に差分は無い。

## 方法

`setup-fixture.mjs`で一時directoryに合成fixtureを作る。Git repository（`repo`、一覧用の主要checkoutに当たる）、その中のworktree（`repo/.worktrees/target`、レビュー対象に当たる）、repositoryの外の`outside/marker.txt`の構成である。markerは乱数の無害な値で、worktreeには外のfile・directoryを指すsymlinkを置いた。主要checkoutの外にもworktree（`external-target`）を置く（`--add-dir`だけで届く配置の確認用）。

`probe-run.mjs <条件> <出力先>`は、`host-session`と同じ配置（cwdは`repo`、`--add-dir`でworktree）で`claude -p`を起動する。次の7件のtool呼出しを依頼し、stream-jsonのtool結果にmarkerの値が出たかを機械的に判定する。

1. Readで外のmarker
2. Globで外のdirectory
3. Grepで外のdirectory
4. Readでworktree内のsymlink（file）
5. Readでworktree内のsymlink（directory）経由
6. Readでworktree内のfile（陽性対照）
7. Readで主要checkoutのfile（参考）

modelは費用を抑えるためhaikuを使った。許可の判定はHost側で行う。`host-session`経由の実測ではopusでも同じ結果だった。各試行は`--no-session-persistence`で起動した。

| 条件 | 起動引数（共通：`-p --permission-mode dontAsk --tools Read,Glob,Grep --strict-mcp-config --settings '{"disableAllHooks":true}' --add-dir <worktree>`） |
| --- | --- |
| A | 修正前と同じ（`--allowedTools Read,Glob,Grep`あり） |
| B | Aから`--allowedTools`を除く |
| C | Aに`--setting-sources ''`（user・project・localを読まない） |
| D | Cから`--allowedTools`を除く |
| E | `--restricted`を加え、`--allowedTools`なし（採用） |
| F | Eに`--allowedTools Read,Glob,Grep` |
| G | Eの`--settings`に外のdirectoryの許可を加える（`--settings`が`--restricted`後も効くかの確認） |
| H | `--setting-sources project`、`--allowedTools`なし |

## 密閉した設定directoryの扱い

テスト用のHOMEと`CLAUDE_CONFIG_DIR`で起動すると「Not logged in」で起動できなかった（実測）。認証情報の複製はしていない。

そこで、利用者の実設定を変えずに起動した。この端末のuser設定には、fixtureの置き場所を含む範囲の読取り許可と追加の作業directoryがある。つまり実環境自体が「広い読取り許可を持つuser設定」の反例になっている。密閉した設定directoryでの実測は未実測である。

## 結果

結果は`results/`にある（r1〜r3は同じ条件の反復）。「外」は1〜5の結果を指し、marker値の出現はevent全体で数えた。

| 条件 | r1 | r2 | r3 | 6（陽性対照） | 7（主要checkout） |
| --- | --- | --- | --- | --- | --- |
| A（修正前） | 外を5件とも読めた | 同じ | 同じ | 読めた | 読めた |
| B（user設定のみ） | 外を5件とも読めた | 同じ | 同じ | 読めた | 読めた |
| C（`--allowedTools`のみ） | 外を5件とも読めた | 同じ | 同じ | 読めた | 読めた |
| D（どちらも無し） | 5件とも拒否 | 同じ | 同じ | 読めた | 読めた |
| E（採用） | 5件とも拒否 | 同じ | 同じ | 読めた | 読めた |
| F（E＋`--allowedTools`） | 5件とも拒否 | 同じ | 同じ | 読めた | 読めた |
| G | 外を5件とも読めた | － | － | 読めた | 読めた |

- Eの拒否の理由は「outside … --restricted confines the file tools to the working directory」だった。symlink（4・5）は「resolves through a symlink to … which is outside …」で拒否された。
- B・C・Dの比較から、原因は上の2つで、どちらか一方だけで外部読取りが起きる。
- Fでは`--allowedTools`があっても`--restricted`の範囲制限が優先された。採用案では、意味の無い許可を残さないため`--allowedTools`を外した。
- Gでは`--settings`で与えた許可が`--restricted`の下でも効いた。`--settings`とmanaged設定は`--restricted`の後も適用される（`claude --help`の記述どおり）。`host-session`の`--settings`は`{"disableAllHooks":true}`に固定しており、CIのテストでもこれを確かめる。

### project設定による拡大

repositoryの直下とworktreeの`.claude/settings.json`に、外のdirectoryの読取り許可と追加の作業directoryを置いて試した（`+project`の結果）。

- E＋project設定：5件とも拒否。
- H＋project設定：5件とも拒否された。この版とこのfixtureの信頼状態では、project設定の許可による拡大はそもそも起きなかった。そのため、拡大の反例は直接は成立していない。
- r1の`+project`は許可だけを置いた。現在の`probe-run.mjs`は、次の確認のための拒否ruleも置く。
- 代わりに、project設定が読まれていることと、`--restricted`がそれを無視することを確かめた（`results/project-deny-check/`）。project設定に主要checkoutのfileの拒否ruleを加えると、Hでは7が拒否された（設定が読まれている）。Eでは7が読めた（`--restricted`がproject設定を無視している）。

### host-sessionでの実測

実際のCLI（`node bin/asc-v05.mjs host-session claude <worktree> --ephemeral`）で、1〜6の依頼を実行した（`results/host-session-e2e.json`）。

| 起動元 | model | 外のmarker | worktree内 |
| --- | --- | --- | --- |
| 修正後 | haiku | 出現0（5件とも`--restricted`で拒否） | 読めた |
| 修正後 | opus | 出現0（5件とも`--restricted`で拒否） | 読めた |
| 修正前（main） | haiku | 出現あり（5件とも読めた） | 読めた |

修正後の実測（haiku・opus）は、commit前の作業treeから起動した。起動引数はcommitした`claudeReviewArguments`と同じである。

独立レビューの指摘を受けて、commit後（`307ddc6f`）に次の2つを追加で実測した。

- 主要checkoutの外にあるworktreeを対象にした起動：対象内のmarkerをReadで読め、Globで列挙できた。外のmarkerは`--restricted`で拒否された（`e2e-external-worktree`）。`--add-dir`で加えた対象は、主要checkoutの外でも読取り範囲に入る。
- 永続session（`--ephemeral`なし）：独立レビュー自体を`--restricted`付きの本体で実行し、完了後に`--resume`での改名まで成功した（`independent-review-persisted`、`naming: completed`）。

## 同じfileの他の経路と他Host

- 完了時の改名（`済: …`）：`--tools ''`で全toolを外しているため、fileを読む手段が無い。変更していない（CIのテストで`--tools ''`を確かめる）。`--restricted`付きで作った永続sessionの改名は成功した（上記）。
- Codex：`sandbox: read-only`は読取り範囲をworkspaceに限定しない。modelを呼ばない`codex sandbox -P :read-only -C <repo> -- cat <外のmarker>`でmarkerを読めた。同じprofileで`touch`は「Operation not permitted」で拒否され、sandbox自体は効いていた。app-serverの`sandbox: read-only`が同じ範囲かは、modelを呼ぶ実行をしていないため未実測である（外部serviceへ送らない方針による）。app-serverのschema（`TurnStartParams`の`sandboxPolicy`）の`readOnly`には、読取り範囲を指定する項目が無い。修正の対象外とし、`skills/asc/references/host-session.md`と`review.md`に制限として明記した。
- `skills/asc/references/review.md`の手動起動例：Claude Codeの例が`--allowedTools Read Glob Grep`だったため、`--restricted --tools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config --settings '{"disableAllHooks":true}'`へ直した（手動起動例の実行は未実測）。

## CIで検査すること

`test/test_host_session.mjs`に、起動引数の組立てを決定的に検査するテストを加えた。

- `--restricted`がある。`--allowedTools`・`--setting-sources`・`--dangerously-skip-permissions`が無い。
- `--settings`が`{"disableAllHooks":true}`だけである。
- `--add-dir`はレビュー対象のworktreeだけである。
- 偽のHostが受け取った引数が、`claudeReviewArguments`の出力と完全に一致する。

実際の`claude`起動による実測はこのEvidenceだけにあり、CIでは行わない。

## 実測済みと未実測

実測済み（macOS、Claude Code 2.1.323）：

- 原因の切り分け（A〜D）。
- 採用案での外部のRead・Glob・Grep・symlinkの拒否。
- 陽性対照（主要checkoutの中と外のworktreeの両方）。
- 永続sessionでの`--restricted`付き起動と、`--resume`による完了時の改名。
- 広い許可を持つ実user設定の下での拒否。
- `--restricted`がproject設定を無視すること。
- `host-session`経由の修正前後の比較。
- Codexの`:read-only` profileが外を読めること。

未実測：

- 密閉したHOME・`CLAUDE_CONFIG_DIR`での実測（未ログインで起動不可）。
- project設定の許可で読取りが実際に広がる状況での反例（この版・信頼状態では拡大自体が起きなかった）。
- Linux・Windowsでの実測。
- Codex app-serverでmodelを呼ぶ実行。

## 残る制限

- 読取り範囲は起動先（主要checkout）と`--add-dir`（レビュー対象）である。主要checkoutの中のfile（Git管理外のfileや他のworktreeを含む）は読める。起動先を主要checkoutにする設計（一覧への所属）によるもので、本修正の範囲外とした。
- managed設定は`--restricted`でも適用されるため、managed設定が読取り範囲を広げる環境では限定されない。
- `--restricted`はuser・project・localの設定fileを読まない。それらの`env`や`apiKeyHelper`に認証を頼る環境では起動に失敗する（読取り範囲を広げずに止まる）。
- `--restricted`の無い古い版では、未知のoptionとして起動に失敗する。
- Codex経路のReviewerはworkspace外を読める。

## 品質検査

- `node --test test/test_host_session.mjs`：Linux container（`node:20.19.5-bookworm`、network none、read-only root）で29件成功した。
- `npm run quality`・`npm run package:check`は、macOS上の実行で失敗した（quality：653件中35件、package:check：12件中3件）。
  - host-session：作成直後の実行fileの初回起動に数秒かかり、テストの2秒の上限を超える。baseでも同じ21件が失敗した。
  - package：`npm pack`の出力にJSON以外の行が混ざる。
  - Git失敗の診断に関するテスト群：本変更が触れないfileのテストである。baseでの再実行はしていない。
  - source-language検査：最初のcommitの`setup-fixture.sh`が対象外のsourceとして拒否された。`setup-fixture.mjs`へ置き換えた。
- 同じ最初のcommit（`307ddc6f`）でのPRのCI（Linux）では、失敗はsource-language検査の1件だけだった（host-session・package・Git診断のテストは成功）。最終的な判定はPRの必須CIの結果による。
