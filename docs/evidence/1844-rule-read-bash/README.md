# Bashがある環境での固有ルールの読込み（#1844）：結果

開発時の検証資料であり、配布対象に含めない。設定と手順は[config/README.md](config/README.md)、判定の規則は[config/decision-criteria.md](config/decision-criteria.md)。

## 状態（2026-11-28）

- **未測定。隔離の確認（probe）の1回目が不合格で、15試行は行っていない。** 規則で許される1回のやり直しは使っていない（下の「やり直さなかった理由」）。
- 固有ルールが読まれるかの結果はまだない。#1840のBashなしの下限（`money.md`の読込み R 1/6、C 0/6）と並べる値もない。
- 最初の固定は`59dc321d`（[config/results/fixation-1.json](config/results/fixation-1.json)、台帳`889bb6f5`。probe 1の後の是正で固定をやり直した：[config/README.md](config/README.md)の「probeの1回目の後の是正」）。条件RはGitHub Release v0.5.128（固定の直前の`gh release list`でLatest。v0.5.123から更新し、dry runを取り直して全15項目が合格）。
- 生の記録（`/private/var/tmp/asc-eval-1844/`）はcommitしていない。

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

## やり直さなかった理由

規則で許されるやり直しは1回である。2の原因は本体の許可の判定で、同じ設定なら同じに起こると見られる（1回の観察による。試行の中の`ps`だけが止まり、ほかの35のBashは自動許可で動いた）。1の原因だけを直してやり直しても`processList`で不合格になり、やり直しの1回を使い切る。このため、やり直しを残して止めた。

- 進行役が決めること：(a) 2の直し方（`refix`か固定のやり直しか）とそのレビュー、(b) 1の直し（runs rootを短くする）を手順に入れること、(c) そのうえで残りの1回のprobeを行うか。
- 2つとも直さずにやり直すなら、probeは2回とも不合格になり、結果は「未判定（隔離の確認に合格する環境を用意できなかった）」になる。

## 費用・トークン・時間

| | probe 1回 |
| --- | --- |
| 費用（USD） | 0.35（台帳 0.3473） |
| 入力（入力＋cache、トークン） | 約115万（cacheの読込み 112.1万、作成 3.3万） |
| 出力（トークン） | 約1.05万 |
| 時間 | 2.4分（`wallMs` 143,289） |

- 台帳の合計0.35 USD（このIssueの割当て10 USD、停止の線9 USD）。
- 見込み（probe 0.38 USD、入力22万）より入力が多い。cacheの読込みが42操作の往復で積み上がった。

## 隔離と後片付け

- 目印fileは`markers.mjs create`で作り、probeの後に`markers.mjs remove`で消した（失敗しても消すscriptで実行）。2つとも無いことを`ls`で確かめた。目印のために作られた空のdirectory（`.agent-skill-chain/local/`）も消した。
- 試行の外へ書こうとしたfile（`/private/tmp/claude-<uid>/`・runs root・`/private/var/tmp/`）は無かった。
- token fileは中身を表示せず、手順どおりenvへ渡しただけである。

## 限界

- 未測定なので、固有ルールの読込み・`start`の実行・規則の遵守・該当しない依頼での不読込みの値はない。
- 1の直し方（短いruns root）が効くかは、モデルを呼ぶprobeで確かめていない。
- 3回目の独立レビューのLow：L2（READMEの文の誤り）は固定の前に直した。L1（probeにkeychainとclipboardのsandboxなしの比較の値が無い）は[config/README.md](config/README.md)の限界に書いた。L3（sandbox-check.jsonが利用者の環境のmetadata：keychainの項目の有無、clipboardの長さ、process数を公開する。秘密ではない）は直していない。
