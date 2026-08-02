# ADR

```yaml
id: ADR-0018
status: accepted
title: gate-reportがpendingであることを、verify-and-publishジョブの失敗ではなくaction_required Check Runとして表現する
tags: [ci, gate, check-run]
supersedes: []
superseded-by: ADR-0019
deprecated-reason: null
```

## Context

`.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish`ジョブは、`gate verify-evidence`が生成したgate-reportを`verify gate-report`（`src/commands/verify.ts`の`gateReport()`）で検査する。同関数は`gate.conformance`・`gate.falsification`・`gate.final`のいずれかが`pending`（レビュー未了、GitHub Reviewがまだ提出されていない等の正常状態）であることも、スキーマ違反・digest不一致・target_sha不正と同じ「違反」として扱い、単一のexit 1で表現していた。`set -euo pipefail`下のジョブはこの時点で停止し、`agent-skill-chain/<gate>-gate`という名前のCheck Runを一度も発行しないままFAILUREで終了する。2026-08-02実測で、当時オープンだった全Issue駆動PR（#345等）がこの経路で恒常的に赤くなっていることを確認した（Issue #349）。

検討した代替案:
- **workflow側でstderr文言を正規表現マッチしてpending判定する案**: CLI側の出力文言を変更するたびにworkflow側の正規表現が追従を要し、`AGENTS.md`が禁止する「行番号・見出し位置参照」に類する陳腐化リスクを本質的に抱える。構造化された終了コードによる契約より壊れやすいため採用しない。
- **`verify gate-report`をpendingの場合は無条件にexit 0とする案**: スキーマ違反やdigest不一致が同時に存在していてもexit 0になりうる（曖昧な優先順位付け）。I8（安全側ラチェット）が求める「降格は自動、昇格は人間の明示行為のみ」の趣旨に反し、fail-open方向の後退を許してしまうため採用しない。
- **exit codeでpendingのみの場合と他の違反を区別する案（採用）**: 「pending以外の理由（otherErrors）が1件でも存在すれば無条件にexit 1」を優先させ、pending判定は`otherErrors`が完全に0件の場合にのみ働く排他的なexit 2として新設する。既存のexit 0/1の意味は変更せず、後方互換なpendingケースだけを新しい終了コードで区別できる。

## Decision

`verify gate-report`（`src/commands/verify.ts`の`gateReport()`）の違反集計を、`conformance`/`falsification`/`final`のpending検出による`pendingErrors`と、スキーマ検証・target_sha検証・approved_artifacts検証による`otherErrors`に分離する。`otherErrors`が1件でも存在すれば従来通りexit 1とする。`otherErrors`が0件で`pendingErrors`が1件以上ある場合に限り、新設のexit 2を返す。

`agent-skill-chain-gate.yml`の`verify-and-publish`ジョブの`Verify gate report schema`ステップは、exit code 2を検出した場合のみ、既存の`Verify local-review evidence`ステップと同型の`gh api check-runs`呼び出しで`agent-skill-chain/<gate>-gate`という名前のaction_required Check Runを対象SHAへ発行したうえで、ジョブ自体はexit 0（成功）で終了する。exit code 0・1の扱いは変更しない。

同ジョブの`detect-segments`には、`agent-skill-chain-ci.yml`・`agent-skill-chain-reconcile.yml`と同型のdependabot/自動化ブランチskip分岐（PR作成者が`dependabot[bot]`かつブランチが`dependabot/*`の場合にIssue ID抽出失敗をskip扱いにする）を追加する。

## Consequences

- レビュー未了であるだけの正常な状態のPRで、`verify-and-publish`ジョブが恒常的にFAILUREになる問題が解消され、`agent-skill-chain/<gate>-gate`のCheck Runがaction_requiredとして常に発行されるようになる。マージ可否の実効的制御は引き続きこのCheck Run（required status）が担う。
- `verify gate-report`の呼び出し元が増えた場合、新設したexit 2の意味（違反ではなくpending）を無視して単純に「非0=失敗」と扱うと誤動作しうる。現時点での呼び出し元は`agent-skill-chain-gate.yml`の1箇所のみであり、新規呼び出し元を追加する際はこのADRを参照して終了コードの意味を踏襲する必要がある。
- 既存の単体テスト（`test/integration/verify.test.ts`のpendingのみgate-reportを検証するケース）はexit status 1を期待しており、本決定に伴いexit status 2を期待するよう更新が必要になる（Issue #349のPLAN.mdで実装ワーカーへ申し送り済み）。
- dependabotブランチでの`detect-segments`失敗ノイズが解消される。

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
