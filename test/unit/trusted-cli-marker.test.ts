// Issue #759 PLAN #2 / DESIGN E4: 信頼CLI導入マーカー（調達実体の期待値の唯一の供給元）の
// 生成・形式・撤去対象への参加を固定する。配布集合の外に置く決定もここで固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyTrustedCliMarker,
  buildTrustedCliMarker,
  formatTrustedCliMarkerOutcome,
  isTrustedCliMarker,
  trustedCliMarkerPath,
  trustedCliMarkerRelativePath,
  TRUSTED_CLI_MARKER_SCHEMA,
} from '../../src/lib/trusted-cli-marker.js';
import { canonicalTreeDigest } from '../../src/lib/tree-digest.js';
import { ROOT_LEVEL_ENTRIES, NAMESPACED_ENTRIES } from '../../src/lib/asset-manifest.js';

function createSourcePackage(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-trusted-cli-marker-'));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'agents-md.js'), 'process.exit(0);\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'agent-skill-chain', version: '9.9.9', bin: { 'agent-skill-chain': './bin/agents-md.js' } })}\n`,
  );
  return dir;
}

test('導入マーカー: 配布集合の外に置かれる', () => {
  const relative = trustedCliMarkerRelativePath();
  assert.equal(relative, path.join('.agent-skill-chain', '.trusted-cli.json'));
  assert.equal(ROOT_LEVEL_ENTRIES.includes(relative), false);
  assert.equal(
    NAMESPACED_ENTRIES.some((entry) => relative.startsWith(path.join('.agent-skill-chain', entry))),
    false,
    '期待値はconsumerごとに異なるため、全consumerへ同一内容を配る配布集合には属せない',
  );
});

test('導入マーカー: 実行元パッケージのname・version・正準ツリーdigestを記録する', (t) => {
  const source = createSourcePackage();
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));

  const marker = buildTrustedCliMarker(source);

  assert.equal(marker.schema_version, TRUSTED_CLI_MARKER_SCHEMA);
  assert.equal(marker.package, 'agent-skill-chain');
  assert.equal(marker.version, '9.9.9');
  assert.equal(marker.tree_digest, canonicalTreeDigest(source));
  assert.equal(isTrustedCliMarker(marker), true);
});

test('導入マーカー: dry-runでは書かず、実行時のみ書き出す', (t) => {
  const source = createSourcePackage();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-marker-target-'));
  t.after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });

  const planned = applyTrustedCliMarker(target, { dryRun: true, sourceRoot: source });
  assert.equal(planned.action, 'planned');
  assert.equal(fs.existsSync(trustedCliMarkerPath(target)), false);

  const written = applyTrustedCliMarker(target, { dryRun: false, sourceRoot: source });
  assert.equal(written.action, 'written');
  const parsed: unknown = JSON.parse(fs.readFileSync(trustedCliMarkerPath(target), 'utf8'));
  assert.equal(isTrustedCliMarker(parsed), true);
  assert.deepEqual(parsed, written.marker);
});

test('導入マーカー: 期待値を算出できない実行元では書かずに理由を返す（既存マーカーを古い値で上書きしない）', (t) => {
  const source = createSourcePackage();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-marker-target-'));
  t.after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });
  const first = applyTrustedCliMarker(target, { dryRun: false, sourceRoot: source });
  assert.equal(first.action, 'written');

  // 走査根の対象範囲へ symbolic link が現れると digest を算出できない（安全側で中止する）。
  fs.symlinkSync(path.join(source, 'package.json'), path.join(source, 'linked.json'));
  const skipped = applyTrustedCliMarker(target, { dryRun: false, sourceRoot: source });

  assert.equal(skipped.action, 'skipped');
  assert.match(skipped.reason ?? '', /symbolic link/);
  assert.match(formatTrustedCliMarkerOutcome(skipped, ''), /調達せず停止します/);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(trustedCliMarkerPath(target), 'utf8')),
    first.marker,
    '算出できないときに既存の期待値を壊さないこと',
  );
});

test('導入マーカー: 形式検査は schema_version と digest 形式を要求する', () => {
  assert.equal(isTrustedCliMarker(undefined), false);
  assert.equal(isTrustedCliMarker({ package: 'agent-skill-chain', version: '1.0.0', tree_digest: `sha256:${'a'.repeat(64)}` }), false);
  assert.equal(
    isTrustedCliMarker({
      schema_version: TRUSTED_CLI_MARKER_SCHEMA,
      package: 'agent-skill-chain',
      version: '1.0.0',
      tree_digest: 'sha256:short',
    }),
    false,
  );
  assert.equal(
    isTrustedCliMarker({
      schema_version: TRUSTED_CLI_MARKER_SCHEMA,
      package: 'agent-skill-chain',
      version: '1.0.0',
      tree_digest: `sha256:${'a'.repeat(64)}`,
    }),
    true,
  );
});
