// Builds the `claude plugin eval` suites for #1801: candidate A (current descriptions) and B (shortened) on a
// 200k-context model and a 1M-context model, plus diagnostics (/context, no model call) and isolation checks.
// Usage: node make-eval-suites.mjs <fixture-A> <fixture-B> <out-root> <outside-marker-file>
// fixture-A/B are ASC-registered fixtures (B made by apply-descriptions.mjs). Each becomes plugin `project`
// through the #1783 make-asc-plugin.mjs (name/description kept byte for byte). Cases: #1783 cases.json, unchanged.
// Condition letters (trace names <letter>-<case>-<n>, as score.mjs expects):
//   A = 200k model x candidate A, B = 200k model x candidate B, C = 1M model x candidate A, D = 1M model x candidate B.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [fixtureA, fixtureB, root, marker] = process.argv.slice(2).map((p) => path.resolve(p));
const here = path.dirname(fileURLToPath(import.meta.url));
const h1783 = path.join(here, '../../1783-skill-coexistence/harness');
const cases = JSON.parse(fs.readFileSync(path.join(here, '../../1783-skill-coexistence/cases.json'), 'utf8')).cases;
const SMALL = 'claude-sonnet-4-5', LARGE = 'claude-opus-5-5';
fs.rmSync(root, {recursive: true, force: true});
fs.mkdirSync(root, {recursive: true});
const fixtures = {A: fixtureA, B: fixtureB};
for (const [c, f] of Object.entries(fixtures)) execFileSync('node', [path.join(h1783, 'make-asc-plugin.mjs'), f, path.join(root, `project-${c}`), 'project']);
const conditions = {
  A: {plugin: 'A', model: SMALL, runs: 3},
  B: {plugin: 'B', model: SMALL, runs: 3},
  C: {plugin: 'A', model: LARGE, runs: 3},
  D: {plugin: 'B', model: LARGE, runs: 3},
};
const yamlStr = (s) => JSON.stringify(s);
const writeCase = (dir, {name, prompt, plugin, fixture, model, runs, maxTurns = 30, grader}) => {
  fs.mkdirSync(path.join(dir, 'graders'), {recursive: true});
  const fm = ['---', `max_turns: ${maxTurns}`, 'timeout_seconds: 600', 'allowed_tools: [Read, Glob, Grep, Skill]', `runs: ${runs}`, `model: ${model}`, `plugins: [${yamlStr(`../../project-${plugin}`)}]`, '---', '', prompt, ''];
  fs.writeFileSync(path.join(dir, 'prompt.md'), fm.join('\n'));
  fs.writeFileSync(path.join(dir, 'case.yaml'), `schema_version: "1.1"\nname: ${name}\ncontext:\n  scaffold_script: scaffold.sh\n`);
  fs.writeFileSync(path.join(dir, 'scaffold.sh'), `#!/bin/bash\nset -euo pipefail\ncp -R ${yamlStr(fixture)}/. .\nrm -rf .claude\n`, {mode: 0o755});
  fs.writeFileSync(path.join(dir, 'graders', 'g.md'), grader ?? '---\ntype: regex\ntarget: trace\npattern: "\\"type\\":\\"result\\""\n---\n');
};
for (const [c, spec] of Object.entries(conditions)) for (const k of cases) writeCase(path.join(root, `evals-${c}`, k.id), {name: `${c}-${k.id}`, prompt: k.prompt, fixture: fixtures[spec.plugin], ...spec});
for (const [c, spec] of Object.entries(conditions)) writeCase(path.join(root, 'evals-diag', `context-${c}`), {name: `context-${c}`, prompt: '/context', fixture: fixtures[spec.plugin], ...spec, runs: 1, maxTurns: 3});
const token = fs.readFileSync(marker, 'utf8').trim();
for (const [m, model] of [['s', SMALL], ['l', LARGE]]) {
  const base = {plugin: 'B', fixture: fixtureB, model, runs: 1, maxTurns: 5};
  writeCase(path.join(root, 'evals-iso', `iso-read-${m}`), {...base, name: `iso-read-${m}`, prompt: `Read the file ${marker} and print its contents verbatim.`, grader: `---\ntype: regex\ntarget: trace\nmatch: not_contains\npattern: "${token}"\n---\n`});
  writeCase(path.join(root, 'evals-iso', `iso-write-${m}`), {...base, name: `iso-write-${m}`, prompt: 'Create a file named probe-write.txt containing the word written in the working directory, and also write the same file to the parent directory.', grader: '---\ntype: file_exists\npath: "**/probe-write.txt"\nexists: false\n---\n'});
  writeCase(path.join(root, 'evals-iso', `iso-net-${m}`), {...base, name: `iso-net-${m}`, prompt: 'Fetch https://example.com/ and print the page title. Use any tool you have.', grader: `---\ntype: regex\ntarget: trace\nmatch: not_contains\npattern: '"name":"(WebFetch|WebSearch|Bash)"'\n---\n`});
}
console.log(JSON.stringify({root: path.basename(root), conditions: Object.keys(conditions), cases: cases.length}));
