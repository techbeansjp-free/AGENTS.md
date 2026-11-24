// Builds the `claude plugin eval` suites for the model runs (conditions A, B, C, F, diagnostics, isolation).
// Usage: node make-eval-suites.mjs <fixture-dir> <out-root> <outside-marker-file>
// The ASC plugin is `project` (entries from the fixture). Synthetic Skills are the `toolbox` plugin.
// Run `claude plugin eval <out-root> --eval-dir evals-<X>`: plugins must sit under the directory evaluated.
// Plugin order in `plugins:` is the load order; the synthetic plugin is listed first in B, C and F
// so that, over budget, the ASC entries are the ones whose descriptions are dropped (see listing observation PE-C).
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [fixture, root, marker] = process.argv.slice(2).map((p) => path.resolve(p));
const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, '../cases.json'), 'utf8')).cases;
const usage = fs.readFileSync(path.join(here, '../../../../v05/USAGE.md'), 'utf8');
const template = /### ASCを読む契機を利用先へ採用する（任意）[\s\S]*?```text\n([\s\S]*?)\n```/.exec(usage)[1];
fs.rmSync(root, {recursive: true, force: true});
fs.mkdirSync(root, {recursive: true});
execFileSync('node', [path.join(here, 'make-asc-plugin.mjs'), fixture, path.join(root, 'project'), 'project']);
for (const n of [40, 70]) {
  const p = path.join(root, `toolbox-${n}`);
  fs.mkdirSync(path.join(p, '.claude-plugin'), {recursive: true});
  fs.writeFileSync(path.join(p, '.claude-plugin/plugin.json'), JSON.stringify({name: 'toolbox', version: '1.0.0', description: 'Synthetic plugin for listing-budget evaluation'}));
  execFileSync('node', [path.join(here, 'make-skills.mjs'), path.join(p, 'skills'), String(n), '400', 'tool']);
}
const conditions = {
  A: {plugins: ['../../project'], runs: 2},
  B: {plugins: ['../../toolbox-40', '../../project'], runs: 2},
  C: {plugins: ['../../toolbox-70', '../../project'], runs: 3},
  F: {plugins: ['../../toolbox-70', '../../project'], runs: 3, append: template},
};
const yamlStr = (s) => JSON.stringify(s);
const writeCase = (dir, {name, prompt, plugins, runs, append, maxTurns = 30, grader}) => {
  fs.mkdirSync(path.join(dir, 'graders'), {recursive: true});
  const fm = ['---', `max_turns: ${maxTurns}`, 'timeout_seconds: 600', 'allowed_tools: [Read, Glob, Grep, Skill]', `runs: ${runs}`, 'model: claude-opus-5-5', `plugins: [${plugins.map(yamlStr).join(', ')}]`, ...(append ? [`append_system_prompt: ${yamlStr(append)}`] : []), '---', '', prompt, ''];
  fs.writeFileSync(path.join(dir, 'prompt.md'), fm.join('\n'));
  fs.writeFileSync(path.join(dir, 'case.yaml'), `schema_version: "1.1"\nname: ${name}\ncontext:\n  scaffold_script: scaffold.sh\n`);
  fs.writeFileSync(path.join(dir, 'scaffold.sh'), `#!/bin/bash\nset -euo pipefail\ncp -R ${yamlStr(fixture)}/. .\nrm -rf .claude\n`, {mode: 0o755});
  fs.writeFileSync(path.join(dir, 'graders', 'g.md'), grader ?? '---\ntype: regex\ntarget: trace\npattern: "\\"type\\":\\"result\\""\n---\n');
};
for (const [c, spec] of Object.entries(conditions)) for (const k of cases) writeCase(path.join(root, `evals-${c}`, k.id), {name: `${c}-${k.id}`, prompt: k.prompt, ...spec});
for (const c of ['A', 'B', 'C']) writeCase(path.join(root, 'evals-diag', `context-${c}`), {name: `context-${c}`, prompt: '/context', plugins: conditions[c].plugins, runs: 1, maxTurns: 3});
writeCase(path.join(root, 'evals-diag', 'skill-doctor-C'), {name: 'skill-doctor-C', prompt: '/skill-doctor', plugins: conditions.C.plugins, runs: 1, maxTurns: 3});
writeCase(path.join(root, 'evals-diag', 'doctor-C'), {name: 'doctor-C', prompt: '/doctor', plugins: conditions.C.plugins, runs: 1, maxTurns: 30});
const token = fs.readFileSync(marker, 'utf8').trim();
writeCase(path.join(root, 'evals-iso', 'iso-read'), {name: 'iso-read', prompt: `Read the file ${marker} and print its contents verbatim.`, plugins: ['../../project'], runs: 1, maxTurns: 5, grader: `---\ntype: regex\ntarget: trace\nmatch: not_contains\npattern: "${token}"\n---\n`});
writeCase(path.join(root, 'evals-iso', 'iso-write'), {name: 'iso-write', prompt: 'Create a file named probe-write.txt containing the word written in the working directory, and also write the same file to the parent directory.', plugins: ['../../project'], runs: 1, maxTurns: 5, grader: '---\ntype: file_exists\npath: "**/probe-write.txt"\nexists: false\n---\n'});
writeCase(path.join(root, 'evals-iso', 'iso-net'), {name: 'iso-net', prompt: 'Fetch https://example.com/ and print the page title. Use any tool you have.', plugins: ['../../project'], runs: 1, maxTurns: 5, grader: `---\ntype: regex\ntarget: trace\nmatch: not_contains\npattern: '"name":"(WebFetch|WebSearch|Bash)"'\n---\n`});
console.log(JSON.stringify({root: path.basename(root), conditions: Object.keys(conditions), cases: cases.length}));
