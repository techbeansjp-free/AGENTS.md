// Keeps the evaluators away from the condition names while a ranking round runs (#1815, reviews M-2 and M-a).
// Primary confinement (chosen, review M-a): both evaluators run through `asc host-session` with the round directory
// <blind-root>/round<r> as the target. It is not a Git directory, so it is both the launch cwd and the only readable
// tree: Fable (host claude) runs with --restricted and the file tools Read/Glob/Grep closed to the cwd; Codex runs in a
// generated permissions profile that allows reads of the target only (skills/asc/references/host-session.md). The
// renders, the ranks outputs, the other round, the keys, the runs and this repository are outside that tree.
// Second layer (this file): while a round runs, the runs root, the keys root, the render root and the other round's
// blind directory are mode 000 (`lock`), and restored afterwards (`unlock`). The ranks root (where host-session writes
// the outputs) cannot be locked because the host-session process writes there; it is a separate tree that neither
// evaluator can read. Each action is appended to a record file (time, round, roots, modes); decide.mjs checks that the
// lock was held from each round's reservation to its settle.
// budget.mjs reserve and settle call guardProblems and refuse unless every locked root is mode 000 and the round
// directory is a separate tree from all of them and from the ranks root.
// Usage: node rank-guard.mjs lock|unlock|check --round <1|2> --runs-root <r> --keys-root <k> --render-root <x>
//          --blind-root <b> --record <file>
import fs from 'node:fs';
import path from 'node:path';

const inside = (c, p) => { const r = path.relative(p, c); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
export const modeOf = (p) => (fs.existsSync(p) ? fs.statSync(p).mode & 0o777 : null);
export const roundDirOf = (blindRoot, round) => path.join(blindRoot, `round${round}`);
export function lockedRoots({runsRoot, keysRoot, renderRoot, blindRoot, round}) {
  return {'runs root': runsRoot, 'keys root': keysRoot, 'render root': renderRoot, 'other round': roundDirOf(blindRoot, round === 1 ? 2 : 1)};
}

export function guardProblems({runsRoot, keysRoot, renderRoot, blindRoot, round, ranksRoot = null}) {
  const p = [];
  if (![1, 2].includes(Number(round)) || !blindRoot) return ['--round 1|2 and --blind-root are required'];
  const roundDir = roundDirOf(blindRoot, Number(round));
  for (const [n, x] of Object.entries(lockedRoots({runsRoot, keysRoot, renderRoot, blindRoot, round: Number(round)}))) {
    if (!x || !fs.existsSync(x)) { p.push(`${n} does not exist`); continue; }
    if (modeOf(x) !== 0) p.push(`${n} is mode ${modeOf(x).toString(8)}, not 000 (node rank-guard.mjs lock)`);
    if (inside(roundDir, x) || inside(x, roundDir)) p.push(`the round directory and the ${n} are not separate trees`);
  }
  if (ranksRoot && (inside(roundDir, ranksRoot) || inside(ranksRoot, roundDir))) p.push('the round directory and the ranks root are not separate trees');
  if (!fs.existsSync(roundDir)) p.push('round directory does not exist');
  else if (!fs.existsSync(path.join(roundDir, 'ui03-dashboard', 'ORDER.txt'))) p.push('round directory is not a make-blind round (no ui03-dashboard/ORDER.txt)');
  return p;
}

export function setModes(o, mode, record) {
  const roots = lockedRoots(o);
  for (const x of Object.values(roots)) fs.chmodSync(x, mode);
  const line = {action: mode === 0 ? 'lock' : 'unlock', round: Number(o.round), at: new Date().toISOString(), modes: Object.fromEntries(Object.entries(roots).map(([n, x]) => [n, modeOf(x).toString(8)]))};
  fs.appendFileSync(record, JSON.stringify(line) + '\n');
  return line;
}

// decide.mjs (review M-d item 4): for each completed round, a lock of that round at or before its reservation and no
// unlock of that round between the lock and its settle.
export function lockHeldProblems(recordText, settles) {
  const recs = String(recordText ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const p = [];
  for (const [e, rounds] of Object.entries(settles)) for (const [r, s] of Object.entries(rounds)) {
    const mine = recs.filter((x) => x.round === Number(r));
    const lock = mine.filter((x) => x.action === 'lock' && x.at <= s.reservedAt && Object.values(x.modes ?? {}).every((m) => m === '0')).at(-1);
    if (!lock) { p.push(`${e} round ${r}: no lock before the reservation`); continue; }
    if (mine.some((x) => x.action === 'unlock' && x.at > lock.at && x.at < s.settledAt)) p.push(`${e} round ${r}: unlocked between the lock and the settle`);
  }
  return p;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const abs = (k) => (opt(k) ? path.resolve(opt(k)) : null);
  const o = {runsRoot: abs('--runs-root'), keysRoot: abs('--keys-root'), renderRoot: abs('--render-root'), blindRoot: abs('--blind-root'), round: Number(opt('--round'))};
  const action = args[0], record = abs('--record');
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  if (!['lock', 'unlock', 'check'].includes(action) || !record || Object.values(o).some((v) => !v)) fail('usage: lock|unlock|check --round <1|2> --runs-root <r> --keys-root <k> --render-root <x> --blind-root <b> --record <file>');
  if (action === 'lock') console.log(JSON.stringify(setModes(o, 0, record)));
  else if (action === 'unlock') console.log(JSON.stringify(setModes(o, 0o700, record)));
  else { const p = guardProblems(o); console.log(JSON.stringify({ok: p.length === 0, problems: p})); process.exit(p.length ? 1 : 0); }
}
