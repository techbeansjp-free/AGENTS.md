# PLAN: worker完了確認のtarget_sha一致チェックが「変更ゼロのcompleted自己申告」を検出できない

- Issue: `ISSUE-644`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `worker-report.schema.yaml`拡張 | `no_change`（boolean、既定false、optional）・`no_change_reason`（string、optional）を`properties`へ追加する。`additionalProperties: false`のため列挙漏れがあると後続の変更単位がすべて失敗する | `AC-2, AC-3, AC-6` | なし |
| 2 | `report status`/`report latest` CLI拡張（`src/commands/report.ts`） | `status()`へ9番目`no_change`（`'true'`文字列のときのみ真）・10番目`no_change_reason`の位置引数を追加しreport objectへ組込み。`latest()`の出力へ`no_change=<true/false>`・`no_change_reason_present=<true/false>`（理由の生テキストは返さない）を追加。USAGE文言も更新する | `AC-2, AC-3, AC-6` | `#1` |
| 3 | dispatch経路の着手時SHA記録（`.agent-skill-chain/adapters/claude.sh`） | `_dispatch_via_agent_tool`は`contract.sha256`へ`STARTED_SHA=<git rev-parse HEAD>`を追記。`launch_worker`直接起動経路はworker起動直前に`git rev-parse HEAD`をローカル変数へ記録し、SHA取得失敗時は`_fail_blocked`へ倒す | `AC-1, AC-4, AC-5` | なし |
| 4 | `_verify_worker_completion_report`判定ロジック拡張（同ファイル） | 新規引数`started_sha`を追加。既存の`target_sha`一致チェックとdispatchトークン一致チェックの間へ、DESIGN.mdの状態遷移図に定めた判定ブロック（started_sha形式検査 → `target_sha`との差分判定 → 一致時のみ無変更宣言・理由存在の検証）を挿入する。呼び出し元（`launch_worker`・`worker-launch-verify.sh`）の引数リストも合わせて更新する | `AC-1, AC-2, AC-3, AC-4, AC-5` | `#2, #3` |
| 5 | `worker-launch-verify.sh`のSTARTED_SHA検査・受け渡し | 既存の`INTEGRITY_ERROR`検査チェーン（`CONTRACT_SHA256`一致・`DISPATCH_STARTED_AT`形式・`DISPATCH_TOKEN`非空）へ`STARTED_SHA`の40桁16進数形式検査を追加し、不正・欠落時は既存と同じ`_fail_blocked`経路へ倒す。検査を通過した`STARTED_SHA`を`_verify_worker_completion_report`呼出しへ渡す | `AC-1, AC-5` | `#3, #4` |
| 6 | contract指示文の更新（同ファイル内、`worker_completion_dispatch`ブロックおよびAgent tool`prompt:`文字列） | 既存の「空文字2つとdispatchトークンを追加する」完了報告書式の説明に続けて、「変更が無い場合のみ9・10番目の引数として`true`と具体的理由を追加する」無変更完了報告の書式を追記する | `AC-2, AC-3` | `#1, #2` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

変更単位3（着手時SHA記録）は変更単位1・2と依存関係が無く並行実装可能だが、変更単位4（判定ロジック本体）は両系列（永続化・CLI経路とdispatch経路）の完了を前提とするため、4以降は直列にならざるを得ない。
