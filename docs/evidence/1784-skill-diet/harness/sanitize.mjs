// Usage: node sanitize.mjs <in.json> <out.json> [<fixture-or-scratch-root>...]
// Replaces local absolute paths in a run record file before it is committed to the public repository.
// Each given root becomes <proj> (if it ends with /proj) or <scratch>; any remaining Host temp or home path becomes <host-tmp> / <home>.
import fs from 'node:fs';

const [input, output, ...roots] = process.argv.slice(2);
let s = fs.readFileSync(input, 'utf8');
for (const root of roots) for (const r of new Set([root, fs.existsSync(root) ? fs.realpathSync(root) : root])) s = s.split(r).join(r.endsWith('/proj') ? '<proj>' : '<scratch>');
s = s.replace(/\/private\/tmp\/claude-\d+\/[^\s"'\\`)]*/g, '<host-tmp>').replace(/\/tmp\/claude-\d+\/[^\s"'\\`)]*/g, '<host-tmp>').replace(/\/Users\/[^\s"'\\`)]*/g, '<home>');
const left = ['/private/', '/Users/', '/home/'].filter((x) => s.includes(x));
if (left.length) throw Error('absolute path left: ' + left.join(','));
fs.writeFileSync(output, s);
