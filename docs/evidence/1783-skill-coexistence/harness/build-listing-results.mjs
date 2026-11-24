// Aggregates the listing observations into results/listing-observations.json (read only on inputs).
// Usage: node build-listing-results.mjs <observations-dir> <out.json>
// For each condition: analyze-listing summary (with the names of name-only entries other than synthetic Skills), the debug-log budget warning, the /context Skills row
// and the `asc` row, and skillUsage recorded in the isolated ~/.claude.json after the runs.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [dir, out] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const rows = [];
for (const d of fs.readdirSync(dir).sort()) {
  const p = path.join(dir, d);
  const j = JSON.parse(execFileSync('node', [path.join(here, 'analyze-listing.mjs'), p], {encoding: 'utf8'}));
  const debug = fs.readFileSync(path.join(p, 'debug-hello.log'), 'utf8');
  const ctxFile = path.join(p, 'stdout-context.txt');
  const ctx = fs.existsSync(ctxFile) ? fs.readFileSync(ctxFile, 'utf8') : '';
  const after = JSON.parse(fs.readFileSync(path.join(p, 'claude.json.after'), 'utf8'));
  rows.push({condition: d, entries: j.entries, withDescription: j.withDescription, listingChars: j.listingChars,
    ascWithDescription: Object.values(j.asc).filter((v) => v.startsWith('desc')).length, asc: j.asc, othersNameOnly: j.others.nameOnly.length,
    nonSyntheticNameOnly: j.others.nameOnly.filter((n) => !/^(personal-|plugin-|tool-|toolbox:|synthetic-tools:)/.test(n)),
    debugWarning: (debug.match(/Skill listing over budget: [^—]*/) ?? [null])[0]?.trim() ?? null,
    contextSkillsRow: (ctx.match(/\| Skills \| [^\n]*/) ?? [null])[0], contextAscRow: (ctx.match(/\| (project:)?asc \| [^\n]*/) ?? [null])[0],
    skillUsageAfter: after.skillUsage});
}
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(rows.length);
