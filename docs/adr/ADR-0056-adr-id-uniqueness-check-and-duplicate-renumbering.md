<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0056
status: proposed
title: docs/adr/のADR ID一意性をlint adr checkで機械検査し、既存重複7件を再採番する
tags: [adr, lint, ci, traceability]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`docs/adr/` の `id:` フィールドはADR間の一意な追跡識別子であり、`related_adrs:`・`supersedes`・`superseded-by` 等の構造化参照の対象キーとして使われる（AGENTS.md I1 追跡可能性、`.agent-skill-chain/templates/adr/ADR.md` §related_adrs参照ルール）。しかし `docs/adr/` には同一番号が複数ファイルに使われている状態が7ファイル分（`ADR-0016` × 3、`ADR-0008` × 2、`ADR-0039` × 2）存在していた（ISSUE-539、本ADRが是正する対象）。

根本原因は2つある。第一に、ADR番号の採番手続きが「各Issueのdesign_workerが、自身のブランチ上の `docs/adr/` を見て手動で最大番号+1を選ぶ」という非同期な方式であり、番号の予約・調停機構が存在しない。複数Issueのブランチが並行して分岐すると、互いに他方が選んだ番号を知らないまま同じ番号を選び得る。第二に、既存の `.agent-skill-chain/scripts/adr-lint.sh check`（`src/lib/adr-consistency.ts` の `collectAdrRecords()`/`checkAdrSymmetry()`）は `id` を索引キーとする `Map` を構築する際に重複を後勝ちで上書きするため、重複それ自体を検出も報告もしない。CI（`.github/workflows/agent-skill-chain-ci.yml` の `adr-lint` ステップ）は `pull_request` トリガでのみ実行され、main への push を契機に実行されるジョブは存在しないため、2つのPRがそれぞれ単独では重複を検出できない状態のままmainへ別々にマージされると、重複はCIで一度も検出されないまま蓄積し得る。

## Decision

`checkAdrIdUniqueness()`（新規、`src/lib/adr-consistency.ts`）を追加し、`docs/adr/` 配下の全ADRファイルを非重複のまま列挙する `collectAdrFileRecords()`（新規、同ファイル）の結果に対して、同一 `id` を持つファイルが2件以上あるグループを違反として報告する。違反メッセージには重複している `id` と該当する全ファイル名を含める。`src/commands/lint.ts` の `adr()` はこの検査を既存の `checkAdrSymmetry()` と合わせて実行し、いずれかの検査で違反があれば `lint adr check` を非ゼロ終了させる（詳細な設計は本Issueの `DESIGN.md`）。

検出範囲は既存のCI実行契機（PRごと、`strict_required_status_checks_policy: true` によりマージ前にbaseへの追従を要求）に限定し、main への push 契機の新規CIジョブ・ADR番号の中央予約システムは導入しない。理由は次のとおり：(a) 既存の `strict_required_status_checks_policy` により、通常の運用ではPRのマージ直前に最新のmain状態へ追従することが要求されるため、同一番号を持つ2つのPRが互いを知らないまま両方ともマージされる window は実務上小さい、(b) push契機の新規自動化を追加するには `.github/workflows/agent-skill-chain-reconcile.yml` 等の既存パターン（`docs/adr/ADR-0007-stray-root-artifact-post-merge-cleanup.md` が同種の判断で検討・採用したmain post-merge cleanup自動化）と同水準の設計判断（admin bypass要否・トリガ条件の機械検査可能性）を要する重い変更であり、本Issueが解決対象とする「検出されない」という欠陥（受動的な機械検査の欠如）とは別種の「防止する」という欠陥への対処であり、スコープが異なる。

既存の重複7ファイルは、`docs/adr/` の現存最大番号（`ADR-0047`）に続く未使用番号 `ADR-0049`〜`ADR-0055` へ、重複グループ内の全ファイルを対象に再採番する（`DESIGN.md` の対応表）。一部のファイルのみを残し他を採番し直す案は、`accepted`/`proposed` の混在するグループ（`ADR-0016`）でどちらを「正」とするかの恣意的な優劣判断を要するため採用せず、7ファイル全てを新番号へ揃えることで判断基準を単純化する。再採番に伴い、`docs/adr/ADR-0044-...md`・`docs/ASC_GATE_APP_ID_RUNBOOK.md` に存在する `ADR-0016`（`ADR-0016-reconcile-workflow-run-trust-boundary.md` を指すもの、新番号 `ADR-0052`）へのバレテキスト直接参照4件を更新する。対象7ファイル間・他ADRからの構造化参照（`related_adrs:`/`supersedes`/`superseded-by`）はいずれも0件であり、断線しない。

## Consequences

- 利点: `docs/adr/` の `id` 一意性が `lint adr check`（CI含む）で機械的に保証される。既存の重複7件が解消され、ADR番号を介した参照・由来提示の対象が一意に定まる。
- 欠点・フォローアップ: 2つのPRが互いの変更を知らないまま並行してmainへマージされる極めて狭い window（`strict_required_status_checks_policy` により通常は各PRのマージ直前に解消される）は、本決定の検出範囲では防げない残余リスクとして残る。将来この window が実害を伴う頻度で顕在化した場合は、main への push 契機の追加検査ジョブ、またはADR番号の予約制導入を、それぞれ独立したADR＋Issueとして再検討する。
- `accepted` 状態のADR2件（新 `ADR-0051`・`ADR-0052`）の `id` を変更することは、通常は「accepted 後の不変項目」（`.agent-skill-chain/templates/adr/ADR.md`）への抵触に見えるが、本決定はこれを例外として扱う。対象は「重複という不整合状態そのものの是正」という一度限りの機械的補正であり、Context/Decision/Consequences の実質的な内容変更を一切伴わない。この例外の適用範囲は本ADRが記録する当該7ファイルの再採番作業に限定し、以後の `accepted` ADRの `id` 変更一般を許容するものではない。

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
