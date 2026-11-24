// Deterministic non-confidential fixture for #1781. Usage: node make-fixture.mjs <dir> <P1|P2|P3>
// P1: three independent work units. P2: one shared contract and three dependent units. P3: P1 with one unit made unwritable.
import fs from 'node:fs';
import path from 'node:path';
const [dir, task] = process.argv.slice(2);
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
const stub = (names) => names.map((n) => `export function ${n}() {\n  throw new Error("not implemented");\n}\n`).join('');
w('package.json', '{"name":"fx","private":true,"type":"module"}\n');
w('test/sample.test.mjs', 'import test from "node:test";\nimport assert from "node:assert";\ntest("sample", () => { assert.equal(1 + 1, 2); });\n');
const SPEC = {
  csv: `# csv

Implement in \`src/csv.mjs\`.

- \`parseCsv(text)\` returns \`string[][]\`. Fields are separated by \`,\`. Records are separated by \`\\n\` or \`\\r\\n\`.
- A field may be enclosed in double quotes. Inside quotes, \`""\` is one literal quote, and commas, \`\\r\` and \`\\n\` are literal.
- A record separator at the very end of the input does not create an extra record. Empty input returns \`[]\`. An empty line between records is a record with one empty field \`[""]\`.
- Throw \`SyntaxError\` for an unterminated quoted field, a quote inside an unquoted field, or any character other than a separator or end of input after a closing quote.
- \`stringifyCsv(rows)\` is the inverse: quote a field only when it contains \`,\`, \`"\`, \`\\r\` or \`\\n\`, double inner quotes, join fields with \`,\` and records with \`\\n\`, no trailing newline.
`,
  duration: `# duration

Implement in \`src/duration/index.mjs\`.

- \`parseDuration(s)\` returns whole seconds. Units: \`d\`=86400, \`h\`=3600, \`m\`=60, \`s\`=1. Each unit appears at most once and in the order d, h, m, s. At least one component is required, and every number must be followed by its unit.
- A component's number is a non-negative integer or decimal such as \`1.5h\` (digits, optionally \`.\` and digits). No whitespace or sign is allowed. The total is rounded with \`Math.round\`.
- Throw \`RangeError\` for anything else, including \`""\`, \`"1h1h"\`, \`"1m1h"\`, \`"h"\`, \`"1.h"\`, \`" 1h"\`.
- \`formatDuration(sec)\` takes a non-negative safe integer (otherwise \`RangeError\`) and returns the canonical form such as \`"1d2h3m4s"\`, omitting zero components. \`0\` returns \`"0s"\`.
`,
  semver: `# semver

Implement in \`src/semver.mjs\`, following SemVer 2.0.0 and npm range semantics.

- Versions are \`MAJOR.MINOR.PATCH\` with optional \`-PRERELEASE\` and \`+BUILD\`. Numeric identifiers must not have leading zeros. Invalid input throws \`TypeError\`.
- \`compareSemver(a, b)\` returns -1, 0 or 1 using SemVer 2.0.0 precedence (section 11). Build metadata is ignored.
- \`satisfies(version, range)\`: a range is one or more comparator sets joined by \`||\`. A set is space-separated comparators, all of which must hold. Comparators are \`=\`, \`>\`, \`>=\`, \`<\`, \`<=\` followed by a version, a bare version (exact), \`^X.Y.Z\` and \`~X.Y.Z\`.
  - \`^1.2.3\` is \`>=1.2.3 <2.0.0-0\`, \`^0.2.3\` is \`>=0.2.3 <0.3.0-0\`, \`^0.0.3\` is \`>=0.0.3 <0.0.4-0\`. \`~1.2.3\` is \`>=1.2.3 <1.3.0-0\`.
  - A version with a prerelease satisfies a set only if some comparator in that set has a version with a prerelease and the same MAJOR.MINOR.PATCH (npm rule). For example \`1.3.0-beta\` does not satisfy \`^1.2.3\`, but \`1.2.4-beta\` satisfies \`>=1.2.4-alpha\`.
- \`maxSatisfying(versions, range)\` returns the highest version string that satisfies the range, or \`null\`.
`,
  money: `# money (shared contract)

Implement in \`src/money.mjs\`. Other units import this module; keep the exported names and behavior exact.

- \`money(minor, currency)\` returns a frozen object \`{ minor, currency }\`. \`minor\` must be a safe integer (otherwise \`TypeError\`). Supported currencies and minor digits: JPY 0, USD 2, EUR 2, KWD 3 (otherwise \`RangeError\`).
- \`add(a, b)\` returns a new money. Different currencies throw \`TypeError\`.
- \`multiply(m, factor)\` returns money whose \`minor\` is \`m.minor * factor\` rounded half to even (banker's rounding) to an integer.
- \`allocate(m, ratios)\` splits \`m\` into \`ratios.length\` money values. \`m.minor\` must be >= 0 and ratios non-negative with a positive sum (otherwise \`RangeError\`). Each share is \`floor(m.minor * r / sum)\`; the remaining units go one each to the shares with the largest fractional remainder, ties to the lower index. Shares always sum to \`m.minor\`.
- \`format(m)\` returns \`"<CUR> <amount>"\` with the currency's minor digits and \`,\` thousands separators, e.g. \`USD 1,234.56\`, \`JPY 1,234,567\`, \`KWD 1.234\`, and negative values as \`USD -0.05\`.
`,
  invoice: `# invoice (depends on money)

Implement in \`src/invoice.mjs\` using \`./money.mjs\` (import it; do not reimplement money logic).

- \`invoiceTotal(lines, taxPercent)\` where each line is \`{ unitMinor, qty, currency }\`. \`lines\` must be non-empty and every \`qty\` a positive integer (otherwise \`RangeError\`). Mixed currencies throw \`TypeError\`.
- Returns \`{ subtotal, tax, total }\` as money values: \`subtotal\` is the sum of \`unitMinor * qty\`, \`tax\` is \`multiply(subtotal, taxPercent / 100)\`, \`total\` is \`add(subtotal, tax)\`.
`,
  split: `# split (depends on money)

Implement in \`src/split.mjs\` using \`./money.mjs\` (import it; do not reimplement money logic).

- \`splitBill(total, people)\` returns an array of \`people\` money values using \`allocate(total, [1, 1, ...])\`. \`people\` must be a positive integer (otherwise \`RangeError\`).
`,
  report: `# report (depends on money)

Implement in \`src/report.mjs\` using \`./money.mjs\` (import it; do not reimplement money logic).

- \`summarize(moneys)\` returns a plain object mapping each currency to \`format\` of the sum of that currency's values, with keys inserted in alphabetical order. An empty array returns \`{}\`.
`,
};
const FILES = { csv: ['src/csv.mjs', ['parseCsv', 'stringifyCsv']], duration: ['src/duration/index.mjs', ['parseDuration', 'formatDuration']], semver: ['src/semver.mjs', ['compareSemver', 'satisfies', 'maxSatisfying']], money: ['src/money.mjs', ['money', 'add', 'multiply', 'allocate', 'format']], invoice: ['src/invoice.mjs', ['invoiceTotal']], split: ['src/split.mjs', ['splitBill']], report: ['src/report.mjs', ['summarize']] };
const units = task === 'P2' ? ['money', 'invoice', 'split', 'report'] : ['csv', 'duration', 'semver'];
for (const u of units) { w(`docs/${u}.md`, SPEC[u]); w(FILES[u][0], stub(FILES[u][1])); }
if (task === 'P3') { fs.chmodSync(path.join(dir, 'src/duration/index.mjs'), 0o444); fs.chmodSync(path.join(dir, 'src/duration'), 0o555); }
