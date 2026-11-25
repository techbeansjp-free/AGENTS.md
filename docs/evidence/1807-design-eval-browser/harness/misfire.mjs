// Misfire check on the UI-10-equivalent case (#1807): design Skill use (Skill call or Read of its files), UI files created,
// and browser tool calls, per trial. Same definition as #1804 score.mjs (ui10), plus browser tools.
// Usage: node misfire.mjs <runs-root> <out.json> [--oracle <run-ui10-tests output json>]
import fs from 'node:fs';
import path from 'node:path';
const [runsRoot, outPath, ...rest] = process.argv.slice(2);
const oracle = rest.includes('--oracle') ? JSON.parse(fs.readFileSync(rest[rest.indexOf('--oracle') + 1], 'utf8')) : {};
const DESIGN = ['anything-frontend-art-direction', 'anything-frontend-product-design'];
const root = path.join(runsRoot, 'ui10-cli');
const walk = (d) => fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.name === '.claude' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const res = {};
for (const t of fs.readdirSync(root).sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, t, 'meta.json'), 'utf8'));
  const core = JSON.parse(fs.readFileSync(path.join(root, t, 'core-steps.json'), 'utf8'));
  const fx = path.join(root, t, 'fixture');
  const uiFiles = walk(fx).map((p) => path.relative(fx, p)).filter((p) => /\.(html|css)$/.test(p) || p.endsWith('DESIGN-NOTES.md'));
  const skillUse = [...(meta.skillCalls ?? []).filter((s) => DESIGN.some((d) => String(s).includes(d))),
    ...(meta.skillFileReads ?? []).filter((p) => DESIGN.some((d) => p.includes(d)))];
  const browserCalls = Object.values(core.toolCalls ?? {}).reduce((a, v) => a + v.calls, 0);
  res[t] = {exit: meta.exit, subtype: meta.resultSubtype, costUsd: meta.costUsd, designSkillUse: skillUse, uiFiles, browserCalls,
    misfire: skillUse.length > 0 || uiFiles.length > 0, oracle: oracle[t]?.oracle ?? null, ownTests: oracle[t]?.ownTests ?? null};
}
fs.writeFileSync(outPath, JSON.stringify(res, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, {misfire: v.misfire, browserCalls: v.browserCalls, oracle: v.oracle}]))));
