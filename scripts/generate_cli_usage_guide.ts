import fs from "node:fs";
import path from "node:path";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import {
  findCommandUsage,
  missingRequiredFlags,
  usageKey,
  type CommandUsage,
} from "../src/cli-usage.js";

export const CLI_GUIDE_BEGIN = "<!-- 自動生成: CLI利用案内 -->";
export const CLI_GUIDE_END = "<!-- 自動生成ここまで -->";
export const CLI_GUIDE_DOCUMENT = ".agent-skill-chain/00_利用案内.md";
export const CLI_README_DOCUMENT = "README.md";
const EXAMPLE_COMMAND = "worktree";
const EXAMPLE_SUBCOMMAND = "create";
const EXAMPLE_VALUE_FLAG = "branch";

function exampleUsage(): CommandUsage {
  const usage = findCommandUsage(EXAMPLE_COMMAND, EXAMPLE_SUBCOMMAND);
  if (!usage)
    throw new Error(
      `例示に使うusage定義がありません: ${usageKey(EXAMPLE_COMMAND, EXAMPLE_SUBCOMMAND)}`,
    );
  return usage;
}

function missingReasons(usage: CommandUsage): string[] {
  return missingRequiredFlags(usage, {}).map(
    (name) => `--${name}=...が必要です`,
  );
}

export function renderCliUsageGuide(): string {
  const usage = exampleUsage();
  const key = usageKey(usage.command, usage.subcommand);
  return [
    CLI_GUIDE_BEGIN,
    "",
    "## commandの調べ方",
    "",
    "**必須flagを1件ずつ試す必要はない。** 任意のcommandとsubcommandへ`--help`を付けると、必須flag検証より先にusageをJSONで返す。",
    "",
    "```",
    `npx agent-skill-chain ${key} --help`,
    "```",
    "",
    "usageは要約、必須flag、条件付きflagとその条件、任意flagと既定値、位置引数、実行例を含む。",
    "",
    "必須flagが不足したまま実行した場合も、**不足を1回の実行ですべて`reasons`へ列挙する。** 1件ずつ返さない。",
    "",
    "```",
    `$ npx agent-skill-chain ${key}`,
    `reasons: ${missingReasons(usage).join(" / ")}`,
    "```",
    "",
    "値をとるflagは`--flag=値`の形式で指定する。**空白区切りは受理しない。** 無言で未指定として扱わず、専用の診断で拒否する。",
    "",
    "```",
    `$ npx agent-skill-chain ${key} --${EXAMPLE_VALUE_FLAG} 値`,
    `reasons: --${EXAMPLE_VALUE_FLAG}は空白区切りでは受理しません。--${EXAMPLE_VALUE_FLAG}=値の形式で指定してください`,
    "```",
    "",
    "trusted boundaryの評価は必須flag検証より先に行う。境界を侵すpathを渡した場合、不足flagではなく境界違反として拒否する。",
    "",
    CLI_GUIDE_END,
  ].join("\n");
}

export function renderCliReadmeGuide(): string {
  const usage = exampleUsage();
  const key = usageKey(usage.command, usage.subcommand);
  return [
    CLI_GUIDE_BEGIN,
    "",
    "各commandの必須flagは`--help`で確認できます。必須flag検証より先に評価され、要約、必須flag、条件付きflag、任意flagと既定値、実行例をJSONで返します。",
    "",
    "```",
    `npx agent-skill-chain ${key} --help`,
    "```",
    "",
    `必須flagが不足したまま実行した場合も、不足を1回の実行ですべて列挙します。上の例では${missingRequiredFlags(usage, {}).length}件を一度に返します。値をとるflagは\`--flag=値\`の形式で指定してください。空白区切りは受理せず、専用の診断で拒否します。`,
    "",
    CLI_GUIDE_END,
  ].join("\n");
}

export function extractCliGuide(text: string): string | undefined {
  const begin = text.indexOf(CLI_GUIDE_BEGIN);
  if (begin === -1) return undefined;
  const end = text.indexOf(CLI_GUIDE_END, begin);
  if (end === -1) return undefined;
  return text.slice(begin, end + CLI_GUIDE_END.length);
}

export function applyCliUsageGuide(root: string): {
  changed: string[];
  errors: string[];
} {
  const changed: string[] = [];
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
    const text = fs.readFileSync(file, "utf8");
    const current = extractCliGuide(text);
    if (current === undefined) {
      errors.push(
        `${relative}に自動生成markerがありません: ${CLI_GUIDE_BEGIN}`,
      );
      continue;
    }
    const rendered = render();
    if (current === rendered) continue;
    fs.writeFileSync(file, text.replace(current, rendered));
    changed.push(relative);
  }
  return { changed, errors };
}

if (process.argv[1] !== undefined && isExecutionEntry(import.meta.url)) {
  const result = applyCliUsageGuide(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.errors.length === 0 ? 0 : 1;
}
