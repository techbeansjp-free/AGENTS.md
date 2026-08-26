import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MODE_STEP_SEQUENCES,
  WORKFLOW_STEPS,
  type WorkflowStep,
} from "../src/domain/workflow.js";
import type { Mode } from "../src/domain/mode.js";

const WORKFLOW_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";

function parseStepTable(markdown: string): WorkflowStep[] {
  const section = markdown.split("## ステップ0〜11")[1]?.split("\n## ")[0];
  if (!section) throw new Error("規範文書にステップ0〜11節がありません");
  return section.split(/\r?\n/u).flatMap((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!/^\d+$/u.test(cells[0] ?? "")) return [];
    const skillId = /^\[([^\]]+)\]\([^)]+\)$/u.exec(cells[1] ?? "")?.[1];
    if (!skillId || cells.length !== 4)
      throw new Error(`step表の行を解析できません: ${line}`);
    return [
      {
        step: Number(cells[0]),
        skillId,
        responsibility: cells[2] ?? "",
        artifact: cells[3] ?? "",
      },
    ];
  });
}

function parseSequence(source: string): number[] {
  if (source === "0 → 1 → … → 11")
    return Array.from({ length: 12 }, (_, index) => index);
  return source.split("→").map((value) => {
    const step = value.trim();
    if (step === "") throw new Error("モード節に空のStep番号があります");
    if (!/^\d+$/u.test(step))
      throw new Error(`モード節のStep番号が不正です: ${step}`);
    return Number(step);
  });
}

function parseModeSequences(markdown: string): Record<Mode, number[]> {
  const modeSection = markdown.split("## モード")[1]?.split("\n## ")[0];
  if (!modeSection) throw new Error("規範文書にモード節がありません");
  const full = /既定は`full`で、`([^`]+)`を実行する/u.exec(modeSection)?.[1];
  const quick = /`quick`[^。]*`([^`]*→[^`]*)`を実行する/u.exec(
    modeSection,
  )?.[1];
  const poc = /`poc`[^。]*`([^`]*→[^`]*)`を実行する/u.exec(modeSection)?.[1];
  if (!full || !quick || !poc)
    throw new Error("規範文書のfull/quick/poc step列を解析できません");
  return {
    full: parseSequence(full),
    quick: parseSequence(quick),
    poc: parseSequence(poc),
  };
}

export function checkWorkflowSteps(
  root = process.cwd(),
  document = path.join(root, WORKFLOW_DOCUMENT),
): { valid: boolean; errors: string[]; steps: number; modes: number } {
  const errors: string[] = [];
  let documentedSteps: WorkflowStep[];
  let documentedModes: Record<Mode, number[]>;
  try {
    const markdown = fs.readFileSync(document, "utf8");
    documentedSteps = parseStepTable(markdown);
    documentedModes = parseModeSequences(markdown);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { valid: false, errors, steps: 0, modes: 0 };
  }
  if (JSON.stringify(documentedSteps) !== JSON.stringify(WORKFLOW_STEPS))
    errors.push(
      `規範文書のstep表がWORKFLOW_STEPSと完全一致しません: document=${JSON.stringify(documentedSteps)} code=${JSON.stringify(WORKFLOW_STEPS)}`,
    );
  for (const mode of ["full", "quick", "poc"] as const)
    if (
      JSON.stringify(documentedModes[mode]) !==
      JSON.stringify(MODE_STEP_SEQUENCES[mode])
    )
      errors.push(
        `規範文書の${mode} step列がMODE_STEP_SEQUENCESと一致しません: document=${documentedModes[mode].join(",")} code=${MODE_STEP_SEQUENCES[mode].join(",")}`,
      );
  return {
    valid: errors.length === 0,
    errors,
    steps: documentedSteps.length,
    modes: Object.values(documentedModes).filter(
      (sequence) => sequence.length > 0,
    ).length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = checkWorkflowSteps();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
