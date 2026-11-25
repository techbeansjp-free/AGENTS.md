// One cumulative spending ledger for every stage of #1814 (reviews M4, N1, N-1). JSON lines in a file outside the
// repository. The first line is {ledgerId, createdAt}; the id is recorded in results/fixation.json at init, so run-trial
// refuses any other ledger (a new ledger cannot reset the total). Each reservation {id, seq, trial, reservedUsd, at} has
// a unique id and a sequence number (count of earlier reservations); a settlement {id, trial, costUsd} follows the trial.
// meta.json / trials.json carry ledgerId and seq, and collect/score refuse mixed ledger ids or a repeated seq (a copy of
// an earlier state of the ledger used to reset the total). A trial name is reserved only once. Spent = for each
// reservation its settled cost, or its reservation when never settled. A lock file keeps trials strictly sequential.
// Usage: node ledger.mjs create <file>
import fs from 'node:fs';
import crypto from 'node:crypto';

function lines(ledger) {
  return fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}
const entries = (ledger) => lines(ledger).filter((e) => !('ledgerId' in e));

export function create(ledger) {
  if (fs.existsSync(ledger)) throw new Error(`ledger exists: ${ledger}`);
  const ledgerId = crypto.randomUUID();
  fs.writeFileSync(ledger, JSON.stringify({ledgerId, createdAt: new Date().toISOString()}) + '\n', {flag: 'wx', mode: 0o600});
  return ledgerId;
}

export function ledgerId(ledger) {
  const first = lines(ledger)[0];
  return first && typeof first.ledgerId === 'string' ? first.ledgerId : null;
}

export function spent(ledger) {
  const byId = new Map();
  for (const e of entries(ledger)) {
    const key = e.id ?? `legacy:${e.trial}`;
    const cur = byId.get(key) ?? {reserved: 0, cost: null};
    if (typeof e.reservedUsd === 'number') cur.reserved += e.reservedUsd;
    if (typeof e.costUsd === 'number') cur.cost = e.costUsd;
    byId.set(key, cur);
  }
  let total = 0;
  for (const t of byId.values()) total += t.cost ?? t.reserved;
  return total;
}

export const reservations = (ledger) => entries(ledger).filter((e) => typeof e.reservedUsd === 'number');
export const reservedNames = (ledger) => new Set(reservations(ledger).map((e) => e.trial));
export const isProbe = (trial) => /-probe-\d+$/.test(trial);

export function lock(ledger) {
  try { fs.writeFileSync(`${ledger}.lock`, `${process.pid}\n`, {flag: 'wx'}); } catch {
    throw new Error(`ledger is locked (${ledger}.lock): another trial is running or a previous one did not finish; check the ledger before removing the lock`);
  }
  return () => fs.rmSync(`${ledger}.lock`, {force: true});
}

// Returns {id, seq}. Refuses a trial name that is already in the ledger.
export function reserve(ledger, trial, reservedUsd) {
  if (reservedNames(ledger).has(trial)) throw new Error(`trial ${trial} is already in the ledger; a rerun needs a new rep number`);
  const id = crypto.randomUUID(), seq = reservations(ledger).length;
  fs.appendFileSync(ledger, JSON.stringify({id, seq, trial, reservedUsd, at: new Date().toISOString()}) + '\n');
  return {id, seq};
}

export function settle(ledger, id, trial, costUsd) {
  // A missing cost keeps the reservation.
  fs.appendFileSync(ledger, JSON.stringify({id, trial, costUsd: typeof costUsd === 'number' ? costUsd : null, at: new Date().toISOString()}) + '\n');
}

// Records from several trials must come from one ledger, each seq once (review N-1 (d)).
export function ledgerConsistency(rows) {
  const ids = [...new Set(rows.map((r) => r.ledgerId ?? null))];
  const p = [];
  if (ids.length > 1 || ids[0] === null) p.push(`trials come from ${ids.length} ledger id(s)${ids.includes(null) ? ' (some without an id)' : ''}`);
  const seen = new Map();
  for (const r of rows) if (typeof r.ledgerSeq === 'number') { if (seen.has(r.ledgerSeq)) p.push(`ledger seq ${r.ledgerSeq} repeated (${seen.get(r.ledgerSeq)}, ${r.trial})`); seen.set(r.ledgerSeq, r.trial); }
  return p;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, file] = process.argv.slice(2);
  if (action === 'create' && file) console.log(JSON.stringify({ledgerId: create(file)}));
  else { console.error('usage: node ledger.mjs create <file>'); process.exit(2); }
}
