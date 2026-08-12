# ADR

```yaml
id: ADR-0062
status: proposed   # proposed | accepted | superseded | deprecated
title: worker完了確認へ着手時SHA記録と無変更完了の明示宣言フィールドを追加する
tags: [worker-completion, i8-safety, worker-report-schema]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`launch_worker`（`.agent-skill-chain/adapters/claude.sh`の`_verify_worker_completion_report`）および
`worker-launch-verify.sh`（Agent tool dispatch経路）が行うworker完了確認は、直近worker report
（`.agent-skill-chain/schemas/worker-report.schema.yaml`）の`status == completed`かつ
`target_sha == git rev-parse HEAD`（現在のpush済みHEAD）という形式的一致のみを検査していた。

この検査には構造的なギャップがある。差し戻し（rework依頼）でworkerを再起動した際、workerが
実際には何もcommitせず、既存のHEADをそのまま`target_sha`として`completed`を自己申告した場合、
dispatch開始前後でHEADが不変であれば`reported_sha == current_sha`が成立してしまい、機械的検査は
passしてしまう。要求された差分が一切反映されていない完了報告が検査を素通りする。

実運用（consumerリポジトリの進行役記録）では、spec_workerが「SPEC.mdは既にcommit済みで変更なし」
としてcompleted報告したが、独立検証（grep・HEAD確認）の結果、依頼した追記が実際には一切反映されて
いなかった事例が確認されている。HEAD自体が変化していなかったためSHA比較は作動せず、進行役の手動
grep確認でのみ異常を発見できた。

これは進行役が成果物の中身を判断しないという役割分担（AGENTS.md I5）を否定するものではない。
意味的な妥当性判断はゲートレビューが引き続き担う。問題は「dispatch開始後に少なくとも1コミットが
積まれたか、積まれていないなら明示的にその旨が宣言されているか」という機械的事実の検査自体が
存在しないという構造的ギャップである。

検討した代替案:

1. **`target_sha`のみで判定を続け、無変更ケースの検出を諦める**: 実装コストは最小だが、確認された
   実害（要求未反映の完了報告が機械検査を素通りする）を放置することになり、AGENTS.md I8「安全側
   ラチェット」（判定不能・異常は自動passでなく安全側へ倒す）の趣旨に反するため不採用。
2. **無変更を検出したら常に自動blocked（宣言による救済経路を設けない）**: 「差し戻し確認の結果、
   既存成果物が既に要件を満たしており本当に変更不要」という正当なケース（AC-2相当）まで一律で
   人間エスカレーションになり、SPEC.mdが要求する「理由が正当かどうかの意味的判断はゲートレビューの
   責務」という役割分担と両立しない。workerが変更不要と判断した理由を明示的に記録できないため、
   後続のゲートレビューが判断材料を持てない。不採用。
3. **（採用）着手時SHAをdispatch開始時点で記録し、`target_sha == 着手時SHA`の場合のみ、
   worker report側に追加した`no_change`（無変更フラグ）と`no_change_reason`（自由記述の理由）の
   両方が明示的に指定されていることを完了確認の必須条件とする**。理由が空・未指定の場合は
   フラグのみでは救済せず安全側（blocked）へ倒す。1コミット以上積まれた通常の完了報告は本チェックの
   対象外とし、既存の判定（鮮度・SHA一致・dispatchトークン一致）のみで従来通り判定する。

## Decision

`.agent-skill-chain/schemas/worker-report.schema.yaml`へ`no_change`（boolean、既定false、optional）
と`no_change_reason`（string、optional）の2フィールドを追加する。両方optionalとし、既存の
completed report（両フィールド無し）との後方互換性を保つ。

dispatch開始時点のHEAD（着手時SHA）を記録する経路を、worker起動系統ごとに設ける。Agent tool
dispatch経路（`_dispatch_via_agent_tool`）は、Issue #665で導入済みの監査証跡ファイル
`contract.sha256`（`CONTRACT_SHA256`/`CONTRACT_LINES`/`DISPATCH_STARTED_AT`/`DISPATCH_TOKEN`を
既に保持）へ`STARTED_SHA`を追記する。この経路はworker完了後に別のBash呼び出し
（`worker-launch-verify.sh`）で検証されるため、プロセス境界をまたぐ永続化が必要になる。直接spawn
経路（`launch_worker`）は同一関数呼び出し内でworker完了確認まで完結するため、着手時SHAはin-memory
変数として保持し、ディスクへの永続化は行わない。

完了確認処理（`_verify_worker_completion_report`）は新規引数`started_sha`を受け取る。既存の
`target_sha`一致チェックの直後、dispatchトークン一致チェックの直前に次の判定を挿入する。

1. `started_sha`が空、または想定形式（40桁16進数）に一致しない場合は、コミットゼロかどうかを
   判定できないため安全側（blocked）へ倒す。
2. 報告された`target_sha`が`started_sha`と異なる場合（1コミット以上積まれている）は、この判定
   ブロックを丸ごとskipし、従来通り既存チェックのみで判定する（無変更フラグの有無に関わらず
   本チェックの対象外）。
3. `target_sha == started_sha`の場合（dispatch開始後に1コミットも積まれていない）:
   - `no_change`が真でなければblocked。
   - `no_change`が真でも`no_change_reason`が空・未指定であればblocked。
   - `no_change`が真かつ理由が具体的に指定されている場合のみ、この判定ブロックをpassし、以降の
     既存チェック（dispatchトークン一致等）へ進む。理由の内容自体が正当かどうかの意味的判断は
     行わず、ゲートレビューの責務として引き続き委ねる。

`report latest`（`src/commands/report.ts`）の出力は、`no_change`（true/false）と
`no_change_reason_present`（理由が非空かどうかの真偽値）のみを返し、理由の生テキストは返さない。
既存の出力形式はsedベースでparseされるKEY=VALUE1行1フィールドであり、自由記述の理由に改行が
含まれるとparseを破壊しうるため、機械判定に必要な最小限の情報（非空かどうか）のみを渡す設計とする。
理由の生テキストはIssue/PRコメント本文（GitHubモード）またはローカルreportファイル（ローカル
モード）に構造化YAMLとして既に保存されており、人間・ゲートレビューはそちらを直接参照できる。

`report status`の位置引数は、既存の8番目`dispatch_token`に続けて9番目`no_change`
（`'true'`文字列のときのみ真）・10番目`no_change_reason`（自由記述、省略可）を末尾へ追加する。
既存の8引数呼び出しは無変更で動作する。

`worker-launch-verify.sh`は既存の`INTEGRITY_ERROR`検査チェーン（`CONTRACT_SHA256`一致・
`DISPATCH_STARTED_AT`形式・`DISPATCH_TOKEN`非空）へ`STARTED_SHA`の形式検査を追加し、不正・欠落時は
既存と同じフェイルセーフ経路（blocked + `human_escalation_requested: true` + writer lease解放）へ
倒す。

## Consequences

**利点**:

- 「差し戻し後に何もcommitせず`completed`を自称する」という確認済みの実害パターンを、
  進行役の手動grep確認に頼らず機械的に検出できるようになる（AGENTS.md I8「安全側ラチェット」の
  具体化）。
- 正当に「既存成果物が既に要件を満たしており変更不要」と判断したケースは、理由を明示すれば
  引き続きpassできる。理由自体の意味的妥当性はゲートレビューが判断するという既存の役割分担
  （I5・I2）を変更しない。
- schemaフィールド・CLI位置引数はいずれも末尾へのoptional追加であり、既存呼び出し元・既存report
  との後方互換性を壊さない。

**欠点・today以降のフォローアップ事項**:

- Agent tool dispatch経路とdirect spawn経路で着手時SHAの保持方法（永続化ファイル vs in-memory）が
  異なる非対称な実装になる。これは2経路のプロセス境界の違い（別Bash呼び出しをまたぐか否か）に
  起因する必然的な差であり、DESIGN.mdへ設計判断として明記する。
- 無変更完了の理由フィールドの内容自体が妥当かどうかを機械的に評価するルールは設けない
  （SPEC.mdのスコープ外）。理由が形式的に「空でない」ことのみを機械検査し、内容の当否は人間・
  ゲートレビューに委ねる運用が今後も続く。
- 本Issueの変更は完了確認処理（`_verify_worker_completion_report`とその2つの呼び出し元）に限定
  される。ゲートレビュー結果の記録・PRマージ判断など、完了確認以外の経路への無変更検出の適用は
  スコープ外であり、必要になれば別Issueで扱う。
