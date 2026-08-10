import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldProjectPolicy } from '../../src/lib/project-policy-scaffold.js';
import { validateAgainstSchema } from '../../src/lib/schema.js';
import { readYamlFile } from '../../src/lib/yaml-io.js';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function manifestPath(root: string): string {
  return path.join(root, '.agent-skill-chain', 'project', 'manifest.yaml');
}

function rulesPath(root: string): string {
  return path.join(root, '.agent-skill-chain', 'project', 'RULES.md');
}

// PLAN.md 変更単位2, (a): 両ファイル不在時に両方生成される。
test('scaffoldProjectPolicy: manifest.yaml・RULES.mdがいずれも不在の場合、両方を新規生成する', () => {
  const root = mkdtemp('project-policy-scaffold-both-missing-');

  const result = scaffoldProjectPolicy(root);

  assert.equal(result.action, 'created');
  assert.ok(fs.existsSync(manifestPath(root)));
  assert.ok(fs.existsSync(rulesPath(root)));
});

// PLAN.md 変更単位2, AC-2: 生成したmanifest.yamlはproject-policy.schema.yamlの検証を通る。
test('scaffoldProjectPolicy: 生成したmanifest.yamlはproject-policy.schema.yamlの必須フィールドを満たす', () => {
  const root = mkdtemp('project-policy-scaffold-schema-valid-');

  scaffoldProjectPolicy(root);

  const manifest = readYamlFile<Record<string, unknown>>(manifestPath(root));
  const outcome = validateAgainstSchema('project-policy', manifest, root);
  assert.equal(outcome.valid, true, outcome.errors.join('; '));
});

// project.id のプレースホルダが導入先ディレクトリ名へ置換されること。
test('scaffoldProjectPolicy: manifest.yamlのproject.idが導入先ディレクトリ名へ置換される', () => {
  const root = mkdtemp('project-policy-scaffold-placeholder-');

  scaffoldProjectPolicy(root);

  const manifest = readYamlFile<{ project: { id: string } }>(manifestPath(root));
  assert.equal(manifest.project.id, path.basename(root));
  assert.doesNotMatch(fs.readFileSync(manifestPath(root), 'utf8'), /__PROJECT_ID__/);
});

// PLAN.md 変更単位2, (b): manifest.yaml存在時は完全no-op（RULES.mdの内容も変更しない）。
test('scaffoldProjectPolicy: manifest.yamlが既に存在する場合は完全no-op（RULES.mdの独自内容も変更しない）', () => {
  const root = mkdtemp('project-policy-scaffold-noop-');
  fs.mkdirSync(path.dirname(manifestPath(root)), { recursive: true });
  const customManifest = 'schema_version: agent-skill-chain/project-policy/v1\n# 独自の内容\n';
  const customRules = '# 独自のRULES.md\n';
  fs.writeFileSync(manifestPath(root), customManifest);
  fs.writeFileSync(rulesPath(root), customRules);

  const result = scaffoldProjectPolicy(root);

  assert.equal(result.action, 'unchanged');
  assert.equal(fs.readFileSync(manifestPath(root), 'utf8'), customManifest);
  assert.equal(fs.readFileSync(rulesPath(root), 'utf8'), customRules);
});

// PLAN.md 変更単位2, (c): dryRun: true時は一切書込みが起きない。
test('scaffoldProjectPolicy: dryRun: trueの場合は一切書込みを行わない', () => {
  const root = mkdtemp('project-policy-scaffold-dry-run-');

  const result = scaffoldProjectPolicy(root, { dryRun: true });

  assert.equal(result.action, 'created');
  assert.equal(fs.existsSync(manifestPath(root)), false);
  assert.equal(fs.existsSync(rulesPath(root)), false);
});

// DESIGN.md 障害・ロールバック考慮(a): RULES.mdのみ書込み済みの中途半端な状態からの再実行で
// 両ファイルが再生成されること（manifest.yaml不在が唯一の判定基準であるため）。
test('scaffoldProjectPolicy: RULES.mdのみ存在しmanifest.yamlが不在の中途半端な状態から再実行すると、両方とも再生成される', () => {
  const root = mkdtemp('project-policy-scaffold-partial-');
  fs.mkdirSync(path.dirname(rulesPath(root)), { recursive: true });
  fs.writeFileSync(rulesPath(root), '中断で残った不完全な内容\n');

  const result = scaffoldProjectPolicy(root);

  assert.equal(result.action, 'created');
  assert.ok(fs.existsSync(manifestPath(root)));
  assert.notEqual(fs.readFileSync(rulesPath(root), 'utf8'), '中断で残った不完全な内容\n');
});
