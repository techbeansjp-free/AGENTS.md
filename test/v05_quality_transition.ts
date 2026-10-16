/** Read-only transition regression; all mutations use temporary configuration copies. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseJsonStrict } from "../src/lib/security.js";
import { isRecord } from "../src/types.js";

function argument(name: string): string {
  const value = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  assert.ok(value, `--${name}= is required`);
  return path.resolve(value.slice(name.length + 3));
}
function object(file: string): Record<string, unknown> {
  const value = parseJsonStrict(fs.readFileSync(file, "utf8"), file);
  assert.ok(isRecord(value));
  return value;
}
function write(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
const trusted = argument("trusted-root");
const candidateSource = argument("candidate-root");
const output = argument("output");
const proposed = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const checker = path.join(proposed, "scripts/check_project_quality.ts");
const source = fs.readFileSync(checker, "utf8");
const block = source
  .split(
    "const V05_CUTOVER_CONFIGURATION: Readonly<Record<string, string>> = ",
  )[1]
  ?.split(";")[0];
assert.ok(block);
const inventory: unknown = JSON.parse(block.replace(/,\s*\}/u, "}"));
assert.ok(isRecord(inventory));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "asc-ci-maintenance-"));
const base = path.join(fixture, "base");
const candidate = path.join(fixture, "candidate");
for (const name of Object.keys(inventory)) {
  fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
  fs.copyFileSync(path.join(candidateSource, name), path.join(base, name));
}
for (const name of [
  "scripts/check_project_quality.ts",
  ".github/trusted-quality-proposals.json",
])
  fs.copyFileSync(path.join(proposed, name), path.join(base, name));
const manifest = object(path.join(base, "package.json"));

const results: {
  name: string;
  accepted: boolean;
  expected: boolean;
  stdout: string;
  stderr: string;
}[] = [];
function check(
  name: string,
  root: string,
  baseline: string | undefined,
  expected: boolean,
): void {
  const args = ["--import", "tsx", checker, `--root=${root}`];
  if (baseline) args.push(`--trusted-root=${baseline}`);
  const result = spawnSync(process.execPath, args, {
    cwd: trusted,
    encoding: "utf8",
  });
  results.push({
    name,
    accepted: result.status === 0,
    expected,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  assert.equal(
    result.status === 0,
    expected,
    `${name}: ${result.stdout}\n${result.stderr}`,
  );
}
function reset(): void {
  fs.rmSync(candidate, { recursive: true, force: true });
  fs.cpSync(base, candidate, { recursive: true });
}
const hash = (value: string | Buffer): string =>
  crypto.createHash("sha256").update(value).digest("hex");
try {
  check("legacy remains valid", proposed, proposed, true);
  check("first cutover", base, proposed, true);
  check("missing trusted base", base, undefined, false);
  manifest.agentSkillChain = { qualityContractVersion: 16 };
  write(path.join(base, "package.json"), manifest);
  check("new base unchanged", base, base, true);
  reset();
  for (const name of ["package.json"]) {
    const file = path.join(candidate, name);
    const value = object(file);
    value.version = "0.5.0";
    write(file, value);
  }
  const lockFile = path.join(candidate, "package-lock.json");
  const lock = object(lockFile);
  lock.version = "0.5.0";
  assert.ok(isRecord(lock.packages));
  assert.ok(isRecord(lock.packages[""]));
  lock.packages[""].version = "0.5.0";
  write(lockFile, lock);
  check("coordinated version bump", candidate, base, true);
  reset();
  const old = fs.readFileSync(
    path.join(base, "scripts/check_project_quality.ts"),
  );
  const after = Buffer.concat([
    old,
    Buffer.from("\n// reviewed maintenance fixture\n"),
  ]);
  const registryFile = ".github/trusted-quality-proposals.json";
  const registry = object(path.join(base, registryFile));
  assert.ok(Array.isArray(registry.proposals));
  registry.proposals.push({
    proposalId: "TQP-V05-MAINTENANCE-TEST",
    status: "staged",
    fromVersion: 16,
    toVersion: 17,
    owner: "synthetic test owner",
    rationale: "Synthetic maintenance validates existing approval protocol.",
    rollback: "Register the prior checker bytes as a new forward approval.",
    targets: [
      {
        kind: "file",
        name: "scripts/check_project_quality.ts",
        beforeSha256: hash(old),
        afterSha256: hash(after),
      },
      {
        kind: "packageField",
        name: "agentSkillChain.qualityContractVersion",
        beforeSha256: hash("16"),
        afterSha256: hash("17"),
      },
    ],
  });
  write(path.join(candidate, registryFile), registry);
  check("proposal registration", candidate, base, true);
  const approved = path.join(fixture, "approved");
  fs.cpSync(candidate, approved, { recursive: true });
  fs.writeFileSync(
    path.join(candidate, "scripts/check_project_quality.ts"),
    after,
  );
  const changed = object(path.join(candidate, "package.json"));
  changed.agentSkillChain = { qualityContractVersion: 17 };
  write(path.join(candidate, "package.json"), changed);
  check("self activation rejected", candidate, base, false);
  check("registered maintenance", candidate, approved, true);
  reset();
  fs.copyFileSync(
    path.join(trusted, "scripts/check_project_quality.ts"),
    path.join(candidate, "scripts/check_project_quality.ts"),
  );
  check("old checker rejected", candidate, base, false);
  for (const name of [
    "scripts/quality-support/lib/security.ts",
    "scripts/quality-support/lib/entrypoint.ts",
    "scripts/quality-support/types.ts",
  ]) {
    reset();
    fs.appendFileSync(
      path.join(candidate, name),
      "\n// unauthorized helper change\n",
    );
    check(`unapproved helper ${name}`, candidate, base, false);
  }
  reset();
  const reverted = object(path.join(candidate, "package.json"));
  reverted.version = "0.4.99";
  write(path.join(candidate, "package.json"), reverted);
  check("legacy version rejected", candidate, base, false);
  for (const [name, from, to] of [
    ["package.json", "node --test test/test_*.mjs", "echo skipped"],
    [
      ".github/workflows/ci.yml",
      'ASC_TEST_CGROUP: "1"',
      'ASC_TEST_CGROUP: "0"',
    ],
    [
      ".github/workflows/trusted-quality.yml",
      "working-directory: trusted",
      "working-directory: candidate",
    ],
  ] as const) {
    reset();
    const file = path.join(candidate, name);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.includes(from));
    fs.writeFileSync(file, text.replace(from, to));
    check(`unapproved ${name}`, candidate, base, false);
  }
  for (const name of [
    "package.json",
    registryFile,
    ".github/workflows/ci.yml",
  ]) {
    reset();
    const file = path.join(candidate, name);
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(base, name), file);
    check(`identical symlink ${name}`, candidate, base, false);
  }
  reset();
  fs.mkdirSync(path.join(candidate, "v05"), { recursive: true });
  write(path.join(candidate, "v05/package.json"), { version: "0.5.0" });
  check("retired sidecar rejected", candidate, base, false);
  reset();
  fs.rmSync(path.join(candidate, ".github"), { recursive: true });
  fs.symlinkSync(
    path.join(base, ".github"),
    path.join(candidate, ".github"),
    "dir",
  );
  check("parent symlink", candidate, base, false);
} finally {
  write(output, { fixture, results });
}
process.stdout.write(
  `${JSON.stringify({ fixture, passed: results.length })}\n`,
);
