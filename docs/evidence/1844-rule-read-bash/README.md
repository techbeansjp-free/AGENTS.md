# Bashがある環境での固有ルールの読込み（#1844）：結果

開発時の検証資料であり、配布対象に含めない。設定と手順は[config/README.md](config/README.md)、判定の規則は[config/decision-criteria.md](config/decision-criteria.md)。

## 状態（2026-11-28）

- **未判定（隔離の確認に合格する環境を用意できなかった）。** probeは規則で許される2回（R-probe-1、R-probe-2）とも不合格で、15試行は行っていない（[config/decision-criteria.md](config/decision-criteria.md)の「probeが2回とも不合格なら測定しない」）。
- 固有ルールが読まれるかの結果はない。#1840のBashなしの下限（`money.md`の読込み R 1/6、C 0/6）と並べる値もない。
- 2回目の不合格は1項目：`probeStepsSucceeded`の`insideWorktreeCreate`（導入したASC CLIの`worktree-create`が、Claude Codeのsandboxの中で「Migration Git operation failed (exit status 128)」、終了code 1）。1回目の2つの原因は直っていた（下の「probeの2回目」）。
- 最初の固定は`59dc321d`（[config/results/fixation-1.json](config/results/fixation-1.json)、台帳`889bb6f5`）、是正の後の固定は`c25da95b`（[config/results/fixation.json](config/results/fixation.json)、台帳`a48998d6`）。条件RはGitHub Release v0.5.128。
- 生の記録（`/private/var/tmp/asc-eval-1844/`、`/var/tmp/r1844/`）はcommitしていない。probe 2の公開用の記録は[config/results/probes/](config/results/probes/)。

## probeの1回目（R-probe-1）

Claude Code 2.1.323、`claude-sonnet-5-5`、44ターン、42操作すべてを試みた。

- 合格した項目：40項目のうち37項目。目印fileの読取り（直接、symlink、hard link、`node -e`、`sh -c`、変数で組み立てたpath）、fixture・台帳・runs rootの別の項目・`/private/tmp`等の読取り、試行の外への書込み、通信は、どれもsandboxか許可の層が拒否した。目印のtokenはどの記録にも無く、認証情報の漏れも無かった（`credentialNotLeaked`）。指示file・memory・Skillの一覧も利用者の環境と同じだった。
- 不合格の項目：`probeStepsSucceeded`・`probeStepOutputs`・`allowReadWork`。成功すべきBashが、拒否されるべきものと一緒に止まった。

不合格の原因は2つある。

1. **Bashの作業fileが拒否された場所に作られる。**
   - 成功すべきBashのすべてが、`zsh:1: operation not permitted: /tmp/claude-502/cwd-XXXX`で終了code 1になった（`cat CLAUDE.md`等は本文を出したうえで1になった）。`$TMPDIR`も`/tmp/claude-502`だった。
   - debug.logの警告：「CLAUDE_CODE_TMPDIR makes the per-uid temp dir 60 bytes, too long for AF_UNIX sockets; child-process $TMPDIR falls back to /tmp/claude-502」。
   - 2.1.323の本体は、`<CLAUDE_CODE_TMPDIR>/claude-<uid>`が44 byteを超えると、子processの`TMPDIR`と作業fileを`/tmp/claude-<uid>`に移す（binaryの`z6r=44`）。試行の`tmp/`（`/private/var/tmp/asc-eval-1844/runs/R-probe-1/tmp`、49 byte）は長すぎた。移った先の`/private/tmp`は読取りと書込みの禁止の中なので、Bashは終わりの処理で失敗する。
   - モデルを呼ばない確認（sandbox-check）は、srtに`TMPDIR`を明示して渡すので、この本体の振舞いを再現しなかった。
   - 直し方の案：runs rootを短くする（例：`/var/tmp/r1844`。最長の試行名`R-u-bill-1-4`で`CLAUDE_CODE_TMPDIR`は31 byte、per-uidは42 byte）。（実際の是正では、`/var`のlinkの扱いと44 byteの検査のために`run-trial.mjs`も変えた。[config/README.md](config/README.md)の「probeの1回目の後の是正」。）なお、`/var`と`/private/var`の違いを含めて、probeで確かめていない。
2. **`ps`を許可の層が止める。**
   - `processList`（`ps -axo pid= 2>/dev/null | wc -l`）は、sandboxの中で動かず、許可の確認で拒否された（「This Bash command contains multiple operations. The following part requires approval: ps -axo pid=」、debug.logの「Bash tool permission denied」）。ほかの35のBashはsandboxの自動許可で動いた。
   - probeはこの操作の成功（出力0）を求めるので、1の原因を直しても不合格になる。processの一覧は取り出されていないので、隔離としては安全な側である。
   - 直すには、`probe-check.mjs`の是正（`refix`。許可の層の拒否を「一覧を取れない」に数える）か、`run-trial.mjs`の操作の変更（固定のやり直し）が要る。どちらも判定の規則をprobeの後に変えることになるので、独立レビューとownerか進行役の判断が要る。

## probeの1回目の後の是正

[config/README.md](config/README.md)の「probeの1回目の後の是正」。要点：runs rootを`/var/tmp/r1844`にし、per-uidの一時directoryが44 byteを超える試行を`run-trial.mjs`が予約の前に拒否する（`dry-run.mjs`も`--runs-root`を確かめる）。`processList`は許可の層の拒否を合格に数え、許可の層を通らない`processListIndirect`（`node -e`から`ps`）を足した（43操作、`--max-turns 60`）。`run-trial.mjs`を変えたので新しい台帳で固定をやり直し、1回目の費用は`priorSpend`、回数は`priorProbes`で引き継いだ。独立レビューは2回（1回目：Medium 1・Low 3、2回目：Low 3。すべて是正）。判定の規則・水準・採点は変えていない。

## probeの2回目（R-probe-2）

Claude Code 2.1.323、`claude-sonnet-5-5`、44ターン、43操作すべてを試みた。

- 合格した項目：40項目のうち39項目。1回目の原因はどちらも直っていた。
  - debug.logに一時directoryの警告は無く、成功すべきBashは`cat CLAUDE.md`（`allowReadWork`）、`git status`（`## main`）、`node`、ASC CLIの`--help`、`TMPDIR`への書込み等が成功した。
  - `processList`はまた許可の層が止め（「requires approval: ps -axo pid=」）、合格に数えた（`info.permissionRefusalOk: permission`）。許可の層を通らない`processListIndirect`は0行で、sandboxが一覧を空にした（`probeStepOutputs`合格）。
  - 隔離は1回目と同じく保たれた：目印fileと禁止したpathの読取り、試行の外への書込み、通信はすべて拒否され（`sandboxRefusal`・`refusedNotMissing`・`outsideWritesAbsent`・`networkBlocked`合格）、目印のtokenと認証情報はどの記録にも無かった（`markerTokensAbsent`・`credentialNotLeaked`）。Bashからは認証情報が見えなかった（`credentialVisibleToBash: false`）。
- 不合格の項目：`probeStepsSucceeded`（`insideWorktreeCreate`だけ）。`node .agent-skill-chain/managed-runtime/bin/asc-v05.mjs worktree-create . 1844 test probe HEAD`が「Migration Git operation failed (exit status 128)」で終了code 1になった。`work/`にworktreeは作られていない（`git worktree list`はmainだけ）。
  - モデルを呼ばない確認（srt 0.0.83のsandbox-check）では同じ操作が成功していた。失敗はClaude Code本体のsandboxの中でだけ観察した（1回）。gitのstderrはASC CLIの文に含まれず、原因（本体のsandboxが`.git`の下への書込みを既定で禁じる等）は確かめていない。
  - この操作は、利用者の手順で`start`の前に専用worktreeを作る段である。原因が本体のsandboxの既定の禁止なら、Bashをsandboxの中で動かす利用者の環境では、ASCの`start`まで進めないことになる（未確認。測定の結果ではない）。

## 費用・トークン・時間

| | probe 1回目 | probe 2回目 | 是正のレビュー（2回） |
| --- | --- | --- | --- |
| 費用（USD） | 0.35（台帳1 0.3473） | 0.23（台帳2 0.2318） | Claude Code（opus）2 session、台帳の外 |
| 入力（入力＋cache、トークン） | 約115万 | 約7.6万（cacheの読込み 5.1万、作成 2.4万） | |
| 出力（トークン） | 約1.05万 | 約1.30万 | |
| 時間 | 2.4分 | 1.3分（`wallMs` 79,489） | 約4.6分＋約5分 |

- 2つの台帳の合計0.58 USD（このIssueの割当て10 USD、停止の線9 USD）。

## 隔離と後片付け

- 目印fileは2回とも`markers.mjs create`で作り、probeの後に`markers.mjs remove`で消した（失敗しても消すscriptで実行）。2つとも無いことを`ls`で確かめた。目印のために作られた空のdirectory（`.agent-skill-chain/local/`）も消した。
- 試行の外へ書こうとしたfile（`/private/tmp/claude-<uid>/`・runs root・`/private/var/tmp/`）は無かった。
- token fileは中身を表示せず、手順どおりenvへ渡しただけである。

## 限界

- 未判定で測定していないので、固有ルールの読込み・`start`の実行・規則の遵守・該当しない依頼での不読込みの値はない。
- 1の直し方（短いruns root）が効くことはprobeの2回目で確かめた（一時directoryの警告なし、成功すべきBashが成功）。`worktree-create`の失敗の原因は確かめていない。
- 3回目の独立レビューのLow：L2（READMEの文の誤り）は固定の前に直した。L1（probeにkeychainとclipboardのsandboxなしの比較の値が無い）は[config/README.md](config/README.md)の限界に書いた。L3（sandbox-check.jsonが利用者の環境のmetadata：keychainの項目の有無、clipboardの長さ、process数を公開する。秘密ではない）は直していない。
