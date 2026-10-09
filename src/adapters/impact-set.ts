import {
  bindFeaturesToStepDefinitions,
  type StepDefinitionSource,
  type StepPattern,
} from "../domain/cucumber-binding.js";
import {
  deriveImpactSet,
  referenceNames,
  reviewAdjacentScope,
  type ImpactSet,
  type StepDefinitionFileSummary,
} from "../domain/impact-set.js";
import type {
  ReviewAdjacentScope,
  ReviewSessionState,
} from "../domain/review-convergence.js";
import { tryParseReviewEvidence } from "../domain/review-evidence.js";
import { semanticGraphContentHash } from "../domain/semantic-graph.js";
import {
  DEFAULT_STAGING_LAYOUT,
  stagingLayoutFromManifestText,
} from "../domain/staging-layout.js";
import { git } from "../lib/process.js";
import { isRecord } from "../types.js";
import {
  loadTypeScriptCompiler,
  type TypeScriptApi,
} from "../lib/typescript-vendor.js";
import { buildCommitSemanticGraph } from "./repository-graph.js";
import {
  GIT_ENV,
  evidenceOnlySuffix,
  observeReviewDiff,
} from "./review-diff.js";

const ECMASCRIPT_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const STEP_FUNCTIONS = new Set([
  "Given",
  "When",
  "Then",
  "And",
  "But",
  "defineStep",
  "Step",
]);
const GLOBAL_REGISTRATIONS = new Set([
  "Before",
  "After",
  "BeforeAll",
  "AfterAll",
  "BeforeStep",
  "AfterStep",
  "setWorldConstructor",
  "setDefaultTimeout",
  "defineParameterType",
  "setDefinitionFunctionWrapper",
]);
/**
 * 文字列中に現れるfile名らしき字面。path区切りや引用符で切り、
 * 末尾に拡張子を持つ語だけを取り出す。
 */
const FILE_NAME_TOKEN =
  /[^\s"'`/\\()<>,;:{}[\]|=+*!?&^%$#~@]+\.[A-Za-z][A-Za-z0-9]{0,9}(?![A-Za-z0-9])/gu;

function isScannedSource(file: string): boolean {
  return (
    ECMASCRIPT_FILE.test(file) &&
    !file.startsWith("dist/") &&
    !file.startsWith("node_modules/") &&
    !file.includes("/node_modules/")
  );
}

/**
 * Cucumberのimport名を実名へ解決する表。`import { After as cucumberAfter }`の
 * 別名も登録関数として数える。
 */
function cucumberBindings(
  compiler: TypeScriptApi,
  source: import("typescript").SourceFile,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (
      !compiler.isImportDeclaration(statement) ||
      !compiler.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@cucumber/cucumber"
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !compiler.isNamedImports(bindings)) continue;
    for (const element of bindings.elements)
      names.set(element.name.text, (element.propertyName ?? element.name).text);
  }
  return names;
}

function calleeName(
  compiler: TypeScriptApi,
  expression: import("typescript").Expression,
): string | undefined {
  if (compiler.isIdentifier(expression)) return expression.text;
  if (compiler.isPropertyAccessExpression(expression))
    return expression.name.text;
  return undefined;
}

/**
 * **step定義fileを字面から要約する。** step登録関数の第1引数が文字列または
 * regex literalでない登録（動的生成）があれば`complete: false`にする。
 */
function summarizeStepDefinitionFile(
  compiler: TypeScriptApi,
  file: string,
  text: string,
): (StepDefinitionSource & StepDefinitionFileSummary) | undefined {
  if (
    !text.includes("@cucumber/cucumber") &&
    !/\b(?:Given|When|Then|defineStep)\s*\(/u.test(text)
  )
    return undefined;
  const source = compiler.createSourceFile(
    file,
    text,
    compiler.ScriptTarget.Latest,
    true,
  );
  /** 文字列中の`@cucumber/cucumber`ではなく、実際のimport宣言だけを数える */
  const importsCucumber = source.statements.some(
    (statement) =>
      compiler.isImportDeclaration(statement) &&
      compiler.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@cucumber/cucumber",
  );
  const aliases = cucumberBindings(compiler, source);
  const patterns: StepPattern[] = [];
  let complete = true;
  let global = false;
  let registrations = 0;
  const visit = (node: import("typescript").Node): void => {
    if (compiler.isCallExpression(node)) {
      const local = calleeName(compiler, node.expression);
      const name =
        local === undefined ? undefined : (aliases.get(local) ?? local);
      if (name !== undefined && GLOBAL_REGISTRATIONS.has(name)) {
        global = true;
        registrations += 1;
      }
      if (name !== undefined && STEP_FUNCTIONS.has(name)) {
        registrations += 1;
        const first = node.arguments[0];
        if (
          first !== undefined &&
          (compiler.isStringLiteral(first) ||
            compiler.isNoSubstitutionTemplateLiteral(first))
        )
          patterns.push({ kind: "expression", source: first.text });
        else if (first !== undefined && compiler.isTemplateExpression(first))
          /** 埋め込み式は任意列（`{}`）として広く一致させる */
          patterns.push({
            kind: "expression",
            source: [
              first.head.text,
              ...first.templateSpans.map((span) => `{}${span.literal.text}`),
            ].join(""),
          });
        else if (
          first !== undefined &&
          compiler.isRegularExpressionLiteral(first)
        ) {
          const literal = first.text;
          const end = literal.lastIndexOf("/");
          patterns.push({
            kind: "regex",
            source: literal.slice(1, end),
            flags: literal.slice(end + 1),
          });
        } else complete = false;
      }
    }
    compiler.forEachChild(node, visit);
  };
  visit(source);
  if (!importsCucumber && registrations === 0) return undefined;
  /**
   * **step定義を持たないhook・World登録fileだけを全scenario共通とみなす。**
   * step定義fileに同居するhookは、そのfileのstepが用意したWorld状態を後始末する
   * ものとして、そのfileを使うfeatureへ影響を限る（仕様の前提として明記する）。
   */
  return {
    path: file,
    patterns,
    complete,
    global: global && patterns.length === 0,
  };
}

function literalReferenceIndex(
  sources: ReadonlyMap<string, string>,
  graphFiles: readonly string[],
): Record<string, string[]> {
  const known = new Set(graphFiles.flatMap(referenceNames));
  const index = new Map<string, Set<string>>();
  for (const [file, text] of sources) {
    if (!isScannedSource(file)) continue;
    for (const match of text.matchAll(FILE_NAME_TOKEN)) {
      const token = match[0];
      if (!known.has(token)) continue;
      const files = index.get(token) ?? new Set<string>();
      files.add(file);
      index.set(token, files);
    }
  }
  return Object.fromEntries(
    [...index].map(([token, files]) => [token, [...files].sort()]),
  );
}

function packageScripts(
  sources: ReadonlyMap<string, string>,
): Record<string, string> {
  const text = sources.get("package.json");
  if (text === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) return {};
    return Object.fromEntries(
      Object.entries(parsed.scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * **2 commit間の影響集合をGitから導出する**（REQ-WF-039、REQ-WF-040）。
 *
 * 差分は`observeReviewDiff`、構造は`headSha`のcommit treeから構築した意味Graphで
 * 観測する。**worktreeを読まない**ため、checkout位置や未commit変更に左右されない。
 * SHAの解決失敗・非ancestorは例外（入力の誤り）、Graph構築の失敗は
 * `mode: "full"`（影響を証明できない）として扱う。
 */
export function computeImpactSet(input: {
  root: string;
  baseSha: string;
  headSha: string;
}): ImpactSet {
  const observed = observeReviewDiff(input.root, input.baseSha, input.headSha);
  let graph:
    | {
        status: "built";
        snapshot: ReturnType<typeof buildCommitSemanticGraph>["snapshot"];
        contentHash: string;
        unresolvedImportPaths: readonly string[];
      }
    | { status: "unavailable"; reason: string };
  let sources: ReadonlyMap<string, string> = new Map();
  try {
    const built = buildCommitSemanticGraph(input.root, input.headSha);
    graph = {
      status: "built",
      snapshot: built.snapshot,
      contentHash: semanticGraphContentHash(built.snapshot),
      unresolvedImportPaths: built.unresolvedImportPaths,
    };
    sources = built.sources;
  } catch (error) {
    graph = {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  /**
   * **staging rootは差分と同じ`headSha`の版から読む。** 作業treeのpolicyを読むと、
   * 同じcommit差分でも作業treeの状態で分類が変わり、`full`が`targeted`へ狭まりうる。
   */
  let stagingRootPattern: string | undefined;
  try {
    const manifest = git(
      ["show", `${input.headSha}:.agent-skill-chain/project-policy.json`],
      input.root,
      { allowFailure: true },
    );
    stagingRootPattern = (
      manifest.status === 0
        ? stagingLayoutFromManifestText(manifest.stdout)
        : DEFAULT_STAGING_LAYOUT
    ).rootPattern;
  } catch {
    stagingRootPattern = undefined;
  }
  const graphFiles =
    graph.status === "built"
      ? graph.snapshot.nodes
          .filter(({ kind }) => kind === "file")
          .map(({ id }) => id.slice("file:".length))
      : [];
  const definitions: (StepDefinitionSource & StepDefinitionFileSummary)[] = [];
  if (graph.status === "built") {
    const compiler = loadTypeScriptCompiler();
    for (const [file, text] of sources) {
      if (!isScannedSource(file)) continue;
      const summary = summarizeStepDefinitionFile(compiler, file, text);
      if (summary !== undefined) definitions.push(summary);
    }
  }
  const features = [...sources]
    .filter(([file]) => file.endsWith(".feature"))
    .map(([file, text]) => ({ path: file, text }));
  const impact = deriveImpactSet({
    baseSha: input.baseSha,
    headSha: input.headSha,
    changeDigest: observed.digest,
    changedPaths: observed.changedPaths,
    graph,
    literalReferences: literalReferenceIndex(sources, graphFiles),
    stepDefinitionFiles: definitions.map(({ path, complete, global }) => ({
      path,
      complete,
      global,
    })),
    featureBinding: bindFeaturesToStepDefinitions({ features, definitions }),
    scripts: packageScripts(sources),
    stagingRootPattern,
  });
  return impact;
}

/**
 * **review round 2以降の隣接範囲をGitから導出する**（REQ-WF-039）。
 *
 * 雛形作成（`buildReviewRoundDraft`）と記録前検証（`previewReviewRound`）と、
 * 再利用判定のtransition観測（`createReuseObserver`。`review round`の検分割当と`pr merge`）が
 * 同じ関数を呼ぶ。記録前検証は提出された`adjacentScope`をこの戻り値と照合し、
 * 不一致を拒否する。**呼び出し側が任意のGraph Evidence digestを注入しても
 * 隣接範囲として受理されない。**
 *
 * **影響は`previousHeadSha`に続く前headのreview記録（`reviewRecordSuffix`）の末端から導出する**
 * （Issue #1544 INV-07、R1544-1-01・R1544-2-01）。PR作成後の是正transitionは前headの証跡commit
 * （`H_final`）を含むが、その内容は前headを束縛した正規のreview証跡であり実装内容に数えない。
 * path名・file名の字面や「証跡を誰も読まない」ことの走査では外さない（file名を組み立てて読む
 * source、走査対象外・上限超過のfileを観測できないため）。suffixより後の変更は、証跡pathや
 * allowlist配下のfileでも実装内容としてREQ-WF-039どおり導出する（できなければ`full`）。
 * `impact.changeDigest`・`changedPaths`は`previousHeadSha`からの全diffのままで、内容の束縛は
 * 弱めない。suffixより後に変更が無いtransitionは隣接範囲を持たず、無制限にもしない。
 */
export function deriveReviewRoundImpact(input: {
  root: string;
  previousHeadSha: string;
  headSha: string;
  records: ReviewRecordAuthority;
}): {
  impact: ImpactSet;
  adjacentScope: readonly ReviewAdjacentScope[];
  adjacentScopeUnbounded: boolean;
} {
  const tip = evidenceSuffixTip(
    input.root,
    input.previousHeadSha,
    input.headSha,
    input.records,
  );
  const derived = computeImpactSet({
    root: input.root,
    baseSha: tip,
    headSha: input.headSha,
  });
  const changed = derived.changedPaths.length > 0;
  const whole =
    tip === input.previousHeadSha
      ? undefined
      : observeReviewDiff(input.root, input.previousHeadSha, input.headSha);
  return {
    impact: whole
      ? {
          ...derived,
          baseSha: input.previousHeadSha,
          changeDigest: whole.digest,
          changedPaths: whole.changedPaths,
        }
      : derived,
    adjacentScope: changed ? reviewAdjacentScope(derived) : [],
    adjacentScopeUnbounded:
      changed && (derived.reviewMode ?? derived.mode) === "full",
  };
}

/**
 * 前headのreview記録を照合する正本（Issue #1544 INV-07、R1544-3-01）。`issue`はstagingの
 * tracker Issue番号で、証跡fileの申告値から取らない（無ければ何も外さない）。`session`は
 * append-onlyのstaging記録で、PRのcommitからは書き換えられない。
 */
export interface ReviewRecordAuthority {
  issue: number | undefined;
  session: Pick<ReviewSessionState, "sessionId" | "rounds">;
}

/**
 * **前headのreview記録だけを足したsuffixのpath**（Issue #1544 INV-07、R1544-2-01・R1544-3-01）。
 * `fromSha`から`tipSha`までがevidence-only suffix（`evidenceOnlySuffix`）で、そのpathが対象Issue
 * 自身の証跡path（`review export`の出力先規則の`docs/reviews/<Issue番号>_review.json`または
 * `.agent-skill-chain/reviews/<Issue番号>_review.json`）であり、`tipSha`のそのfileが正規の
 * review証跡（`parseReviewEvidence`が受理）として`fromSha`を実装headに束縛し、かつ証跡の
 * `sessionId`と`latestRoundDigest`がreview sessionの`candidateHeadSha === fromSha`のroundと
 * 一致するときだけpathを返す。正準形は公開関数で誰でも作れるため、形と申告値だけでは外さない。
 * 照合できなければundefinedで、呼び出し側は従来どおり全diffから導出する（できなければ`full`）。
 */
function reviewRecordSuffix(
  root: string,
  fromSha: string,
  tipSha: string,
  records: ReviewRecordAuthority,
): string | undefined {
  const path = evidenceOnlySuffix(root, fromSha, tipSha);
  if (
    path === undefined ||
    records.issue === undefined ||
    (path !== `docs/reviews/${records.issue}_review.json` &&
      path !== `.agent-skill-chain/reviews/${records.issue}_review.json`)
  )
    return undefined;
  const shown = git(["show", `${tipSha}:${path}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  if (shown.status !== 0) return undefined;
  const parsed = tryParseReviewEvidence(shown.stdout);
  if (!("evidence" in parsed)) return undefined;
  const { implementationHeadSha, session } = parsed.evidence.observed;
  return implementationHeadSha === fromSha &&
    session.sessionId === records.session.sessionId &&
    records.session.rounds.some(
      ({ candidateHeadSha, roundDigest }) =>
        candidateHeadSha === fromSha &&
        roundDigest === session.latestRoundDigest,
    )
    ? path
    : undefined;
}

/** `sha`のtreeにある`path`のblob ID（無ければ空文字列）。 */
function blobAt(root: string, sha: string, path: string): string {
  return git(["rev-parse", "--verify", "--quiet", `${sha}:${path}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  }).stdout.trim();
}

/**
 * `fromSha`の直後から第1親chainで続く、前headのreview記録だけのsuffix（`reviewRecordSuffix`）の
 * 末端commit。無いとき、またはそのpathを`toSha`までに再び変えた（書き換え・削除）ときは
 * `fromSha`を返し、`fromSha`からの全diffで導出させる。
 */
function evidenceSuffixTip(
  root: string,
  fromSha: string,
  toSha: string,
  records: ReviewRecordAuthority,
): string {
  let tip = fromSha;
  let path: string | undefined;
  for (const commit of git(
    ["rev-list", "--first-parent", "--reverse", `${fromSha}..${toSha}`],
    root,
    { env: GIT_ENV },
  )
    .stdout.split("\n")
    .filter(Boolean)) {
    if (evidenceOnlySuffix(root, fromSha, commit) === undefined) break;
    const recorded = reviewRecordSuffix(root, fromSha, commit, records);
    if (recorded === undefined) continue;
    tip = commit;
    path = recorded;
  }
  return path !== undefined &&
    blobAt(root, tip, path) === blobAt(root, toSha, path)
    ? tip
    : fromSha;
}
