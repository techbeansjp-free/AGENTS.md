import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { doctor } from "../domain/lifecycle.js";

const REPOSITORY = "techbeansjp-free/AGENTS.md";
const API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
type Json = Record<string, unknown>;
type Execution = { status: number | null; stdout: string; stderr: string };
export type LatestUpdateResult = {
  currentVersion: string | null;
  latestVersion: string;
  asset: string;
  applied: boolean;
  verified: boolean;
  update?: Json;
  doctor?: Json;
  activation?: unknown;
  diagnostic?: string;
};
export type LatestUpdateDependencies = {
  release?: () => Promise<unknown>;
  installed?: (root: string) => string | null;
  execute?: (asset: string, args: string[]) => Execution;
};

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("正式版の応答がJSON objectではありません");
  return value as Json;
}

async function latestRelease(): Promise<unknown> {
  const response = await fetch(API, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `最新正式版を取得できません: GitHub HTTP ${response.status}`,
    );
  return response.json();
}

function executeRelease(asset: string, args: string[]): Execution {
  // A fresh runner directory prevents a consumer's local bin/package from
  // shadowing the explicitly selected official distribution.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "asc-release-update-"));
  try {
    const result = spawnSync(
      "npm",
      [
        "exec",
        "--yes",
        `--package=${asset}`,
        "--",
        "agent-skill-chain",
        ...args,
      ],
      { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.error?.message ?? result.stderr ?? "",
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function parseResult(result: Execution, stage: string): Json {
  try {
    return object(JSON.parse(result.stdout));
  } catch {
    throw new Error(
      `${stage}の結果を確認できません: ${result.stderr || result.stdout}`,
    );
  }
}

/** Resolve once, then use the same pinned official asset for update and doctor. */
export async function updateLatest(
  root: string,
  options: { apply: boolean; recoverRecord?: boolean },
  dependencies: LatestUpdateDependencies = {},
): Promise<LatestUpdateResult> {
  root = path.resolve(root);
  const currentVersion = (
    dependencies.installed ??
    ((target) => doctor(target).releaseIdentity.managedVersion)
  )(root);
  const release = object(await (dependencies.release ?? latestRelease)());
  const tag = release.tag_name;
  if (
    typeof tag !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(tag) ||
    release.draft !== false ||
    release.prerelease !== false
  )
    throw new Error("GitHub latestは安定した正式releaseではありません");
  const asset = `https://github.com/${REPOSITORY}/releases/download/${tag}/agent-skill-chain.tgz`;
  if (
    !Array.isArray(release.assets) ||
    !release.assets.some((entry: unknown) => {
      const candidate = object(entry);
      return (
        candidate.name === "agent-skill-chain.tgz" &&
        candidate.state === "uploaded" &&
        candidate.browser_download_url === asset
      );
    })
  )
    throw new Error(`${tag}に正式配布asset agent-skill-chain.tgzがありません`);
  const resolved = { currentVersion, latestVersion: tag.slice(1), asset };
  if (!options.apply) return { ...resolved, applied: false, verified: false };
  const execute = dependencies.execute ?? executeRelease;
  const update = execute(asset, [
    "update",
    `--root=${root}`,
    "--apply",
    ...(options.recoverRecord ? ["--recover-record"] : []),
  ]);
  if (update.status !== 0)
    throw new Error(
      `正式版のupdateに失敗しました: ${update.stderr || update.stdout}`,
    );
  const updated = parseResult(update, "update");
  if (updated.applied !== true)
    throw new Error("正式版のupdateが適用完了を報告していません");
  const checked = execute(asset, ["doctor", `--root=${root}`]);
  let verification: Json;
  try {
    verification = parseResult(checked, "doctor");
  } catch (error) {
    return {
      ...resolved,
      applied: true,
      verified: false,
      update: updated,
      diagnostic: error instanceof Error ? error.message : String(error),
      activation: updated.activation ?? {
        restart: "new-session",
        message: "更新は適用済みです。新しいsessionを開始してください。",
      },
    };
  }
  const verified = checked.status === 0 && verification.healthy === true;
  return {
    ...resolved,
    applied: true,
    verified,
    update: updated,
    doctor: verification,
    activation: updated.activation ?? {
      restart: "new-session",
      message: "更新完了。新しいsessionを開始してください。",
    },
    ...(!verified
      ? {
          diagnostic:
            "更新は適用済みですがdoctorに未解決の診断があります。doctorの結果を確認してください。",
        }
      : {}),
  };
}
