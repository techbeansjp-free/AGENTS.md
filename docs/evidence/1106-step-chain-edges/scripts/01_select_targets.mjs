import fs from "node:fs";
import path from "node:path";
const rows = JSON.parse(fs.readFileSync("/tmp/1106-rows.json", "utf8"));
const byTracker = new Map();
for (const r of rows) {
  if (r.mode !== "full" || r.maxstep < 9) continue;
  const k = r.tracker;
  if (!k) continue;
  const prev = byTracker.get(k);
  if (!prev || r.maxstep > prev.maxstep) byTracker.set(k, r);
}
const all = [...byTracker.values()]
  .filter((r) => {
    const d = path.dirname(r.path);
    return fs.existsSync(path.join(d, "03_実装計画.md"))
      && fs.existsSync(path.join(d, "02_設計.md"))
      && fs.existsSync(path.join(d, "01_要件定義.md"))
      && fs.existsSync(path.join(d, "00_要求定義.md"));
  })
  .sort((a, b) => Number(a.tracker) - Number(b.tracker));
console.log("候補（4成果物すべてを持つfull mode、tracker重複排除）:", all.length);
const picked = all.slice(-12);
console.log("対象（tracker昇順の末尾12件＝直近12件）:");
for (const r of picked) console.log(" ", r.tracker, path.basename(r.path).slice(0, 60));
fs.writeFileSync("/tmp/1106-picked.json", JSON.stringify(picked.map((r) => path.dirname(r.path)), null, 1));
