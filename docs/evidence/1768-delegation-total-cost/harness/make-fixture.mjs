// Deterministic non-confidential fixture: 14 small modules + tests. Usage: node make-fixture.mjs <dir>
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'nova'];
// fmtPrice is called from these modules only (oracle for the search task).
const callers = new Set(['bravo', 'echo', 'hotel', 'kilo', 'nova']);
fs.writeFileSync(path.join(dir, 'src/config.mjs'), 'export const TAX_RATE = 0.1;\nexport const CURRENCY = "JPY";\n');
fs.writeFileSync(path.join(dir, 'src/format.mjs'), 'import { CURRENCY } from "./config.mjs";\nexport function fmtPrice(n) { return `${CURRENCY} ${n.toFixed(0)}`; }\nexport function fmtName(s) { return s.trim(); }\n');
for (const n of names) {
  const uses = callers.has(n);
  const imp = uses ? 'import { fmtPrice, fmtName } from "./format.mjs";' : 'import { fmtName } from "./format.mjs";';
  const body = uses ? `  return fmtPrice(qty * unit) + " " + fmtName("${n}");` : `  return fmtName("${n}") + String(qty * unit);`;
  fs.writeFileSync(path.join(dir, `src/${n}.mjs`), `${imp}\nexport function ${n}Total(qty, unit) {\n${body}\n}\n`);
  fs.writeFileSync(path.join(dir, `test/${n}.test.mjs`), `import test from "node:test";\nimport assert from "node:assert";\nimport { ${n}Total } from "../src/${n}.mjs";\ntest("${n}", () => { assert.ok(typeof ${n}Total(2, 3) === "string"); });\n`);
}
fs.writeFileSync(path.join(dir, 'src/tax.mjs'), 'import { TAX_RATE } from "./config.mjs";\nexport function withTax(n) { return n * (1 + TAX_RATE); }\n');
fs.writeFileSync(path.join(dir, 'test/tax.test.mjs'), 'import test from "node:test";\nimport assert from "node:assert";\nimport { withTax } from "../src/tax.mjs";\ntest("tax", () => { assert.equal(withTax(100), 110.00000000000001); });\n');
fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fx","type":"module","scripts":{"test":"node --test test/"}}\n');
