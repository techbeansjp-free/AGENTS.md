// Keeps the evaluators away from the condition names while a ranking round runs (#1815, review M-2). No model call.
// The prompt is not the only confinement:
//   - each round is ranked in its own directory <blind-root>/round<r> (make-blind.mjs), a tree separate from the runs
//     root (meta.json names the condition) and the keys root;
//   - Fable runs through `asc host-session` with Read/Glob/Grep only and cwd = that directory; Codex runs with a read-only
//     sandbox and cwd = that directory (README「順位」);
//   - while any ranking round runs, the runs root and the keys root are mode 000 (`lock`), and restored afterwards
//     (`unlock`). Each action is appended to a record file outside the repository (time, action, resulting modes).
// budget.mjs reserve and settle call guardProblems and refuse unless both roots are mode 000 and the round directory is
// a separate tree, so a round cannot start (or be settled) with the keys readable.
// Usage: node rank-guard.mjs lock|unlock|check <runs-root> <keys-root> <round-dir> --record <file>
import fs from 'node:fs';
import path from 'node:path';

const inside = (c, p) => { const r = path.relative(p, c); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
export const modeOf = (p) => (fs.existsSync(p) ? fs.statSync(p).mode & 0o777 : null);

export function guardProblems({runsRoot, keysRoot, roundDir}) {
  const p = [];
  for (const [n, x] of [['runs root', runsRoot], ['keys root', keysRoot]]) {
    if (!x || !fs.existsSync(x)) { p.push(`${n} does not exist`); continue; }
    if (modeOf(x) !== 0) p.push(`${n} is mode ${modeOf(x).toString(8)}, not 000 (node rank-guard.mjs lock)`);
    if (roundDir && (inside(roundDir, x) || inside(x, roundDir))) p.push(`the round directory and the ${n} are not separate trees`);
  }
  if (!roundDir || !fs.existsSync(roundDir)) p.push('round directory does not exist');
  else if (!fs.existsSync(path.join(roundDir, 'ui03-dashboard', 'ORDER.txt'))) p.push('round directory is not a make-blind round (no ui03-dashboard/ORDER.txt)');
  return p;
}

export function setModes({runsRoot, keysRoot, mode, record}) {
  for (const x of [runsRoot, keysRoot]) fs.chmodSync(x, mode);
  const line = {action: mode === 0 ? 'lock' : 'unlock', at: new Date().toISOString(), runsMode: modeOf(runsRoot).toString(8), keysMode: modeOf(keysRoot).toString(8)};
  fs.appendFileSync(record, JSON.stringify(line) + '\n');
  return line;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--record');
  const record = i >= 0 ? path.resolve(args[i + 1]) : null;
  const [action, runsRoot, keysRoot, roundDir] = args.filter((_, j) => j !== i && j !== i + 1).map((a, j) => (j === 0 ? a : path.resolve(a)));
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  if (!['lock', 'unlock', 'check'].includes(action) || !runsRoot || !keysRoot || !roundDir || !record) fail('usage: lock|unlock|check <runs-root> <keys-root> <round-dir> --record <file>');
  if (action === 'lock') console.log(JSON.stringify(setModes({runsRoot, keysRoot, mode: 0, record})));
  else if (action === 'unlock') console.log(JSON.stringify(setModes({runsRoot, keysRoot, mode: 0o700, record})));
  const p = guardProblems({runsRoot, keysRoot, roundDir});
  if (action === 'check') { console.log(JSON.stringify({ok: p.length === 0, problems: p})); process.exit(p.length ? 1 : 0); }
}
