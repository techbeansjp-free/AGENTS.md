# ADR

```yaml
id: ADR-0079
status: proposed
title: reviewer stderr分類のmodel identifierを引用符以外のASCII可視1〜128 byteとして確定する
tags: [adapter, codex, gate-reviewer, diagnostics, security]
supersedes: [ADR-0076]
superseded-by: null
deprecated-reason: null
```

## Context

ゲートレビュアの非ゼロ終了時、共有隔離 runner は stderr を捨てており、運用者は終了コードと試行回数しか
得られず、model unavailable・authentication failure・timeout・その他の実行失敗を区別できなかった。一方
raw stderr は provider 資格情報や実行環境由来の秘密値を含み得るため、そのまま永続化・外部出力できない。
また non-core Codex reviewer は model 未指定時に汎用名 `gpt-5.6` を暗黙選択していたが、実測環境では
この名前で起動できず、具体名 `gpt-5.6-sol` の明示後に起動した。

先行判断 ADR-0076 はこの2点を解決したが、model 分類 grammar の identifier を `[a-z0-9][a-z0-9._-]{0,127}`
に制限していた。この制限は、明示 model override として任意の identifier を許可し（Issue #744 SPEC.md AC-6）、
その model unavailable を他の実行失敗と相互判別する（同 AC-1）という要求と両立しない。区切り文字 `/` `:` `+`
を含む値は現に到達可能で、制限下では model 分岐がすべて無効化され `EXECUTION_FAILURE` へ誤分類される。
identifier の集合以外に ADR-0076 の判断を変える必要は無いが、accepted 後の Decision は書き換えられないため、
判断全体を自己完結して置き換える本 ADR を新規に作成する。

## Decision

reviewer stderr は pipe へ接続し、隔離 runner の親制御処理が末尾まで drain する。raw byte・文字列断片・行は
ファイルにも親メモリにも保持しない。先頭 64 KiB だけを streaming DFA へ逐次入力し、保持するのは固定 grammar の
有限状態、検査 byte count、超過フラグ、model/auth 各 signature の成立・衝突状態だけとする。上限超過後も
SIGPIPE を避けるため末尾まで読み捨てる。成功時は分類状態を破棄して診断を生成せず、非ゼロまたは timeout 時だけ
固定状態から分類を返す。いずれの経路でも raw stderr の sink や buffer を作らない。

model identifier は **1〜128 byte、各 byte が単一引用符（`0x27`）以外の ASCII 可視文字（`0x21`〜`0x7E`）** とする。
空、空白・タブ・制御文字・`0x7F`、および `0x80` 以上の byte（`LC_ALL=C` 固定のため多byte文字は構成 byte 単位で
不一致）は identifier を成立させない。区切り文字 `/` `:` `+` を含む値、および大文字を含む値は成立する。
model 分類は、`error: model '<id>' is not available`、`error: model '<id>' is not supported`、
`error: model '<id>' does not exist`、`error: unknown model '<id>'` の**行全体**に完全一致する場合だけ成立する。
照合は ASCII case-insensitive とし、行末 CR を許容する。DFA は identifier 自体を保持せず、現在位置と
1〜128 byte の長さだけを状態遷移で検査する。authentication は `error: authentication failed`、
`error: unauthorized`、`error: not authenticated`、`error: login required`、`error: not logged in`、
`error: http 401`、`error: http 403` の行全体に完全一致する場合だけ成立する。両分類が同時に現れる場合や
部分一致は `EXECUTION_FAILURE` へ倒す。timeout を含む分類は `MODEL_UNAVAILABLE`、`AUTHENTICATION_FAILURE`、
`TIMEOUT`、`EXECUTION_FAILURE` の閉集合とする。外へ出す診断は固定 code、分類、rc、試行回数、超過フラグだけとし、
raw stderr 由来の文面を含めない。診断は 4 KiB を上限とし、allowlist 検証不能時は分類と rc だけへ縮退する。
隔離 root は全終了経路で削除する。

non-core Codex reviewer の model は、非空の `CODEX_REVIEWER_MODEL` を無改変で最優先し、未指定時は
`gpt-5.6-sol` を組込み既定とする。この既定が利用不能なら `NONCORE_DEFAULT_MODEL_UNAVAILABLE` として停止する。
複数 model への自動 fallback や実行時 discovery は行わない。core review は protected project policy の
model・reasoning・read-only・完全 command override attestation を引き続き必須とし、non-core 既定で補完しない。

identifier をこの集合とする根拠は次の2点である。SPEC.md AC-6 は non-core で `CODEX_REVIEWER_MODEL` に
**任意の** model identifier を明示でき、その値が無改変で reviewer へ渡ることを要求する。SPEC.md AC-1 は
model unavailable・authentication failure・timeout・その他の実行失敗が相互に判別できることを要求する。
identifier を英小文字・数字・`.` `_` `-` に限ると、AC-6 が許す到達可能な値（例: `vendor/model`）の
model unavailable が AC-1 の判別対象から落ちる。行全体の完全一致という判別条件を維持したまま identifier だけを
広げることで、両 AC を同時に満たしつつ `unknown option for model command` のような他の実行失敗の誤分類も防ぐ。

## Consequences

- 起動失敗を再現した時点で、安全な分類、終了コード、試行回数、切り詰め有無を取得できる。
- 成否判明前を含む全経路で raw stderr を file や親メモリへ保持せず、資格情報を外部へ出さない。
- 明示 model override が区切り文字や大文字を含んでも model unavailable を判別でき、SPEC.md AC-6 と AC-1 を
  同時に満たす。
- identifier を広げても分類の成立条件は行全体の完全一致のままであり、部分一致や追加 suffix を持つ行、
  および両分類が衝突する行は従来どおり `EXECUTION_FAILURE` へ縮退する。
- identifier が広い分、provider が将来 model 名を引用符で囲まない文面へ変えた場合の耐性は上がらない。
  その場合は分類精度が下がるが、承認には倒れない。
- non-core は観測済みの利用不能な汎用名へ黙って倒れず、明示 override による運用回避も維持する。
- 本 ADR は ADR-0076 の判断全体を置き換える。identifier 集合以外の内容は同一であり、実装・テストの
  変更を伴わない。ADR-0076 は `superseded` とし、以後の正本は本 ADR とする。
- provider CLI 全般の互換層、model discovery、Claude 固有の model・認証診断は別の判断とする。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |
