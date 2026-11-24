#!/usr/bin/env node
import fs from 'node:fs';

export function summarize(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const [headerLine, ...dataLines] = lines;
  const header = headerLine.split(',');
  const totals = header.map(() => 0);
  let count = 0;
  for (const row of dataLines.map((line) => line.split(','))) {
    row.forEach((cell, i) => { totals[i] += Number(cell); });
    count += 1;
  }
  return header.map((name, i) => `${name}: ${totals[i]} (${count})`).join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(summarize(fs.readFileSync(process.argv[2], 'utf8')));
}
