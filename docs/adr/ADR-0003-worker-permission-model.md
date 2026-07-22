# ADR

```yaml
id: ADR-0003
status: proposed   # proposed | accepted | superseded | deprecated
title: セグメント作業ワーカーの権限付与は責務スコープ allowlist を既定とする
tags: [permission, worker, adapter, security]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/adapters/claude.sh` の `launch_worker` は、セグメント作業ワーカー（spec/design/implementation/validation）を本物の `claude` CLI でヘッドレス起動する。ワーカーは正規責務範囲（自 branch への `git commit`／`git push`、Draft PR 作成、テスト実行、`report-status`／`lease-*`／`checkpoint` 実行、自 worktree 内の read/write）を人間の追加承認なく完走できる必要がある。

既定 `WORKER_CMD` は `claude -p --output-format text --permission-mode acceptEdits` だった。`acceptEdits` はファイル編集のみ自動承認し、`git push` 等の Bash 操作は非対話ヘッドレスで承認待ちのまま停止するため、ワーカーが `git push` で止まり `launch_worker` が blocked へ倒れていた（正常経路での human_required 誤発火）。

権限付与の実現方式には次の緊張がある。(1) 無制限な `bypassPermissions`（全ツール自動承認）は完走はするが、責務外操作まで無条件許可し安全側原則に反する。加えて、`bypassPermissions` の検証自体が検証エージェントの外側セッションの安全分類器にブロックされる副次現象が観測された。(2) AGENTS.md I5 は「権限は credential/権限分離で担保し、ツール名の一律 deny では実装しない」と定め、自 branch 以外への書込み禁止は worktree 隔離＋branch スコープ credential で担保する。(3) ゲートレビュアは既に `--allowed-tools ''`（空＝read-only）で起動しており、`--allowed-tools` はこのアダプタの確立パターンである。「ワーカーへどうツール権限を付与するか」は今後のアダプタ追加（codex 等）や権限方式変更が横断的に honor すべき恒久的判断であり、記録に値する。

## Decision

セグメント作業ワーカーの既定の権限付与を、**既定 permission mode のまま `--allowed-tools` に正規責務範囲のツール・Bash パターンを明示列挙する「責務スコープ allowlist」方式**とする。列挙外のツール呼び出しはヘッドレスで拒否され（安全側 fail）、`launch_worker` の完了確認（report=completed かつ target_sha 一致）が満たされなければ blocked へ倒れる。無制限な `bypassPermissions` は既定にしない。

- 自 branch 以外への書込み禁止（I5）は、worktree 隔離＋自 branch スコープの credential 分離という一次防御で担保する。allowlist はその上の「責務外操作を自動承認しない」層であり、ツール名の一律 deny ではなく責務範囲の scoped allow である。
- allowlist の内容はアダプタ内に grep 可能な名前付き変数（`WORKER_ALLOWED_TOOLS`）として定義し、env で上書き可能とする。`WORKER_CMD` による起動系の完全上書き余地も維持する。
- `bypassPermissions` は禁止はしないが既定にはしない。隔離された CI/sandbox で allowlist 保守を回避したい特殊ケースに限り `WORKER_CMD` の明示上書きとしてのみ用いる。
- 権限方式の実機検証は、外側セッションの安全分類器を呼び出し経路から外すため、進行役の対話セッションのネスト呼び出しではなく分離した独立プロセス（`setsid`/`nohup`/CI）で行う。安全分類器自体は変更しない。

## Consequences

- 利点: 既定が「列挙外は拒否」となり無制限自動承認を避けられる（安全側既定）。停止点だった `git push` を allowlist に含めることでヘッドレス完走が可能になる（実効性）。`launch_gate_reviewer` の read-only（`--allowed-tools ''`）と対称で、`enforce on`（PreToolUse hook）の配線有無に依存せず単体で権限が確定する。`bypassPermissions` を既定にしないため安全分類器衝突を既定経路で誘発しない。
- 欠点・フォローアップ: ワーカーの責務が拡大すると allowlist の列挙保守が必要になり、列挙漏れは当該操作の拒否＝ワーカー未完了（安全側の blocked）を招く。緩和策は (i) 状態遷移を asc スクリプトへ集約し発行 top-level コマンドを有限化する、(ii) `WORKER_CMD` 上書き余地を残す、(iii) 実機検証で列挙漏れを検出し allowlist を調整する。将来のアダプタ（codex 等）も本原理（責務スコープ allowlist を既定、bypass は隔離環境の明示上書きのみ）を踏襲する。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。
