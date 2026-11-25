// One cumulative spending ledger for every stage of #1814 (review M4, N1). JSON lines in a file outside the repository:
// {id, trial, reservedUsd} is appended before a trial starts, {id, trial, costUsd} after it ends. Every reservation has a
// unique id, and a trial name may be reserved only once in the ledger (a rerun takes a new rep number), so a rerun can
// never hide an earlier reservation. Spent = for each id its settled cost, or its reservation when it never settled
// (a killed parent counts at its budget, never at zero). A lock file (created exclusively) makes trials strictly
// sequential; a left-over lock stops every later trial until a person checks the ledger and removes it.
import fs from 'node:fs';
import crypto from 'node:crypto';

function entries(ledger) {
  return fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
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

export const reservedNames = (ledger) => new Set(entries(ledger).filter((e) => typeof e.reservedUsd === 'number').map((e) => e.trial));

export function lock(ledger) {
  try { fs.writeFileSync(`${ledger}.lock`, `${process.pid}\n`, {flag: 'wx'}); } catch {
    throw new Error(`ledger is locked (${ledger}.lock): another trial is running or a previous one did not finish; check the ledger before removing the lock`);
  }
  return () => fs.rmSync(`${ledger}.lock`, {force: true});
}

// Returns the reservation id. Refuses a trial name that is already in the ledger.
export function reserve(ledger, trial, reservedUsd) {
  if (reservedNames(ledger).has(trial)) throw new Error(`trial ${trial} is already in the ledger; a rerun needs a new rep number`);
  const id = crypto.randomUUID();
  fs.appendFileSync(ledger, JSON.stringify({id, trial, reservedUsd, at: new Date().toISOString()}) + '\n');
  return id;
}

export function settle(ledger, id, trial, costUsd) {
  // A missing cost keeps the reservation.
  fs.appendFileSync(ledger, JSON.stringify({id, trial, costUsd: typeof costUsd === 'number' ? costUsd : null, at: new Date().toISOString()}) + '\n');
}
