/**
 * 有限選択判断（deterministic codeでもGenerative Modelの深い推論でもない判断）の
 * 入出力を表すDecision Contract（Issue #1483、v0.4.1 Phase 0）。
 *
 * **この module は型定義と候補一覧だけを持ち、呼び出し実行ロジックを持たない。**
 * 実際にrouting/authorityへ組み込むこと（callableTargetを実際に呼び出す実行ロジック）は
 * v0.4.2以降が実装する。ここでは「この判断は有限選択として切り出せるか」を型と
 * チェックリストで機械的に判定できる状態と、候補のfile:line一覧だけを届ける。
 *
 * **fail-open方向（quick化・tier降格・Gate PASS判定等）の呼び出し先は恒久的に対象外。**
 * `DecisionCallableTarget`にfail-open方向の識別子を追加しない。
 */

/** 有限選択判断の呼び出し先候補。fail-open方向の値を追加しない。 */
export type DecisionCallableTarget = "lightweight-tier" | "jev" | "unassigned";

/** 有限選択判断1件の入出力。 */
export interface DecisionContract<TValue extends string = string> {
  /** 判断の結果値。 */
  readonly value: TValue;
  /** 判断の確信度。0以上1以下。 */
  readonly confidence: number;
  /** この判断を委ねる呼び出し先。fail-open方向の値は型として存在しない。 */
  readonly callableTarget: DecisionCallableTarget;
}

/** 候補が現在fail-closed方向かfail-open方向かの分類。fail-open候補は恒久的に対象外（BR-02）。 */
export type DecisionCandidateDirection = "fail-closed" | "fail-open";

interface DecisionCandidateEntryBase {
  /** 安定ID。`DCAND-`+3桁連番。`DC-`接頭辞は開発考慮事項ID（DC-PRIVACY等）と衝突するため使わない。 */
  readonly id: string;
  /** 候補の短い説明。 */
  readonly label: string;
  /** 判断（または判断の代替となる heuristic）が行われる場所。 */
  readonly decisionSiteFile: string;
  /** `decisionSiteFile`内の行番号または行範囲。 */
  readonly decisionSiteLine: string;
  /** fail-closed方向かfail-open方向か。 */
  readonly direction: DecisionCandidateDirection;
}

/**
 * 呼び出し元をfile:lineで名指しできた候補（disposition="adopted"）。
 * callerFile・callerLineを型として必須にし、呼び出し元不明のまま採用できないようにする（INV-02、BR-01）。
 */
export interface AdoptedDecisionCandidateEntry extends DecisionCandidateEntryBase {
  readonly disposition: "adopted";
  /** 判断結果を消費する呼び出し元file。 */
  readonly callerFile: string;
  /** `callerFile`内の行番号または行範囲。 */
  readonly callerLine: string;
}

/**
 * 対象から除外した候補（disposition="excluded"）。
 * exclusionReasonを型として必須にし、理由なしの除外を作れないようにする（C-03）。
 */
export interface ExcludedDecisionCandidateEntry extends DecisionCandidateEntryBase {
  readonly disposition: "excluded";
  /** 除外理由。BR-01（呼び出し元を名指しできない）、BR-02（fail-open方向）、または「有限選択の対象外」のいずれかを明示する。 */
  readonly exclusionReason: string;
}

/** C-02/C-03の候補一覧1行。disposition別に必須fieldが異なるdiscriminated union。 */
export type DecisionCandidateEntry =
  AdoptedDecisionCandidateEntry | ExcludedDecisionCandidateEntry;

/**
 * C-02の候補一覧（実行時に自分でgrep・読み込みして実在確認済み。2026-09-25）。
 *
 * 採用5件（`disposition: "adopted"`、全件fail-closed方向）。
 * 除外7件（`disposition: "excluded"`、BR-01・BR-02・「有限選択の対象外」のいずれかを理由に持つ）。
 *
 * 詳細は`03_実装計画.md` T01配下の候補一覧表を正本とする。
 */
export const DECISION_CANDIDATES: readonly DecisionCandidateEntry[] =
  Object.freeze([
    Object.freeze({
      id: "DCAND-001",
      label:
        "quick失格分類の検出（detectQuickDisqualifiers。変更fileのpathからdependency/public-api/data-migration/security-boundary/infrastructureを正規表現で推定する）",
      decisionSiteFile: "src/domain/mode.ts",
      decisionSiteLine: "484",
      direction: "fail-closed",
      disposition: "adopted",
      callerFile: "src/domain/issue.ts",
      callerLine: "1688",
    }),
    Object.freeze({
      id: "DCAND-002",
      label:
        "CI run配信状態の3値判定（inspectCiDelivery/nextActionFor。固定30分の猶予閾値でdelivered/pending/undeliveredを判定し人間呼び出しの要否を返す）",
      decisionSiteFile: "src/domain/ci-delivery.ts",
      decisionSiteLine: "81",
      direction: "fail-closed",
      disposition: "adopted",
      callerFile: "src/cli.ts",
      callerLine: "1726",
    }),
    Object.freeze({
      id: "DCAND-003",
      label:
        "仕様更新要否の判定（requiresSpecUpdate。変更file pathの正規表現一致でdocs/specs/更新の要否を推定する）",
      decisionSiteFile: "src/domain/spec.ts",
      decisionSiteLine: "303",
      direction: "fail-closed",
      disposition: "adopted",
      callerFile: "src/cli.ts",
      callerLine: "7066",
    }),
    Object.freeze({
      id: "DCAND-004",
      label:
        "個別監査表の行分類（auditRowDraft。変更fileを7分類＋fallbackへ正規表現cascadeで振り分け監査表を事前充填する）",
      decisionSiteFile: "src/domain/review-artifact.ts",
      decisionSiteLine: "564",
      direction: "fail-closed",
      disposition: "adopted",
      callerFile: "src/domain/review-artifact.ts",
      callerLine: "654",
    }),
    Object.freeze({
      id: "DCAND-005",
      label:
        "開発考慮事項の決定文言が具体的かの判定（hasConcreteDecisionText。長さ閾値＋定型文除外の正規表現でplaceholderを検出する）",
      decisionSiteFile: "src/domain/policy.ts",
      decisionSiteLine: "373",
      direction: "fail-closed",
      disposition: "adopted",
      callerFile: "src/domain/policy.ts",
      callerLine: "395",
    }),
    Object.freeze({
      id: "DCAND-006",
      label: "finding severityの分類そのもの",
      decisionSiteFile: ".agent-skill-chain/skills/step-10-review/SKILL.md",
      decisionSiteLine: "14",
      direction: "fail-closed",
      disposition: "excluded",
      exclusionReason:
        "BR-01（呼び出し元を名指しできない）。分類行為自体はSKILL.md手順内で進行役が行い、review-convergence.ts:347のoneOf(finding.severity, ...)は分類結果を検証するだけでcompiled codeへのseamが無い",
    }),
    Object.freeze({
      id: "DCAND-007",
      label: "finding relationの分類（acceptance-violation等5種）",
      decisionSiteFile: "src/domain/review-convergence.ts",
      decisionSiteLine: "39-45",
      direction: "fail-open",
      disposition: "excluded",
      exclusionReason:
        "BR-02（fail-open方向に作用しうる分岐を含むため恒久的対象外）。呼び出し元はfindingAdmission（review-convergence.ts:423-507）で実在するが、improvement/out-of-scopeへの誤分類はrecord-only（gateを緩める側）に作用しうる",
    }),
    Object.freeze({
      id: "DCAND-008",
      label: "CodeRabbit利用枠制限の判定",
      decisionSiteFile: ".agent-skill-chain/docs/01_開発ワークフロー.md",
      decisionSiteLine: "214",
      direction: "fail-closed",
      disposition: "excluded",
      exclusionReason:
        "BR-01（呼び出し元を名指しできない）。src/全体をgrepしても対応するcompiled codeが無い（DCAND-006と同型）",
    }),
    Object.freeze({
      id: "DCAND-009",
      label: "reviewer選定（Codex Sol/Opus）の判断",
      decisionSiteFile: ".agent-skill-chain/skills/step-10-review/SKILL.md",
      decisionSiteLine: "18",
      direction: "fail-closed",
      disposition: "excluded",
      exclusionReason:
        "BR-01（判断を消費する呼び出し元が無い）。role.ts:338-405のvalidateProviderSelectionは既になされた選択のauthorityを検証するだけで、選定の判断自体を消費しない",
    }),
    Object.freeze({
      id: "DCAND-010",
      label: "「軽微な矛盾」3条件判定",
      decisionSiteFile: ".agent-skill-chain/docs/01_開発ワークフロー.md",
      decisionSiteLine: "266-272",
      direction: "fail-closed",
      disposition: "excluded",
      exclusionReason:
        "BR-01（呼び出し元を名指しできない）。src/全体をgrepしても対応するcompiled codeが無い",
    }),
    Object.freeze({
      id: "DCAND-011",
      label: "Q-01〜Q-08モード判定質問への回答行為そのもの",
      decisionSiteFile: ".agent-skill-chain/docs/01_開発ワークフロー.md",
      decisionSiteLine: "25-74",
      direction: "fail-closed",
      disposition: "excluded",
      exclusionReason:
        "有限選択の対象外。validateModeQuestions等は構造検証のみで回答行為を行わない。回答は実際のdiff・設計意図を読む深い解釈的判断であり、本Issueが切り出す「有限選択」の外側と判断する。DCAND-001はこの領域のうち自動化済みの狭い一部分",
    }),
    Object.freeze({
      id: "DCAND-012",
      label:
        "classifyPackageAssets/pathIsSensitive/contentIsSensitive（secret/credentialのfilename・content heuristic分類）",
      decisionSiteFile: "src/domain/enforcement.ts",
      decisionSiteLine: "1478-1530",
      direction: "fail-closed",
      disposition: "excluded",
      exclusionReason:
        "BR-01（production codeに呼び出し元が無い）。参照はtest/steps/risk-policy.steps.tsのtestだけであり、Semantic Graphと同型の「実装されているが誰も呼ばない」状態",
    }),
  ]);

/**
 * C-04: 判断結果と呼び出し先をjournalへ記録するfield設計。
 *
 * **設計のみで、実装・schema変更は本Issueのscopeに含まない**（v0.4.2以降）。
 * 既存journal schema（`.agent-skill-chain/schemas/workflow-step-journal.schema.json`・
 * `routing-evidence.schema.json`・`review-progress-record.schema.json`・
 * `delivery-state.schema.json`）のproperty名との衝突は無いことを確認済み
 * （`decisionRecordId`・`value`・`confidence`・`callableTarget`・`decidedAt`はいずれの
 * 既存schemaのproperty名とも一致しない。SCN-UNIT-DC-004で機械確認する）。
 *
 * **`recordedAt`と`decisionId`は使わない。** 4 schemaすべてが既に`recordedAt`を持ち、
 * `delivery-state.schema.json`は`decisionId`も持つ。いずれもSCN-UNIT-DC-004の実行で
 * 実際に衝突を検出した（Step 9実装中の発見。当初は3 schemaだけを比較対象にしていたが、
 * `delivery-state.schema.json`も判断結果を記録する既存journal-like schemaに該当すると
 * 判断し比較対象へ加えたところ`decisionId`の衝突も見つかった）。
 */
export interface DecisionJournalField {
  /** 判断1回を識別する安定ID。 */
  readonly decisionRecordId: string;
  /** 判断結果の値。 */
  readonly value: string;
  /** 判断の確信度。0以上1以下。 */
  readonly confidence: number;
  /** この判断を委ねた呼び出し先。 */
  readonly callableTarget: DecisionCallableTarget;
  /** 判断を記録した時刻。ISO 8601。 */
  readonly decidedAt: string;
}
