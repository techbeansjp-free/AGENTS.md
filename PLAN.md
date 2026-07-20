# PLAN: agent-skill-chain — 完全自走の実効化: ruleset実適用・worker/review adapterのclaude切替実機検証

- Issue: `ISSUE-180`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素 A〜D を、実装セグメントが迷わず実行できる粒度（具体コマンド・確認手順・完了判定）へ分解する。GitHub 保護の本適用（`#3`・`#4`・`#5`）は**共有インフラへの不可逆操作**であり、実行直前にユーザー確認を挟む（後述「注意事項」を必ず参照）。

| # | 変更単位 | 内容・具体手順 | 完了判定 | 対応 AC-ID | 依存 |
|---|---|---|---|---|---|
| 1 | config の adapter 切替 | `.agent-skill-chain/config/agent-skill-chain.yaml` の `review.adapter` と `worker.adapter` を `human`→`claude` に変更する（2行の値変更のみ） | 両行が `claude`。`git diff` が当該2行のみ | `AC-5` | なし |
| 2 | ビルド健全性の先行確認 | `npm run build` を実行し、切替後もビルドが通ることを確認する（config 変更はコードに影響しない想定の確認） | `npm run build` 終了コード0 | `AC-10`（前段） | `#1` |
| 3 | **[要ユーザー確認]** main への正本 ruleset 実適用 | `./.agent-skill-chain/scripts/setup-ruleset.sh techbeansjp-free/AGENTS.md` を実行（正本 `main.json` は無変更）。**実行前にユーザー承認を得る**（注意事項参照） | `gh api repos/techbeansjp-free/AGENTS.md/rulesets` が `[]` でなく `main-protection` が `enforcement: active` で存在 | `AC-1` | なし |
| 4 | 適用 ruleset の required contexts 確認 | `gh api repos/techbeansjp-free/AGENTS.md/rulesets/<id> --jq '.rules[]\|select(.type=="required_status_checks").parameters.required_status_checks'` で内容を照合 | `agent-skill-chain/spec-gate`・`design-gate`・`implementation-gate`・`validation-gate`・`verify` の5コンテキストがすべて含まれる | `AC-2` | `#3` |
| 5 | **[要ユーザー確認]** 統合ブランチへの branch protection 実適用 | DESIGN.md「採用案の具体コマンド案」の `gh api -X PUT .../branches/chore/162-agent-skill-chain-bootstrap/protection --input -`（5 required contexts・`enforce_admins:false`・`required_pull_request_reviews`・`restrictions:null`）を適用する。**実行前にユーザー承認を得る** | `gh api .../branches/chore/162-agent-skill-chain-bootstrap/protection` が 404 でなく protection を返し、`required_status_checks.contexts` に5コンテキストが含まれる | `AC-3` | なし |
| 6 | main・統合ブランチ双方の保護状態の実測確認 | `main`（`.../rulesets` と PR の `statusCheckRollup`）と統合ブランチ（`.../branches/<branch>/protection`）の双方で required check がマージ条件になっていることを API で確認する | 双方で required check 未達 PR がマージ不可になる状態であることを実測（統合ブランチの 404 が解消済み） | `AC-3` | `#3`,`#4`,`#5` |
| 7 | **[要ユーザー確認]** 使い捨て失敗 PR による block 実機確認 | 統合ブランチ（推奨、任意で `main` も）を base に、`verify` を確実に失敗させる差分（ライブ対象ファイルへの `lint-vocab` 禁止語混入、または既存単体テスト1件を落とす改変）を持つ使い捨てブランチ `chore/asc-block-probe-<ts>` を作り Draft でない PR を開く。`gh pr view <n> --json mergeable,statusCheckRollup` を取得。**PR 作成自体は使い捨てで自由だが、他者の混乱を避けるため作成をユーザーに一報する** | `mergeable` が `MERGEABLE` でない（required check 未達でブロック）ことを実測 | `AC-4` | `#3`,`#5` |
| 8 | 使い捨て失敗 PR・ブランチの後始末 | `#7` の PR を `gh pr close <n>`、ブランチを `git push origin --delete <branch>`（およびローカル worktree/branch 削除）で消す | PR が closed、リモート/ローカルに当該ブランチが残らない。`main`・統合ブランチへ未混入 | `AC-4` | `#7` |
| 9 | launch_worker 実機完走（正常経路） | 使い捨て Issue を1件用意し（ローカルバックエンド `coordination.backend: local` の使い捨て作業ツリー推奨）、本物 `claude` CLI・認証情報あり（`ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN`）の下で `.agent-skill-chain/adapters/claude.sh` の `launch_worker <issue_id> spec` を人間介在なく起動し完了まで待つ。標準出力/標準エラーを証跡として保存する | launch_worker が終了コード0で返り、`report latest <issue_id> spec` の直近が `status=completed` かつ `target_sha` = `git rev-parse HEAD`、lease 解放済み | `AC-6`,`AC-7` | `#1` |
| 10 | 正常経路で human_required が発火しないことの確認 | `#9` の report 履歴・gate-report を確認し、フェイルセーフ（`report_status blocked` の `human_escalation_requested` 扱い）が一度も発火していないことを確認する | 正常経路の report 履歴に `blocked`/`human_escalation_requested` が存在しない | `AC-8` | `#9` |
| 11 | human_required 対照確認（真の異常時のみ発火） | 認証欠如を注入して `env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN launch_worker <使い捨てissue> spec` を起動し、`report_status blocked`（`human_escalation_requested=true`・`blocked_reason` に「認証」）が発火し非0非3で返ることを確認する。`#10` と対比する | 異常条件で blocked 発火・非0非3。`#10`（正常=発火せず）との対比が成立 | `AC-9` | `#9`,`#10` |
| 12 | launch_worker 検証物の後始末 | `#9`〜`#11` で作った使い捨て Issue・作業ツリー・lease（ローカル状態ファイルまたは `refs/agent-skill-chain/leases/*`）を除去する（`git worktree remove`／`git push origin --delete` 等） | 検証用 Issue/worktree/lease が残らない | `AC-6`,`AC-9` | `#9`,`#10`,`#11` |
| 13 | 全体回帰確認 | `npm run build && npm test` を実行し、既存テスト（`worker-adapters.test.ts` の認証欠如・起動失敗・完了偽装・target_sha 不一致のフェイルセーフ各テストを含む）が全 pass することを確認する | `npm test` 全 pass（regression なし） | `AC-10` | `#1`,（GitHub本適用は結果に非依存だが全変更反映後に実施） |
| 14 | 証跡の集約 | `#3`〜`#12` の実測ログ・API 出力・report-status 記録を VALIDATION.md（独立検証セグメントの成果物）へ転記できる形で保存・整理する | AC-1〜AC-9 の manual/hybrid 証跡が揃っている | `AC-1`〜`AC-9` | `#3`〜`#12` |

## AC → タスク対応の自己点検

SPEC.md の全 AC が本 PLAN のいずれかのタスクで実現されることを確認する。

| AC-ID | 実現タスク | 検証方法（SPEC 見込み） |
|---|---|---|
| AC-1（ruleset active） | `#3` | manual |
| AC-2（required contexts 5件） | `#4` | manual |
| AC-3（main・統合ブランチ双方で機械強制） | `#5`,`#6` | manual |
| AC-4（使い捨て PR がブロック） | `#7`,`#8` | manual |
| AC-5（adapter=claude） | `#1` | automated |
| AC-6（launch_worker 実機完走） | `#9` | manual |
| AC-7（完走の証跡） | `#9`,`#14` | manual |
| AC-8（正常経路で human_required 不発火） | `#10` | manual |
| AC-9（真の異常時のみ発火＝対照） | `#11`（＋既存 `worker-adapters.test.ts` の automated 部分は `#13` で pass 確認） | hybrid |
| AC-10（既存テスト全 pass） | `#2`,`#13` | automated |

全 AC が対応タスクを持つ（対応漏れなし）。

## 実装順序の見直しについて

`#1`（config 切替）と `#9`〜`#12`（launch_worker 実機）は GitHub 保護群（`#3`〜`#8`）と独立しており並行着手してよい。`#3`（main ruleset）と `#5`（統合ブランチ保護）は相互独立。`#7`（使い捨て失敗 PR）は `#3`・`#5` の本適用後でないと「ブロックされる」ことを確認できない。`#13`（回帰）は全コード/config 変更反映後に行う。作業順序のみの見直しは本ファイルの更新のみでよく、DESIGN.md の更新は不要。

## 注意事項（共有インフラへの不可逆・共有影響操作）

- **使い捨て検証は自由に進めてよい**: 使い捨て Issue/PR/ブランチの作成、ローカルバックエンドでの launch_worker 起動、認証欠如注入、ダミー失敗差分の作成などは一過性で切り戻し可能なため、逐一の確認なく進めてよい。ただし後始末（`#8`・`#12`）は必ず完了させ、`main`・統合ブランチ・WIP 枠へ痕跡を残さないこと。
- **本適用（`#3`・`#5`）の直前はユーザー確認を挟む**: ruleset の本適用（`setup-ruleset.sh` の実行）と統合ブランチへの branch protection 本適用（`gh api -X PUT .../protection`）は、本リポジトリ共有の GitHub 保護設定を変える**不可逆・共有影響のある操作**である。実行直前にユーザーへ「これから何を・どのブランチへ適用するか」を提示して承認を得てから実行すること。切り戻し手順は DESIGN.md「障害・ロールバック考慮」（ruleset は `DELETE .../rulesets/<id>`、branch protection は `DELETE .../branches/<branch>/protection`）に従う。
- **admin merge 運用の温存**: `enforce_admins: false` を維持し、必要時の `gh pr merge --admin` を妨げないこと。required check 未達のブロック状態（AC-3/AC-4 が観測する `mergeable`/`statusCheckRollup`）と admin bypass は別事象である。
- **認証実値の非出力**: launch_worker 検証時、`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` の実値をログ・PR・Issue・証跡へ出力しないこと（adapter のフェイルセーフ設計と同じ非開示原則）。
