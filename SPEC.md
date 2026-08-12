<!--
このファイルはAGENTS.mdが定める4セグメント・4ゲートの規約に基づく雛形であり、Issue毎に複製して使う（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: worker完了確認がreported_sha != started_shaの場合に祖先関係を検証せずrollback/履歴書き換えを正当な新規作業として誤通過させる

- Issue: `ISSUE-671`
- 作成者: `spec_worker`
- 対象ブランチ: `process/671-worker-completion-ancestor-check`

## 目的・背景

Issue #644（PR #668）で追加した無変更completed検出は、`_verify_worker_completion_report`
（`.agent-skill-chain/adapters/claude.sh`）において `reported_sha == started_sha`（dispatch開始
後に1コミットも積まれていない）の場合にのみ `no_change` 宣言と具体的理由を要求する。

一方 `reported_sha != started_sha` の場合、現行実装はこの差分が「着手時SHAの上に正当に
commitが積まれた結果」であることを一切検証せず、無条件で既存の完了判定（`target_sha ==
現在HEAD` の形式的一致のみを見るAC-4相当の従来経路）へ進めてしまう。dispatch開始後に
workerが `git reset --hard <started_shaの祖先ではない任意のcommit>` を実行したり、rebase・
amendによって履歴を書き換えたりした結果、HEADがstarted_shaと異なる任意のSHAになった
場合でも、そのSHAとcurrent HEADが一致してさえいれば完了確認はpassする。

これは、Issue #644自身が「無変更completedの自己申告を検出できない」という穴を塞ぐ目的で
あったにもかかわらず、その実装が「SHA不一致だけを根拠に正当な新規作業と判定する」という
同種の未検証ギャップを新たに残した状態である。祖先関係を検証しないため、rollback・履歴
書き換えという安全性に関わる事象が、要求された差分が正しく積まれた正常な完了報告と
機械的に区別できない。

これは進行役が成果物の中身を判断しないという役割分担（I5）を否定するものではない。意味的な
妥当性判断（history rewriteが正当な理由に基づくか）は引き続き人間・ゲートレビューの責務だが、
「reported_shaが着手時SHAの子孫であるか」という**機械的事実**の検査自体が現状存在しない
という構造的ギャップが問題である。安全側ラチェット（I8）に照らせば、この機械的事実を検証
できない・または不成立と判明した場合は、無条件passではなく安全側（blocked）へ倒すべきである。

`_verify_worker_completion_report` は `worker-launch-verify.sh`（Agent tool dispatch経路）から
も呼び出される唯一の完了判定関数であり、本Issueが対象とする検証ギャップはこの単一の関数に
閉じている。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。
AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

`reported_sha != started_sha` の場合であっても、`started_sha` が `reported_sha` の祖先で
あること（`git merge-base --is-ancestor "$started_sha" "$reported_sha"` 相当の祖先関係）を
検証し、祖先関係が成立しない場合、または祖先関係の判定自体が実行不能な場合は、安全側で
blocked（I8）へ倒す。これにより「dispatch開始時点のSHAの上にcommitが積まれた」という
主張自体の機械的な裏付けを取り、rollback・履歴書き換えを正当な新規作業として誤認しない。

### 要件

- 要件1: `_verify_worker_completion_report`（およびこれを呼び出す `worker-launch-verify.sh`
  等、同等の完了判定を行う全経路）は、`reported_sha != started_sha` の場合に `started_sha`
  が `reported_sha` の祖先であるかどうかの祖先関係検証を行う。
- 要件2: 祖先関係が成立しない場合（`git reset --hard`・rebase・amend等の履歴書き換えにより
  `started_sha` が `reported_sha` の祖先でなくなっている場合）、既存の完了判定へ進めず、
  安全側（blocked + `human_escalation_requested: true` + writer lease解放）へ倒す。
- 要件3: 祖先関係の判定自体が実行不能な場合（`started_sha`・`reported_sha` のいずれかが
  現在のリポジトリにobjectとして存在しない、祖先判定コマンドが異常終了する等）も、未知は
  安全側（blocked）として扱う。
- 要件4: 祖先関係が成立する場合（`started_sha` の子孫として `reported_sha` が正当に積まれて
  いる場合）は、既存の完了判定（他の既存チェック：report鮮度・dispatchトークン一致・SHA
  形式検証等）へ進める。既存の正当な新規commit経路の完了報告を後退させない。
- 要件5: `reported_sha == started_sha`（無変更completed）の場合の既存判定（Issue #644で
  追加済みの `no_change` 宣言・具体的理由の必須化）は変更しない。本Issueの祖先関係検証は
  `reported_sha != started_sha` の場合にのみ適用する。
- 要件6: 既存の完了確認が行っている他の安全側チェック（report鮮度、dispatchトークン一致、
  contract整合性、started_sha自体のSHA形式検証等）は、本Issueの変更によって後退させない。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える。

#### AC-1: rollback（started_shaの祖先でないreported_sha）はblockedへ倒れる

- Given: あるIssueのsegmentについてworkerがdispatchされ、着手時SHAがXとして記録されている
- When: workerが（誤操作・バグ等により）`git reset --hard` でXの祖先ではない任意のcommit
  Y（Y ≠ X、かつXはYの祖先ではない）へHEADを移動し、`target_sha=Y` の `completed` を報告する
- Then: 完了確認は自動passせず、blocked（`human_escalation_requested: true`）へ倒れ、writer
  leaseが解放される
- 検証方法見込み: `automated`

#### AC-2: rebase/amendによる履歴書き換え（started_shaを含まない新しい履歴）もblockedへ倒れる

- Given: あるIssueのsegmentについてworkerがdispatchされ、着手時SHAがXとして記録されている
- When: workerがrebase/amend等によりXを含まない新しい履歴を構築し、その結果できたcommit
  Z（Zの祖先にXが含まれない）を `target_sha=Z` として `completed` を報告する
- Then: 完了確認は自動passせず、blocked（`human_escalation_requested: true`）へ倒れる
- 検証方法見込み: `automated`

#### AC-3: started_shaの子孫として正当に積まれたcommitは従来通り通過する（回帰なし）

- Given: あるIssueのsegmentについてworkerがdispatchされ、着手時SHAがXとして記録されている
- When: workerがXの上に1つ以上commitを積み、HEADがY（XがYの祖先）になり、`target_sha=Y`
  の `completed` を報告する
- Then: 完了確認は（他の既存チェックが全てpassする前提で）passする
- 検証方法見込み: `automated`

#### AC-4: 祖先関係の判定自体が実行不能な場合は安全側でblockedへ倒れる

- Given: 着手時SHA Xが記録されているが、当該SHAが現在のリポジトリにobjectとして存在しない、
  または祖先関係判定コマンドが異常終了する状況にある
- When: workerが `target_sha=Y`（Y ≠ X）の `completed` を報告し、完了確認が実行される
- Then: 祖先関係を判定できないため、完了確認は自動passせずblockedへ倒れる
- 検証方法見込み: `automated`

#### AC-5: reported_sha == started_sha（無変更completed）の既存動作に回帰がない

- Given: Issue #644で追加済みの無変更completed検出ロジックの対象条件
  （`reported_sha == started_sha`）を満たす `completed` 報告が行われる
- When: 完了確認を実行する
- Then: 本Issueで追加する祖先関係検証は `reported_sha == started_sha` のケースの判定経路に
  影響を与えず、既存の無変更検出ロジック（`no_change` 宣言・具体的理由の必須化）のみで
  判定される
- 検証方法見込み: `automated`

## スコープ外

- 検出したrollback・履歴書き換えを自動修復すること（安全側でblockedへ倒すのみで、修復は
  人間・進行役の判断に委ねる）。
- Codex/human adapter等、`claude.sh` 以外の別実装における同種チェックの新規追加（本Issueの
  対象は `_verify_worker_completion_report` およびこれを呼び出す `worker-launch-verify.sh`
  等の既存経路のみ）。
- 意味的妥当性判断（履歴書き換えが正当な理由に基づくものかどうか）——引き続き人間・ゲート
  レビューの責務であり、本Issueでは自動化しない。
- 祖先関係検証以外の新規安全側チェックの追加。
- 過去（本Issue適用前）に既に投稿・判定済みのcompleted報告を遡って再判定すること。
