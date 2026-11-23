import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const files = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) w(p);
    else if (p.endsWith('.jsonl')) files.push(p);
  }
})(root);
const z = () => ({ n: 0, i: 0, o: 0, cr: 0, cw: 0 });
const add = (a, u) => {
  a.n++;
  a.i += u.input_tokens || 0;
  a.o += u.output_tokens || 0;
  a.cr += u.cache_read_input_tokens || 0;
  a.cw += u.cache_creation_input_tokens || 0;
};
const T = { all: z(), small: z(), smallBash: z(), smallSameBash: z(), big: z() };
let asc = 0, missing = 0;
const onlyAsc = process.argv[3] === 'asc';
let used = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const isAsc = /agent-skill-chain|skills\/asc/.test(raw);
  if (isAsc) asc++;
  if (onlyAsc && !isAsc) continue;
  used++;
  const seen = new Set();
  let prev = null;
  let lastTools = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    const msg = m.message;
    if (!msg) continue;
    if (m.type === 'user' && Array.isArray(msg.content)) {
      const r = msg.content.filter((c) => c.type === 'tool_result');
      prev = r.length ? { err: r.some((c) => c.is_error) } : null;
      continue;
    }
    if (m.type === 'assistant' && Array.isArray(msg.content)) {
      if (!msg.usage) { missing++; continue; }
      if (!msg.stop_reason) continue;
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
      const tu = msg.content.filter((c) => c.type === 'tool_use');
      const tx = msg.content.some((c) => (c.type === 'text' && c.text.trim()) || c.type === 'thinking');
      add(T.all, msg.usage);
      if (prev && !prev.err && tu.length && !tx) {
        const names = tu.map((c) => c.name).join(',');
        const o = msg.usage.output_tokens || 0;
        if (o <= 200) {
          add(T.small, msg.usage);
          if (tu.every((c) => c.name === 'Bash')) {
            add(T.smallBash, msg.usage);
            if (lastTools === names) add(T.smallSameBash, msg.usage);
          }
        } else add(T.big, msg.usage);
      }
      lastTools = tu.map((c) => c.name).join(',');
      prev = null;
    }
  }
}
console.log(JSON.stringify({ files: files.length, sessionsUsed: used, ascSessions: asc, missingUsage: missing, T }, null, 1));
