// Runs inside the network-less container. Builds one isolated HOME per condition, starts the
// capture server, runs the Host once with a fixed prompt, and stores the captured request and logs.
// Usage: node observe-in-container.mjs <conditions.json> <condition-name> <out-dir>
// Mounts expected: /harness (this directory, read only), /fixture (ASC-registered fixture, read only).
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
const [condFile, name, out] = process.argv.slice(2);
const cond = JSON.parse(fs.readFileSync(condFile, 'utf8')).find((c) => c.name === name);
if (!cond) throw new Error(`unknown condition ${name}`);
const home = `/home/eval/h-${name}`, work = `${home}/work`;
fs.rmSync(home, {recursive: true, force: true});
fs.mkdirSync(`${home}/.claude/skills`, {recursive: true});
fs.cpSync('/fixture', work, {recursive: true});
fs.mkdirSync(out, {recursive: true});
const gen = (dir, spec, prefix) => spawnSync('node', ['/harness/make-skills.mjs', dir, String(spec.count), String(spec.chars), prefix, ...(spec.competitors ? ['--competitors'] : [])], {encoding: 'utf8'}).stdout.trim();
const made = [];
if (cond.userSkills) made.push(gen(`${home}/.claude/skills`, cond.userSkills, 'personal'));
const pluginArgs = [];
if (cond.pluginSkills) {
  const pname = cond.pluginSkills.name ?? 'synthetic-tools';
  const p = `${home}/plugins/${pname}`;
  fs.mkdirSync(`${p}/.claude-plugin`, {recursive: true});
  fs.writeFileSync(`${p}/.claude-plugin/plugin.json`, JSON.stringify({name: pname, version: '1.0.0', description: 'Synthetic plugin for listing-budget evaluation'}));
  made.push(gen(`${p}/skills`, cond.pluginSkills, cond.pluginSkills.prefix ?? 'plugin'));
  pluginArgs.push('--plugin-dir', p);
}
if (cond.ascAsPlugin) {
  const p = `${home}/plugins/${cond.ascAsPlugin}`;
  made.push(spawnSync('node', ['/harness/make-asc-plugin.mjs', work, p, cond.ascAsPlugin], {encoding: 'utf8'}).stdout.trim());
  fs.rmSync(`${work}/.claude/skills`, {recursive: true, force: true});
  if (cond.ascPluginFirst) pluginArgs.unshift('--plugin-dir', p); else pluginArgs.push('--plugin-dir', p);
}
for (const [skill, text] of Object.entries(cond.userOverrideSkills ?? {})) {
  fs.mkdirSync(`${home}/.claude/skills/${skill}`, {recursive: true});
  fs.writeFileSync(`${home}/.claude/skills/${skill}/SKILL.md`, `---\nname: ${skill}\ndescription: ${text}\n---\n\nSynthetic personal Skill with the same name as a distributed Skill.\n`);
}
if (cond.shortenAsc) for (const d of fs.readdirSync(`${work}/.claude/skills`)) {
  const f = `${work}/.claude/skills/${d}/SKILL.md`;
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^description: (.+)$/m, (_, t) => `description: ${[...t].slice(0, cond.shortenAsc).join('')}`));
}
if (cond.claudeMd) fs.writeFileSync(`${work}/CLAUDE.md`, fs.readFileSync(`/harness/${cond.claudeMd}`, 'utf8'));
const now = Date.parse('2026-11-24T00:00:00Z');
const usage = {};
for (const [skill, n] of Object.entries(cond.usage ?? {})) usage[skill] = {usageCount: n, lastUsedAt: now};
for (const [pattern, n] of Object.entries(cond.usagePatterns ?? {})) {
  const dirs = pattern === 'personal' ? fs.readdirSync(`${home}/.claude/skills`) : [];
  for (const d of dirs) usage[d] = {usageCount: n, lastUsedAt: now};
}
fs.writeFileSync(`${home}/.claude.json`, JSON.stringify({hasCompletedOnboarding: true, numStartups: 5, skillUsage: usage, projects: {[work]: {hasTrustDialogAccepted: true}}}));
if (cond.settingsNameOnlyPersonal) {
  const names = fs.readdirSync(`${home}/.claude/skills`).sort().slice(0, cond.settingsNameOnlyPersonal);
  cond.settings = {...(cond.settings ?? {}), skillOverrides: Object.fromEntries(names.map((n) => [n, 'name-only']))};
}
const capture = `${out}/capture.jsonl`;
fs.rmSync(capture, {force: true});
const server = spawn('node', ['/harness/capture-server.mjs', '8787', capture, ...(cond.skillCall ? [cond.skillCall] : [])], {stdio: 'ignore'});
await new Promise((r) => setTimeout(r, 500));
const env = {PATH: process.env.PATH, HOME: home, ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787', ANTHROPIC_API_KEY: 'sk-ant-offline-capture', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', ...(cond.env ?? {})};
const base = ['--model', cond.model ?? 'claude-opus-5-5', '--no-session-persistence', '--tools', 'Read,Glob,Grep,Skill', ...pluginArgs, ...(cond.settings ? ['--settings', JSON.stringify(cond.settings)] : [])];
const runs = {};
const prompts = cond.prompts ?? {hello: 'hello', context: '/context'};
for (const [label, prompt] of Object.entries(prompts)) {
  const r = spawnSync('claude', ['-p', prompt, ...base, '--output-format', label === 'hello' ? 'stream-json' : 'text', '--verbose', '--debug-file', `${out}/debug-${label}.log`], {cwd: work, env, encoding: 'utf8', timeout: 120000});
  fs.writeFileSync(`${out}/stdout-${label}.txt`, r.stdout ?? '');
  fs.writeFileSync(`${out}/stderr-${label}.txt`, r.stderr ?? '');
  runs[label] = {status: r.status, signal: r.signal, error: r.error ? String(r.error) : null};
}
server.kill();
fs.copyFileSync(`${home}/.claude.json`, `${out}/claude.json.after`);
fs.writeFileSync(`${out}/meta.json`, JSON.stringify({condition: cond, generated: made, runs}, null, 1));
console.log(JSON.stringify({name, runs}));
