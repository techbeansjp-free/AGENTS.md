import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import {
  COMMAND_USAGE,
  usageKey,
  type CommandUsage,
} from "../src/cli-usage.js";
import {
  CLI_GUIDE_DOCUMENT,
  CLI_README_DOCUMENT,
  extractCliGuide,
  renderCliReadmeGuide,
  renderCliUsageGuide,
} from "./generate_cli_usage_guide.js";

const CLI_SOURCE = "src/cli.ts";
const DISPATCH =
  /command === "([a-z][a-z-]*)"(?:\s*&&\s*subcommand === "([a-z][a-z-]*)")?/u;

interface DispatchBlock {
  readonly command: string;
  readonly subcommand?: string;
  readonly demanded: readonly string[];
  readonly referenced: readonly string[];
  readonly usesWorkflowArguments: boolean;
}

function collectDispatchBlocks(source: string): DispatchBlock[] {
  const file = ts.createSourceFile(
    CLI_SOURCE,
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  let main: ts.FunctionDeclaration | undefined;
  file.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "main")
      main = node;
  });
  if (!main?.body) return [];
  const blocks: DispatchBlock[] = [];
  for (const statement of main.body.statements) {
    if (!ts.isIfStatement(statement)) continue;
    const matched = DISPATCH.exec(statement.expression.getText(file));
    if (!matched) continue;
    if (ts.isThrowStatement(statement.thenStatement)) continue;
    const demanded = new Set<string>();
    const referenced = new Set<string>();
    let usesWorkflowArguments = false;
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(file);
        const argument = node.arguments[1];
        if (
          callee === "required" &&
          argument !== undefined &&
          ts.isStringLiteral(argument)
        )
          demanded.add(argument.text);
        if (callee === "requiredExpectedRevision")
          demanded.add("expected-revision");
        if (callee === "workflowArguments") usesWorkflowArguments = true;
      }
      if (
        ts.isElementAccessExpression(node) &&
        node.expression.getText(file) === "flags" &&
        ts.isStringLiteral(node.argumentExpression)
      )
        referenced.add(node.argumentExpression.text);
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.getText(file) === "flags"
      )
        referenced.add(node.name.text);
      node.forEachChild(walk);
    };
    walk(statement.thenStatement);
    for (const name of demanded) referenced.add(name);
    blocks.push({
      command: matched[1] ?? "",
      ...(matched[2] === undefined ? {} : { subcommand: matched[2] }),
      demanded: [...demanded].sort(),
      referenced: [...referenced].sort(),
      usesWorkflowArguments,
    });
  }
  return blocks;
}

function declaredNames(usage: CommandUsage): {
  demandable: Set<string>;
  all: Set<string>;
} {
  const demandable = new Set<string>([
    ...usage.requiredFlags.map((item) => item.name),
    ...usage.conditionalFlags.map((item) => item.name),
  ]);
  const all = new Set<string>([
    ...demandable,
    ...usage.optionalFlags.map((item) => item.name),
  ]);
  return { demandable, all };
}

const CLI_GUIDE_GENERATOR =
  "node --import tsx scripts/generate_cli_usage_guide.ts";

export function checkCliUsageDocuments(root: string): string[] {
  const errors: string[] = [];
  for (const [relative, render] of [
    [CLI_GUIDE_DOCUMENT, renderCliUsageGuide],
    [CLI_README_DOCUMENT, renderCliReadmeGuide],
  ] as const) {
    const file = path.resolve(root, relative);
    if (!fs.existsSync(file)) {
      errors.push(`${relative}がありません`);
      continue;
    }
    const current = extractCliGuide(fs.readFileSync(file, "utf8"));
    if (current === undefined) {
      errors.push(
        `${relative}に自動生成markerがありません。${CLI_GUIDE_GENERATOR}を実行してください`,
      );
      continue;
    }
    if (current !== render())
      errors.push(
        `${relative}の自動生成区画が正本と一致しません。${CLI_GUIDE_GENERATOR}を実行して差分をcommitしてください`,
      );
  }
  return errors;
}

export function checkCliUsage(root = process.cwd()): {
  valid: boolean;
  errors: string[];
  commands: number;
} {
  const errors: string[] = [];
  const sourceFile = path.resolve(root, CLI_SOURCE);
  if (!fs.existsSync(sourceFile))
    return { valid: false, errors: [`${CLI_SOURCE}がありません`], commands: 0 };
  const blocks = collectDispatchBlocks(fs.readFileSync(sourceFile, "utf8"));
  const seen = new Set<string>();
  for (const block of blocks) {
    const key = usageKey(block.command, block.subcommand);
    seen.add(key);
    const usage = COMMAND_USAGE.find(
      (entry) =>
        entry.command === block.command &&
        entry.subcommand === block.subcommand,
    );
    if (!usage) {
      errors.push(`usage定義がないsubcommandです: ${key}`);
      continue;
    }
    const { demandable, all } = declaredNames(usage);
    for (const name of block.referenced)
      if (!all.has(name))
        errors.push(
          `${key}: usageに未記載のflagを実装が読んでいます: --${name}`,
        );
    for (const name of demandable)
      if (
        !block.referenced.includes(name) &&
        !(name === "artifact" && block.usesWorkflowArguments)
      )
        errors.push(
          `${key}: usageが必須・条件付きと宣言したflagを実装が読んでいません: --${name}`,
        );
    for (const name of block.demanded)
      if (!demandable.has(name))
        errors.push(
          `${key}: 実装がrequiredとして要求するflagがusageの必須・条件付きにありません: --${name}`,
        );
  }
  for (const usage of COMMAND_USAGE) {
    const key = usageKey(usage.command, usage.subcommand);
    if (!seen.has(key) && usage.subcommand !== undefined)
      errors.push(`実装に対応するdispatchがないusage定義です: ${key}`);
    if (usage.summary === "" || usage.example === "")
      errors.push(`${key}: usageのsummaryとexampleは空にできません`);
    if (!usage.example.startsWith(`npx agent-skill-chain ${usage.command}`))
      errors.push(`${key}: usageのexampleが実行形式と一致しません`);
  }
  errors.push(...checkCliUsageDocuments(root));
  return { valid: errors.length === 0, errors, commands: COMMAND_USAGE.length };
}

if (process.argv[1] !== undefined && isExecutionEntry(import.meta.url)) {
  const result = checkCliUsage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}
