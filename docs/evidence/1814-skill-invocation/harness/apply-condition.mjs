// Turns a copy of the registered fixture into one measurement condition of conditions.json (#1814). No model call.
// R: base CLAUDE.md only. P: base + the pointer text. H: base + a project SessionStart hook that injects the same text.
// PH: both. S: base + hook with conditions.json strongHookText. The pointer text is taken from the installed release's
// own .agent-skill-chain/v05/USAGE.md in the fixture (what a user reads), not from this repository. The hook is registered
// in the project .claude/settings.json in the form USAGE documents for the resume-context SessionStart hook; its command
// is a project-local script because the release has no read-trigger command yet (IMPROVEMENT_DESIGN.md).
// The change is committed in the trial copy, as a user adopting it would, with the same neutral subject in every condition.
// The hook script also appends one line to $ASC1814_HOOK_LOG when that variable is set (outside the fixture), so the run
// record shows that the hook fired without relying on the model's words.
// Usage: node apply-condition.mjs <fixture-copy> <condition>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {git, gitEnv} from './make-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
export const NEUTRAL_SUBJECT = 'Update project files';
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
  const usage = fs.readFileSync(path.join(fixture, '.agent-skill-chain/v05/USAGE.md'), 'utf8');
  // The phase-3 release may rewrite the USAGE section; condition I does not need the text.
  let pointer = '';
  try { pointer = pointerText(usage); } catch (e) { if (!c.adopt) throw e; }
  // Condition I keeps the CLAUDE.md the product's adoption produced (make-fixture --adopt); others set it here.
  if (!c.adopt) fs.writeFileSync(path.join(fixture, 'CLAUDE.md'), conds.baseClaudeMd + (c.pointer ? `\n${pointer}\n` : ''));
  const claudeMd = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
  const out = {condition: name, claudeMdSha256: sha256(claudeMd), pointerSha256: sha256(pointer), pointer: Boolean(c.pointer), hook: c.hook ?? null, adopt: c.adopt ?? null};
  // hook 'product' (condition I) is the product's own hook installed by make-fixture --adopt; nothing is written here.
  if (c.hook === 'usage' || c.hook === 'strong') {
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
  // Every condition, R included, gets exactly one commit with the same neutral subject (review M1): the Host shows recent
  // commit subjects in its git context, so a condition-specific subject would add text that only some conditions see.
  git(['add', '-A'], fixture);
  out.changedFiles = spawnSync('git', ['diff', '--cached', '--name-only'], {cwd: fixture, env: gitEnv(fixture), encoding: 'utf8'}).stdout.split('\n').filter(Boolean);
  git(['commit', '-q', '--allow-empty', '-m', NEUTRAL_SUBJECT], fixture);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fixture, name] = process.argv.slice(2);
  console.log(JSON.stringify(applyCondition(path.resolve(fixture), name)));
}
