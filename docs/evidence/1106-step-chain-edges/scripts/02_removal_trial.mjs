import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const ROOT = process.argv[2];
const CLI = path.join(ROOT, "dist/bin/agent-skill-chain.js");
const WORK = "/tmp/1106-work";
const ARTIFACTS = ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"];
const stagings = JSON.parse(fs.readFileSync("/tmp/1106-picked.json", "utf8"));
const gut = (s) => s.split("\n").filter((l) => l.startsWith("#")).join("\n") + "\n";
function validate(p) {
  const r = spawnSync(process.execPath, [CLI, "issue", "validate", `--path=${p}`], { cwd: ROOT, encoding: "utf8" });
  try { const d = JSON.parse(r.stdout); return { valid: d.valid === true, errors: d.errors ?? [] }; }
  catch { return { valid: null, errors: ["__PARSE_FAIL__ " + (r.stdout + r.stderr).slice(0, 200)] }; }
}
const out = [];
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
for (let i = 0; i < stagings.length; i += 1) {
  const s = stagings[i];
  const donor = stagings[(i + 1) % stagings.length];
  const name = path.basename(s).slice(0, 40);
  const w = path.join(WORK, "trial");
  fs.rmSync(w, { recursive: true, force: true }); fs.cpSync(s, w, { recursive: true });
  out.push({ staging: name, target: "（なし）", variant: "baseline", ...validate(w) });
  for (const t of ARTIFACTS) {
    for (const v of ["delete", "gut", "swap"]) {
      fs.rmSync(w, { recursive: true, force: true }); fs.cpSync(s, w, { recursive: true });
      const f = path.join(w, t);
      if (v === "delete") fs.rmSync(f, { force: true });
      if (v === "gut") fs.writeFileSync(f, gut(fs.readFileSync(f, "utf8")));
      if (v === "swap") fs.copyFileSync(path.join(donor, t), f);
      out.push({ staging: name, target: t, variant: v, ...validate(w) });
    }
  }
}
fs.rmSync(WORK, { recursive: true, force: true });
fs.writeFileSync("/tmp/1106-observations.json", JSON.stringify(out, null, 1));
// 集計
const agg = {};
for (const o of out) {
  const k = o.target + " / " + o.variant;
  agg[k] ??= { n: 0, valid: 0, invalid: 0 };
  agg[k].n += 1;
  if (o.valid) agg[k].valid += 1; else agg[k].invalid += 1; // lint対応。集計のみで観測値に影響しない
}
console.log("観測数:", out.length);
for (const k of Object.keys(agg)) console.log(" ", k.padEnd(28), JSON.stringify(agg[k]));
