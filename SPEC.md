# SPEC: worker完了確認のtarget_sha一致チェックが「変更ゼロのcompleted自己申告」を検出できない

- Issue: `ISSUE-644`
- 作成者: `spec_worker`
- 対象ブランチ: `process/644-worker-completion-nochange-detect`

## 目的・背景

`launch_worker`（`.agent-skill-chain/adapters/claude.sh` の `_verify_worker_completion_report`）お
よび `worker-launch-verify.sh`（Agent tool dispatch経路）が行うworker完了確認は、直近worker
report（`.agent-skill-chain/schemas/worker-report.schema.yaml`）の `status == completed` かつ
`target_sha == git rev-parse HEAD`（現在のpush済みHEAD）という**形式的一致のみ**を検査する。

この検査は、差し戻し（rework依頼）でworkerを再起動した際に「実際には何もcommitせず、
既存のHEADをそのまま `target_sha` として `completed` を自己申告する」ケースを検出できない。
dispatch開始前後でHEADが不変であれば `reported_sha == current_sha` が成立してしまい、
チェックはpassする。要求された差分が一切反映されていない完了報告が、機械的検査を素通りする。

これは進行役が成果物の中身を判断しないという役割分担（I5）を否定するものではない。意味的な
妥当性判断はゲートレビューが担うが、「dispatch開始後に少なくとも1コミットが積まれたか、
積まれていないなら明示的にその旨が宣言されているか」という**機械的事実**の検査自体が
現状存在しないという構造的ギャップが問題である。

実運用（consumer リポジトリの進行役記録）では、spec_workerが「SPEC.mdは既にcommit済みで
変更なし」としてcompleted報告したが、独立検証（grep・HEAD確認）の結果、依頼した追記が
実際には一切反映されていなかった事例が確認されている。HEAD自体が変化していなかったため
SHA比較は作動せず、進行役の手動grep確認でのみ異常を発見できた。

現行実装の事実として、dispatch開始時点で `.agent-skill-chain/adapters/claude.sh` の
`launch_worker` は `dispatch_started_at`（dispatch開始UTC時刻）を生成し、
`dispatch_temp_dir/contract.sha256` へ `DISPATCH_STARTED_AT` として記録している。この記録は
worker report の鮮度検査（報告がdispatch開始より前でないか）にのみ使われており、
dispatch開始時点のHEAD（着手前SHA）自体は記録も比較もされていない。また worker report
スキーマには「変更なしで完了した」ことを明示するフィールドが存在せず、無変更完了と通常完了が
同一の表現になり機械検査で区別できない。

## 要求 → 要件 → 受入条件

### 要求

差し戻し（追記・修正依頼）後のworker completed報告について、「dispatch開始時点のHEADから
1コミットも進んでいない」という機械的事実を、既存の完了確認処理の中で検出し、明示的な
無変更宣言が伴わない限り自動passさせない。安全側判定（I8）として、判定不能な場合も
自動passではなくblocked／human_escalationへ倒す。

### 要件

- 要件1: dispatch開始時点のHEAD（以下、着手時SHA）を、dispatch開始処理（`launch_worker` の
  `dispatch_temp_dir` 作成時点、および `worker-launch-verify.sh` が読む `contract.sha256`
  相当の監査証跡）へ記録する。
- 要件2: `worker-report.schema.yaml` へ、無変更完了を明示宣言するためのフィールド
  （無変更フラグと、その理由を記述する自由記述フィールド）を追加する。両フィールドは省略可能
  とし、既存の completed report（無変更フラグ無し）との後方互換性を壊さない。
- 要件3: 完了確認処理（`_verify_worker_completion_report` および同等の判定を行う経路）は、
  「報告された `target_sha`」が「着手時SHA」と一致する場合（＝dispatch開始後に1コミットも
  積まれていない場合）、無変更フラグが明示的に真でない限り自動passさせず、既存のフェイルセーフ
  経路（blocked報告 + `human_escalation_requested: true` + writer lease解放）へ倒す。
- 要件4: 無変更フラグが真として報告された場合でも、無変更の理由フィールドが空・未指定である
  場合はpassさせず、要件3と同じフェイルセーフ経路へ倒す。理由フィールドが具体的に指定されて
  いる場合に限り、意味的妥当性の判断（その理由が正当かどうか）はゲートレビューの責務として
  完了確認をpassさせる。
- 要件5: 着手時SHA自体が記録・取得できない場合（監査証跡欠落・不正形式等）は、コミット
  ゼロかどうかを判定できないため、未知は安全側（blocked）として扱う。
- 要件6: 既存の完了確認が行っている他の安全側チェック（report鮮度、dispatchトークン一致、
  contract整合性等）は、本Issueの変更によって後退させない。
- 要件7: 1コミット以上が積まれた通常の completed 報告（`target_sha` が着手時SHAと異なる）は、
  無変更フラグの有無に関わらず本チェックの対象にはならず、従来通り他の既存チェックのみで
  判定する。

### 受入条件（Acceptance Criteria）

#### AC-1: 無変更のまま無宣言でcompleted報告した場合はblockedへ倒れる

- Given: あるIssueのsegmentについてworkerがdispatchされ、着手時SHAがXとして記録されている
- When: workerがdispatch開始後に1コミットも追加・pushせず（現在HEADがXのまま）、無変更フラグ
  を付けずに `target_sha=X` の `completed` を報告する
- Then: 完了確認は自動passせず、blocked（`human_escalation_requested: true`）へ倒れ、writer
  leaseが解放される
- 検証方法見込み: `automated`

#### AC-2: 無変更フラグと具体的な理由付きのcompletedは通過できる

- Given: あるIssueのsegmentについてworkerがdispatchされ、着手時SHAがXとして記録されている。
  workerは要求内容を確認した結果、既存の成果物が要件を既に満たしており変更不要と判断した
- When: workerがdispatch開始後にコミットを追加せず、無変更フラグを真とし、具体的な理由を
  伴って `target_sha=X` の `completed` を報告する
- Then: 完了確認はpassする（他の既存チェック（report鮮度・dispatchトークン一致等）が全て
  passしている前提）
- 検証方法見込み: `automated`

#### AC-3: 無変更フラグが真だが理由が空の場合はblockedへ倒れる

- Given: あるIssueのsegmentについてworkerがdispatchされ、着手時SHAがXとして記録されている
- When: workerがdispatch開始後にコミットを追加せず、無変更フラグのみを真とし、理由フィールド
  を空・未指定のまま `target_sha=X` の `completed` を報告する
- Then: 完了確認は自動passせず、blocked（`human_escalation_requested: true`）へ倒れる
- 検証方法見込み: `automated`

#### AC-4: 1コミット以上積まれた通常のcompletedは従来通り通過する（回帰なし）

- Given: あるIssueのsegmentについてworkerがdispatchされ、着手時SHAがXとして記録されている
- When: workerがdispatch開始後に1つ以上commit・pushしHEADがY（Y ≠ X）になり、無変更フラグを
  付けずに `target_sha=Y` の `completed` を報告する
- Then: 完了確認は（他の既存チェックが全てpassする前提で）passする
- 検証方法見込み: `automated`

#### AC-5: 着手時SHAが記録・取得できない場合は安全側でblockedへ倒れる

- Given: あるIssueのsegmentについてdispatchが行われたが、着手時SHAの監査証跡（記録ファイルの
  欠落・不正形式等）が失われている
- When: workerが何らかの `target_sha` を伴う `completed` を報告し、完了確認が実行される
- Then: コミットゼロかどうかを判定できないため、完了確認は自動passせずblockedへ倒れる
- 検証方法見込み: `automated`

#### AC-6: 既存のworker report（無変更フィールド無し・1コミット以上積まれた完了報告）との後方互換性

- Given: 本Issue適用前のスキーマ・形式で作成された、無変更フィールドを含まない過去の
  completed報告が存在し、`target_sha` が着手時SHAと異なる
- When: 完了確認・スキーマ検証を実行する
- Then: 無変更フィールド不在のみを理由にスキーマ検証エラーやblockedにはならず、従来通り
  判定される
- 検証方法見込み: `automated`

## スコープ外

- 要求された変更が実際に正しく反映されているかという意味的な差分内容の妥当性判定（引き続き
  ゲートレビューの責務であり、本Issueでは自動化しない）。
- 過去（本Issue適用前）に既に投稿済みの completed 報告を遡って再判定すること。
- lease失効・`reconcile.sh` による回収処理そのものの変更。
- 完了確認以外の経路（例: ゲートレビュー結果の記録・PRマージ判断）における無変更検出の適用。
- 無変更完了の理由フィールドの内容自体が妥当かどうかを機械的に評価するルール（自由記述の
  受理可否は人間・ゲートレビューが判断する）。
