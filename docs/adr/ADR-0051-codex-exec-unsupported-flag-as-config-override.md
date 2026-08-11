# ADR

```yaml
id: ADR-0051
status: accepted
title: codex execサブコマンドが受理しないCLIフラグは-c config overrideへ置換する
tags: [adapter, codex, gate-reviewer, compatibility]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/adapters/codex.sh` の `launch_gate_reviewer` が組み立てる `codex exec` コマンドラインには `--ask-for-approval never` が含まれていたが、実際にインストールされているcodex CLI（codex-cli 0.146.0、ChatGPTアカウントでログイン済み）の `codex exec` サブコマンドはこのオプションを受け付けず、`error: unexpected argument '--ask-for-approval' found` で即座に終了する。`--ask-for-approval`（`-a`）はルートの `codex`（interactive）コマンドの `--help` にのみ存在し、`codex exec --help` には存在しない。この結果、gate reviewer役割にcodexアダプタが選択された構成では、`launch_gate_reviewer` 経由のゲートレビュー起動が常に失敗していた（ISSUE-356）。

対応にあたり2つの選択肢を検討した。

第一に、`--ask-for-approval` を単純に削除し承認ポリシー指定自体を諦める案。しかしこれは「承認を求めず自動実行する」という既存の意図した挙動（read-onlyサンドボックス下でのモデル生成コマンド実行がinteractive承認で止まらないこと）を損なう可能性があり、SPEC.mdの要件（人間の承認入力を待たずに実行される挙動の維持）に反する。

第二に、`codex exec --help` に列挙されている `-c, --config <key=value>` 経由で、`--ask-for-approval` に対応する設定キーを直接上書きする案。`APPROVAL_POLICY` という値の表記から対応する設定キー名を `approval_policy` と推測し、`codex exec --strict-config -c approval_policy=\"never\" --sandbox read-only --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check -C /tmp --color never -m gpt-5.6 "reply with just OK"` で実機検証したところ、`--strict-config`（未知キーを拒否するモード）付きでもエラーなく受理され、セッションヘッダーに `approval: never` と表示されることを確認した。同関数内には既に `-c 'shell_environment_policy.inherit="none"'` 等、複数の `-c key=value` 形式のconfig overrideが同一エスケープ規約で並んでおり、同じ記法を拡張するだけで済む。

## Decision

`launch_gate_reviewer` が組み立てる既定の `GATE_REVIEWER_CMD` から `--ask-for-approval never` を削除し、同一の `-c key=value` エスケープ規約で `-c 'approval_policy="never"'` を追加する。`launch_worker`（`--ask-for-approval` を使用しておらず本バグの影響を受けない）は変更しない。

あわせて、今後同種の非互換（`codex exec --help` に列挙されないフラグをコマンドライン組み立てに含めてしまう事象）が発覚した場合の一般的な対処方針として、次を採用する。

- 対象フラグが `codex`（root）の `--help` には存在するが `codex exec --help` には存在しない場合、まず対応する `config.toml` キー名を候補として推測し、`--strict-config` 付きの実機検証でエラーなく受理・意図通り反映されることを確認したうえで `-c key=value` へ置換する。
- 対応する設定キーが存在しない、または実機検証で意図通りの反映を確認できない場合は、フラグを削除するだけで済ませず、`human_required` へ倒すフェイルセーフ経路（例: `_codex_fail_safe`）の追加を検討する別Issueとして扱う。

## Consequences

- 利点: 「approvalを求めず自動実行する」という既存の意図した挙動を維持したまま、実際にインストールされているcodex CLIバージョンで `launch_gate_reviewer` 経由のゲートレビュー起動が引数エラーなく機能するようになる。`_codex_fail_safe`（認証不成立・CLI不在の検知）等の既存フェイルセーフ経路には変更がなく、従来どおり機能する。
- 欠点・フォローアップ: `approval_policy` という設定キー名は codex CLI 側の実装詳細への依存であり、将来のcodex CLIバージョンで当該キー自体が変更・廃止された場合は同種の障害が再発しうる。この追従は本Issueのスコープ外であり、発生時は本ADRに記録した対処方針（root/execのhelp差分確認→config override候補の実機検証→置換）を踏襲する別Issueとして扱う。
- 汎用的なcodex CLIバージョン間互換レイヤー（フラグ有無を実行時に自動検出する等の仕組み）は本ADRの対象外とし、導入しない。

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
