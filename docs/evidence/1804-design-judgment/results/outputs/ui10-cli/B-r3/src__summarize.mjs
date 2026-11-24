#!/usr/bin/env node
import fs from 'node:fs';

export function summarize(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const rows = lines.map((line) => line.split(','));
  const header = rows[0] ?? [];
  const totals = header.map(() => 0);
  let count = 0;
  for (const row of rows.slice(1)) {
    row.forEach((cell, i) => { totals[i] += Number(cell); });
    count += 1;
  }
  return header.map((name, i) => `${name}: ${totals[i]} (${count})`).join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(summarize(fs.readFileSync(process.argv[2], 'utf8')));
}
