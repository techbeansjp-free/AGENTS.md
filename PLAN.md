# PLAN: agent-skill-chain Tier 1 — adapters launch_worker（spec/design/implementation/validationワーカー起動）の実装計画

- Issue: `ISSUE-166`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `worker`設定セクション新設 | `.agent-skill-chain/schemas/config.schema.yaml`・`.agent-skill-chain/config/agent-skill-chain.yaml`・`src/lib/config.ts`（`AgentSkillChainConfig`型）へ`worker: {adapter: claude\|codex\|human}`（既定`human`）を追加する。`review.adapter`と対称の追加のためmigrationはoptionalフィールド追加のみ | `AC-1` | なし |
| 2 | `lease acquire`: issue横断コンフリクト検査 | `src/commands/lease.ts`のGitHubモード`acquire()`へ、`activeLeaseFor(number, segment, root)`による既存の同一segment判定に加え、`listLeaseComments(number, root)`で同issue内の**他segment**の有効leaseも検出し拒否する分岐を追加する。ローカルモードは既存の1ファイル/issue構造により対応済みのため変更しない | `AC-2` | なし |
| 3 | `lease acquire`: `wip.limit`事前チェック | ローカルモード=`issues/*/.agent-skill-chain/lease.yaml`のうち`expires_at > now`件数、GitHubモード=`writer-lease:active`ラベル付きopen issue件数を数え、`wip.limit`以上なら`acquire()`を拒否する。`release()`成功時に同ラベルを除去する処理も追加する | `AC-8` | `#2` |
| 4 | `worker-launch.sh`新設 | `.agent-skill-chain/scripts/worker-launch.sh`を`gate-launch-reviewer.sh`と対称の構造で新設する（`worker.adapter`解決→adapter source→`launch_worker`呼び出し→終端コード安全網） | `AC-1`, `AC-7` | `#1` |
| 5 | `claude.sh`: `launch_worker`実装 | DESIGN.mdの「claude adapter」節に従い、lease取得→`segment start`→`WORKER_CMD`起動（`timeout`＋renewループ＋PID監視）→完了確認（`report-status`直近レコード突合）→解放・報告を実装する。`WORKER_CMD`/`WORKER_TIMEOUT_SEC`のデフォルト値は実機の`claude` CLIで書込み許可フラグを検証してから確定する | `AC-1`, `AC-2`, `AC-3`, `AC-4`, `AC-7`, `AC-9` | `#1`〜`#4` |
| 6 | `codex.sh`: `launch_worker`実装 | lease取得を行わず、即座に`report_status blocked`（理由: 未構成）＋`exit 2`で返すfail-safe実装。将来のCodex実行系結線に向けた拡張ポイントコメントを付す | `AC-1`, `AC-5` | `#1` |
| 7 | `human.sh`: `launch_worker`実装 | lease取得→`segment start`→通知（`gh issue comment`＋`worker:<segment>:awaiting-human`ラベル／ローカルmarker）→`exit 3`（deferred、release無し）。通知本文に`lease renew`／完了時手順（`checkpoint`→（specのみ）`pr create`→`report status`→`lease release`）を明記する | `AC-1`, `AC-2`, `AC-3`, `AC-6`, `AC-9` | `#1`〜`#4` |
| 8 | 3 adapterの冒頭コメント更新 | 「launch_worker 相当は別途設計・実装が必要なため対象外」という記述を、実装済み・#166参照に更新する | `AC-1` | `#5`〜`#7` |
| 9 | テスト追加 | `test/integration/gate-adapters.test.ts`と対称の`test/integration/worker-adapters.test.ts`を新設し、`WORKER_CMD`をstubに差し替えてbash経由で`worker-launch.sh`を駆動する。少なくとも以下を検証する: (a) claude成功時のexit 0・lease解放・`report_status completed`、(b) claude timeout/認証未設定時のexit非0非3・lease解放・`report_status blocked(human_escalation_requested=true)`、(c) codexの即blocked・exit 2・lease未取得のまま、(d) humanのexit 3・lease未解放・通知内容、(e) `wip.limit`到達時の`lease acquire`拒否、(f) 同issue内の他segment lease保持時の`lease acquire`拒否 | `AC-1`〜`AC-9`（`automated`分） | `#1`〜`#8` |
| 10 | 既存テスト回帰確認 | `npm test`を実行し、既存`launch_gate_reviewer`関連テスト（`gate-adapters.test.ts`等）・`lease-renew.test.ts`・`github-lease.test.ts`が無破壊であることを確認する | `AC-10` | `#1`〜`#9` |

## 実装順序の見直しについて

`#2`（issue横断コンフリクト検査）と`#3`（wip.limit検査）はどちらも`src/commands/lease.ts`の`acquire()`内であるため、実装時に1コミットへ統合してもよい（設計要素としては別関心事のため本ファイルでは分けて記載した）。`#5`〜`#7`（3 adapterの`launch_worker`本体）は`#1`〜`#4`共通基盤の完成後であれば並行実装可能である。作業順序のみを見直す場合は本ファイルのみを更新すればよく、`DESIGN.md`の更新は不要である。
