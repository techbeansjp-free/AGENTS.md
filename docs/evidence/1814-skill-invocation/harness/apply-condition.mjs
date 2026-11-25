// Turns a copy of the registered fixture into one measurement condition of conditions.json (#1814). No model call.
// R: base CLAUDE.md only. P: base + the pointer text. H: base + a project SessionStart hook that injects the same text.
// PH: both. S: base + hook with conditions.json strongHookText. The pointer text is taken from the installed release's
// own .agent-skill-chain/v05/USAGE.md in the fixture (what a user reads), not from this repository. The hook is registered
// in the project .claude/settings.json in the form USAGE documents for the resume-context SessionStart hook; its command
// is a project-local script because the release has no read-trigger command yet (IMPROVEMENT_DESIGN.md).
// The change is committed in the trial copy, as a user adopting it would.
// The hook script also appends one line to $ASC1814_HOOK_LOG when that variable is set (outside the fixture), so the run
// record shows that the hook fired without relying on the model's words.
// Usage: node apply-condition.mjs <fixture-copy> <condition>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {git} from './make-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const loadConditions = () => JSON.parse(fs.readFileSync(path.join(ev, 'conditions.json'), 'utf8'));

// Same extraction as docs/evidence/1783-skill-coexistence/harness/make-eval-suites.mjs.
export function pointerText(usage) {
  const m = /### ASCを読む契機を利用先へ採用する（任意）[\s\S]*?```text\n([\s\S]*?)\n```/.exec(usage);
  if (!m) throw new Error('pointer text not found in v05/USAGE.md');
  return m[1].trim();
}

export function hookScript() {
  return [
    "import fs from 'node:fs';",
    "const text = fs.readFileSync(new URL('./asc-read-trigger.txt', import.meta.url), 'utf8').trim();",
    "let source = 'unknown';",
    "try { source = JSON.parse(fs.readFileSync(0, 'utf8')).source ?? 'unknown'; } catch { /* no stdin */ }",
    "if (process.env.ASC1814_HOOK_LOG) fs.appendFileSync(process.env.ASC1814_HOOK_LOG, JSON.stringify({event: 'SessionStart', source, at: new Date().toISOString()}) + '\\n');",
    "process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'SessionStart', additionalContext: text}}));",
    '',
  ].join('\n');
}

export function applyCondition(fixture, name) {
  const conds = loadConditions();
  const c = conds.conditions[name];
  if (!c) throw new Error(`unknown condition ${name}`);
  const pointer = pointerText(fs.readFileSync(path.join(fixture, '.agent-skill-chain/v05/USAGE.md'), 'utf8'));
  const claudeMd = conds.baseClaudeMd + (c.pointer ? `\n${pointer}\n` : '');
  fs.writeFileSync(path.join(fixture, 'CLAUDE.md'), claudeMd);
  const out = {condition: name, claudeMdSha256: sha256(claudeMd), pointerSha256: sha256(pointer), pointer: c.pointer, hook: c.hook};
  if (c.hook) {
    const h = conds.hook;
    const text = c.hook === 'usage' ? pointer : conds.strongHookText;
    const settingsPath = path.join(fixture, h.settingsPath);
    if (fs.existsSync(settingsPath)) throw new Error(`refused: fixture already has ${h.settingsPath}`);
    fs.mkdirSync(path.dirname(path.join(fixture, h.scriptPath)), {recursive: true});
    fs.writeFileSync(path.join(fixture, h.scriptPath), hookScript());
    fs.writeFileSync(path.join(fixture, h.textPath), text + '\n');
    const settings = {hooks: {SessionStart: [{matcher: h.matcher, hooks: [{type: 'command', command: h.command, timeout: h.timeout}]}]}};
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    Object.assign(out, {hookTextSha256: sha256(text), settingsSha256: sha256(JSON.stringify(settings, null, 2) + '\n')});
  }
  git(['add', '-A'], fixture);
  const dirty = spawnSync('git', ['diff', '--cached', '--quiet'], {cwd: fixture}).status !== 0;
  if (dirty) git(['commit', '-q', '-m', `Adopt ASC read trigger (${name})`], fixture);
  out.committed = dirty;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fixture, name] = process.argv.slice(2);
  console.log(JSON.stringify(applyCondition(path.resolve(fixture), name)));
}
