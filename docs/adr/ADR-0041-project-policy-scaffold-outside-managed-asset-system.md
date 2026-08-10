# ADR

```yaml
id: ADR-0041
status: proposed   # proposed | accepted | superseded | deprecated
title: project固有ポリシーの雛形生成はNAMESPACED_ENTRIES非対象の独立scaffoldとしてinitに実装する
tags: [init, project-policy, safety]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/project/`（`manifest.yaml` + `RULES.md`）は consumer project 固有の追加プロセス規約の置き場所だが、`init`/`setup`/`upgrade`/`uninstall` のいずれも当該ディレクトリを作成・案内せず、`.agent-skill-chain/templates/` にも雛形が存在しない。導入者は AGENTS.md の散文以外に手がかりを持てず、実際にどう作ればよいか分からないという報告を受けた（2026-08-11、ISSUE-586）。

一方で、`src/lib/asset-manifest.ts` の `NAMESPACED_ENTRIES`（`upgrade`/`init` が走査する管理対象アセット名前空間の一覧）は `project` を意図的に含めていない。これは `upgrade` が consumer の独自ポリシーを誤って上書き・削除しないための既存の安全設計であり、README.md が明記する「`upgrade` は `project/` に対して不可侵」「`uninstall` は `project/` を保持する」という不変条件と一致する（本Issueでは変更しない）。

雛形生成の実現手段として、次の2通りを検討した。

1. **`.agent-skill-chain/project/` を `NAMESPACED_ENTRIES` へ追加し、既存の管理対象アセット複製の仕組み（`collectManagedAssetMappings` → `copyTreeFailOnConflict`）に相乗りする**: 実装は最小になるが、`copyTreeFailOnConflict` は「既存ファイルと内容が異なれば `CliError` で処理全体を中断する」仕様（`src/lib/fs-copy.ts`）である。consumer が独自に編集済みの `manifest.yaml` を持つ状態で `init` を再実行すると、`project/` 以外の全ファイルの展開も含めて `init` 全体が失敗する。さらに `NAMESPACED_ENTRIES` へ追加すると `upgrade` の削除候補判定・ミラー同期の走査対象にも自動的に入り、既存の「`project/` へ不可侵」という不変条件を壊さないための除外分岐を新たにあちこちへ追加する必要が生じ、既存の安全設計（既に確立された除外という単純な事実）を複雑化させる。
2. **`project/` の雛形生成を、既存の管理対象アセット複製の仕組みとは独立した専用ロジック（`project-policy-scaffold`）として実装し、`NAMESPACED_ENTRIES` には追加しない**: `manifest.yaml` が存在しない場合にのみ生成する冪等な skip-if-exists ロジックとする。生成したファイルは所有権記録（`ownership-record.ts`）へも登録しない。`upgrade`/`uninstall` のコード・`NAMESPACED_ENTRIES` の定義は一切変更しないため、既存の「`project/` へ不可侵」という不変条件は新たな分岐を追加することなく構造的に維持される。

選択肢2は実装対象が1コンポーネント（`project-policy-scaffold`）増える分、選択肢1よりわずかに実装コストが高いが、(a) consumer が独自編集済みの `manifest.yaml` を持つ場合でも `init` 全体を失敗させない、(b) `upgrade`/`uninstall` の不可侵・保持という既存不変条件を「新たな除外分岐」ではなく「既存の除外定義を変更しない」という消極的事実だけで維持できる、という2点で安全側に立つ。

## Decision

`.agent-skill-chain/project/manifest.yaml`・`RULES.md` の雛形生成は、既存の管理対象アセット複製の仕組み（`NAMESPACED_ENTRIES`・`collectManagedAssetMappings`・`copyTreeFailOnConflict`・所有権記録）へ相乗りさせず、`src/lib/project-policy-scaffold.ts` という独立した専用ロジックとして実装する（選択肢2を採用）。このロジックは `.agent-skill-chain/project/manifest.yaml` が存在しない場合にのみ、新設のテンプレート資産（`.agent-skill-chain/templates/project-policy/`、`NAMESPACED_ENTRIES` には追加しない）から `manifest.yaml`・`RULES.md` を生成し、生成結果を所有権記録へ登録しない。`init` はこのロジックを既存の管理対象アセット複製処理の後段で1回呼び出す。`upgrade`・`uninstall` のコード・`NAMESPACED_ENTRIES` の定義は変更しない。

## Consequences

- 導入者は `init`（`--dry-run` 無し）を実行するだけで `.agent-skill-chain/project/manifest.yaml`・`RULES.md` の雛形を得られ、AGENTS.md の散文を読み解かなくても書き方を把握できる具体的な手がかりを得る。
- consumer が既に独自編集済みの `manifest.yaml` を持つ場合でも、その内容と衝突して `init` 全体が失敗することはない（`project-policy-scaffold` は既存ファイルを検知した時点で完全に no-op になる）。
- `upgrade`・`uninstall` は本変更後もコード変更なしで `.agent-skill-chain/project/` へ不可侵・保持のままである。回帰は新規追加する自動テストで確認する（`PLAN.md` の変更単位5）。
- フォローアップ: `.agent-skill-chain/project/roles/<role>.md` の雛形提供や `doctor` コマンドへの `manifest.yaml` 不在時の案内追加は本Issueのスコープ外とし、必要性が判断された場合に別Issueで扱う。

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
