# ADR

```yaml
id: ADR-0044
status: proposed
title: 配布rulesetテンプレートのdrift是正と専用App bindingの条件化
tags: [gate, ruleset, github-app, distribution, issue-sync]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/templates/github/provisioning/rulesets/main.json`（配布用branch ruleset定義）の `required_status_checks` は、`agent-skill-chain/{spec,design,implementation,validation}-gate` という4つのCheck Run contextを必須ステータスとして要求している。しかしこれら4つのCheck Runを発行していたworkflowファイル（`agent-skill-chain-gate.yml`・`agent-skill-chain-reconcile.yml`・`agent-skill-chain-trusted-gate.yml`）はIssue #386で実体・配布テンプレート双方から削除済みであり、これらのCheck Runを発行できるworkflowは現在どこにも存在しない。

Issue #386は同時に、このリポジトリ自身に適用中のbranch ruleset（`gh api repos/{owner}/{repo}/rulesets/19276510`で確認できる実体、id=19276510）から4つのgate checkを削除し`verify`のみを必須へ変更したが、`gh api`による直接PATCHで行われたため、配布テンプレートファイル自体（`main.json`）の更新が漏れていた。この結果、`init` → `setup github` という標準導入経路をそのまま辿るconsumerプロジェクトでは、誰も発行できないCheck Runがrequired statusとして設定され、admin bypass権限を持たない利用者は通常のPRを恒久的にマージできなくなる（ISSUE-593）。

加えて `gate publish`（`src/commands/gate.ts` の `publish()`）は、Check Run発行（`publishCheckRun()`）が失敗すると即座に処理を打ち切り、Issue/PR本文への成果物転記（`syncGateArtifacts()`、ADR-0021・ISSUE-567で既定有効化された`issue_sync`が使う経路）を一度も試行しない。`syncGateArtifacts()`自体はCheck Run発行の成否に依存しない独立した処理であるにもかかわらず、Check Run発行失敗のたびに道連れで実行されなくなっており、`issue_sync`が実質的に機能しない状態を生んでいる。

配布テンプレートの`required_status_checks`から4つのgate check contextを単純に削除するだけでは、既存の`setup.ts`の`renderRulesetWithDedicatedApp()`が機能しなくなるという副作用がある。同関数は、`ASC_GATE_APP_ID`環境変数が指す専用GitHub AppのApp IDを、4つのgate check contextそれぞれへ`integration_id`として結線する処理であり、（a）`ASC_GATE_APP_ID`が有効な値であること、（b）4つのgate check contextがそれぞれちょうど1件ずつ`required_status_checks`に存在することを無条件に要求する。4件を削除した既定テンプレートに対してこの関数を無変更のまま適用すると、`ASC_GATE_APP_ID`の設定有無によらず常に例外を投げ、`setup ruleset`／`setup github`自体が恒久的に失敗するという新たな回帰を生む。

検討した代替案:

- **配布テンプレートJSONのみを更新し、`renderRulesetWithDedicatedApp()`は無変更のまま残す**: 単純だが、上記の通り`setup ruleset`／`setup github`が常に失敗する新規回帰を生む。ISSUE-593のAC-2（標準導入経路でPRがマージ可能であること）・AC-4（テンプレートJSONをそのまま用いる経路の維持）の両方に反するため不採用。
- **`renderRulesetWithDedicatedApp()`とその呼び出し（`GATE_CHECK_NAMES`・`ASC_GATE_APP_ID`関連コード）自体を削除する**: 専用GitHub Appによる`integration_id`限定binding機構（ADR-0016のDecision節が言及する`dedicated_app`backend、ADR-0013が扱う強制identity）を将来再度活性化する経路を完全に断つことになる。ISSUE-593のスコープ外事項として明示的に除外されている「専用GitHub Appのinstallation tokenを用いたgate publishの完全運用の実装」を、実装ではなく解体という形で先取りしてしまうため不採用。
- **`renderRulesetWithDedicatedApp()`を、`required_status_checks`内にgate check contextが1件以上存在する場合のみ既存の検証・binding処理を適用し、1件も存在しない場合はテンプレートをそのまま返すよう条件化する（採用）**: 既定の配布テンプレート（4件を含まない）に対しては`ASC_GATE_APP_ID`非依存で`setup ruleset`／`setup github`が完走し、ISSUE-593のAC-2・AC-4を満たす。専用GitHub Appを既に導入し、手元のテンプレート複製へ4件のgate check contextを維持しているconsumer（ADR-0016のDecision節が触れる`dedicated_app`backendを選ぶ利用者）の経路には影響しない。将来の専用App運用手続き（ADR-0016が「未実施」と記録する運用ギャップ）が実施されればそのまま機能する状態を保つ。
- **`gate publish`のCheck Run発行と成果物転記を、それぞれ独立した2つのCLIサブコマンドへ分離する**: I/F変更が大きく、既存の呼び出し元（進行役の手動実行手順）を書き換える必要がある。`syncGateArtifacts()`をCheck Run発行成否と独立した`try/catch`で呼び出し順序を入れ替えるだけで同じ効果（転記の独立試行）を得られるため、より小さい変更で足りるこちらを不採用とし、呼び出し順序の変更のみを採用する。

## Decision

1. 配布テンプレート `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` の `required_status_checks.required_status_checks` から4つのgate check context（`agent-skill-chain/{spec,design,implementation,validation}-gate`）を削除し、`verify` の1件のみとする。これによりこのリポジトリ自身の現在適用中rulesetの内容と配布テンプレートを一致させる。
2. `src/commands/setup.ts` の `renderRulesetWithDedicatedApp()` を、`required_status_checks`内にgate check context（`agent-skill-chain/{spec,design,implementation,validation}-gate`のいずれか）が1件以上存在する場合のみ、既存の`ASC_GATE_APP_ID`必須化・4件一意性検証・`integration_id`結線処理を適用するよう条件化する。1件も存在しない場合（Decision 1適用後の既定テンプレート）は、`ASC_GATE_APP_ID`を要求せずテンプレートをそのまま返す。
3. `src/commands/gate.ts` の `publish()` において、`publishCheckRun()` の失敗判定（`return fail(...)`）を `syncGateArtifacts()` の呼び出しより後ろへ移動し、Check Run発行の成否に関わらず `syncGateArtifacts()` を常に試行する。
4. `docs/ASC_GATE_APP_ID_RUNBOOK.md` の前提記述（`setup ruleset`は常に`ASC_GATE_APP_ID`を要求する）を、Decision 2適用後の実際の挙動（既定テンプレートでは不要、gate check contextを手元のテンプレート複製へ再度加えた場合のみ必要）へ更新し、`gate publish`の現状の運用制約（Check Runを発行可能なCI workflowが存在しないこと、rulesetのrequired statusに現状寄与しないこと、進行役が任意実行する記録専用ツールであること）を明記する。

## Consequences

- 標準導入経路（`init` → `setup github`）を辿るconsumerプロジェクトは、`ASC_GATE_APP_ID`を設定せずとも`setup ruleset`が完走し、`gate publish`を一度も成功させられない状態でも通常のPRがマージ可能になる（ISSUE-593 AC-1・AC-2）。
- `gate publish`実行時、Check Run発行が失敗してもIssue/PR本文への成果物転記が独立して試行され、`issue_sync`（ADR-0021・ISSUE-567）が実質的に機能する（AC-3）。
- 専用GitHub Appを既に導入し、手元のテンプレート複製へ4件のgate check contextを維持しているconsumerの経路（ADR-0016のDecision節が言及する`dedicated_app`backend）には影響しない。
- `docs/ASC_GATE_APP_ID_RUNBOOK.md`は、既定の配布テンプレートに対しては手順自体が不要になる。同runbookが必要になるのは、利用者が意図的にgate check contextをテンプレート複製へ再度加える場合に限られる（AC-5）。
- 専用GitHub Appのinstallation tokenを用いた`gate publish`の完全運用（ADR-0016が言及する`dedicated_app`/`required_workflow`backend、ADR-0013「強制identityとworkflow attestationを満たすCheckだけをゲート正本にする」、`status: proposed`）の実装・活性化自体は本ADRの対象外のまま残る。将来これを実施する場合、`renderRulesetWithDedicatedApp()`の条件分岐（Decision 2）はそのままで、手元のテンプレート複製へgate check contextを追加するだけで機能する設計になっている。
