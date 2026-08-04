# Codex バックグラウンドタスク運用ポリシー

> 正本: 本ファイル。AGENTS.md 本体は行数上限（150行）の制約上、本運用手順の詳細を持たない。
> `.agent-skill-chain/` の対象範囲（Coordination Backend・セグメント・ゲート）そのものではなく、
> 進行役がアドバイザー役としてCodexを呼び出す際の実測確認義務を扱う付随ポリシーである。

## 対象範囲

進行役が独立調査等のためアドバイザー役としてCodex（`codex:codex-rescue` 等のサブエージェント経由）
を呼び出すと、内部のcodex-companionランタイムがホスト上にバックグラウンドプロセス群
（`app-server-broker.mjs`・`codex app-server`・`codex-code-mode-host` 等）を起動する。呼び出し元の
サブエージェント自体が数十秒で完了報告を返しても、これらのプロセスがその後もホスト上に残存し、
経過時間（wall clock）に対しCPU時間がほぼ増加しない停止状態のまま何時間も残り続ける場合がある
（2026-08-02、5時間19分の残存を実測で確認した実例あり）。完了報告のみを根拠に「動いているはず」
「終わったはず」と判断してはならず、進行役は本ファイルの手順で実測確認する。

同一ホスト上では複数の並行セッションが別々のworktreeでCodexを起動している場合があり、
プロセス名だけでは自セッションの起動プロセスと他セッションの起動プロセスを区別できない。

## 定期的な生存確認手順

```bash
ps -eo pid,etimes,cputimes,lstart,args | grep -E 'app-server-broker\.mjs|codex app-server|codex-code-mode-host' | grep -v grep
```

- `etimes`: 起動からの経過秒数（wall clock）
- `cputimes`: 累積CPU使用秒数
- `lstart`: 起動時刻（絶対時刻）
- 起動時cwd: 上記で得たPIDについて `readlink -f /proc/<PID>/cwd` を実行する

進行役は、Codexへ独立調査等を委任し完了報告を受けた後、上記コマンドで対象プロセスが実際に
終了しているか、または正常に稼働中かを実測で確認する。

## ハングとみなす判定基準

以下の2条件を両方満たした場合をハングとみなす。

1. 経過時間（`etimes`）が10分（600秒）以上
2. 一定間隔（10分以上）を空けて取得した2回の `cputimes` が変化していない（増加していない）

条件1のみ（1回サンプルでの経過時間・CPU時間の比較）は初動の一次スクリーニングに留め、断定判断は
条件2（2回サンプルの差分）で行う。`cputimes` が長時間ゼロ近傍でも、直近に本アドバイザー呼び出しを
行っていない別セッションの待機中プロセス（次のリクエストを待つ正当な待機状態）まで一律にハング
扱いしないよう、必ず自worktreeのcwdで絞り込んだ上で判定する（後述）。

判定手順の具体例:

```bash
# 1回目のサンプル
ps -eo pid,etimes,cputimes,args | grep -E 'app-server-broker\.mjs|codex app-server|codex-code-mode-host' | grep -v grep > /tmp/codex-ps-1.txt

# 10分以上待って2回目のサンプル
ps -eo pid,etimes,cputimes,args | grep -E 'app-server-broker\.mjs|codex app-server|codex-code-mode-host' | grep -v grep > /tmp/codex-ps-2.txt

# 同一PIDについて、経過時間の差分>=600秒かつCPU時間の差分がほぼ0ならハング確定
```

機械的に行いたい場合は `.agent-skill-chain/scripts/codex-hang-check.sh`（任意の補助スクリプト）が
使える。

```bash
# 一次スクリーニング（自worktreeのcwdに限定することを推奨）
.agent-skill-chain/scripts/codex-hang-check.sh check --cwd "$(pwd)"

# 確定判定（2回サンプルの比較）
.agent-skill-chain/scripts/codex-hang-check.sh compare --before /tmp/codex-ps-1.txt --after /tmp/codex-ps-2.txt --cwd "$(pwd)"
```

## ハング確定後のプロセス終了手順

無関係な別セッションの正当なプロセスを誤って停止させないよう、cwdと起動時刻で対象を絞り込んだ
上でのみ終了させる。

1. 対象PIDの起動時cwd（`readlink -f /proc/<PID>/cwd`）を確認し、今回の作業で使用したworktree
   パスと完全一致することを確認する。他worktree・他セッションのcwdであれば対象外とし、
   絶対に終了させない。
2. `.agent-skill-chain/scripts/codex-hang-check.sh kill --cwd <worktreeパス> --dry-run` で、
   cwd不一致のプロセスを自動的に除外した対象一覧をまず確認する（`--cwd` は必須引数であり、
   省略した場合は安全側にエラーで停止する）。
3. 対象一覧が意図通りであることを確認した上で `--dry-run` を外して再実行し、実際に
   `SIGTERM` を送る。本スクリプトは実機の `ps` を対象にする場合、自分自身（本スクリプトの
   実行プロセス）の祖先プロセスを、cwd・パターンが一致していても自動的に除外する（実機検証で、
   検索patternの文字列が呼び出し元シェル自身の引数へ偶然含まれ、かつcwdも一致してしまい、
   進行役自身の実行プロセスを誤って対象にし得ることを確認したための安全弁）。
4. `SIGTERM` 送信後、数秒待って対象PIDが実際に消えたことを `ps -p <PID>` で確認する。残存する
   場合のみ `kill -9`（`SIGKILL`）を手動で検討する（自動送信はしない）。

## ハング検知後の標準対応判断基準

- 1回目のハング検知: プロセスを終了し、同一の調査依頼を1回だけ再試行してよい。
- 再試行後も同一プロセス群が同様のハング兆候を示した場合: 再試行を打ち切り、fableアドバイザー
  への切替、または進行役自身がBash・Read等の直接ツールで調査する方式へ切り替える。
- ハングの再現性が高い（同一操作で複数回発生）場合は、本運用手順の限界を超える既知の不具合の
  疑いがあるため、Issueとして起票し、Codex呼び出しの既定運用（使用可否・バックグラウンド実行の
  要否）自体の見直しを検討する。

## 検証記録（Issue #336）

本ファイル・`.agent-skill-chain/scripts/codex-hang-check.sh` の手順は、本Issueのworktree上で
以下を実機確認した。

- 経過時間>=600秒かつCPU時間がほぼ増加しない模擬プロセスを、上記の一次スクリーニング・2回
  サンプル比較の両方式で正しく検知できること。
- cwdが異なる（他セッション相当の）模擬プロセス・実プロセスの両方について、終了対象から
  確実に除外されること。実機での検証中、検索patternの文字列を含む呼び出し元シェル自身が
  誤って終了対象に選ばれ得る実例を発見し、上記「本スクリプト実行プロセス自身の祖先を除外する
  安全弁」を追加した上で、意図した対象（cwdが一致する実プロセス）のみが終了され、
  かつ進行役自身の実行プロセスは終了されないことを確認した。
