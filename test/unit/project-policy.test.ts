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

test('loadProjectPolicyDocuments: manifest.yamlが権限拒否で読み取れない場合はENOENTへ吸収せず例外を伝播する（AC-4(c)）', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'common.md', 'common policy');
  writeManifest(root, { common: ['common.md'], roles: {} });
  const manifestPath = path.join(root, '.agent-skill-chain', 'project', 'manifest.yaml');
  fs.chmodSync(manifestPath, 0o000);
  try {
    assert.throws(() => loadProjectPolicyDocuments(root, 'spec'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.notEqual((error as NodeJS.ErrnoException).code, 'ENOENT');
      return true;
    });
  } finally {
    // createPolicyRoot の t.after（rmSync）より先にパーミッションを戻す
    // （0o000のまま残すとrmSyncより先にこのfinallyが同期実行されるため通常は問題ないが、
    // 念のためrmSync自体が失敗しないよう復元する）。
    fs.chmodSync(manifestPath, 0o644);
  }
});

test('loadProjectPolicyDocuments: "../"による上位ディレクトリ脱出は拒否する（AC-7）', (t) => {
  const root = createPolicyRoot(t);
  fs.writeFileSync(path.join(root, 'outside.md'), 'outside secret', 'utf8');
  writeManifest(root, { common: ['../../outside.md'], roles: {} });

  assert.throws(() => loadProjectPolicyDocuments(root, 'spec'), /範囲外/);
});

test('loadProjectPolicyDocuments: 絶対パス指定は拒否する（AC-7、封じ込め境界内を指す場合も含む）', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'common.md', 'common policy');
  const absolutePath = path.join(root, '.agent-skill-chain', 'project', 'common.md');
  writeManifest(root, { common: [JSON.stringify(absolutePath)], roles: {} });

  assert.throws(() => loadProjectPolicyDocuments(root, 'spec'), /相対パスである必要があります/);
});

test('loadProjectPolicyDocuments: symlinkによる範囲外脱出は拒否する（AC-7）', (t) => {
  const root = createPolicyRoot(t);
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-outside-'));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const outsideFile = path.join(outsideDir, 'secret.md');
  fs.writeFileSync(outsideFile, 'outside via symlink', 'utf8');
  const projectDir = path.join(root, '.agent-skill-chain', 'project');
  fs.symlinkSync(outsideFile, path.join(projectDir, 'escape.md'));
  writeManifest(root, { common: ['escape.md'], roles: {} });

  assert.throws(() => loadProjectPolicyDocuments(root, 'spec'), /範囲外/);
});

test('loadProjectPolicyDocuments: ネストした配下パスは正当に読み込める', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'sub/dir/doc.md', 'nested policy');
  writeManifest(root, { common: ['sub/dir/doc.md'], roles: {} });

  assert.deepEqual(loadProjectPolicyDocuments(root, 'spec'), ['nested policy']);
});

test('loadProjectPolicyDocuments: documents.commonとdocuments.roles.<segment>の双方に同一文書が登録されていても1回のみ読み込む（AC-8）', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'common.md', 'common policy');
  writeManifest(root, { common: ['common.md'], roles: { spec: ['common.md'] } });

  assert.deepEqual(loadProjectPolicyDocuments(root, 'spec'), ['common policy']);
});

test('loadProjectPolicyDocuments: 同一リスト内で表記違いの重複登録があっても1回のみ読み込む（AC-8）', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'common.md', 'common policy');
  writeManifest(root, { common: ['common.md', 'roles/../common.md'], roles: {} });

  assert.deepEqual(loadProjectPolicyDocuments(root, 'spec'), ['common policy']);
});

test('loadProjectPolicyDocuments: 実ファイルとそれを指すsymlinkエイリアスの双方が登録されていても1回のみ読み込む（AC-8）', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'RULES.md', 'rules policy');
  const projectDir = path.join(root, '.agent-skill-chain', 'project');
  // 封じ込め境界内のsymlinkエイリアス。実体は同一のRULES.mdを指す。
  fs.symlinkSync(path.join(projectDir, 'RULES.md'), path.join(projectDir, 'alias.md'));
  writeManifest(root, { common: ['RULES.md', 'alias.md'], roles: {} });

  assert.deepEqual(loadProjectPolicyDocuments(root, 'spec'), ['rules policy']);
});

test('loadProjectPolicyDocuments: 同一リスト内に完全同一パスが2重登録されていても1回のみ読み込む（AC-8）', (t) => {
  const root = createPolicyRoot(t);
  writePolicyDocument(root, 'RULES.md', 'rules policy');
  writeManifest(root, { common: ['RULES.md', 'RULES.md'], roles: {} });

  assert.deepEqual(loadProjectPolicyDocuments(root, 'spec'), ['rules policy']);
});

test('loadProjectPolicyDocuments: manifest.yamlが構文的に不正なYAMLの場合は捕捉せず例外を伝播する（AC-4(b)）', (t) => {
  const root = createPolicyRoot(t);
  fs.writeFileSync(
    path.join(root, '.agent-skill-chain', 'project', 'manifest.yaml'),
    'documents:\n  common: [unclosed\n',
    'utf8',
  );

  assert.throws(() => loadProjectPolicyDocuments(root, 'spec'), (error: unknown) => {
    assert.ok(error instanceof Error);
    // ENOENT後方互換経路（空配列フォールバック）へ吸収されず、構文エラーとして送出されること。
    assert.notEqual((error as NodeJS.ErrnoException).code, 'ENOENT');
    return true;
  });
});
