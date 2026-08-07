import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digestOf } from '../../src/lib/digest.js';
import { toOwnershipKey, type OwnershipRecord } from '../../src/lib/ownership-record.js';
import { computeCandidateKeys, classifyCandidate, resolveStaleAssets } from '../../src/lib/stale-assets.js';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Issue #492: 削除候補差分計算（要件3・AC-4・AC-5・AC-9）。

test('computeCandidateKeys: 直前記録が無ければ候補は0件', () => {
  assert.deepEqual(computeCandidateKeys(undefined, new Set()), []);
});

test('computeCandidateKeys: 現行配布元に無い記録済みファイルのみ候補になる（AC-9: 現存ファイルは対象外）', () => {
  const previous: OwnershipRecord = { version: '0.1.0', files: { 'stale.md': 'sha256:a', 'kept.md': 'sha256:b' } };
  const candidates = computeCandidateKeys(previous, new Set(['kept.md']));
  assert.deepEqual(candidates, ['stale.md']);
});

test('computeCandidateKeys: .agent-skill-chain/project/配下は候補から除外される（AC-5 防御的除外）', () => {
  const previous: OwnershipRecord = {
    version: '0.1.0',
    files: { '.agent-skill-chain/project/RULES.md': 'sha256:a', 'stale.md': 'sha256:b' },
  };
  const candidates = computeCandidateKeys(previous, new Set());
  assert.deepEqual(candidates, ['stale.md']);
});

// Issue #492: 候補ファイルの分類（AC-2・AC-3・AC-8・AC-10、DESIGN.md状態遷移）。

test('classifyCandidate: ファイルが物理的に存在しない場合はAbsent（要件7・AC-8）', () => {
  const root = mkdtemp('stale-assets-');
  const status = classifyCandidate(path.join(root, 'missing.md'), 'sha256:whatever');
  assert.equal(status, 'Absent');
});

test('classifyCandidate: 読み取り自体がENOENT以外の理由で失敗する場合はUnreadable（要件8・AC-10）', (t) => {
  const root = mkdtemp('stale-assets-');
  const filePath = path.join(root, 'locked.md');
  fs.writeFileSync(filePath, 'secret');
  fs.chmodSync(filePath, 0o000);
  t.after(() => fs.chmodSync(filePath, 0o644));

  const status = classifyCandidate(filePath, digestOf(Buffer.from('secret')));

  assert.equal(status, 'Unreadable');
});

test('classifyCandidate: 通常ファイルでなくなっている場合はTypeChanged', () => {
  const root = mkdtemp('stale-assets-');
  const dirPath = path.join(root, 'was-a-file.md');
  fs.mkdirSync(dirPath);

  const status = classifyCandidate(dirPath, 'sha256:whatever');

  assert.equal(status, 'TypeChanged');
});

test('classifyCandidate: 内容が記録済みdigestと一致すればContentMatch（AC-2）', () => {
  const root = mkdtemp('stale-assets-');
  const filePath = path.join(root, 'unchanged.md');
  fs.writeFileSync(filePath, 'original content');

  const status = classifyCandidate(filePath, digestOf(Buffer.from('original content')));

  assert.equal(status, 'ContentMatch');
});

test('classifyCandidate: 内容が記録済みdigestと不一致であればContentChanged（AC-3）', () => {
  const root = mkdtemp('stale-assets-');
  const filePath = path.join(root, 'changed.md');
  fs.writeFileSync(filePath, 'edited by user');

  const status = classifyCandidate(filePath, digestOf(Buffer.from('original content')));

  assert.equal(status, 'ContentChanged');
});

// Issue #492: 削除実行（dry-run分岐）・次回所有権記録エントリの算出。

test('resolveStaleAssets: 未改変の廃止ファイルは削除され、次回記録から除去される（AC-2）', () => {
  const root = mkdtemp('stale-assets-');
  const filePath = path.join(root, 'stale.md');
  fs.writeFileSync(filePath, 'original content');
  const key = toOwnershipKey(root, filePath);
  const previous: OwnershipRecord = { version: '0.1.0', files: { [key]: digestOf(Buffer.from('original content')) } };

  const result = resolveStaleAssets(root, previous, new Set(), {}, false);

  assert.equal(fs.existsSync(filePath), false);
  assert.deepEqual(result.outcomes, [{ key, action: 'deleted' }]);
  assert.deepEqual(result.nextFiles, {});
  assert.equal(result.hasDeleteFailure, false);
});

test('resolveStaleAssets --dry-run: 削除候補は実削除されず一覧提示され、記録は書き込まれない（AC-6）', () => {
  const root = mkdtemp('stale-assets-');
  const filePath = path.join(root, 'stale.md');
  fs.writeFileSync(filePath, 'original content');
  const key = toOwnershipKey(root, filePath);
  const previous: OwnershipRecord = { version: '0.1.0', files: { [key]: digestOf(Buffer.from('original content')) } };

  const result = resolveStaleAssets(root, previous, new Set(), undefined, true);

  assert.equal(fs.existsSync(filePath), true, 'dry-runでは実ファイルが削除されないこと');
  assert.deepEqual(result.outcomes, [{ key, action: 'planned-deleted' }]);
  assert.equal(result.nextFiles, undefined, 'dry-runでは所有権記録を書き込まないこと');
});

test('resolveStaleAssets: 内容が変更されたファイルは削除されず、dry-run有無を問わず同一の警告になる（AC-3）', () => {
  const root = mkdtemp('stale-assets-');
  const filePath = path.join(root, 'changed.md');
  fs.writeFileSync(filePath, 'edited by user');
  const key = toOwnershipKey(root, filePath);
  const previous: OwnershipRecord = { version: '0.1.0', files: { [key]: digestOf(Buffer.from('original content')) } };

  const nonDryRun = resolveStaleAssets(root, previous, new Set(), {}, false);
  const dryRun = resolveStaleAssets(root, previous, new Set(), undefined, true);

  assert.equal(fs.existsSync(filePath), true);
  assert.equal(nonDryRun.outcomes[0]?.action, 'content-changed');
  assert.equal(dryRun.outcomes[0]?.action, 'content-changed');
  assert.equal(nonDryRun.outcomes[0]?.message, dryRun.outcomes[0]?.message, '警告文言はdry-run有無で同一であること');
  assert.deepEqual(nonDryRun.nextFiles, { [key]: previous.files[key] }, '変更検出時は次回記録にエントリを保持すること');
});

test('resolveStaleAssets: 読み取り不能なファイルは削除されず警告され、次回記録に保持される（AC-10）', (t) => {
  const root = mkdtemp('stale-assets-');
  const filePath = path.join(root, 'locked.md');
  fs.writeFileSync(filePath, 'secret');
  fs.chmodSync(filePath, 0o000);
  t.after(() => fs.chmodSync(filePath, 0o644));
  const key = toOwnershipKey(root, filePath);
  const previous: OwnershipRecord = { version: '0.1.0', files: { [key]: 'sha256:whatever' } };

  const result = resolveStaleAssets(root, previous, new Set(), {}, false);

  assert.equal(result.outcomes[0]?.action, 'unreadable');
  assert.equal(result.hasDeleteFailure, false);
  assert.deepEqual(result.nextFiles, { [key]: 'sha256:whatever' });
});

test('resolveStaleAssets: 物理的に既に存在しないファイルはエラーにも警告にもならず、次回記録から除去される（AC-8）', () => {
  const root = mkdtemp('stale-assets-');
  const key = 'already-removed.md';
  const previous: OwnershipRecord = { version: '0.1.0', files: { [key]: 'sha256:whatever' } };

  const result = resolveStaleAssets(root, previous, new Set(), {}, false);

  assert.deepEqual(result.outcomes, []);
  assert.equal(result.hasDeleteFailure, false);
  assert.deepEqual(result.nextFiles, {});
});

test('resolveStaleAssets: 削除操作自体が失敗した場合は異常終了対象になり、次回記録に保持される（AC-7）', (t) => {
  const root = mkdtemp('stale-assets-');
  const lockedDir = path.join(root, 'locked-dir');
  fs.mkdirSync(lockedDir);
  const filePath = path.join(lockedDir, 'stale.md');
  fs.writeFileSync(filePath, 'original content');
  fs.chmodSync(lockedDir, 0o555);
  t.after(() => {
    fs.chmodSync(lockedDir, 0o755);
  });
  const key = toOwnershipKey(root, filePath);
  const previous: OwnershipRecord = { version: '0.1.0', files: { [key]: digestOf(Buffer.from('original content')) } };

  const result = resolveStaleAssets(root, previous, new Set(), {}, false);

  assert.equal(fs.existsSync(filePath), true, '削除に失敗したファイルは残ること');
  assert.equal(result.outcomes[0]?.action, 'delete-failed');
  assert.equal(result.hasDeleteFailure, true);
  assert.deepEqual(result.nextFiles, { [key]: previous.files[key] }, '削除失敗エントリは次回再試行のため保持されること');
});

test('resolveStaleAssets: 複数候補中1件のみ削除失敗しても、他の正常な削除結果は隠されない（AC-11）', (t) => {
  const root = mkdtemp('stale-assets-');
  const lockedDir = path.join(root, 'locked-dir');
  fs.mkdirSync(lockedDir);
  const failingPath = path.join(lockedDir, 'stale.md');
  fs.writeFileSync(failingPath, 'a');
  fs.chmodSync(lockedDir, 0o555);
  t.after(() => fs.chmodSync(lockedDir, 0o755));

  const okPath = path.join(root, 'ok-stale.md');
  fs.writeFileSync(okPath, 'b');

  const failingKey = toOwnershipKey(root, failingPath);
  const okKey = toOwnershipKey(root, okPath);
  const previous: OwnershipRecord = {
    version: '0.1.0',
    files: { [failingKey]: digestOf(Buffer.from('a')), [okKey]: digestOf(Buffer.from('b')) },
  };

  const result = resolveStaleAssets(root, previous, new Set(), {}, false);

  assert.equal(result.hasDeleteFailure, true);
  const okOutcome = result.outcomes.find((o) => o.key === okKey);
  const failingOutcome = result.outcomes.find((o) => o.key === failingKey);
  assert.equal(okOutcome?.action, 'deleted', '失敗と無関係な削除結果は隠されないこと');
  assert.equal(failingOutcome?.action, 'delete-failed');
  assert.equal(fs.existsSync(okPath), false);
});

test('resolveStaleAssets: root外を指す破損・改ざんキーは削除候補にも次回記録にも含めない', () => {
  const root = mkdtemp('stale-assets-');
  const previous: OwnershipRecord = { version: '0.1.0', files: { '../outside.md': 'sha256:whatever' } };

  const result = resolveStaleAssets(root, previous, new Set(), {}, false);

  assert.deepEqual(result.outcomes, []);
  assert.deepEqual(result.nextFiles, {});
});
