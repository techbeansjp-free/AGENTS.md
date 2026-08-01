import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectPolicyDocuments } from '../../src/lib/project-policy.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function createPolicyRoot(t: { after(callback: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-project-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const namespace = path.join(root, '.agent-skill-chain');
  fs.mkdirSync(path.join(namespace, 'project'), { recursive: true });
  fs.mkdirSync(path.join(namespace, 'schemas'), { recursive: true });
  fs.copyFileSync(
    path.join(packageRoot, '.agent-skill-chain', 'schemas', 'project-policy.schema.yaml'),
    path.join(namespace, 'schemas', 'project-policy.schema.yaml'),
  );
  return root;
}

function writeManifest(root: string, documents: { common: string[]; roles: Record<string, string[]> }): void {
  const roleEntries = Object.entries(documents.roles)
    .map(([segment, paths]) => `    ${segment}: [${paths.join(', ')}]`)
    .join('\n');
  const manifest = [
    'schema_version: agent-skill-chain/project-policy/v1',
    'project:',
    '  id: test-project',
    '  policy_version: 1',
    'documents:',
    `  common: [${documents.common.join(', ')}]`,
    '  roles:',
    roleEntries || '    {}',
    'precedence:',
    '  level: project',
    '  overrides: [package-defaults]',
    'constraints:',
    '  may_override_core_invariants: false',
    '  unregistered_documents_are_normative: false',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, '.agent-skill-chain', 'project', 'manifest.yaml'), manifest, 'utf8');
}

function writePolicyDocument(root: string, relativePath: string, content: string): void {
  const documentPath = path.join(root, '.agent-skill-chain', 'project', relativePath);
  fs.mkdirSync(path.dirname(documentPath), { recursive: true });
  fs.writeFileSync(documentPath, content, 'utf8');
}

test('loadProjectPolicyDocuments: manifest.yamlがないconsumer projectでは空配列を返す', (t) => {
  const root = createPolicyRoot(t);

  assert.deepEqual(loadProjectPolicyDocuments(root, 'spec'), []);
});

test('loadProjectPolicyDocuments: documents.commonの登録文書を読み込む', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'common.md', 'common policy');
  writeManifest(root, { common: ['common.md'], roles: {} });

  assert.deepEqual(loadProjectPolicyDocuments(root, 'spec'), ['common policy']);
});

test('loadProjectPolicyDocuments: 要求segmentのrole文書だけを追加する', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'common.md', 'common policy');
  writePolicyDocument(root, 'roles/implementation.md', 'implementation policy');
  writePolicyDocument(root, 'roles/spec.md', 'spec policy');
  writeManifest(root, {
    common: ['common.md'],
    roles: { implementation: ['roles/implementation.md'], spec: ['roles/spec.md'] },
  });

  assert.deepEqual(loadProjectPolicyDocuments(root, 'implementation'), ['common policy', 'implementation policy']);
  assert.doesNotMatch(loadProjectPolicyDocuments(root, 'implementation').join('\n'), /spec policy/);
});

test('loadProjectPolicyDocuments: スキーマに適合しないmanifestはエラーにする', (t) => {
  const root = createPolicyRoot(t);
  fs.writeFileSync(
    path.join(root, '.agent-skill-chain', 'project', 'manifest.yaml'),
    'schema_version: agent-skill-chain/project-policy/v1\n',
    'utf8',
  );

  assert.throws(() => loadProjectPolicyDocuments(root, 'spec'), /スキーマに適合しません/);
});

test('loadProjectPolicyDocuments: documents.commonに登録された文書の実体が無い場合はエラーにする', (t) => {
  const root = createPolicyRoot(t);
  // 'missing.md' は登録するが、実体ファイルは作成しない（AC-6）。
  writeManifest(root, { common: ['missing.md'], roles: {} });

  assert.throws(() => loadProjectPolicyDocuments(root, 'spec'), /ENOENT/);
});

test('loadProjectPolicyDocuments: documents.roles.<segment>に登録された文書の実体が無い場合はエラーにする', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'common.md', 'common policy');
  // 'roles/implementation.md' は登録するが、実体ファイルは作成しない（AC-6）。
  writeManifest(root, { common: ['common.md'], roles: { implementation: ['roles/implementation.md'] } });

  assert.throws(() => loadProjectPolicyDocuments(root, 'implementation'), /ENOENT/);
});
