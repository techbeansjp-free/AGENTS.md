import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

test('ISSUE-325 AC-1: worker選択のコメントに禁止された設計書参照がない', () => {
  for (const relativePath of [
    '.agent-skill-chain/scripts/worker-launch.sh',
    'src/lib/worker-selection.ts',
  ]) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

    assert.doesNotMatch(contents, /DESIGN\.md §/, `${relativePath} に禁止参照がないこと`);
  }
});
