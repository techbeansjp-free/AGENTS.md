import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';
import { validateAgainstSchema } from '../../src/lib/schema.js';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const projectDir = path.join(packageRoot, '.agent-skill-chain', 'project');
const trackedArtifacts = ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md'];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

test('self-extension project policy: manifestで登録した実在文書だけを規範として定義する', () => {
  const manifestPath = path.join(projectDir, 'manifest.yaml');
  const manifest = readYamlFile<Record<string, unknown>>(manifestPath);
  const validation = validateAgainstSchema('project-policy', manifest, packageRoot);
  assert.deepEqual(validation, { valid: true, errors: [] });

  const common = ((manifest.documents as { common: string[] }).common);
  assert.deepEqual(common, ['RULES.md', '自己拡張ワークフロー.md', 'OPERATING_PRINCIPLES.md']);
  for (const document of common) {
    const content = fs.readFileSync(path.join(projectDir, document), 'utf8');
    assert.ok(content.trim().length > 0, `${document} が空ではないこと`);
    assert.doesNotMatch(content, /\.agent-skill-chain\/(?:source|runtime\/templates)|\.\.\/source/, `${document} が廃止assetを参照しないこと`);
  }
});

test('self-extension lifecycle: isolated repoで成果物の作成、記録、close後の復元を行える', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // `.gitignore` は package の自己拡張方針を実証するためfixtureへ明示的に導入する。
  fs.copyFileSync(path.join(packageRoot, '.gitignore'), path.join(repo.dir, '.gitignore'));
  git(repo.dir, ['add', '.gitignore']);
  git(repo.dir, ['commit', '-m', 'test: add self-extension ignore policy']);
  git(repo.dir, ['push']);

  const start = runCli(['issue', 'start', 'ISSUE-245', 'process', 'self-extension-policy', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  for (const artifact of trackedArtifacts) {
    const ignored = spawnSync('git', ['check-ignore', '--quiet', artifact], { cwd: worktreePath });
    assert.equal(ignored.status, 1, `${artifact} はignoreされないこと`);
  }

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC: isolated lifecycle\n\n- Issue: `ISSUE-245`\n\n#### AC-1\n');
  fs.writeFileSync(path.join(worktreePath, 'DESIGN.md'), '# DESIGN: isolated lifecycle\n');
  fs.writeFileSync(path.join(worktreePath, 'PLAN.md'), '# PLAN: isolated lifecycle\n');
  fs.writeFileSync(
    path.join(worktreePath, 'VALIDATION.md'),
    'schema_version: agent-skill-chain/validation-report/v1\nissue_id: ISSUE-245\ntarget_sha: pending\nacceptance_criteria: []\nregression:\n  executed: true\n  evidence: [isolated-test]\n',
  );
  const checkpoint = runCli(['checkpoint', 'test: record self-extension issue artifacts'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  // local backendではIntegration RecordがDraft PRに相当し、Issue番号とbranchを恒久記録する。
  const pr = runCli(['pr', 'create', 'ISSUE-245', branch], { cwd: repo.dir });
  assert.equal(pr.status, 0, pr.stderr);
  assert.match(fs.readFileSync(pr.stdout.trim(), 'utf8'), /closes: ISSUE-245/);

  git(repo.dir, ['merge', '--no-ff', branch, '-m', 'merge: close ISSUE-245']);
  git(repo.dir, ['push']);
  for (const artifact of trackedArtifacts) {
    assert.ok(fs.existsSync(path.join(repo.dir, artifact)), `close後も${artifact}をmainから復元できること`);
  }
  assert.match(git(repo.dir, ['log', '--oneline', '--all', '--', 'SPEC.md']), /record self-extension issue artifacts/);
});
