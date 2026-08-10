<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0041
status: proposed   # proposed | accepted | superseded | deprecated
title: setup github/sync templatesの大文字小文字衝突検知はオプトインでfail-closedとし、--dry-runはGitHub API書込みも抑制する
tags: [fs-copy, setup, sync, dry-run, safety]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`agent-skill-chain setup github`・`agent-skill-chain sync templates` は、`copyTreeMirror`（`src/lib/fs-copy.ts`）で配布元テンプレートを導入先へ無条件上書きミラーコピーする。既存ファイルとの内容比較を行わないため、大文字小文字を区別しないファイルシステム（例: macOS APFS）では、配布元の小文字パス（例: `.github/pull_request_template.md`）が展開先の大文字表記の既存ファイル（例: `.github/PULL_REQUEST_TEMPLATE.md`）と同一実体として扱われ、利用者のカスタムファイルが無警告で失われうる（ISSUE-538）。また `setup github`／`sync templates` には、実書込み前に変更内容を確認できる `--dry-run` が無く（`init`／`upgrade` には既にある）、`CopyOptions.dryRun` はライブラリ層（`fs-copy.ts`）には既に存在するが CLI 層で結線されていない。

`copyTreeMirror` は `setup.ts`（`.github/` 同期）・`sync.ts`（`.github/`・`.claude/agents/`・`.claude/skills/` 同期）に加え、`upgrade.ts`（`config/agent-skill-chain.yaml`・`CLAUDE.md` 等、`.github/`・`.claude/agents/`・`.claude/skills/` 以外の管理対象アセットの同期）からも呼ばれる共有ライブラリ関数である。SPEC.md は大文字小文字衝突検知の対象を `setup github`／`sync templates` が扱う配布物（`.github/`・`.claude/agents/`・`.claude/skills/`）に限定し、`init`（`copyTreeFailOnConflict` を使用）および `upgrade` が扱うそれ以外の配布物への適用を明示的にスコープ外としている。単純に `copyTreeMirror` 内部で無条件に検知を有効化すると、この共有関数を呼ぶ `upgrade.ts` の挙動まで意図せず変更してしまい、スコープ外の既存呼び出し元に副作用が漏れる。

## Decision

1. `CopyOptions`（`fs-copy.ts`）に既定値 `false` のオプトインフラグ `detectCaseCollision` を新設する。`setup.ts` の `syncStep()` と `sync.ts` の `templates()` の呼び出しでのみ明示的に `true` を渡す。`init.ts`（`copyTreeFailOnConflict`）・`upgrade.ts`（`copyTreeMirror` の既存呼び出し）はこのフラグを渡さず、既定 `false` のまま挙動を変更しない。
2. 衝突検知は、展開先ディレクトリの実エントリ名一覧（`fs.readdirSync`）を大文字小文字を無視して比較する方式で行い、`lstatOrNull` によるパス解決（ホストのファイルシステムの大文字小文字区別可否に応じて挙動が変わりうる）には依存しない。これにより、大文字小文字を区別する／しないいずれのホスト環境で実行しても同一の検知結果になる。
3. 衝突を検知した場合は、警告して続行するのではなく `CliError` を送出し、他の一切のファイルへの書込みも行わずに展開全体を中断する（fail-closed）。検知は既存の計画（`planTree`）・適用（`applyPlan`）の分離構造のうち計画段階で行うため、`--dry-run` の指定有無に関わらず同一の検知結果を返し、実書込みも発生しない。
4. `setup github --dry-run` は、`.github/` のミラーコピーを未書込みで計画するだけでなく、`setup labels`／`setup ruleset` が行う GitHub API への書込みも実行しない（呼び出し自体をスキップし、スキップした旨を出力する）。`--dry-run` は「一切の外部書込みを行わない」という一貫した意味を持つ。

## Consequences

- 大文字小文字のみ異なる既存ファイルを持つリポジトリで `setup github`／`sync templates` を実行すると、これまで無警告で上書きしていたケースが新たに中断（エラー終了）するようになる。意図した安全側の挙動変化であり、解消には利用者が該当ファイルを手動で確認・統合する必要がある。
- `upgrade`（`config/agent-skill-chain.yaml` 等）・`init` の既存挙動は変更されない。大文字小文字衝突検知をそれらへ拡張する場合は、別 Issue で `detectCaseCollision` の呼び出し箇所を追加するか、同種の検討を行う必要がある。
- `setup github --dry-run` はラベル・ruleset 適用の事前検証（テンプレートのレンダリング可否等）までは行わない。GitHub API 書込みを伴う変更の事前確認が別途必要になった場合は、将来 `setup labels`／`setup ruleset` 自体への `--dry-run` 追加を検討する余地がある（本 Issue のスコープ外）。
- ディレクトリ名の大文字小文字衝突検知（ファイル名のみを対象とし、ディレクトリ名は対象外）は本決定の対象外。必要になった場合は別 Issue で `CopyPlan.addDir` 側への拡張を検討する。

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
