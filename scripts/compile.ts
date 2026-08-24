import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const output = path.resolve(root, "dist");
if (fs.existsSync(output)) fs.rmSync(output, { recursive: true });

const compiler = path.resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);
const result = spawnSync(compiler, ["-p", "tsconfig.build.json"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

fs.chmodSync(path.resolve(output, "bin", "agent-skill-chain.js"), 0o755);
