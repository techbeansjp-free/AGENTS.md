// One cumulative spending ledger for every stage of #1814 (review M4). JSON lines in a file outside the repository:
// {trial, reservedUsd} is appended before a trial starts, {trial, costUsd} after it ends. Spent = for each trial its
// settled cost, or its reservation when it never settled (a killed parent counts at its budget, never at zero).
// A lock file (created exclusively) makes trials strictly sequential; a left-over lock stops every later trial until a
// person checks the ledger and removes it.
import fs from 'node:fs';

export function spent(ledger) {
  if (!fs.existsSync(ledger)) return 0;
  const byTrial = new Map();
  for (const line of fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    const cur = byTrial.get(e.trial) ?? {reserved: 0, cost: null};
    if (typeof e.reservedUsd === 'number') cur.reserved += e.reservedUsd;
    if ('costUsd' in e) cur.cost = typeof e.costUsd === 'number' ? e.costUsd : null;
    byTrial.set(e.trial, cur);
  }
  let total = 0;
  for (const t of byTrial.values()) total += t.cost ?? t.reserved;
  return total;
}

export function lock(ledger) {
  try { fs.writeFileSync(`${ledger}.lock`, `${process.pid}\n`, {flag: 'wx'}); } catch {
    throw new Error(`ledger is locked (${ledger}.lock): another trial is running or a previous one did not finish; check the ledger before removing the lock`);
  }
  return () => fs.rmSync(`${ledger}.lock`, {force: true});
}

export function reserve(ledger, trial, reservedUsd) {
  fs.appendFileSync(ledger, JSON.stringify({trial, reservedUsd, at: new Date().toISOString()}) + '\n');
}

export function settle(ledger, trial, costUsd) {
  // A missing cost keeps the reservation (costUsd null is ignored by spent()).
  fs.appendFileSync(ledger, JSON.stringify({trial, costUsd: typeof costUsd === 'number' ? costUsd : null, at: new Date().toISOString()}) + '\n');
}
