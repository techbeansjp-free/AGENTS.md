# ADR

```yaml
id: ADR-0076
status: proposed
title: reviewer stderrをraw非保持で有界分類しnon-core Codex model既定を利用可能な具体名へ固定する
tags: [adapter, codex, gate-reviewer, diagnostics, security]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

Codex gate reviewer の非ゼロ終了時、共有隔離 runner は stderr を `/dev/null` へ捨てていた。このため
運用者が得られる情報は終了コードと試行回数だけで、model unavailable、authentication failure、timeout、
その他の実行失敗を区別できなかった。一方、raw stderr はprovider資格情報や実行環境由来の秘密値を
含み得るため、そのまま永続化または外部出力できない。

non-core Codex reviewer はmodel未指定時に汎用名 `gpt-5.6` を暗黙選択していたが、実測環境ではこの名前で
起動できず、具体名 `gpt-5.6-sol` の明示後に起動した。過去stderrは失われたため直接因果は確定できないが、
暗黙既定が利用不能でも一般的な `rc=1` としか報告できない経路は再現可能である。

## Decision

reviewer stderrはpipeへ接続し、隔離runnerの親制御処理が末尾までdrainする。raw byte、文字列断片、行は
ファイルにも親メモリにも保持しない。先頭64 KiBだけをstreaming DFAへ逐次入力し、保持するのは固定grammarの
有限状態、検査byte count、超過フラグ、model/auth各signatureの成立・衝突状態だけとする。上限超過後も
SIGPIPEを避けるため末尾まで読み捨てる。成功時は分類状態を破棄して診断を生成せず、非ゼロまたはtimeout時だけ
固定状態から分類を返す。いずれの経路でもraw stderrのsinkやbufferを作らない。

model identifierは`[a-z0-9][a-z0-9._-]{0,127}`に制限する。model分類は、
`error: model '<id>' is not available`、
`error: model '<id>' is not supported`、`error: model '<id>' does not exist`、
`error: unknown model '<id>'`の行全体に完全一致する場合だけ成立する。DFAはidentifier自体を保持せず、
文字種と1〜128 byteの長さだけを状態遷移で検査する。authenticationは
`error: authentication failed`、`error: unauthorized`、`error: not authenticated`、
`error: login required`、`error: not logged in`、`error: http 401`、`error: http 403`の行全体に
完全一致する場合だけ成立する。両分類が同時に現れる場合や部分一致は`EXECUTION_FAILURE`へ倒す。timeoutを含む分類は
`MODEL_UNAVAILABLE`、`AUTHENTICATION_FAILURE`、`TIMEOUT`、`EXECUTION_FAILURE`の閉集合とする。
外へ出す診断は固定code、分類、rc、試行回数、超過フラグだけとし、raw stderr由来の文面を含めない。
診断は4 KiBを上限とし、allowlist検証不能時は分類とrcだけへ縮退する。隔離rootは全終了経路で削除する。

non-core Codex reviewer のmodelは、非空の `CODEX_REVIEWER_MODEL` を無改変で最優先し、未指定時は
`gpt-5.6-sol` を組込み既定とする。この既定が利用不能なら `NONCORE_DEFAULT_MODEL_UNAVAILABLE` として
停止する。複数modelへの自動fallbackや実行時discoveryは行わない。core review はprotected project policyの
model・reasoning・read-only・完全command override attestationを引き続き必須とし、non-core既定で補完しない。

## Consequences

- 起動失敗を再現した時点で、安全な分類、終了コード、試行回数、切り詰め有無を取得できる。
- 成否判明前を含む全経路でraw stderrをfileや親メモリへ保持せず、資格情報を外部へ出さない。
- 成功時は診断を生成せず、非ゼロ・timeout時だけ固定サイズ状態から診断する。
- 完全一致しない文面や複数分類に衝突する失敗は、一般分類へ安全側に縮退する。
- non-core は観測済みの利用不能な汎用名へ黙って倒れず、明示overrideによる運用回避も維持する。
- signatureが将来のprovider文面に一致しない場合は分類精度が下がるが、承認には倒れない。
- provider CLI全般の互換層、model discovery、Claude固有のmodel・認証診断は別の判断とする。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |
