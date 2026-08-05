# ADR

```yaml
id: ADR-0029
status: accepted
title: worker-launch.shが呼び出し元のcwd・スクリプトパスに依存せず対象issueのworktreeを自己解決し再実行する
tags: [worktree, worker-launch, writer-lease, adapters]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/scripts/worker-launch.sh`（および`.agent-skill-chain/adapters/{claude,codex,human}.sh`の`launch_worker`）は、対象issue専用のworktreeパスをissue_idから解決してcdする処理を持たない。`REPO_ROOT`は自身の`BASH_SOURCE`（呼び出しに使われたスクリプトファイルのパス）から解決されるだけであり、進行役が絶対パス経由・main worktree等の別worktreeのcwdから呼び出した場合、起動されるワーカーの実行コンテキスト（ファイル読み書き対象・`git rev-parse HEAD`の基準）は「呼び出し元プロセスがたまたまいた場所」に依存する。2026-08-04・2026-08-05に本リポジトリ自身で複数worktree並存下の実運用中に、対象を一意特定できずblocked終了する事象と、完了確認の「現在HEAD」比較が対象worktree以外のHEADと誤って突合されフェイルセーフが誤発動する事象が、いずれも実際に再現した（ISSUE-442 SPEC.md参照）。

`test/integration/worker-adapters.test.ts`のコメントには元々「`launch_worker`はcwd=対象issueのworktree内で動く前提（DESIGN.md、#166）」と明記されているが、この前提を検証・強制するコードはどこにも無く、テストは常に対象worktree内から起動する形でこの前提を満たしていたため、呼び出し元の慣習に依存するバグが長期間気づかれずに残っていた。

検討した代替案:

1. **各アダプタ（claude/codex/human.sh）内で個別にcdする**: `codex.sh`は`claude.sh`の`launch_worker`本体を`declare -f`で取り込んでおり、修正しても実体は1箇所で済むが、`human.sh`は独自実装のため最低2箇所の修正が必要になる。加えて`worker-launch.sh`自身の将来の拡張（引数解析等）が対象worktree外のコード版で動き続ける非一貫性は解消できない。
2. **`worker-launch.sh`内で`REPO_ROOT`変数だけを対象worktreeパスへ上書きし、`cd`のみ行って自プロセス内で処理を継続する（再実行しない）**: 実装は簡潔だが、`worker-launch.sh`自身のトップレベルロジックは「呼び出しに使われたコピー（＝呼び出し元の場所のブランチ内容）」のまま実行され、ソースされるアダプタだけが対象worktree（＝対象issueのブランチ内容）のコピーになる、という2つの異なるブランチのコード片が混在した状態で動く。本Issueのように`worker-launch.sh`自身を変更するIssueが将来も起こりうる自己拡張リポジトリの性質上、この非一貫性は障害調査を困難にする。
3. **role_contract（`roles.yaml`）に対象worktreeパスを埋め込み、ワーカー自身に`cd`させる**: SPEC.mdのスコープ外事項として設計セグメントの裁量に委ねられているが、`worker-launch.sh`自身が行うlease取得・完了確認（`git rev-parse HEAD`）はワーカーのAI推論より前・外側で発生する処理であり、プロンプト内指示では解決できない。
4. **既存`findIssueWorktree`を直接複数該当検知するよう変更する**: 呼び出し元8箇所（`issue resume`・`verify`・`adr`・`gate`・`lease`・`pr`・`cleanup`・`reconcile`）すべてに影響し、本Issueの受入条件（worker-launch経路に限定、SPEC.md「スコープ外」）を超える広い変更になる。

## Decision

`worker-launch.sh`を、対象issueのworktreeを自己解決し、必要なら対象worktree自身のコピーへ`cd`＋`exec`で処理を委譲する単一の制御点とする。

- `src/lib/worktree.ts`に`resolveIssueWorktreeExactlyOne(root, config, issueNumber)`を新設する。`listWorktrees`の全件を対象issueのworktree命名パターンでフィルタし、2件以上なら候補パスを列挙した`ambiguous`、1件のみなら`found`を返す。0件なら既存`findIssueWorktree`のbranch名一致・CI単一checkoutフォールバックへ委譲し、その戻り値をそのまま変換する（1件のworktreeエントリが返れば`found`、`undefined`が返れば`not_found`）。フォールバックのbranch名一致は呼び出し元の現在worktree1本のブランチのみを判定対象にし、CI単一checkout信頼は`listWorktrees`のエントリが厳密に1件の場合のみ発火する設計であるため、いずれも複数候補を返すことができず、フォールバック委譲後に`ambiguous`へ変換されることはない。既存`findIssueWorktree`自体の挙動・呼び出し元は変更しない。
- `agent-skill-chain worker context <issue_id> <segment>`は、`found`の場合のみ`worktree_path=<絶対パス>`行を追加出力する。`not_found`/`ambiguous`は行を出さずコマンド自体は既存どおり成功する（segment省略経路・既存の他呼び出し元は無改修）。
- `worker-launch.sh`は`worker context`呼び出し直後に`worktree_path=`を検査する。空ならlease取得前にexit 2で安全側停止する。値があり自身の`REPO_ROOT`と一致しなければ、対象worktree内の`.agent-skill-chain/scripts/worker-launch.sh`へ`cd`＋`exec`で委譲する（環境変数による一回限りの再帰ガード付き）。

## Consequences

- 単一の制御点（`worker-launch.sh`冒頭）だけを変更すればclaude/codex/human全アダプタに一律で効く。アダプタ本体（`git rev-parse HEAD`を含む既存の完了確認ロジック）は無改修のまま、cwdが対象worktreeになる副作用だけで正しく動作するようになる。
- 対象worktreeにagent-skill-chain CLIの実行手段（ビルド済み`bin/agents-md.js`、`node_modules/.bin/agent-skill-chain`、またはグローバルインストール）が必要という前提を、常に（従来は偶然satisfyされていたのに対し）一律に要求するようになる。これは`#166`のテストが既に明記していた既存前提であり、本ADRが新規に課す要件ではない。
- 読み取り専用のゲートレビュア起動経路（`launch_gate_reviewer`・`gate-launch-reviewer.sh`）は、対象worktreeを特定するのではなくclone・target_shaベースの別機構で動作しており、本ADRの対象外（ISSUE-442 SPEC.mdのスコープ外事項）。同種の対象特定問題が無いか横断確認する場合は別Issueで扱う。
- worktree起動のたびに1回分のプロセス`exec`委譲コストが増えるが、既に一致している通常経路（対象worktree自身から呼び出された場合）では委譲を行わないため実質無視できる。

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
