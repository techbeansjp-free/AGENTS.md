# PLAN: human gateのtrusted session復帰を実装する

- Issue: `ISSUE-278`
- 対応する DESIGN: `DESIGN.md`

## 目的・依存・出力

承認済みSPEC/DESIGN/ADRを入力とし、GitHub正準session、初回trusted通知、manual submit、
Strict耐久slot、full-set digest、human adapter renderer、配布同期と自動テストを出力する。
Issue #277のStrict provenance/schema/純粋aggregationを先にmainへmergeし、本branchをrebaseする。
依存が無い状態で類似aggregatorを複製せず、rebase後の契約不一致はdesignへ差し戻す。

## 実装順序

| # | 変更単位 | 内容 | AC-ID | 依存 |
|---|---|---|---|---|
| 1 | 依存統合 | #277をrebaseしStrict report・aggregator APIを固定 | AC-6 | なし |
| 2 | session domain | versioned record、状態遷移、canonical digest、replay判定 | AC-2, AC-3, AC-8 | #1 |
| 3 | context guard | backend/adapter/PR/repo/head/branch/Issue/profile/Check Appを検証 | AC-2, AC-7 | #2 |
| 4 | artifact resolver | segment output＋差分からfull-setを導出しGit object digest化 | AC-4, AC-5 | #3 |
| 5 | Check repository | 親/slot作成、同一ID CAS相当、再読確認、terminal更新 | AC-1〜AC-6 | #2〜#4 |
| 6 | trusted CLI | `gate human-open-session`と`gate human-submit`を追加 | AC-1〜AC-7 | #5 |
| 7 | 初回workflow | default CLIだけを実行する`pull_request_target`入口を追加 | AC-1, AC-2, AC-7 | #6 |
| 8 | 復帰workflow | quoted stdin、共通concurrency、最小権限のdispatchを追加 | AC-2〜AC-8 | #6 |
| 9 | adapter・配布 | humanを通知renderer化し、templateと展開先を同期 | AC-1, AC-7, AC-8 | #7, #8 |
| 10 | 検証 | unit/integration/security/template/full regressionを保存 | AC-1〜AC-8 | #1〜#9 |

## BDD conformance・falsification

| Given | When | Then | AC-ID |
|---|---|---|---|
| same-repo human PR | 初回event | default CLIが同じ親Checkへcommandを記録しPR codeを実行しない | AC-1 |
| closed/external/stale PR | open/submit | API write前に非0となり既存Checkを変更しない | AC-2 |
| adapter/profile/Check/session不一致 | submit | successをmintせずprovenance errorにする | AC-2 |
| 同じawaiting sessionへ2 submit | barrierで同時実行 | 1件だけがconsumingを取得する | AC-3 |
| consumed session＋同じdigest | replay | 新Check/PATCHなしで既存結果URLを返す | AC-3 |
| consumed session＋異なるdigest | replay | 拒否しterminal結果を維持する | AC-3 |
| started gate | expected artifactsを解決 | 非空full-setの全digestと集合digestを親Checkへ保存する | AC-4 |
| 空・不足・余分・重複・不存在path | approve verdict | successを発行しない | AC-5 |
| malformed/pending/unknown/巨大JSON | submit | shell実行せずvalidation errorにする | AC-5 |
| Strict parent＋slot 1件 | submit | 親はawaiting/action_requiredを維持する | AC-6 |
| Strict＋別actor/別invocation 2 approve | second submit | 共通aggregator後に同じ親Checkをsuccessへ更新する | AC-6 |
| Strict＋同actor/重複slot/別SHA/証跡差 | aggregate | human_requiredで停止する | AC-6 |
| local backend | human open/submit | `gh`を一度も呼ばずlocal reportを変更しない | AC-7 |
| workflow inputsにquote/newline/metachar | dispatch | env→stdinで同じJSONを渡しcommand injectionを起こさない | AC-7 |
| template/target | sync検査 | workflow・adapterがbyte一致し自動adapter差分がない | AC-8 |

## テスト適用性

- unit: canonical JSON/digest、状態遷移、expected-state CAS、replay、path正規化、集約優先順位。
- integration: gh stubで親/slot Check ID、`external_id`、PATCH回数、API障害、head変更、2 process競合を検査。
- workflow security: default branch checkout、PR script非実行、最小permissions、`issues: write`不在、
  input式のshell直展開なし、token/verdict非出力を静的・実行fixtureで検査。
- artifact: 各gateの必須output、追加変更file、削除、空集合、改竄digest、集合順序をfixtureで検査。
- regression: Standard human、Claude Code/Codex、local gate、gate reconcile、ADR finalize、setup/syncを維持する。
- 外部GitHub APIへの破壊的Check発行は行わず、workflow構文と配布後dispatchは統合時に確認する。

## checkpoint・完了条件

design checkpoint後にread-only gateを通し、承認後はADR finalization workerが専用writer leaseでstatusだけを
更新する。implementation workerはwriter leaseを取得し、依存rebase、各変更単位、テストを小さく
commit/pushする。validation workerは全ACのログ、Check遷移、反例、全回帰を`VALIDATION.md`へ保存する。
session field、CAS、権限、Strict入力、artifact集合を変える場合はDESIGN再承認を要する。
