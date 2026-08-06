# ADR

```yaml
id: ADR-0032
status: proposed   # proposed | accepted | superseded | deprecated
title: Codex worker起動の既定コマンド組み立てをアダプタ差し替え可能なフック関数へ切り出し、stdin UTF-8境界破損をrole_contractサイズ判定で回避する
tags: [codex, adapter, worker-launch, stdin]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/adapters/codex.sh` の `launch_worker()` は `.agent-skill-chain/adapters/claude.sh` が定義する共通 lifecycle（`launch_worker` 本体）を `eval` で名前を変えて取り込み（`_codex_worker_lifecycle`）、認証チェック等一部のヘルパー関数の動的束縛（同一プロセス内での関数再定義によるオーバーライド。`_claude_auth_ok` が `_codex_auth_ok` を呼ぶよう再定義される、が既存の実例）だけで Codex 固有差分を適用している。

`claude.sh` の共通 lifecycle は、role_contract（segment worker への動作契約全文）を一時ファイルへ書き出し `bash -c "$worker_cmd" <"$prompt_file"` で常に stdin 経由により渡す。Codex adapter の既定 `WORKER_CMD` は `codex exec ... -`（末尾 `-` は「stdin から prompt を読む」指示）を組み立てるため、role_contract は常に stdin 経由で Codex CLI（`codex exec`）へ渡っていた。

role_contract のサイズがおおむね 64KB（65536バイト）を超えると、Codex CLI が `Failed to read prompt from stdin: input is not valid UTF-8 (invalid byte at offset 65534)` エラーで即座に起動失敗する不具合が実測された（Issue #449 implementation segment で2回連続再現、同一バイトオフセット）。role_contract 自体は正しい UTF-8（日本語テキストを多く含む）であり、Codex CLI の stdin 読み取り実装が固定サイズ（推測64KiB）のチャンク単位で UTF-8 妥当性を検証しており、マルチバイト文字がチャンク境界をまたぐ場合に検証が誤って失敗すると推測される（上流 Codex CLI 自体の不具合であり、上流修正は本 ADR・対応する Issue #462 のスコープ外）。この障害は role_contract サイズが閾値付近か否かという偶発的な条件で発生し、進行役が都度 `CODEX_WORKER_CMD`（テスト用/一時的な起動系上書き機構）を手動で argv 経由起動のラッパーへ差し替えることでしか回避できていなかった。

回避には、role_contract のサイズに応じて Codex CLI への prompt 受け渡し経路（stdin 経由 / 位置引数 `[PROMPT]` 経由）を実行時に切り替える必要がある。しかし、既存構造では起動コマンド文字列（`WORKER_CMD`）は `codex.sh: launch_worker()` が role_contract 取得（`claude.sh` 側の共通 lifecycle 内で行われる `_asc_cli segment start`）より前に組み立てており、role_contract の内容・サイズを起動コマンド組み立て時点で参照できない。

## Decision

`claude.sh` の `launch_worker` が持つ「`WORKER_CMD` 未指定時の既定起動コマンド組み立て」処理を `_worker_default_cmd <segment> <contract>` という1関数へ切り出す。この呼び出しは既存の順序（role_contract取得後・認証チェック後、`WORKER_CMD` が空の場合のみ）のまま行う。`claude.sh` はこの関数の既定実装（claude CLI を `--allowed-tools` 付きで起動する、既存動作そのまま。`contract` 引数は未使用）を提供する。

`codex.sh` は、既存の `_claude_auth_ok` 上書きと同型の動的束縛（`claude.sh` を `source` した後に同名関数を再定義し、`eval` で取り込んだ共通 lifecycle のコピーからの呼び出し先を実行時に差し替える）を用いて `_worker_default_cmd` を上書きする。Codex 版の実装は、role_contract のバイトサイズが環境変数 `CODEX_STDIN_SAFE_THRESHOLD_BYTES`（既定 32768。実測破損境界 65534 の約半分であり、Codex CLI 側チャンク境界実装の詳細が変動しても十分な安全マージンを持つ）を超える場合、`codex exec` の位置引数 `[PROMPT]` 経由（role_contract を `printf '%q'` でシェルエスケープし単一 argv 要素として埋め込み、かつコマンド文字列末尾に `</dev/null` を付与）で起動コマンドを組み立て、超えない場合は従来どおり stdin 経由（末尾 `-`）で組み立てる。

位置引数経由でも `</dev/null` を付与するのは、Codex CLI が位置引数を受け取っていても stdin が別ソースへ接続されたままだとそれを追加で `<stdin>` ブロックとして読み込んでしまう（位置引数だけを見て stdin を無視するわけではない）ことが実機検証で判明したため。呼び出し元（`claude.sh: launch_worker`）が行う `bash -c "$worker_cmd" <"$prompt_file"` という外側の stdin redirect 自体は変更しないが、`bash -c` に渡すコマンド文字列内で個別コマンドに付与した redirect は当該コマンドの実行時にのみ外側の fd0 を上書きするため、位置引数経由の分岐でだけ `codex exec` 呼び出し自体に `</dev/null` を付与することで、呼び出し元を変更せず Codex 固有ロジックを `codex.sh` 内に閉じたまま stdin 供給を確実に断つ。

model・reasoning effort・sandbox opts の解決（`_codex_worker_model`/`_codex_worker_effort`/`_codex_worker_sandbox_opts`、いずれも無変更）は分岐の前に一度だけ行い両分岐で共有するため、代替経路でも既存と同一設定が適用される。`CODEX_WORKER_CMD`/`WORKER_CMD`（テスト用完全上書き）が明示されている場合は `_worker_default_cmd` 自体を呼ばない既存の優先順位を変更しない。

閾値はプロジェクト設定スキーマ（`.agent-skill-chain/config/agent-skill-chain.yaml`）へ項目追加せず、既存の `CODEX_IMPLEMENTATION_MODEL` 等と同型の環境変数上書きとして実装する（上流 Codex CLI の未公開実装詳細に対する技術的回避策のマージンであり、プロジェクトごとに恒常的に変える性質の値ではないため）。

### 却下した代替案

- stdin 経由を廃止し常に位置引数経由へ統一する: 閾値以下でも起動コマンド文字列が変わり既存の自動テストが前提とするコマンド形を壊すリスクを常に負い、要件（閾値以下は退行なし）にも反するため却下。
- TypeScript 側（`worker-launch.sh` 呼び出し前）で事前にサイズ判定しコマンド文字列を生成する: role_contract の内容確定は bash アダプタ内の `_asc_cli segment start` 実行後にしか分からず、TypeScript 側へ contract 本文を受け渡す新しい経路を要し変更範囲が不必要に広がる。起動コマンド組み立てロジックの正本が bash と TypeScript に分裂することも避けたいため却下。
- `claude.sh`（共通lifecycle）へ直接 Codex 固有のサイズ判定ロジックを書く: `claude.sh` はベンダー中立の共通 lifecycle であり、Codex 固有の stdin 実装バグの知識を混入させると既存の責務境界方針（Codex 固有差分は `codex.sh` に閉じる）に反するため却下。

## Consequences

- 利点: role_contract サイズが約64KB付近かどうかに関わらず、進行役が `CODEX_WORKER_CMD` を手動で差し替えなくても segment worker が起動できるようになる（SPEC.md AC-5）。
- 利点: `_worker_default_cmd` という1関数の追加・上書きだけで実現でき、`claude.sh` 側の既定動作（Claude CLI 起動）はビット単位で不変、`CODEX_WORKER_CMD`/`WORKER_CMD` による完全上書き経路も変更されない。
- 欠点・フォローアップ: 位置引数経由で埋め込む role_contract が将来 ARG_MAX（Linux では通常2MB前後）に近づくほど肥大化した場合、`bash -c` の起動自体が失敗し得る（既存の「起動失敗」blocked フェイルセーフへ倒れるため silent には失敗しないが、恒久的な起動失敗になる）。発生した場合は分割送信等の別対応を要する別 Issue とする。
- フォローアップ: `.agent-skill-chain/adapters/claude.sh` の `launch_gate_reviewer()` も Codex CLI（`codex exec ... -`）へ pipe 経由の stdin で prompt を渡しており原理上同一の境界破損リスクを持つが、本 ADR・Issue #462 は実際に障害が確認された `launch_worker()` 経由のみを対象とする（SPEC.md「スコープ外」）。`launch_gate_reviewer()` 側で同種の破損が実際に確認された場合は、本 ADR と同様の `_worker_default_cmd` 型のフック導入を別 Issue で検討する。
- 実機での位置引数経由起動（Codex CLI が `--` 以降の位置引数を `[PROMPT]` として受理する）自体は、PLAN.md 変更単位5（AC-5, hybrid検証）で実機確認する。なお「位置引数を渡していても stdin が接続されたままだと追加で `<stdin>` ブロックを読み込んでしまう」という当初未確認だった挙動は実機検証で既に判明しており、Decision（コマンド文字列末尾への `</dev/null` 付与）で対応済みである。この対応後もなお想定と異なる挙動が判明した場合は、コマンド形（決定3）を再検討し design-gate を再通過させる。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```

- `proposed → accepted`: 設計ゲート承認時に遷移する。設計レビュアは ADR 本文をレビューし content digest を承認するのみ（read-only、直接 status を書き換えない）。進行役が `.agent-skill-chain/scripts/adr-finalize.sh` を起動し、専任の ADR finalization ワーカーが writer lease を取得したうえで `status` のみを `accepted` に更新して commit・push する（`.agent-skill-chain/config/roles.yaml` の `adr_finalization_worker`、`scope: adr_status_only`）。finalization ワーカーは書込み前に content digest を再検査する。
- `accepted → superseded`: 新しい ADR を含む同一 PR 内で、新 ADR の作者（ワーカー）が旧 ADR の `status` / `superseded-by` を同一 PR で更新する。`supersedes` ⇔ `superseded-by` の対称性・参照先の実在が機械検査される。
- `accepted → deprecated`: 前提が消滅し後継が無い場合に遷移する。`deprecated-reason` に1行の理由を記録する（存在検査あり）。

## related_adrs 参照ルール

他 Issue の `DESIGN.md` から本 ADR を参照する場合は `related_adrs:` フィールド（構造化リスト）を用いる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。本文中の自然文による歴史的言及（例: 「本決定は ADR-0007 を置き換える」）は検査対象外であり許可される。
