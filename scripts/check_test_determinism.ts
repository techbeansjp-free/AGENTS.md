import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

const STEP_DIRECTORY = "test/steps";
const FIXTURE_INSTANT_MODULE = "test/support/fixture-instant.ts";
const FORBIDDEN_CLOCK = ["Date.now", "Math.random"];

interface RepositoryReadException {
  readonly file: string;
  readonly target: string;
  readonly reason: string;
}

export const REPOSITORY_READ_EXCEPTIONS: readonly RepositoryReadException[] =
  Object.freeze([
    {
      file: "test/steps/project-choice-diff.steps.ts",
      target: ".agent-skill-chain/project/choices/development.json",
      reason:
        "製品自身のproject choiceに対する差分分類をdogfoodingで検証する。値が変われば分類も変わるべきであり、fixture化すると乖離を検出できない",
    },
    {
      file: "test/steps/project-policy-satisfiability.steps.ts",
      target: ".agent-skill-chain/project",
      reason:
        "製品自身のproject設定一式を隔離repositoryへ複製し、充足可能性をdogfoodingで検証する",
    },
    {
      file: "test/steps/project-policy-file-target.steps.ts",
      target: ".agent-skill-chain/project",
      reason:
        "製品自身のproject設定一式を隔離rootへ複製し、--fileで渡した候補manifestが実際に検証されることをdogfoodingで検証する",
    },
    {
      file: "test/steps/risk-policy.steps.ts",
      target: ".agent-skill-chain/project",
      reason:
        "製品自身のproject設定一式を隔離repositoryへ複製し、risk policyの適用をdogfoodingで検証する",
    },
    {
      file: "test/steps/risk-policy.steps.ts",
      target: ".agent-skill-chain/project/choices/development.json",
      reason: "製品自身のproject choiceに対するrisk判定をdogfoodingで検証する",
    },
    {
      file: "test/steps/risk-policy.steps.ts",
      target: ".agent-skill-chain/project/conformance/bindings.json",
      reason:
        "製品自身のconformance bindingをdogfoodingで検証する。REQ-WF-008の対象である",
    },
    {
      file: "test/steps/role-tier.steps.ts",
      target: ".agent-skill-chain/project/choices/development.json",
      reason:
        "製品自身のproject choiceに対するrole・tier解決をdogfoodingで検証する",
    },
    {
      file: "test/steps/unit.steps.ts",
      target: "package.json",
      reason:
        "製品自身のproject quality契約をdogfoodingで検証する。scriptは複製後に上書きし、versionへは依存しない",
    },
    {
      file: "test/steps/unit.steps.ts",
      target: ".agent-skill-chain/project",
      reason: "製品自身のproject設定一式を隔離repositoryへ複製して単体検証する",
    },
    {
      file: "test/steps/unit.steps.ts",
      target: ".agent-skill-chain/project/choices/development.json",
      reason: "製品自身のproject choiceを単体検証する",
    },
    {
      file: "test/steps/consumer-acceptance.steps.ts",
      target: "package.json",
      reason:
        "SCN-INT-CONSUMER-002が配布scriptのmerge-base不変条件とconsumer acceptance観測前後のdigest不変条件を製品自身へdogfoodingする",
    },
    {
      file: "test/steps/worktree-placement.steps.ts",
      target: ".agent-skill-chain/project",
      reason:
        "製品自身のproject設定一式を隔離repositoryへ複製し、worktree配置policyをdogfoodingで検証する",
    },
  ]);

const MUTABLE_REPOSITORY_STATE = [
  "package.json",
  "package-lock.json",
  ".agent-skill-chain/project",
];

function isMutableRepositoryState(target: string): boolean {
  if (path.isAbsolute(target)) return false;
  const normalized = target.replace(/\\/gu, "/");
  return MUTABLE_REPOSITORY_STATE.some(
    (item) => normalized === item || normalized.startsWith(`${item}/`),
  );
}

function literalTarget(
  argument: ts.Expression | undefined,
  source: ts.SourceFile,
): string | undefined {
  if (argument === undefined) return undefined;
  if (ts.isStringLiteral(argument)) return argument.text;
  if (ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  if (!ts.isCallExpression(argument)) return undefined;
  const callee = argument.expression.getText(source);
  if (callee !== "path.join" && callee !== "path.resolve") return undefined;
  const first = argument.arguments[0];
  if (first === undefined || !ts.isStringLiteral(first)) return undefined;
  return first.text;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function stepFiles(root: string): string[] {
  const directory = path.resolve(root, STEP_DIRECTORY);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => path.join(STEP_DIRECTORY, name));
}

export function checkTestDeterminism(root = process.cwd()): {
  valid: boolean;
  errors: string[];
  files: number;
  declaredExceptions: number;
} {
  const errors: string[] = [];
  const files = stepFiles(root);
  const used = new Set<string>();
  for (const relative of files) {
    const absolute = path.resolve(root, relative);
    const source = ts.createSourceFile(
      relative,
      fs.readFileSync(absolute, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    const report = (node: ts.Node, message: string): void => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      errors.push(`${relative}:${line + 1}: ${message}`);
    };
    walk(source, (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source);
        if (FORBIDDEN_CLOCK.includes(callee))
          report(
            node,
            `${callee}()は実時計・乱数へ依存します。${FIXTURE_INSTANT_MODULE}のfixtureInstantを使ってください`,
          );
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(source) === "fs"
        ) {
          const target = literalTarget(node.arguments[0], source);
          if (target !== undefined && isMutableRepositoryState(target)) {
            const declared = REPOSITORY_READ_EXCEPTIONS.find(
              (item) => item.file === relative && item.target === target,
            );
            if (declared) used.add(`${relative}|${target}`);
            else
              report(
                node,
                `実repository相対pathへの直接accessです: ${target}。fixtureが自作するか、環境変数で注入するか、理由を添えてREPOSITORY_READ_EXCEPTIONSへ宣言してください`,
              );
          }
        }
      }
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(source) === "Date" &&
        (node.arguments === undefined || node.arguments.length === 0)
      )
        report(
          node,
          `引数なしのnew Date()は実時計へ依存します。${FIXTURE_INSTANT_MODULE}のfixtureInstantを使ってください`,
        );
    });
  }
  for (const item of REPOSITORY_READ_EXCEPTIONS)
    if (!used.has(`${item.file}|${item.target}`))
      errors.push(
        `使われていないREPOSITORY_READ_EXCEPTIONS宣言です: ${item.file} -> ${item.target}`,
      );
  return {
    valid: errors.length === 0,
    errors,
    files: files.length,
    declaredExceptions: REPOSITORY_READ_EXCEPTIONS.length,
  };
}

if (process.argv[1] !== undefined && isExecutionEntry(import.meta.url)) {
  const result = checkTestDeterminism();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}
