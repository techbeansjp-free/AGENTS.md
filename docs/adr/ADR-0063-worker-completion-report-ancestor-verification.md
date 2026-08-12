# ADR

```yaml
id: ADR-0063
status: proposed   # proposed | accepted | superseded | deprecated
title: worker完了確認へreported_shaとstarted_shaの祖先関係検証を追加する
tags: [worker-completion, i8-safety, rollback-detection]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

Issue #644（ADR-0062）で追加した無変更completed検出は、`_verify_worker_completion_report`
（`.agent-skill-chain/adapters/claude.sh`。`worker-launch-verify.sh` からも同一関数として
呼び出される、worker完了判定の唯一の関数）において `reported_sha == started_sha`（dispatch開始後に
1コミットも積まれていない）の場合にのみ `no_change` 宣言と具体的理由を必須化した。

一方 `reported_sha != started_sha` の場合、現行実装はこの差分が「着手時SHAの上に正当にcommitが
積まれた結果」であることを一切検証せず、無条件で既存の完了判定（`target_sha == 現在HEAD` の形式的
一致のみを見る経路）へ進めてしまう。dispatch開始後にworkerが `git reset --hard
<started_shaの祖先ではない任意のcommit>` を実行したり、rebase・amendによって履歴を書き換えたり
した結果、HEADがstarted_shaと異なる任意のSHAになった場合でも、そのSHAとcurrent HEADが一致してさえ
いれば完了確認はpassしてしまう。祖先関係を検証しないため、rollback・履歴書き換えという安全性に
関わる事象が、要求された差分が正しく積まれた正常な完了報告と機械的に区別できない。

これは進行役が成果物の中身を判断しないという役割分担（AGENTS.md I5）を否定するものではない。
意味的な妥当性判断（history rewriteが正当な理由に基づくか）は引き続き人間・ゲートレビューの責務だが、
「reported_shaが着手時SHAの子孫であるか」という機械的事実の検査自体が現状存在しないという構造的
ギャップが問題である。安全側ラチェット（AGENTS.md I8）に照らせば、この機械的事実を検証できない・
または不成立と判明した場合は、無条件passではなく安全側（blocked）へ倒すべきである。

検討した代替案:

1. **現状維持（祖先関係を検証しない）**: 実装コストは無いが、確認された構造的ギャップ（rollback・
   履歴書き換えを正当な新規作業と機械的に区別できない）を放置することになり、AGENTS.md I8
   「安全側ラチェット」の趣旨に反するため不採用。
2. **`git log --oneline <started_sha>..<reported_sha>` 等、コミット列挙による検証**: 祖先関係
   だけでなく途中のcommit一覧まで取得できるが、本Issueが必要とするのは「祖先であるか否か」という
   真偽判定のみであり、列挙結果を追加で解析するコストと複雑さに見合う利点が無いため不採用。
3. **（採用）`git merge-base --is-ancestor <started_sha> <reported_sha>` の終了コードのみを根拠に
   3値判定する**。同コマンドは「祖先である」場合に `0`、「祖先でない（到達不能）」場合に `1`、
   いずれかのSHAが有効なcommitとして解決できない等の異常時に `1` 以外の非0値（通常 `128`）を返す、
   という終了コードの区別が仕様上保証されている。この区別をそのまま「pass／祖先不成立でblocked／
   判定不能でblocked」の3分岐へ写像する。実装が最小で、既存の `_verify_worker_completion_report`
   内の他のgit呼び出し（`git rev-parse HEAD`）と同じ慣用形（終了コードを変数へ退避してから分岐）で
   自然に組み込める。

## Decision

`_verify_worker_completion_report`（`.agent-skill-chain/adapters/claude.sh`）内、既存の
`target_sha` とcurrent HEADの一致チェックの直後にある `reported_sha == started_sha`
（ISSUE-644/ADR-0062で追加済みの無変更completed判定）の `else` 側へ、次の祖先関係検証ブロックを
追加する。

1. `reported_sha != started_sha` の場合にのみ、`git merge-base --is-ancestor "$started_sha"
   "$reported_sha"` を実行し、`set -euo pipefail` 環境下でスクリプト全体を異常終了させないよう
   `cmd || rc=$?` 慣用形で終了コードのみを取得する（呼び出し前の時点で、`started_sha` は既存の
   40桁16進数形式検査を通過済みであり、`reported_sha` は既存チェックにより必ずcurrent HEAD
   （実在するcommit）と一致している）。
2. 終了コード `0`（祖先関係が成立）: この検証ブロックをpassし、既存の後続チェック
   （dispatchトークン一致等）へ進む。正当に「`started_sha` の上に1つ以上commitが積まれた」通常の
   完了報告フローに回帰を生じさせない。
3. 終了コード `1`（祖先関係が不成立、到達不能）: fail。「rollback・履歴書き換えの可能性」を示す
   具体的理由文字列を返す。
4. 終了コードがそれ以外の非0値（判定コマンド自体が異常終了、いずれかのSHAがobjectとして解決不能
   等）: fail。「祖先関係を判定できない」ことを示す具体的理由文字列を返す。

`reported_sha == started_sha`（無変更completed）の既存分岐はこのブロックの対象外であり変更しない
（ADR-0062の決定を変更しない）。

呼び出し元（`launch_worker` の直接spawn経路、`worker-launch-verify.sh` のAgent tool dispatch経路）
は、いずれも `_verify_worker_completion_report` の戻り値と理由文字列を既存の `_fail_blocked`
（blocked報告＋`human_escalation_requested: true`＋writer lease解放、ADR-0060で確立済み）へそのまま
渡す既存の汎用エラー伝播機構を持つため、コード変更を要しない。両経路が同一の
`_verify_worker_completion_report` を共有しているため、本Issueが対象とする検証ギャップはこの単一の
関数への変更で両経路に適用される。

## Consequences

**利点**:

- rollback（`git reset --hard`等でstarted_shaの祖先でない任意のcommitへHEADを移動）・
  rebase/amendによる履歴書き換えを、進行役の手動確認に頼らず機械的に検出し安全側（blocked）へ
  倒せるようになる（AGENTS.md I8「安全側ラチェット」の具体化）。
- 正当な「started_shaの上に1つ以上commitを積んだ」完了報告フロー、および無変更completed
  （ADR-0062）フローはいずれも影響を受けない（回帰なし）。
- 変更は `_verify_worker_completion_report` 内の1ブロックの追加に閉じており、schema・CLI引数・
  呼び出し元のコードはいずれも変更しない。問題が発覚した場合は追加ブロックのみのrevertで旧来動作へ
  即座に戻せる。

**欠点・today以降のフォローアップ事項**:

- リポジトリが浅いclone（`git clone --depth=`）である環境では、`started_sha` が実際には祖先で
  あっても history が切り詰められているために `git merge-base --is-ancestor` が誤って `1`
  （不成立）を返し、正当な完了報告を誤ってblockedにする可能性がある。本Issueが対象とするworktree
  （`git worktree add` で作成されたworktree）は通常フルhistoryを持つmain clone由来のため、
  通常運用でこの事象は発生しない想定だが、浅いcloneでの運用は本Issueのスコープ外の既知の限界として
  ここに記録する。必要になれば別Issueで扱う。
- 検出したrollback・履歴書き換えを自動修復する機構は設けない（SPEC.mdのスコープ外）。安全側で
  blockedへ倒すのみで、修復は人間・進行役の判断に委ねる運用が今後も続く。
- 意味的妥当性判断（履歴書き換えが正当な理由に基づくものかどうか）を機械的に評価するルールは
  設けない。祖先関係という機械的事実の検査のみを行い、内容の当否は引き続き人間・ゲートレビューに
  委ねる。
