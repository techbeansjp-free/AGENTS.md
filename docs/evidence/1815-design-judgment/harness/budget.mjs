// Ledger entries for the paid steps that are not generation trials (#1815): the Fable ranking sessions. Uses the #1814
// ledger (one file, append-only, lock, reservations counted until settled). A session is reserved before it starts at
// conditions.json budget.rankingReserveUsd and refused when ledger total + reservation > capUsd - safetyMarginUsd, or when
// the fixation checks fail (fixation.mjs paidStepProblems). Settle with the Host cost; `missing` keeps the reservation.
// Codex reports no Host cost: record it with `note` (no amount), as #1807 recorded it as missing.
// Usage: node budget.mjs reserve <ledger> <name>          (name: rank-fable-<round>)
//        node budget.mjs settle  <ledger> <name> <usd|missing>
//        node budget.mjs note    <ledger> <name> <text>    (e.g. rank-codex-1 "no Host cost")
//        node budget.mjs total   <ledger>
import fs from 'node:fs';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {loadJson} from './pairing.mjs';
import {paidStepProblems} from './fixation.mjs';

export function canReserve(spent, amount, budget) {
  return spent + amount <= budget.capUsd - budget.safetyMarginUsd;
}

function main() {
  const [action, ledger, name, value] = process.argv.slice(2);
  let unlock = () => {};
  const fail = (m) => { unlock(); console.error(`refused: ${m}`); process.exit(3); };
  const budget = loadJson('conditions.json').budget;
  if (!ledger || !fs.existsSync(ledger)) fail('ledger does not exist');
  if (action === 'total') { console.log(JSON.stringify({spentUsd: ledgerOps.spent(ledger), capUsd: budget.capUsd, stopAboveUsd: budget.capUsd - budget.safetyMarginUsd})); return; }
  if (!/^rank-(fable|codex)-[12]$/.test(name ?? '')) fail('name must be rank-fable-<1|2> or rank-codex-<1|2>');
  const p = paidStepProblems(ledger);
  if (p.length) fail(p.join('; '));
  try { unlock = ledgerOps.lock(ledger); } catch (e) { fail(e.message); }
  try {
    if (action === 'reserve') {
      if (!name.startsWith('rank-fable-')) fail('only Fable sessions are reserved (Codex has no Host cost)');
      const spent = ledgerOps.spent(ledger);
      if (!canReserve(spent, budget.rankingReserveUsd, budget)) fail(`ledger total ${spent.toFixed(2)} + ${budget.rankingReserveUsd} would exceed ${budget.capUsd} - ${budget.safetyMarginUsd}`);
      const r = ledgerOps.reserve(ledger, name, budget.rankingReserveUsd);
      console.log(JSON.stringify({reserved: name, id: r.id, seq: r.seq}));
    } else if (action === 'settle') {
      const res = ledgerOps.reservations(ledger).find((e) => e.trial === name);
      if (!res) fail(`${name} has no reservation`);
      ledgerOps.settle(ledger, res.id, name, value === 'missing' ? null : Number(value));
      console.log(JSON.stringify({settled: name, costUsd: value}));
    } else if (action === 'note') {
      fs.appendFileSync(ledger, JSON.stringify({note: name, text: String(value ?? ''), at: new Date().toISOString()}) + '\n');
      console.log(JSON.stringify({noted: name}));
    } else fail('usage: reserve|settle|note|total');
  } finally { unlock(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
