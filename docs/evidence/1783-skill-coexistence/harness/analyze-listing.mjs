// Extracts the Skill listing that the Host sent in the first main-loop request of a capture.
// Usage: node analyze-listing.mjs <observation-dir> [--full]
// Prints per-entry visibility: description present or name only, and the listing size.
import fs from 'node:fs';
import path from 'node:path';
const [dir, flag] = process.argv.slice(2);
const reqs = fs.readFileSync(path.join(dir, 'capture.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const main = reqs.filter((r) => r.path.startsWith('/v1/messages?') && (r.body?.tools ?? []).some((t) => t.name === 'Skill'));
const marker = 'The following skills are available for use with the Skill tool:';
const textsOf = (body) => [...(Array.isArray(body.system) ? body.system.map((b) => b.text ?? '') : [body.system ?? '']), ...body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [{text: m.content}]).map((b) => b.text ?? ''))];
const first = main[0];
const text = first ? textsOf(first.body).find((t) => t.includes(marker)) : undefined;
if (!text) { console.log(JSON.stringify({dir: path.basename(dir), listing: null, mainRequests: main.length})); process.exit(0); }
const block = text.slice(text.indexOf(marker) + marker.length).replace(/^\n+/, '');
const lines = [];
for (const line of block.split('\n')) { if (line.startsWith('- ')) lines.push(line); else if (lines.length && line.trim() === '') break; else if (lines.length) lines[lines.length - 1] += '\n' + line; }
const entries = lines.map((l) => { const m = /^- (.+?)(?:: ([\s\S]*))?$/.exec(l); return {name: m[1], description: m[2] ?? null}; });
const asc = JSON.parse(fs.readFileSync(new URL('../inventory.json', import.meta.url), 'utf8')).rows.filter((r) => r.kind === 'standard').map((r) => r.name);
const isAsc = (name) => asc.includes(name) || asc.includes(name.replace(/^project:/, ''));
const summary = {
  dir: path.basename(dir), mainRequests: main.length, entries: entries.length,
  withDescription: entries.filter((e) => e.description !== null).length,
  listingChars: lines.join('\n').length,
  asc: Object.fromEntries(asc.map((n) => { const e = entries.find((x) => x.name === n || x.name === `project:${n}`); return [n, e ? (e.description === null ? 'name-only' : `desc:${e.description.length}`) : 'absent']; })),
  others: {withDescription: entries.filter((e) => !isAsc(e.name) && e.description !== null).map((e) => e.name), nameOnly: entries.filter((e) => !isAsc(e.name) && e.description === null).map((e) => e.name)},
};
if (flag === '--full') summary.entries = entries;
console.log(JSON.stringify(summary, null, 1));
