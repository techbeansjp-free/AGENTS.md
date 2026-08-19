# ADR

```yaml
id: ADR-0076
status: proposed
title: reviewer stderrを隔離内で有界捕捉しnon-core Codex model既定を利用可能な具体名へ固定する
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

reviewer stderr は、reviewer と同じ隔離 root 内の bounded sink へ接続する。sink は先頭64 KiBだけを
権限 `0600` で保持し、超過分を保存せずdrainして超過フラグを残す。終了状態と捕捉内容は隔離内で、
`MODEL_UNAVAILABLE`、`AUTHENTICATION_FAILURE`、`TIMEOUT`、`EXECUTION_FAILURE` の固定分類へ変換する。
外へ出す診断は固定code、分類、rc、試行回数、超過フラグだけとし、raw stderr由来の文面を含めない。
診断は4 KiBを上限とし、allowlist検証不能時は分類とrcだけへ縮退する。raw stderrを含む隔離rootは、
成功・失敗・timeoutのすべてで削除する。

non-core Codex reviewer のmodelは、非空の `CODEX_REVIEWER_MODEL` を無改変で最優先し、未指定時は
`gpt-5.6-sol` を組込み既定とする。この既定が利用不能なら `NONCORE_DEFAULT_MODEL_UNAVAILABLE` として
停止する。複数modelへの自動fallbackや実行時discoveryは行わない。core review はprotected project policyの
model・reasoning・read-only・完全command override attestationを引き続き必須とし、non-core既定で補完しない。

## Consequences

- 起動失敗を再現した時点で、安全な分類、終了コード、試行回数、切り詰め有無を取得できる。
- raw stderrや資格情報を外部へ出さず、未知の失敗は一般分類へ安全側に縮退する。
- non-core は観測済みの利用不能な汎用名へ黙って倒れず、明示overrideによる運用回避も維持する。
- signatureが将来のprovider文面に一致しない場合は分類精度が下がるが、承認には倒れない。
- provider CLI全般の互換層、model discovery、Claude固有のmodel・認証診断は別の判断とする。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |
