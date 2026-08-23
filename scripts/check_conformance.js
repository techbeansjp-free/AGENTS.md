import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRepositoryConformance } from '../src/domain/conformance.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-conformance-'));
const report = path.join(temporary, 'cucumber.json');
try {
  const run = spawnSync('npm', ['test', '--', '--format', `json:${report}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  if (run.status !== 0) process.exit(run.status ?? 1);
  const features = JSON.parse(fs.readFileSync(report, 'utf8'));
  const passedScenarioIds = [];
  for (const feature of features) for (const element of feature.elements ?? []) {
    const match = /\b(SCN-[A-Z0-9-]+)\b/u.exec(element.name ?? '');
    if (match && (element.steps ?? []).every((/** @type {any} */ step) => step.result?.status === 'passed')) passedScenarioIds.push(match[1]);
  }
  const contract = JSON.parse(fs.readFileSync(path.join(root, '.agent-skill-chain/policy/conformance.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(root, '.agent-skill-chain/project/conformance/bindings.json'), 'utf8'));
  const result = validateRepositoryConformance(root, contract, binding, { tool: 'cucumber-js', passedScenarioIds });
  if (!result.valid) {
    process.stderr.write(`conformance検査: 失敗\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`conformance検査: 合格（I1〜I12、実在source/export、成功SCN証拠）\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
