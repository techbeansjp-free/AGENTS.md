import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const ROOT = process.argv[2];
const git = (a) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const rows = JSON.parse(fs.readFileSync("/tmp/1106-rows.json", "utf8"));
const byTracker = new Map();
for (const r of rows) {
  if (r.mode !== "full" || r.maxstep < 9) continue;
  const d = path.dirname(r.path);
  if (!fs.existsSync(path.join(d, "journal/steps.jsonl"))) continue;
  const prev = byTracker.get(r.tracker);
  if (!prev || r.maxstep > prev.maxstep) byTracker.set(r.tracker, { ...r, dir: d });
}
// mainのmerge commitからIssue番号を引く
const log = git(["log", "--first-parent", "--format=%H%x09%P%x09%s", "origin/main"]).split("\n");
const mergeByPr = new Map();
for (const line of log) {
  const [sha, parents, subject] = line.split("\t");
  const m = /^Merge pull request #(\d+) /.exec(subject ?? "");
  if (m && parents.split(" ").length === 2) mergeByPr.set(m[1], { sha, parents: parents.split(" ") });
}
// **branch名からIssue番号を引く。** merge commitの本文にはIssue番号が入らない。
const prForIssue = new Map();
for (const line of log) {
  const [sha, parents, subject] = line.split("\t");
  const m = /^Merge pull request #\d+ from [^/]+\/[a-z]+\/(\d+)-/.exec(subject ?? "");
  if (!m) continue;
  const ps = parents.split(" ");
  if (ps.length !== 2) continue;
  if (!prForIssue.has(m[1])) prForIssue.set(m[1], { sha, parents: ps });
}
const out = [];
for (const [tracker, r] of byTracker) {
  const steps = {};
  for (const line of fs.readFileSync(path.join(r.dir, "journal/steps.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    if (steps[d.step] === undefined) steps[d.step] = d.recordedAt; // 最初の記録
  }
  const info = prForIssue.get(tracker);
  let first = null;
  if (info) {
    const range = `${info.parents[0]}..${info.parents[1]}`;
    const dates = git(["log", "--format=%aI%x09%H", "--reverse", range]).split("\n").filter(Boolean);
    for (const d of dates) {
      const [date, sha] = d.split("\t");
      const files = git(["show", "--name-only", "--format=", sha]).split("\n").filter(Boolean);
      if (files.some((f) => f.startsWith("src/") || f.startsWith("test/") || f.startsWith("scripts/"))) { first = date; break; }
    }
  }
  out.push({ tracker, step5: steps[5] ?? null, step7: steps[7] ?? null, firstImpl: first });
}
const cmp = (a, b) => (a && b ? (new Date(a) < new Date(b) ? "before" : "after") : "unknown");
let b5 = 0, a5 = 0, b7 = 0, a7 = 0, u = 0;
for (const r of out) {
  const c5 = cmp(r.firstImpl, r.step5), c7 = cmp(r.firstImpl, r.step7);
  if (c5 === "before") b5++; else if (c5 === "after") a5++; else u++;
  if (c7 === "before") b7++; else if (c7 === "after") a7++;
}
console.log("対象:", out.length);
console.log(`最初の実装commitがStep 5の記録より前: ${b5} / 後: ${a5} / 判定不能: ${u}`);
console.log(`最初の実装commitがStep 7の記録より前: ${b7} / 後: ${a7}`);
console.log("\n前になった案件:");
for (const r of out) if (cmp(r.firstImpl, r.step5) === "before") console.log(" ", r.tracker, r.firstImpl, "<", r.step5);
fs.writeFileSync("/tmp/1106-order2.json", JSON.stringify(out, null, 1));
