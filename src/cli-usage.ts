export interface UsageFlag {
  readonly name: string;
  readonly value: string;
  readonly description: string;
}

export interface ConditionalUsageFlag extends UsageFlag {
  readonly when: string;
}

export interface OptionalUsageFlag extends UsageFlag {
  readonly fallback: string;
}

export interface CommandUsage {
  readonly command: string;
  readonly subcommand?: string;
  readonly summary: string;
  readonly positional?: string;
  readonly requiredFlags: readonly UsageFlag[];
  readonly conditionalFlags: readonly ConditionalUsageFlag[];
  readonly optionalFlags: readonly OptionalUsageFlag[];
  readonly example: string;
  readonly acceptsSpaceSeparatedFlags?: boolean;
}

function flag(name: string, value: string, description: string): UsageFlag {
  return { name, value, description };
}

function conditional(
  name: string,
  value: string,
  description: string,
  when: string,
): ConditionalUsageFlag {
  return { name, value, description, when };
}

function optional(
  name: string,
  value: string,
  description: string,
  fallback: string,
): OptionalUsageFlag {
  return { name, value, description, fallback };
}

const APPLY_MODE: readonly OptionalUsageFlag[] = Object.freeze([
  optional(
    "dry-run",
    "",
    "書き込まずに計画だけを出力する",
    "--dry-runと--applyのどちらかが必要",
  ),
  optional(
    "apply",
    "",
    "計画を実際に適用する",
    "--dry-runと--applyのどちらかが必要",
  ),
]);

const ROOT_FLAG = optional(
  "root",
  "path",
  "対象repositoryのroot",
  "現在の作業directory",
);

export const COMMAND_USAGE: readonly CommandUsage[] = Object.freeze([
  {
    command: "graph",
    subcommand: "install",
    summary: "固定digestのGraphQLite extensionをpreviewまたは導入する",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example: "npx agent-skill-chain graph install --root=. --dry-run",
  },
  {
    command: "graph",
    subcommand: "rebuild",
    summary: "正本からworktree固有のGraphQLite派生投影を完全再構築する",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("built-at", "ISO8601", "投影構築時刻", "実行時刻"),
      ...APPLY_MODE,
    ],
    example: "npx agent-skill-chain graph rebuild --root=. --apply",
  },
  {
    command: "graph",
    subcommand: "status",
    summary: "正本とGraphQLite派生投影のdriftをread-onlyで検証する",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example: "npx agent-skill-chain graph status --root=.",
  },
  {
    command: "graph",
    subcommand: "impact",
    summary: "固定budgetの決定論的BFSで変更nodeの影響範囲を探索する",
    requiredFlags: [flag("start", "id,id", "探索開始node ID")],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("direction", "incoming|outgoing", "探索方向", "incoming"),
      optional(
        "edge-kinds",
        "kind,kind",
        "対象edge kind",
        "全deterministic edge",
      ),
      optional(
        "include-inferred",
        "",
        "inferred edgeを候補探索へ含める",
        "未指定時はdeterministic edgeだけをexact Evidence候補にする",
      ),
    ],
    example:
      "npx agent-skill-chain graph impact --root=. --start=file:src/cli.ts --direction=incoming",
  },
  {
    command: "graph",
    subcommand: "path",
    summary: "BFSまたはDijkstraで決定論的な説明経路を取得する",
    requiredFlags: [
      flag("from", "id", "開始node ID"),
      flag("to", "id", "終了node ID"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional(
        "edge-kinds",
        "kind,kind",
        "対象edge kind",
        "全deterministic edge",
      ),
    ],
    example:
      "npx agent-skill-chain graph path --root=. --from=requirement:REQ-WF-001 --to=file:src/cli.ts",
  },
  {
    command: "graph",
    subcommand: "order",
    summary: "Kahn法とiterative Tarjanで決定論的な実装順序またはcycleを返す",
    requiredFlags: [flag("edge-kinds", "kind,kind", "順序制約に使うedge kind")],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example:
      "npx agent-skill-chain graph order --root=. --edge-kinds=depends-on,imports",
  },
  {
    command: "routing",
    subcommand: "roles",
    summary: "同一scopeのrole割当が独立identityであることを検証する",
    requiredFlags: [
      flag("scope", "text", "role割当を評価するscope"),
      flag("assignments", "path", "role割当を記述したJSON file"),
    ],
    conditionalFlags: [],
    optionalFlags: [],
    example:
      "npx agent-skill-chain routing roles --scope=issue-886 --assignments=./assignments.json",
  },
  {
    command: "routing",
    subcommand: "tier",
    summary: "riskとmodeに対するmodel tier選択の妥当性を検証する",
    requiredFlags: [
      flag("risk", "text", "対象作業のrisk区分"),
      flag("mode", "quick|full|poc", "ワークフローmode"),
      flag("model", "text", "選択したmodel"),
      flag("selected", "text", "選択したtier"),
      flag("scope", "text", "評価するscope"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("justification", "text", "上位tierを選ぶ根拠", "根拠なし"),
    ],
    example:
      "npx agent-skill-chain routing tier --risk=high --mode=full --model=opus --selected=high --scope=issue-886",
  },
  {
    command: "routing",
    subcommand: "ceiling",
    summary: "provider別の自律選択上限と人間overrideを検証する",
    requiredFlags: [
      flag("issue", "整数", "対象Issue番号"),
      flag("scope", "text", "評価するscope"),
      flag("provider", "text", "選択したprovider"),
      flag("selection", "text", "選択の種別"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      optional("now", "ISO8601", "評価基準時刻", "実行時刻"),
      optional("override", "path", "人間overrideのJSON file", "overrideなし"),
    ],
    example:
      "npx agent-skill-chain routing ceiling --issue=886 --scope=issue-886 --provider=codex --selection=autonomous",
  },
  {
    command: "routing",
    subcommand: "observe",
    summary: "providerの実行入口が利用可能かを観測する",
    requiredFlags: [flag("provider", "text", "観測対象provider")],
    conditionalFlags: [],
    optionalFlags: [],
    example: "npx agent-skill-chain routing observe --provider=codex",
  },
  {
    command: "routing",
    subcommand: "resolve",
    summary: "role・provider・modelのroutingを解決する",
    requiredFlags: [
      flag("scope", "text", "解決するscope"),
      flag("coordinator", "text", "coordinatorのidentity"),
      flag("implementer", "text", "implementerのidentity"),
      flag("reviewer", "text", "reviewerのidentity"),
      flag("evaluator-ref", "text", "trusted evaluatorのref"),
    ],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example:
      "npx agent-skill-chain routing resolve --scope=issue-886 --coordinator=a --implementer=b --reviewer=c --evaluator-ref=main",
  },
  {
    command: "routing",
    subcommand: "independence",
    summary: "implementerとreviewerの独立性を検証する",
    requiredFlags: [
      flag("implementer", "text", "implementerのidentity"),
      flag("reviewer", "text", "reviewerのidentity"),
      flag("candidate-head", "sha", "candidateのhead SHA"),
      flag("trusted-ref", "text", "trusted側のref"),
      flag("evaluator-ref", "text", "trusted evaluatorのref"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      optional(
        "candidate-paths",
        "path,path",
        "candidateの変更path",
        "観測なし",
      ),
    ],
    example:
      "npx agent-skill-chain routing independence --implementer=b --reviewer=c --candidate-head=$(git rev-parse HEAD) --trusted-ref=main --evaluator-ref=main",
  },
  {
    command: "routing",
    subcommand: "evidence",
    summary: "routing証跡を記録する",
    positional:
      "<issue|complete|state|prune> 記録・整理する証跡の操作。issueは新規発行、completeは完了記録の追記、stateは状態遷移の追記、pruneは保持期限切れの整理",
    requiredFlags: [],
    conditionalFlags: [
      conditional("base-sha", "sha", "基点SHA", "位置引数がissueのとき"),
      conditional("issue", "整数", "Issue番号", "位置引数がissueのとき"),
      conditional("scope", "text", "scope", "位置引数がissueのとき"),
      conditional("role", "text", "role", "位置引数がissueのとき"),
      conditional(
        "route-mode",
        "text",
        "routing mode",
        "位置引数がissueのとき",
      ),
      conditional("provider", "text", "provider", "位置引数がissueのとき"),
      conditional("model", "text", "model", "位置引数がissueのとき"),
      conditional(
        "model-selection",
        "text",
        "model選択の種別",
        "位置引数がissueのとき",
      ),
      conditional(
        "routing-reason",
        "text",
        "routing判断の根拠",
        "位置引数がissueのとき",
      ),
      conditional(
        "reasoning-effort",
        "text",
        "reasoning effort",
        "位置引数がissueのとき",
      ),
      conditional(
        "service-tier",
        "text",
        "service tier",
        "位置引数がissueのとき",
      ),
      conditional("identity", "text", "実行identity", "位置引数がissueのとき"),
      conditional(
        "evaluator-ref",
        "text",
        "trusted evaluatorのref",
        "位置引数がissueのとき",
      ),
      conditional(
        "mapping-version",
        "text",
        "trusted mappingの版",
        "位置引数がissueのとき",
      ),
      conditional(
        "target-ids",
        "id,id",
        "対象requirement ID",
        "位置引数がpruneのとき",
      ),
      conditional(
        "implementation-head",
        "sha",
        "実装のhead SHA",
        "位置引数がcompleteのとき",
      ),
      conditional("digest", "sha256", "証跡digest", "位置引数がpruneのとき"),
      conditional(
        "evidence-id",
        "text",
        "証跡ID",
        "位置引数がcompleteまたはstateのとき",
      ),
      conditional("state", "text", "遷移先state", "位置引数がstateのとき"),
      conditional("end-state", "text", "終端state", "位置引数がcompleteのとき"),
      conditional("reason", "text", "遷移の根拠", "位置引数がstateのとき"),
    ],
    optionalFlags: [
      ROOT_FLAG,
      optional(
        "authorize",
        "approved",
        "pruneの--apply時に必要な承認",
        "承認なし",
      ),
      ...APPLY_MODE,
    ],
    example:
      "npx agent-skill-chain routing evidence state --evidence-id=EV-1 --state=recorded --end-state=closed --reason=完了 --dry-run",
  },
  {
    command: "workflow",
    subcommand: "steps",
    summary: "ワークフローStep定義とmode別の必須列を出力する",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [optional("mode", "quick|full|poc", "modeを絞る", "全mode")],
    example: "npx agent-skill-chain workflow steps --mode=full",
    acceptsSpaceSeparatedFlags: true,
  },
  {
    command: "workflow",
    subcommand: "verification-set",
    summary:
      "Requirement・受入条件・影響分析からrisk比例のVerification Setを選ぶ",
    requiredFlags: [
      flag("input", "path", "repository root内のVerification Set入力JSON file"),
    ],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example:
      "npx agent-skill-chain workflow verification-set --input=.asc/verification-input.json --root=.",
    acceptsSpaceSeparatedFlags: true,
  },
  {
    command: "workflow",
    subcommand: "assess-discovery",
    summary: "実装中の発見をmode別に評価し、前向きな処理先を決める",
    requiredFlags: [
      flag("input", "path", "repository root内の実装中発見入力JSON file"),
    ],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example:
      "npx agent-skill-chain workflow assess-discovery --input=.asc/discovery.json --root=.",
    acceptsSpaceSeparatedFlags: true,
  },
  {
    command: "workflow",
    subcommand: "promote-full",
    summary:
      "実装中発見の判定を同じIssue stagingへ適用しquickまたはpocをfullへ単調昇格する。既定は副作用なしのpreview",
    requiredFlags: [
      flag("staging", "path", "昇格するIssue staging directory"),
      flag("input", "path", "repository root内の実装中発見入力JSON file"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("promoted-at", "ISO8601", "昇格記録の時刻", "実行時刻"),
      optional(
        "dry-run",
        "",
        "書き込まずに昇格計画だけを出力する",
        "省略時もpreview",
      ),
      optional(
        "apply",
        "",
        "previewした昇格計画を実際に適用する",
        "指定しない限りpreview",
      ),
    ],
    example:
      "npx agent-skill-chain workflow promote-full --staging=.agent-skill-chain/tmp/issues/20260830_120000-change --input=.asc/discovery.json --root=. --apply",
    acceptsSpaceSeparatedFlags: true,
  },
  {
    command: "workflow",
    subcommand: "record",
    summary: "Step実施をstep journalへ追記する",
    requiredFlags: [
      flag("staging", "path", "staging directory"),
      flag("step", "1..10", "記録するStep番号"),
      flag("evidence", "text", "Stepの証跡"),
      flag("artifact", "path", "成果物。1件以上を繰り返し指定する"),
    ],
    conditionalFlags: [
      conditional(
        "review-session-digest",
        "sha256",
        "収束済みreview sessionのlatest round digest",
        "step=10のとき",
      ),
    ],
    optionalFlags: [optional("recorded-at", "ISO8601", "記録時刻", "実行時刻")],
    example:
      "npx agent-skill-chain workflow record --staging=.asc/886 --step=4 --evidence=実装完了 --artifact=src/cli-usage.ts",
    acceptsSpaceSeparatedFlags: true,
  },
  {
    command: "workflow",
    subcommand: "poc-observation",
    summary:
      "bubblewrap内で隔離fixtureの固定Node runnerを実行してPoC観測Evidenceを生成する",
    requiredFlags: [flag("staging", "path", "poc staging directory")],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example:
      "npx agent-skill-chain workflow poc-observation --staging=.agent-skill-chain/tmp/issues/20260830_120000-poc --root=. --apply",
    acceptsSpaceSeparatedFlags: true,
  },
  {
    command: "workflow",
    subcommand: "verify",
    summary: "step journalが必須Stepを満たすか検証する",
    requiredFlags: [flag("staging", "path", "staging directory")],
    conditionalFlags: [],
    optionalFlags: [optional("up-to", "0..11", "検証する上限Step", "11")],
    example:
      "npx agent-skill-chain workflow verify --staging=.asc/886 --up-to=4",
    acceptsSpaceSeparatedFlags: true,
  },
  {
    command: "issue",
    subcommand: "create",
    summary: "Issue本文の雛形を生成する",
    requiredFlags: [
      flag("title", "text", "Issueのtitle"),
      flag("mode", "quick|full|poc", "要求するworkflow mode"),
      flag(
        "assessment",
        "path",
        '質問IDをキーにした回答mapのJSON file。{"Q-01":{"answer":true|false|"unknown","evidence":"根拠"},…}の形式で、mode決定記録そのものは受理しない。回答か根拠が欠けたIDは不明として扱いfullへ倒す',
      ),
    ],
    conditionalFlags: [
      conditional(
        "poc-declaration",
        "path",
        "strict PocDeclaration JSON file",
        "--mode=pocのとき",
      ),
    ],
    optionalFlags: [
      ROOT_FLAG,
      optional("changed", "path,path", "既知の変更path", "なし"),
    ],
    example:
      "npx agent-skill-chain issue create --title=不具合 --mode=full --assessment=./assessment.json",
  },
  {
    command: "issue",
    subcommand: "validate",
    summary: "Issue本文が契約を満たすか検証する",
    positional: "[path] 検証するIssue本文。--pathの代わりに使える",
    requiredFlags: [flag("path", "path", "検証するIssue本文")],
    conditionalFlags: [],
    optionalFlags: [
      optional("stage", "text", "検証するstage", "既定stage"),
      optional("changed", "path,path", "変更path", "観測なし"),
    ],
    example: "npx agent-skill-chain issue validate --path=./ISSUE.md",
  },
  {
    command: "issue",
    subcommand: "sync",
    summary: "Issue本文をGitHubへ反映する",
    requiredFlags: [
      flag("issue", "整数", "対象Issue番号"),
      flag("repo", "owner/name", "対象repository"),
      flag("body-file", "path", "反映する本文file"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      optional("authorize", "approved", "書き込みの承認", "承認なし"),
      optional("checkpoint", "path", "checkpoint file", "checkpointなし"),
      optional("staging-path", "path", "staging directory", "既定path"),
      optional("synced-at", "ISO8601", "同期時刻", "実行時刻"),
      ...APPLY_MODE,
    ],
    example:
      "npx agent-skill-chain issue sync --issue=886 --repo=owner/name --body-file=./ISSUE.md --dry-run",
  },
  {
    command: "issue",
    subcommand: "staging",
    summary: "Issue stagingの保持期限を点検する",
    requiredFlags: [],
    conditionalFlags: [
      conditional(
        "approved-hash",
        "sha256",
        "削除計画の承認hash",
        "--applyを指定するとき",
      ),
    ],
    optionalFlags: [
      ROOT_FLAG,
      optional("retention-days", "整数", "保持日数", "既定の保持日数"),
      optional("now", "ISO8601", "評価基準時刻", "実行時刻"),
      optional("apply", "", "削除を適用する", "点検のみ"),
    ],
    example: "npx agent-skill-chain issue staging --root=.",
  },
  {
    command: "project",
    subcommand: "bootstrap",
    summary: "projectのquality契約を初期化する",
    requiredFlags: [flag("kind", "text", "初期化するprojectの種別")],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("new-project", "", "新規projectとして初期化する", "既存project"),
      optional("onboard-existing", "", "既存projectを取り込む", "新規扱い"),
      ...APPLY_MODE,
    ],
    example:
      "npx agent-skill-chain project bootstrap --kind=typescript --dry-run",
  },
  {
    command: "spec",
    subcommand: "validate",
    summary: "仕様書一式が契約を満たすか検証する",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("changed", "path,path", "変更path", "観測なし"),
      optional("review", "path", "review成果物", "review指定なし"),
    ],
    example: "npx agent-skill-chain spec validate --root=.",
  },
  {
    command: "review",
    subcommand: "round",
    summary: "固定anchorのreview roundをpreviewまたは永続化する",
    requiredFlags: [
      flag("staging", "path", "対象Issue staging"),
      flag("file", "path", "review round入力JSON"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      optional("apply", "", "roundをreview sessionへ永続化する", "preview"),
    ],
    example:
      "npx agent-skill-chain review round --staging=.agent-skill-chain/tmp/issues/20260830_120000-change --file=./review-round.json --apply",
  },
  {
    command: "review",
    subcommand: "validate",
    summary: "review成果物が契約を満たすか検証する",
    positional: "[file] 検証するreview成果物。--fileの代わりに使える",
    requiredFlags: [flag("file", "path", "検証するreview成果物")],
    conditionalFlags: [],
    optionalFlags: [],
    example:
      "npx agent-skill-chain review validate --file=./docs/reviews/47.md",
  },
  {
    command: "review",
    subcommand: "evidence",
    summary: "reviewの外部証拠を記録する",
    requiredFlags: [
      flag("artifact", "path", "review成果物"),
      flag("review-id", "text", "review識別子"),
      flag("run-id", "text", "CI run識別子"),
      flag("pr", "整数", "PR番号"),
      flag("repo", "owner/name", "対象repository"),
      flag("implementation-commit", "sha", "実装commit"),
      flag("final-commit", "sha", "最終commit"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("external", "path", "外部reviewの観測", "観測なし"),
      optional(
        "implementer-actor-id",
        "text",
        "implementerのactor ID",
        "観測なし",
      ),
    ],
    example:
      "npx agent-skill-chain review evidence --artifact=./docs/reviews/47.md --review-id=R-1 --run-id=1 --pr=909 --repo=owner/name --implementation-commit=aaa --final-commit=bbb",
  },
  {
    command: "trace",
    subcommand: "validate",
    summary: "要件・SCN・実装の追跡整合を検証する",
    requiredFlags: [flag("evidence", "path", "追跡証跡file")],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example: "npx agent-skill-chain trace validate --evidence=./trace.json",
  },
  {
    command: "conformance",
    subcommand: "validate",
    summary: "契約とbindingと証跡の一致を検証する",
    requiredFlags: [
      flag("contract", "path", "契約file"),
      flag("binding", "path", "binding file"),
      flag("evidence", "path", "証跡file"),
    ],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example:
      "npx agent-skill-chain conformance validate --contract=./c.json --binding=./b.json --evidence=./e.json",
  },
  {
    command: "policy",
    subcommand: "validate",
    summary: "project policyがtrusted契約を満たすか検証する",
    positional: "[file] 検証するpolicy file。--fileの代わりに使える",
    requiredFlags: [flag("file", "path", "検証するpolicy file")],
    conditionalFlags: [
      conditional(
        "trusted-commit",
        "sha",
        "trusted側commit",
        "explicit modeのいずれかのflagを指定したとき",
      ),
      conditional(
        "expected-base-sha",
        "sha",
        "期待するbase SHA",
        "explicit modeのいずれかのflagを指定したとき",
      ),
      conditional(
        "candidate-head-sha",
        "sha",
        "candidateのhead SHA",
        "explicit modeのいずれかのflagを指定したとき",
      ),
      conditional(
        "base-ref",
        "text",
        "base ref",
        "explicit modeのいずれかのflagを指定したとき",
      ),
      conditional(
        "default-branch",
        "text",
        "既定branch",
        "explicit modeのいずれかのflagを指定したとき",
      ),
      conditional(
        "repo",
        "owner/name",
        "対象repository",
        "explicit modeのいずれかのflagを指定したとき",
      ),
      conditional(
        "pr",
        "整数",
        "PR番号",
        "explicit modeのいずれかのflagを指定したとき",
      ),
    ],
    optionalFlags: [ROOT_FLAG],
    example:
      "npx agent-skill-chain policy validate --file=./.agent-skill-chain/project/policy.json",
  },
  {
    command: "policy",
    subcommand: "evaluate",
    summary: "trustedとcandidateのpolicy差を評価する",
    requiredFlags: [
      flag("trusted", "path", "trusted側policy"),
      flag("candidate", "path", "candidate側policy"),
    ],
    conditionalFlags: [],
    optionalFlags: [],
    example:
      "npx agent-skill-chain policy evaluate --trusted=./trusted.json --candidate=./candidate.json",
  },
  {
    command: "policy",
    subcommand: "enforce",
    summary: "policyを入力へ適用して判定する",
    requiredFlags: [
      flag("policy", "path", "適用するpolicy"),
      flag("input", "path", "判定対象の入力"),
    ],
    conditionalFlags: [],
    optionalFlags: [],
    example:
      "npx agent-skill-chain policy enforce --policy=./policy.json --input=./input.json",
  },
  {
    command: "policy",
    subcommand: "migrate",
    summary: "policyの版を移行する",
    requiredFlags: [],
    conditionalFlags: [
      conditional(
        "expected-revision",
        "整数",
        "期待するrevision",
        "--applyを指定するとき",
      ),
      conditional("state", "path", "移行state file", "--applyを指定するとき"),
      conditional(
        "approved-plan-hash",
        "sha256",
        "移行計画の承認hash",
        "--applyでapply操作を行うとき",
      ),
    ],
    optionalFlags: [
      optional(
        "operation",
        "apply|rollback|retry|recover",
        "移行操作",
        "apply",
      ),
      optional("trusted", "path", "trusted側policy", "指定なし"),
      optional("candidate", "path", "candidate側policy", "指定なし"),
      optional("manifest", "path", "manifest file", "指定なし"),
      optional("report", "path", "報告の出力先", "標準出力のみ"),
      ...APPLY_MODE,
    ],
    example: "npx agent-skill-chain policy migrate --dry-run",
  },
  {
    command: "worktree",
    subcommand: "create",
    summary: "規定の命名でworktreeを作成する",
    requiredFlags: [
      flag("issue", "整数", "対象Issue番号"),
      flag("branch", "text", "作成するbranch"),
      flag("slug", "text", "worktree名のslug"),
      flag("base", "text", "分岐元ref"),
      flag("remote-default-branch", "text", "remoteの既定branch"),
      flag("remote-default-sha", "sha", "remote既定branchのSHA"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional(
        "path",
        "path",
        "worktree path。repository相対で指定する",
        "現在時刻から自動構成する",
      ),
      optional("repo", "owner/name", "対象repository", "観測値"),
      ...APPLY_MODE,
    ],
    example:
      "npx agent-skill-chain worktree create --issue=886 --branch=feature/886-cli-usage --slug=cli-usage --base=main --remote-default-branch=main --remote-default-sha=$(git rev-parse origin/main) --apply",
  },
  {
    command: "worktree",
    subcommand: "survey",
    summary: "worktreeの後片付け可否を観測する",
    requiredFlags: [flag("root", "path", "対象repositoryのroot")],
    conditionalFlags: [],
    optionalFlags: [
      optional("format", "json|text", "出力形式", "json"),
      optional(
        "apply",
        "",
        "read-onlyのため受理しない。指定すると拒否する",
        "指定しない",
      ),
    ],
    example: "npx agent-skill-chain worktree survey --root=.",
  },
  {
    command: "worktree",
    subcommand: "hygiene",
    summary: "作業領域の残骸を点検し整理する",
    requiredFlags: [flag("root", "path", "対象repositoryのroot")],
    conditionalFlags: [
      conditional(
        "approved-hash",
        "sha256",
        "整理計画の承認hash",
        "--applyを指定するとき",
      ),
    ],
    optionalFlags: [optional("apply", "", "整理を適用する", "点検のみ")],
    example:
      "npx agent-skill-chain worktree hygiene --root=. --approved-hash=0000",
  },
  {
    command: "worktree",
    subcommand: "finalize",
    summary: "worktreeの後片付け計画を作成し適用する",
    requiredFlags: [
      flag("root", "path", "対象repositoryのroot"),
      flag("path", "path", "後片付けするworktree"),
      flag("evidence", "path", "finalize証跡のJSON file"),
    ],
    conditionalFlags: [
      conditional(
        "report-hash",
        "sha256",
        "計画報告の承認hash",
        "--applyを指定するとき",
      ),
      conditional(
        "merge-sha",
        "sha",
        "merge済みSHA",
        "--completeまたは--update-rootを指定するとき",
      ),
      conditional(
        "approved-digest",
        "sha256",
        "cleanup previewの承認digest",
        "--completeで実際に後片付けするとき",
      ),
      conditional(
        "cleanup-authority",
        "",
        "worktree cleanup操作の明示authority",
        "--completeで実際に後片付けするとき",
      ),
    ],
    optionalFlags: [
      optional("complete", "", "完了処理へ進む", "後片付けのみ"),
      optional("update-root", "", "rootを追随させる", "追随しない"),
      optional("authorize", "approved", "適用の承認", "承認なし"),
      ...APPLY_MODE,
    ],
    example:
      "npx agent-skill-chain worktree finalize --root=. --path=.worktrees/20260826_111243-886-cli-usage --evidence=./evidence.json --dry-run",
  },
  {
    command: "pr",
    subcommand: "create",
    summary: "契約を満たすPRを作成する",
    requiredFlags: [
      flag("issue", "整数", "対象Issue番号"),
      flag("repo", "owner/name", "対象repository"),
      flag("base", "text", "base branch"),
      flag("head", "text", "head branch"),
      flag("head-sha", "sha", "headのSHA"),
      flag("evidence", "path", "PR証跡のJSON file"),
      flag("body-file", "path", "template構造を満たすPR本文"),
    ],
    conditionalFlags: [],
    optionalFlags: [
      ROOT_FLAG,
      optional("title", "text", "PRタイトル", "本文のH1見出し"),
      optional("authorize", "approved", "作成の承認", "承認なし"),
      optional("canonical-issue", "整数", "正本Issue番号", "--issueと同じ"),
      optional("relates", "整数,整数", "関連Issue番号", "関連なし"),
      optional("staging", "path", "staging directory", "既定path"),
      optional(
        "workflow-override",
        "path",
        "欠落StepのHumanOverride",
        "overrideなし",
      ),
      ...APPLY_MODE,
    ],
    example:
      "npx agent-skill-chain pr create --issue=886 --repo=owner/name --base=main --head=feature/886-cli-usage --head-sha=$(git rev-parse HEAD) --evidence=./evidence.json --body-file=./PR.md --dry-run",
  },
  {
    command: "pr",
    subcommand: "merge",
    summary: "PRを許可されたmerge方式でmergeする",
    requiredFlags: [
      flag("repo", "owner/name", "対象repository"),
      flag("pr", "整数", "PR番号"),
      flag("method", "merge|squash|rebase", "merge方式"),
      flag("staging", "path", "Step 10までを検証するstaging directory"),
    ],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example:
      "npx agent-skill-chain pr merge --repo=owner/name --pr=909 --method=merge --staging=.agent-skill-chain/tmp/issues/20260830_120000_909-example --dry-run",
  },
  {
    command: "pr",
    subcommand: "reanchor",
    summary: "rebase後のPR証跡を内容等価性つきで新headへ再固定する",
    requiredFlags: [
      flag("staging", "path", "対象Issue staging"),
      flag("new-head", "sha", "rebase後のhead SHA"),
      flag("new-base", "sha", "rebase後のbase SHA"),
      flag("reason", "text", "再固定の理由"),
    ],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example:
      "npx agent-skill-chain pr reanchor --staging=.agent-skill-chain/tmp/issues/20260901_120000_example --new-head=$(git rev-parse HEAD) --new-base=$(git rev-parse origin/main) --reason=既定branchが動いたためrebaseした --dry-run",
  },
  {
    command: "review",
    subcommand: "reanchor",
    summary: "PR作成前のreview証跡を内容等価性つきで新headへ再固定する",
    requiredFlags: [
      flag("staging", "path", "対象Issue staging"),
      flag("new-head", "sha", "rebase後のhead SHA"),
      flag("new-base", "sha", "rebase後のbase SHA"),
      flag("reason", "text", "再固定の理由"),
    ],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example:
      "npx agent-skill-chain review reanchor --staging=.agent-skill-chain/tmp/issues/20260901_120000_example --new-head=$(git rev-parse HEAD) --new-base=$(git rev-parse origin/main) --reason=既定branchが動いたためrebaseした --dry-run",
  },
  {
    command: "install",
    summary: "host skillとmanaged assetを展開する",
    positional: "[root] 対象repositoryのroot。--rootの代わりに使える",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example: "npx agent-skill-chain install --root=. --apply",
  },
  {
    command: "update",
    summary: "展開済みhost skillとmanaged assetを更新する",
    positional: "[root] 対象repositoryのroot。--rootの代わりに使える",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example: "npx agent-skill-chain update --root=. --apply",
  },
  {
    command: "delete",
    summary: "展開済みhost skillとmanaged assetを削除する",
    positional: "[root] 対象repositoryのroot。--rootの代わりに使える",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG, ...APPLY_MODE],
    example: "npx agent-skill-chain delete --root=. --dry-run",
  },
  {
    command: "doctor",
    summary: "repositoryの健全性を診断する",
    positional: "[root] 対象repositoryのroot。--rootの代わりに使える",
    requiredFlags: [],
    conditionalFlags: [],
    optionalFlags: [ROOT_FLAG],
    example: "npx agent-skill-chain doctor --root=.",
  },
]);

export function usageKey(command: string, subcommand?: string): string {
  return subcommand ? `${command} ${subcommand}` : command;
}

export function findCommandUsage(
  command: string,
  subcommand: string | undefined,
): CommandUsage | undefined {
  const withSubcommand = COMMAND_USAGE.find(
    (usage) =>
      usage.command === command &&
      usage.subcommand !== undefined &&
      usage.subcommand === subcommand,
  );
  if (withSubcommand) return withSubcommand;
  return COMMAND_USAGE.find(
    (usage) => usage.command === command && usage.subcommand === undefined,
  );
}

export function valueFlagNames(usage: CommandUsage): readonly string[] {
  return [
    ...usage.requiredFlags,
    ...usage.conditionalFlags,
    ...usage.optionalFlags,
  ]
    .filter((item) => item.value !== "")
    .map((item) => item.name);
}

export function missingRequiredFlags(
  usage: CommandUsage,
  provided: Readonly<Record<string, string | boolean>>,
  positionals: readonly string[] = [],
): readonly string[] {
  const positionalSubstitute =
    usage.positional !== undefined && positionals.length > 0;
  return usage.requiredFlags
    .filter((item, index) => {
      if (positionalSubstitute && index === 0) return false;
      const value = provided[item.name];
      return typeof value !== "string" || value === "";
    })
    .map((item) => item.name);
}

export function renderUsage(usage: CommandUsage): Record<string, unknown> {
  const render = (item: UsageFlag): string =>
    item.value === "" ? `--${item.name}` : `--${item.name}=<${item.value}>`;
  return {
    command: usageKey(usage.command, usage.subcommand),
    summary: usage.summary,
    ...(usage.positional === undefined ? {} : { positional: usage.positional }),
    requiredFlags: usage.requiredFlags.map((item) => ({
      flag: render(item),
      description: item.description,
    })),
    conditionalFlags: usage.conditionalFlags.map((item) => ({
      flag: render(item),
      description: item.description,
      when: item.when,
    })),
    optionalFlags: usage.optionalFlags.map((item) => ({
      flag: render(item),
      description: item.description,
      fallback: item.fallback,
    })),
    example: usage.example,
    note: "flagは--名前=値の形式で指定します。空白区切りは受理しません",
  };
}

export class CliValidationError extends Error {
  readonly reasons: readonly string[];
  readonly next: string;
  constructor(reasons: readonly string[], next: string) {
    super(reasons.join(" / "));
    this.name = "CliValidationError";
    this.reasons = reasons;
    this.next = next;
  }
}

export function missingFlagsError(
  usage: CommandUsage,
  missing: readonly string[],
): CliValidationError {
  return new CliValidationError(
    missing.map((name) => `--${name}=...が必要です`),
    `npx agent-skill-chain ${usageKey(usage.command, usage.subcommand)} --help でusageを確認してください`,
  );
}

export function spaceSeparatedFlagError(
  usage: CommandUsage,
  name: string,
): CliValidationError {
  return new CliValidationError(
    [
      `--${name}は空白区切りでは受理しません。--${name}=値の形式で指定してください`,
    ],
    `npx agent-skill-chain ${usageKey(usage.command, usage.subcommand)} --help でusageを確認してください`,
  );
}
