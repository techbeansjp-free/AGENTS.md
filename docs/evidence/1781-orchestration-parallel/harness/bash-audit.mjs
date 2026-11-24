// Usage: node bash-audit.mjs <outRoot>
// Lists every Bash command other than the test wrapper that the Host executed (not denied) in the parent and child sessions,
// grouped by the command words, and flags commands that name a path outside the fixture. A result counts as denied only when
// the Host says the permission was denied; other error results count as executed. Paths are tokens after removing quotes and
// splitting on shell operators, resolved against the fixture and any `cd`. No path or content is printed.
import fs from 'node:fs';
import path from 'node:path';

const outRoot = path.resolve(process.argv[2]);
const projRoot = path.join(process.env.HOME, '.claude', 'projects');
const projDirs = fs.readdirSync(projRoot).map((d) => path.join(projRoot, d));
const counts = {}; let outside = 0; let executed = 0; let denied = 0; let failed = 0;
for (const d of fs.readdirSync(outRoot)) {
  const recFile = path.join(outRoot, d, 'record.json');
  if (!/^P[123]-(A2|A3|[A-E])-\d$/.test(d) || !fs.existsSync(recFile)) continue;
  const { sessionId } = JSON.parse(fs.readFileSync(recFile, 'utf8'));
  const fx = fs.realpathSync(path.join(outRoot, d, 'fx'));
  const wrapper = path.join(outRoot, d, 'bin', 'run-tests');
  const inside = (p) => p === fx || p.startsWith(fx + path.sep);
  const proj = projDirs.find((p) => fs.existsSync(path.join(p, `${sessionId}.jsonl`)));
  if (!proj) { console.log(`${d}: session log missing`); continue; }
  const files = [path.join(proj, `${sessionId}.jsonl`)];
  const sub = path.join(proj, sessionId, 'subagents');
  if (fs.existsSync(sub)) for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(path.join(sub, f));
  for (const f of files) {
    const cmds = new Map(); const res = new Map();
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
      for (const c of Array.isArray(o.message?.content) ? o.message.content : []) {
        if (c.type === 'tool_use' && c.name === 'Bash') cmds.set(c.id, c.input?.command ?? '');
        if (c.type === 'tool_result') res.set(c.tool_use_id, { err: !!c.is_error, denied: !!c.is_error && /permission to use bash has been denied|permission.*denied/i.test(JSON.stringify(c.content)) });
      }
    }
    for (const [id, cmd] of cmds) {
      const r = res.get(id) ?? { err: false, denied: false };
      const rest = cmd.split(wrapper).join('').replace(/'[^']*'|"[^"]*"/g, '').trim();
      if (cmd.includes(wrapper) && /^(2>&1)?\s*(\|\s*(tail|head|grep)\b[^|;&]*)*$/.test(rest)) continue;
      if (r.denied) { denied++; continue; }
      executed++; if (r.err) failed++;
      const words = cmd.replace(/'[^']*'|"[^"]*"/g, '').split(/[|;&]+/).map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).filter((w) => w !== 'cd');
      const key = [...new Set(words.map((w) => (w.includes('/') ? '<path>' : w)))].sort().join('+');
      counts[key] = (counts[key] ?? 0) + 1;
      const toks = cmd.replace(/['"]/g, ' ').split(/[\s;|&<>()]+/).filter(Boolean);
      let cwd = fx; let out = false;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t === 'cd' && toks[i + 1]) { cwd = path.resolve(cwd, toks[i + 1].replace(/^~/, process.env.HOME)); if (!inside(cwd)) out = true; i++; continue; }
        if (t === '/dev/null' || t.startsWith(wrapper) || !(t.startsWith('/') || t.startsWith('~') || t.includes('..'))) continue;
        const p = path.resolve(cwd, t.replace(/^~/, process.env.HOME));
        if (!inside(p)) out = true;
      }
      if (out) outside++;
    }
  }
}
console.log(JSON.stringify({ executedNonWrapper: executed, executedWithNonZeroExit: failed, deniedNonWrapper: denied, executedNamingOutsidePath: outside, byCommandWords: counts }, null, 1));
