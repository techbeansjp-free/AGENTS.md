import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// ISSUE-326: segment start の project policy 配布を、SPEC.md の AC が規定するCLI可観測契約
// （標準出力・終了コード）そのもので検証する。ライブラリ単体テスト
// （test/unit/project-policy.test.ts）では捉えられない guard() 経由の終了コード正規化と、
// 失敗時に標準出力へ部分出力すら行わない原子性を、ビルド後の bin/agents-md.js への
// subprocess 実行（runCli）で確認する。

/** tmp repo の `.agent-skill-chain/project/manifest.yaml` をテスト用の登録内容で上書きする。 */
function writeManifest(repoDir: string, documents: { common: string[]; roles: Record<string, string[]> }): void {
  const roleEntries = Object.entries(documents.roles)
    .map(([segment, paths]) => `    ${segment}: [${paths.join(', ')}]`)
    .join('\n');
  const manifest = [
    'schema_version: agent-skill-chain/project-policy/v1',
    'project:',
    '  id: cli-test-project',
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
  fs.writeFileSync(path.join(repoDir, '.agent-skill-chain', 'project', 'manifest.yaml'), manifest, 'utf8');
}

function writePolicyDocument(repoDir: string, relativePath: string, content: string): void {
  const documentPath = path.join(repoDir, '.agent-skill-chain', 'project', relativePath);
  fs.mkdirSync(path.dirname(documentPath), { recursive: true });
  fs.writeFileSync(documentPath, content, 'utf8');
}

/** issue start + spec segment への lease acquire まで済ませ、segment start 実行可能な状態にする。 */
function prepareSpecSegment(repoDir: string, issueId: string, slug: string): void {
  const start = runCli(['issue', 'start', issueId, 'feature', slug, FIXED_TIMESTAMP], { cwd: repoDir });
  assert.equal(start.status, 0, start.stderr);
  const acquire = runCli(['lease', 'acquire', issueId, 'spec'], { cwd: repoDir });
  assert.equal(acquire.status, 0, acquire.stderr);
}

test('segment start (CLI): documents.commonと自セグメント分のdocuments.roles.<segment>の内容が標準出力に含まれ、終了コード0で成功する（AC-1/AC-2）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeManifest(repo.dir, {
    common: ['COMMON.md'],
    roles: { spec: ['roles/spec-only.md'], design: ['roles/design-only.md'] },
  });
  writePolicyDocument(repo.dir, 'COMMON.md', 'COMMON-SENTINEL: 全ワーカー共通ポリシー本文\n');
  writePolicyDocument(repo.dir, 'roles/spec-only.md', 'SPEC-ROLE-SENTINEL: specセグメント専用ポリシー本文\n');
  writePolicyDocument(repo.dir, 'roles/design-only.md', 'DESIGN-ROLE-SENTINEL: designセグメント専用ポリシー本文\n');
  prepareSpecSegment(repo.dir, 'ISSUE-1', 'policy-dist');

  const segmentStart = runCli(['segment', 'start', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: spec_worker/);
  assert.match(segmentStart.stdout, /COMMON-SENTINEL: 全ワーカー共通ポリシー本文/, 'documents.commonの文書内容が標準出力に含まれること（AC-1）');
  assert.match(segmentStart.stdout, /SPEC-ROLE-SENTINEL: specセグメント専用ポリシー本文/, 'documents.roles.specの文書内容が標準出力に含まれること（AC-2）');
  assert.doesNotMatch(
    segmentStart.stdout,
    /DESIGN-ROLE-SENTINEL/,
    '他セグメント向け（documents.roles.design）の文書内容はspec起動時の標準出力に含まれないこと（AC-2）',
  );
});

test('segment start (CLI): 登録パスが範囲外脱出（../）を含む場合、標準出力へ何も出力せず（部分出力も無い）終了コードが非0になる（AC-7）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // 脱出先の実体は実在し読み取り可能にする（AC-7: 「解決先が実在し読み取り可能である」ことは
  // 配布を正当化しない。実在しない場合の失敗＝AC-6と区別するため）。
  fs.writeFileSync(path.join(repo.dir, '.agent-skill-chain', 'evil.md'), 'EVIL-SENTINEL: 範囲外の機密文書\n', 'utf8');
  // 正当な文書を先頭に登録し、後続の違反パスで失敗した際に先読み分すら出力されないこと
  // （原子性）を反証可能にする。
  writeManifest(repo.dir, { common: ['OK.md', '../evil.md'], roles: {} });
  writePolicyDocument(repo.dir, 'OK.md', 'OK-SENTINEL: 正当な登録文書\n');
  prepareSpecSegment(repo.dir, 'ISSUE-2', 'policy-escape');

  const segmentStart = runCli(['segment', 'start', 'ISSUE-2', 'spec'], { cwd: repo.dir });
  assert.notEqual(segmentStart.status, 0, '範囲外脱出パスの登録時は終了コードが非0であること');
  assert.equal(segmentStart.stdout, '', '標準出力へ何も出力しないこと（先行する正当文書の部分出力も無い）');
  assert.match(segmentStart.stderr, /範囲外/, '封じ込め違反である旨がstderrへ出力されること');
});

test('segment start (CLI): 登録パスに対応する実ファイルが存在しない場合、標準出力へ何も出力せず（部分出力も無い）終了コードが非0になる（AC-6）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeManifest(repo.dir, { common: ['OK.md', 'missing.md'], roles: {} });
  writePolicyDocument(repo.dir, 'OK.md', 'OK-SENTINEL: 正当な登録文書\n');
  prepareSpecSegment(repo.dir, 'ISSUE-3', 'policy-missing');

  const segmentStart = runCli(['segment', 'start', 'ISSUE-3', 'spec'], { cwd: repo.dir });
  assert.notEqual(segmentStart.status, 0, '登録文書の実体欠落時は終了コードが非0であること');
  assert.equal(segmentStart.stdout, '', '標準出力へ何も出力しないこと（先行する正当文書の部分出力も無い）');
  assert.match(segmentStart.stderr, /missing\.md/, '欠落した登録パスがstderrのエラーから特定できること');
});
