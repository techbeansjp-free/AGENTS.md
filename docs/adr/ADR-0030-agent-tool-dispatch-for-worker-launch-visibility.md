# ADR

```yaml
id: ADR-0030
status: proposed
title: worker-launch.shのsegment worker起動をAgent tool経由へ切り替える方式——lease/segment start/dispatch/verifyの4段分割
tags: [worker-launch, agent-tool, subagent-visibility, writer-lease, durability, claude-code]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`ISSUE-448`は、進行役がClaude Code CLIセッションである場合に`.agent-skill-chain/scripts/worker-launch.sh`が起動するsegment worker（spec/design/implementation/validation）を、進行役セッションのサブエージェントツリー上に表示させることを求める。現行の`.agent-skill-chain/adapters/claude.sh`の`launch_worker()`は、`bash -c "claude -p ..." &`という進行役プロセスから完全に独立したサブプロセスとしてworkerを起動しており、Claude CodeのUIはこれを進行役自身が発行したAgent tool呼び出しとしてしか認識しないため、この起動方式ではツリーに一切現れない。

この変更は2つの不変条件と衝突しうる。

1. **AGENTS.md I5（進行役の純粋性）**: 進行役は調整状態のみを読み書きし、成果物の著述・取り込みを行わない。Agent tool経由での起動は、字面上「進行役自身がworkerを発行する」ように見えるため、この境界を侵さないことを構造的に示す必要がある。
2. **AGENTS.md I3（耐久性）**: headless subprocess方式は進行役プロセスの生死に影響されず動作する。Agent tool経由の起動がこの独立性を失うのであれば、進行役セッション終了時にworkerがどうなるかという新しい失敗経路が生じる。

SPEC.mdはこの両立可否をdesign segmentでの技術検証事項として明示的に残し（未決事項1・2）、検証結果次第でopt-in設定（既定無効）として導入することを要件8・AC-8で定めている。本ADRはその検証結果と、採用した設計上の決定を記録する。

## Decision

**1. Bashスクリプト単体ではAgent tool呼び出しを起動できないため、起動フローを「lease取得・contract取得（script）→Agent tool呼び出し（進行役自身の判断・操作）→完了確認・lease解放（script）」の3段に分割する。**

現行の`launch_worker()`はlease取得からサブプロセスのwait・完了確認・lease解放までを1回のBashツール呼び出し内で完結させている。しかしAgent toolを呼び出す主体は進行役を駆動するLLM自身であり、シェルスクリプトからその呼び出しを代理発行することはできない。したがって新方式では、`_dispatch_via_agent_tool()`（`claude.sh`新設）がlease取得とrole_contract取得までを行い、role_contract本文と進行役向けのdispatch手順を標準出力へ書いて新規exit code `4`（"dispatch_required"）で復帰する。leaseはここでは解放しない。進行役はこの出力を受けて自らAgent toolを呼び出し（`subagent_type: "agent-skill-chain-worker"`、`prompt`にcontract本文をそのまま、`run_in_background: false`）、呼び出しが完了した後に新規スクリプト`worker-launch-verify.sh`を実行して完了確認とlease解放を行う。

**2. I5の両立は「輸送経路の変更であって著述主体の変更ではない」ことにより成立させる。**

現行方式でも進行役はrole_contract全文をstdin経由で「読まずに」中継しているに過ぎず、実際の成果物編集・commit・push・完了報告はサブプロセス内で走るワーカー自身が既存の`checkpoint.sh`（writer lease credential経由）・`report-status.sh`を呼び出して行う。新方式は`prompt`引数を輸送経路として使うだけで、この構造を変えない。進行役側が行うのは、contract本文を一切加工せずAgent toolへ渡すことと、完了確認スクリプトを起動することの2点であり、これはいずれも「調整状態の読み書き」（Agent tool呼び出しというコマンド操作、lease/report確認というコマンド操作）であって「成果物の著述」ではない。dispatch payloadのうちcontract本文以外の部分（`subagent_type`・待機手順等）は進行役が生成する運用メタデータであり、成果物の内容そのものではないため、これも同じ区分で扱う。

**3. I3の両立は「新しい独立性を作る」のではなく「既存の耐久性安全網に委ねる」ことで成立させる。**

Agent tool経由のworker実行は進行役セッションの生存に本質的に紐づく。この独立性の喪失自体は解消しない。その代わり、(a) Agent tool呼び出しを`run_in_background: false`で行うことを必須化し、現行の`wait "$worker_pid"`と同じ「進行役のターンが正常終了する＝workerも完了している」というブロッキング的性質を保つ。(b) 進行役セッションが異常終了した場合の回復は、新方式専用の仕組みを新設せず、既存のwriter lease TTL失効・ADR-0024（credentialなしreclaim）・`issue-resume.sh`という既存の安全網にそのまま委ねる。これは新方式で失敗が「発生し得る頻度」を増やすが、失敗から回復する「手段の種類」を増やさない、という設計判断である。この受容自体が、要件8がこの新方式を既定無効のopt-inとする理由の一部である。

**4. ツール許可範囲の粒度低下を受容し、既定off・限定的なツール一覧で緩和する。**

現行の`--allowed-tools`はBashコマンド単位（例: `Bash(git commit:*)`）の許可制御を提供するが、Claude Codeのカスタムsubagent種別（`.claude/agents/*.md`の`tools:`フロントマター）はツール単位（`Bash`全体の可否等）でしか制御できない。同じ粒度の多重防御は再現できないため、新設するカスタムsubagent種別`agent-skill-chain-worker`では、少なくとも`Agent`（無制限な再帰dispatchの防止）・`ExitPlanMode`・`NotebookEdit`・`WebFetch`・`WebSearch`・`Artifact`を明示的に除外し、ワーカーの正規責務範囲に含まれるツールのみ（`Read, Grep, Glob, Edit, Write, MultiEdit, Bash`）を許可する。Bashコマンド単位の防御層が1つ減ることは既知のリスクとして受容し、要件8の既定無効（opt-in）がこのリスクの実害露出を限定する。

## Consequences

- opt-in（`worker.agent_tool_dispatch.enabled`、既定false）を有効化しない限り、既存のheadless subprocess方式は一切変更されない（AC-2/AC-7/AC-8）。ロールバックは設定を戻すだけで完結する。
- 起動フローが1回のスクリプト呼び出しから「script→進行役操作→script」の3段構成に変わるため、進行役側の手順（Agent tool呼び出し方法・完了後の確認スクリプト実行）が新たな運用知識として必要になる。この手順は`.agent-skill-chain/standards/`に正本を置き、dispatch payload自体にも要旨を都度含める。
- 進行役セッションの生存にworker実行が紐づくという、headless subprocess方式には無かった性質を新たに受け入れる。この性質はopt-inを有効化したプロジェクト・Issueにのみ影響し、既存の耐久性安全網（lease TTL・reclaim・resume）の範囲内で回復可能である。
- Bashコマンド単位のツール許可制御という多重防御の1層が、新方式では利用できない。将来的な緩和（例: フックによる補完）は本Issueのスコープ外とし、必要であれば別Issueで扱う。
- 本ADRは技術検証の結果を記録するものであり、`DESIGN.md`・`PLAN.md`と対を成す。実装は本Issueの実装segmentで行う。

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
