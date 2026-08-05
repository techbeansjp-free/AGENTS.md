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

現行の`launch_worker()`はlease取得からサブプロセスのwait・完了確認・lease解放までを1回のBashツール呼び出し内で完結させている。しかしAgent toolを呼び出す主体は進行役を駆動するLLM自身であり、シェルスクリプトからその呼び出しを代理発行することはできない。したがって新方式では、`_dispatch_via_agent_tool()`（`claude.sh`新設）がlease取得とrole_contract取得までを行い、role_contractを一時ディレクトリ内のファイル（`contract.md`）へ書き出したうえで、そのファイルパスと固定・短文のdispatch指示テンプレートのみを標準出力へ書いて新規exit code `4`（"dispatch_required"）で復帰する（role_contract本文そのものは標準出力へ一切書かない。理由はDecision 2参照）。leaseはここでは解放しない。進行役はこの出力を受けて自らAgent toolを呼び出し（`subagent_type: "agent-skill-chain-worker"`、`prompt`に定型文＋contractファイルの絶対パスのみ、`run_in_background: false`）、呼び出しが完了した後に新規スクリプト`worker-launch-verify.sh`を実行して完了確認とlease解放を行う。

**2. I5の両立は「輸送経路の変更であって著述主体の変更ではない」ことに加え、「role_contract本文が進行役自身の生成コンテキストへ一度も入らない」ことで成立させる。**

当初案（role_contract本文をBashツールの標準出力へ書き、進行役がそれをそのままAgent toolの`prompt`引数として再送出する）はdesign-gate round1で反証された。現行方式が真に安全である根拠は「著述主体・commit主体が変わらない」ことだけではなく、より根本的には`launch_worker()`が`contract="$(_asc_cli segment start ...)"`で取得したcontractを`printf '%s' "$contract" >"$prompt_file"`で一時ファイルへ書き出し`bash -c "$worker_cmd" <"$prompt_file"`とファイルリダイレクトで渡す、という一連の操作が単一のBashツール呼び出し内でシェルプロセス自身により完結し、進行役LLMが実際に生成するコマンド文字列にcontractの内容が一切現れないことにある。Bashツールの標準出力として一度LLMの生成コンテキストへ読み込まれた内容を、そのまま次のツールコール引数として再送出する行為は、たとえ「加工しない」という指示があっても、この不変条件（LLMの生成過程にcontract全文を通過させない）を破る。

採用した設計はこの性質をAgent tool経由でも再現する：`_dispatch_via_agent_tool()`はcontract本文を`mktemp -d`で作った一時ディレクトリ（worktree外・Git非追跡・`chmod 700`）内のファイルへ書き出すのみで標準出力へは一切書かず、進行役へはcontractの内容に一切依存しない固定・短文のdispatch指示テンプレートとファイルパスだけを返す。Agent toolの`prompt`引数として進行役が実際に生成するのはこの定型文＋パスのみであり、これは「調整状態の読み書き」（Agent tool呼び出しというコマンド操作）に留まる。role_contract本文は、Agent tool呼び出しで起動されたサブエージェント自身が自分のRead tool呼び出しでファイルから直接読み込む。進行役の生成コンテキストにcontract本文が入ることは一度も無く、実際の成果物編集・commit・push・完了報告は従来通りサブエージェント自身が既存の`checkpoint.sh`（writer lease credential経由）・`report-status.sh`を呼び出して行う。この設計は同時にAC-4（role_contract全文が加工・要約・追記なく伝わること）についても、進行役LLMが長大な本文をツールコール引数として再生成する必要があった当初案より頑健である（サブエージェントがファイルをバイト単位で読み込むため、生成過程での省略・言い換えのリスクが構造的に存在しない）。

**3. I3の両立は「新しい独立性を作る」のではなく「既存の耐久性安全網に委ねる」ことで成立させる。ただし待機中のlease renewalには専用の独立デーモンを設ける。**

Agent tool経由のworker実行は進行役セッションの生存に本質的に紐づく。この独立性の喪失自体は解消しない。その代わり、(a) Agent tool呼び出しを`run_in_background: false`で行うことを必須化し、現行の`wait "$worker_pid"`と同じ「進行役のターンが正常終了する＝workerも完了している」というブロッキング的性質を保つ。(b) 進行役セッションが異常終了した場合の回復は、新方式専用の仕組みを新設せず、既存のwriter lease TTL失効・ADR-0024（credentialなしreclaim）・`issue-resume.sh`という既存の安全網にそのまま委ねる。これは新方式で失敗が「発生し得る頻度」を増やすが、失敗から回復する「手段の種類」を増やさない、という設計判断である。この受容自体が、要件8がこの新方式を既定無効のopt-inとする理由の一部である。

現行方式のlease renewal（サブプロセス生存中`renewal_interval_seconds`ごとに`renew_lease`を呼ぶ処理）は`launch_worker()`内の1回のBashツール呼び出しに閉じたバックグラウンドサブシェルとして実装されているが、新方式ではAgent tool呼び出しによるブロッキング待機がそのBashツール呼び出しの外側（進行役の別ターン）で起きるため、同じ実装では待機期間をカバーできない。そこで`_dispatch_via_agent_tool()`は、同じrenewループ本体を`setsid`で切り離した独立デーモンプロセス（`_dispatch_lease_renew_daemon()`）として起動し、起動元のBashツール呼び出し終了後も生存させる。デーモンは新規env`ASC_DISPATCH_MAX_WAIT_SEC`（既定7200秒）を超えたら自己終了し、無期限延命は行わない——進行役がAgent tool呼び出しを行わず放置した場合や、呼び出し中に進行役セッションが異常終了した場合も、最終的には(b)と同じ既存のTTL失効・reclaim・resumeの安全網に委ねられる（検知までの時間が延びるだけで、回復手段の種類は増えない）。`worker-launch-verify.sh`はcontractファイルと同じ一時ディレクトリのPIDファイルを読み取れればデーモンを`kill`してからディレクトリごと削除する。

**4. ツール許可範囲の粒度低下を受容し、既定off・限定的なツール一覧で緩和する。**

現行の`--allowed-tools`はBashコマンド単位（例: `Bash(git commit:*)`）の許可制御を提供するが、Claude Codeのカスタムsubagent種別（`.claude/agents/*.md`の`tools:`フロントマター）はツール単位（`Bash`全体の可否等）でしか制御できない。同じ粒度の多重防御は再現できないため、新設するカスタムsubagent種別`agent-skill-chain-worker`では、少なくとも`Agent`（無制限な再帰dispatchの防止）・`ExitPlanMode`・`NotebookEdit`・`WebFetch`・`WebSearch`・`Artifact`を明示的に除外し、ワーカーの正規責務範囲に含まれるツールのみ（`Read, Grep, Glob, Edit, Write, MultiEdit, Bash`）を許可する。Bashコマンド単位の防御層が1つ減ることは既知のリスクとして受容し、要件8の既定無効（opt-in）がこのリスクの実害露出を限定する。

## Consequences

- opt-in（`worker.agent_tool_dispatch.enabled`、既定false）を有効化しない限り、既存のheadless subprocess方式は一切変更されない（AC-2/AC-7/AC-8）。ロールバックは設定を戻すだけで完結する。
- 起動フローが1回のスクリプト呼び出しから「script→進行役操作→script」の3段構成に変わるため、進行役側の手順（Agent tool呼び出し方法・完了後の確認スクリプト実行）が新たな運用知識として必要になる。この手順は`.agent-skill-chain/standards/`に正本を置き、dispatch payload自体にも要旨を都度含める。
- 進行役セッションの生存にworker実行が紐づくという、headless subprocess方式には無かった性質を新たに受け入れる。この性質はopt-inを有効化したプロジェクト・Issueにのみ影響し、既存の耐久性安全網（lease TTL・reclaim・resume）の範囲内で回復可能である。
- Bashコマンド単位のツール許可制御という多重防御の1層が、新方式では利用できない。将来的な緩和（例: フックによる補完）は本Issueのスコープ外とし、必要であれば別Issueで扱う。
- role_contract本文を保持する一時ディレクトリ・lease renewal専用の独立デーモンプロセスという、headless subprocess方式には無かった実行時アーティファクトが増える。いずれもworktree外・Git非追跡・上限付き生存期間（`ASC_DISPATCH_MAX_WAIT_SEC`）であり、`worker-launch-verify.sh`が正常経路で回収する。回収漏れが起きても既存のTTL失効安全網でカバーされ、成果物やcredentialの漏えいには繋がらない。
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
