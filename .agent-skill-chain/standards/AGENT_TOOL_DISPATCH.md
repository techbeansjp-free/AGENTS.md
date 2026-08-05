# Agent tool dispatch 運用手順

## 目的・対象

本手順は、Claude Code CLIセッションの進行役が、`claude` adapterのsegment workerを同一セッションのサブエージェントツリーで可視化して実行する場合に適用する。新方式は`worker.agent_tool_dispatch.enabled: true`を人間が明示した場合だけ利用し、既定値`false`では従来のheadless subprocess起動を維持する。

## 前提・用語

- dispatch: `worker-launch.sh`がworkerプロセスを直接起動せず、Agent tool呼び出しに必要な固定メタデータを返す状態。
- dispatch一時ディレクトリ: `contract.md`、`contract.sha256`、`renew.pid`を保持するworktree外の`chmod 700`ディレクトリ。
- 入力はIssue IDとsegment名、出力はdispatch指示または既存起動方式の完了結果である。
- Claude Code CLIセッション判定、`claude` adapter、明示opt-inの3条件が一つでも欠ける場合は本手順を使わない。

## 実行手順

1. `.agent-skill-chain/scripts/worker-launch.sh <issue_id> <segment>`を実行する。
2. 終了コード`4`と`AGENT_TOOL_DISPATCH_REQUIRED`を受け取った場合、出力された固定プレフィックス行`ISSUE_ID=`、`DISPATCH_TEMP_DIR=`、`CONTRACT_SHA256=`、`CONTRACT_LINES=`を保持する。contract本文は標準出力へ現れない。
3. Agent toolを`subagent_type: agent-skill-chain-worker`、`run_in_background: false`で1回呼び出す。promptにはworker-launch出力の定型文と`contract.md`の絶対パスだけを渡す。
4. サブエージェントは指定された`contract.md`をReadツールではなくBashツールの`cat`で読み、標準出力全体を要約・改変せず動作契約として実行する。別のAgentへ再委譲しない。
5. サブエージェントの最終応答は完了状態、target SHA、簡潔な1文要約だけに限定し、成果物本文、diff、引用を含めない。
6. Agent tool完了後、`.agent-skill-chain/scripts/worker-launch-verify.sh <ISSUE_IDの値> <DISPATCH_TEMP_DIRの値>`を実行する。verifyはrenewデーモン停止、contractのSHA256・行数照合、worker reportとHEAD SHAの照合、lease解放を行う。

## 出力・完了条件

- `worker-launch.sh`: `4`はdispatch要求であり、worker完了ではない。`0`は非dispatch経路の完了、`3`はhuman adapterのdeferred、その他はエラーである。
- `worker-launch-verify.sh`: `0`だけが完了を表す。`1`は引数不正または対象worktree解決不能、`2`はblocked報告とlease解放を伴う検証失敗である。
- 完了条件は、worker reportが`completed`でtarget SHAが対象worktreeのHEADと一致し、verifyが`0`を返すことである。

## 制約・異常時の扱い

- dispatch後にAgent toolまたはverifyを実行できない場合、推測で完了扱いにしない。renewデーモンは最大待機時間で停止し、その後はwriter lease TTL、reclaim、resumeの既存回復経路に委ねる。
- `ASC_DISPATCH_MAX_WAIT_SEC`既定14400秒を超える正常なAgent tool実行はサポート対象外である。
- `contract.md`の監査値不一致、worker report未報告、status不一致、target SHA不一致はすべてblockedとする。
- 未決事項はない。Codex adapter、human adapter、gate reviewerのAgent tool可視化は対象外である。
