/**
 * 有限選択判断（deterministic codeでもGenerative Modelの深い推論でもない判断）の
 * 入出力を表すDecision Contract（Issue #1483、v0.4.1 Phase 0）。
 *
 * **この module は型定義と候補一覧だけを持ち、呼び出し実行ロジックを持たない。**
 * 実際にrouting/authorityへ組み込むこと（callableTargetを実際に呼び出す実行ロジック）は
 * v0.4.2（Issue #1485、Decision Type Registry・`agent-skill-chain decision invoke`・
 * `src/adapters/decision-invoke.ts`）が実装した。ここでは「この判断は有限選択として
 * 切り出せるか」を型とチェックリストで機械的に判定できる状態と、候補のfile:line一覧
 * だけを届ける。DCAND-001〜010の`executor`/`authorityMode`対応は
 * `src/domain/decision-types.ts`のDecision Type Registryが所有し、ここへ複製しない。
 *
 * **fail-open方向（quick化・tier降格・Gate PASS判定等）の呼び出し先は恒久的に対象外。**
 * `DecisionCallableTarget`にfail-open方向の識別子を追加しない。
 */
/**
 * C-02の候補一覧（実行時に自分でgrep・読み込みして実在確認済み。2026-09-25）。
 *
 * 採用9件（`disposition: "adopted"`、全件fail-closed方向。DCAND-001〜005はIssue #1483時点
 * から採用済み、DCAND-006/008/009/010はIssue #1485がDecision Skill自身（
 * `src/adapters/decision-invoke.ts`）をBR-01が要求する呼び出し元として新設し採用へ変更した）。
 * 除外3件（`disposition: "excluded"`、DCAND-007・011・012。BR-02（fail-open方向）または
 * 「有限選択の対象外」を理由に持つ。恒久的に対象外）。
 *
 * 詳細は`03_実装計画.md` T01配下の候補一覧表を正本とする。
 */
export const DECISION_CANDIDATES = Object.freeze([
    Object.freeze({
        id: "DCAND-001",
        label: "quick失格分類の検出（detectQuickDisqualifiers。変更fileのpathからdependency/public-api/data-migration/security-boundary/infrastructureを正規表現で推定する）",
        decisionSiteFile: "src/domain/mode.ts",
        decisionSiteLine: "484",
        decisionSiteAnchor: "export function detectQuickDisqualifiers",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/domain/issue.ts",
        callerLine: "1688",
        callerAnchor: "detectQuickDisqualifiers(options.changedFiles",
    }),
    Object.freeze({
        id: "DCAND-002",
        label: "CI run配信状態の3値判定（inspectCiDelivery/nextActionFor。固定30分の猶予閾値でdelivered/pending/undeliveredを判定し人間呼び出しの要否を返す）",
        decisionSiteFile: "src/domain/ci-delivery.ts",
        decisionSiteLine: "81",
        decisionSiteAnchor: "export function inspectCiDelivery",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/cli.ts",
        callerLine: "1738",
        callerAnchor: "inspectCiDelivery({",
    }),
    Object.freeze({
        id: "DCAND-003",
        label: "仕様更新要否の判定（requiresSpecUpdate。変更file pathの正規表現一致でdocs/specs/更新の要否を推定する）",
        decisionSiteFile: "src/domain/spec.ts",
        decisionSiteLine: "265",
        decisionSiteAnchor: "export function requiresSpecUpdate",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/cli.ts",
        callerLine: "7223",
        callerAnchor: "validateSpecs(root",
    }),
    Object.freeze({
        id: "DCAND-004",
        label: "個別監査表の行分類（auditRowDraft。変更fileを7分類＋fallbackへ正規表現cascadeで振り分け監査表を事前充填する）",
        decisionSiteFile: "src/domain/review-artifact.ts",
        decisionSiteLine: "564",
        decisionSiteAnchor: "export function auditRowDraft",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/domain/review-artifact.ts",
        callerLine: "654",
        callerAnchor: "auditRowDraft(item.path, item.changeType)",
    }),
    Object.freeze({
        id: "DCAND-005",
        label: "開発考慮事項の決定文言が具体的かの判定（hasConcreteDecisionText。長さ閾値＋定型文除外の正規表現でplaceholderを検出する）",
        decisionSiteFile: "src/domain/policy.ts",
        decisionSiteLine: "378",
        decisionSiteAnchor: "function hasConcreteDecisionText",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/domain/policy.ts",
        callerLine: "403",
        callerAnchor: "hasConcreteDecisionText(record[field], minimum)",
    }),
    Object.freeze({
        id: "DCAND-006",
        label: "review findingの検証記録に含める分類・理由の記入（進行役がfindingの分類と理由を記録する手順）",
        decisionSiteFile: ".agent-skill-chain/skills/step-10-review/SKILL.md",
        decisionSiteLine: "14",
        decisionSiteAnchor: "分類（severity等）と理由の記入（DCAND-006）は",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/adapters/decision-invoke.ts",
        callerLine: "241",
        callerAnchor: 'if (type.id === "DCAND-006") {',
    }),
    Object.freeze({
        id: "DCAND-007",
        label: "finding relationの分類（acceptance-violation等5種）",
        decisionSiteFile: "src/domain/review-convergence.ts",
        decisionSiteLine: "39-45",
        decisionSiteAnchor: "acceptance-violation",
        direction: "fail-open",
        disposition: "excluded",
        exclusionReason: "BR-02（fail-open方向に作用しうる分岐を含むため恒久的対象外）。呼び出し元はfindingAdmission（review-convergence.ts:423-507）で実在するが、improvement/out-of-scopeへの誤分類はrecord-only（gateを緩める側）に作用しうる",
    }),
    Object.freeze({
        id: "DCAND-008",
        label: "CodeRabbit利用枠制限の判定",
        decisionSiteFile: ".agent-skill-chain/docs/01_開発ワークフロー.md",
        decisionSiteLine: "214",
        decisionSiteAnchor: "CodeRabbitの利用枠制限の判定（DCAND-008）は",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/adapters/decision-invoke.ts",
        callerLine: "153",
        callerAnchor: 'case "DCAND-008": {',
    }),
    Object.freeze({
        id: "DCAND-009",
        label: "reviewer選定（Codex Sol/Opus）の判断",
        decisionSiteFile: ".agent-skill-chain/skills/step-10-review/SKILL.md",
        decisionSiteLine: "18",
        decisionSiteAnchor: "reviewer選定（DCAND-009）は",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/adapters/decision-invoke.ts",
        callerLine: "258",
        callerAnchor: 'if (authorityMode === "constrained-choice") {',
    }),
    Object.freeze({
        id: "DCAND-010",
        label: "「軽微な矛盾」3条件判定",
        decisionSiteFile: ".agent-skill-chain/docs/01_開発ワークフロー.md",
        decisionSiteLine: "266-272",
        decisionSiteAnchor: "軽微かどうかは判断ではなく次の3条件で決める",
        direction: "fail-closed",
        disposition: "adopted",
        callerFile: "src/adapters/decision-invoke.ts",
        callerLine: "273",
        callerAnchor: 'type.id === "DCAND-010" ? DCAND_010_SAFE_VALUE',
    }),
    Object.freeze({
        id: "DCAND-011",
        label: "Q-01〜Q-08モード判定質問への回答行為そのもの",
        decisionSiteFile: ".agent-skill-chain/docs/01_開発ワークフロー.md",
        decisionSiteLine: "25-30",
        decisionSiteAnchor: "を選べるかは次の8問で決める",
        direction: "fail-closed",
        disposition: "excluded",
        exclusionReason: "有限選択の対象外。validateModeQuestions等は構造検証のみで回答行為を行わない。回答は実際のdiff・設計意図を読む深い解釈的判断であり、本Issueが切り出す「有限選択」の外側と判断する。DCAND-001はこの領域のうち自動化済みの狭い一部分",
    }),
    Object.freeze({
        id: "DCAND-012",
        label: "classifyPackageAssets/validatePackageManifest（secret/credentialのfilename・content heuristic分類）",
        decisionSiteFile: "src/domain/enforcement.ts",
        decisionSiteLine: "1478-1481",
        decisionSiteAnchor: "export function classifyPackageAssets",
        direction: "fail-closed",
        disposition: "excluded",
        exclusionReason: "BR-01（呼び出し元を名指しできない）。`classifyPackageAssets`と`validatePackageManifest`（この分類結果を消費する入口）自体はsrc/cli.ts・scripts/check_package_contents.ts等のどこからも呼ばれていない（grep実測、production callerは0件）。内部heuristicの`pathIsSensitive`/`contentIsSensitive`は同fileの`validatePackageManifest`定義内から呼ばれるが、その`validatePackageManifest`自体が到達不能なため実行経路が存在しない。参照は`test/steps/risk-policy.steps.ts`のtestだけであり、Semantic Graphと同型の「実装されているが誰も呼ばない」状態（Step 10独立reviewで`pathIsSensitive`の呼び出し元を指摘され、`classifyPackageAssets`単体ではなく`validatePackageManifest`を含めて実測を訂正した）",
    }),
]);
//# sourceMappingURL=decision-contract.js.map