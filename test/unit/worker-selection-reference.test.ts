import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

test('ISSUE-325 AC-1/AC-4: worker選択のコメントに禁止された設計書参照がない', () => {
  for (const relativePath of [
    '.agent-skill-chain/scripts/worker-launch.sh',
    'src/lib/worker-selection.ts',
  ]) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

    assert.doesNotMatch(contents, /DESIGN\.md §/, `${relativePath} に禁止参照がないこと`);
  }
});

test('ISSUE-325 AC-4: worker-selection.ts に破棄されたSPEC.mdの受入条件ID参照が残存しない', () => {
  const contents = fs.readFileSync(path.join(repositoryRoot, 'src/lib/worker-selection.ts'), 'utf8');

  assert.doesNotMatch(
    contents,
    /AC-[0-9]+/,
    'src/lib/worker-selection.ts に受入条件ID形式（AC-数字）の参照が残っていないこと',
  );
});

test('ISSUE-325 AC-4: worker-selection.ts に自己参照的な「本Issue」文言が残存しない', () => {
  const contents = fs.readFileSync(path.join(repositoryRoot, 'src/lib/worker-selection.ts'), 'utf8');

  assert.doesNotMatch(
    contents,
    /本 ?Issue/,
    'src/lib/worker-selection.ts に「本Issue」「本 Issue」という自己参照的文言が残っていないこと',
  );
});
