// Issue #677: CLI解決ロジックの単一実装化と、54本の前文契約を静的に固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const assetRoot = path.join(repoRoot, '.agent-skill-chain');
const sharedRelative = '.agent-skill-chain/scripts/cli-resolve.sh';
const markerStart = '# >>> agent-skill-chain CLI resolver preamble >>>';
const markerEnd = '# <<< agent-skill-chain CLI resolver preamble <<<';
const literals = ['bin/agents-md.js', 'node_modules/.bin/agent-skill-chain', 'command -v agent-skill-chain'];

function shellFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return shellFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.sh') ? [absolute] : [];
  });
}

function relative(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function preamble(text: string): string | undefined {
  const start = text.indexOf(markerStart);
  const end = text.indexOf(markerEnd, start);
  if (start < 0 || end < 0) return undefined;
  return text.slice(start, end + markerEnd.length);
}

const files = shellFiles(assetRoot).sort();
const contents = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));

test('CLI解決の3 literal を近接保持するファイルは共有実装以外に存在しない', () => {
  const detected = files.filter((file) => {
    const lines = contents.get(file)!.split('\n');
    return lines.some((_line, index) => {
      const window = lines.slice(index, index + 12).join('\n');
      return literals.every((literal) => window.includes(literal));
    });
  });
  assert.ok(detected.every((file) => relative(file) === sharedRelative), detected.map(relative).join('\n'));
});

test('プロジェクトローカルCLIの literal は共有実装1ファイルだけが保持する', () => {
  const detected = files.filter((file) => contents.get(file)!.includes(literals[1]!)).map(relative);
  assert.deepEqual(detected, [sharedRelative]);
  const shared = contents.get(path.join(repoRoot, sharedRelative))!;
  assert.ok(literals.every((literal) => shared.includes(literal)), '共有実装が3経路の literal をすべて保持すること');
});

test('54本の前文は終了形を正規化すると文字単位で一致し、契約割当も固定される', () => {
  const marked = files
    .map((file) => ({ file, block: preamble(contents.get(file)!) }))
    .filter((entry): entry is { file: string; block: string } => entry.block !== undefined);
  assert.equal(marked.length, 54);

  const normalized = marked.map(({ block }) =>
    block
      .split('\n')
      .map((line) => line.trimStart())
      .join('\n')
      .replace(/\breturn\b/g, 'exit'),
  );
  assert.equal(new Set(normalized).size, 1, '終了形以外の前文テキストが全54本で一致すること');

  const returnFiles = marked.filter(({ block }) => /\n\s*return 1\b/.test(block)).map(({ file }) => relative(file));
  const exitFiles = marked.filter(({ block }) => /\n\s*exit 1\b/.test(block)).map(({ file }) => relative(file));
  assert.equal(exitFiles.length, 52);
  assert.deepEqual(returnFiles, [
    '.agent-skill-chain/adapters/claude.sh',
    '.agent-skill-chain/adapters/human.sh',
  ]);
});

test('前文マーカーによる対象集合54本と既知の非対象集合が完全に分離される', () => {
  const marked = files.filter((file) => preamble(contents.get(file)!) !== undefined);
  const counts = { scripts: 0, ci: 0, adapters: 0 };
  for (const file of marked) {
    const segments = relative(file).split('/');
    const group = segments[1];
    if (group === 'scripts' || group === 'ci' || group === 'adapters') counts[group] += 1;
  }
  assert.deepEqual(counts, { scripts: 40, ci: 12, adapters: 2 });

  const complement = files.filter((file) => !marked.includes(file)).map(relative);
  assert.deepEqual(complement, [
    '.agent-skill-chain/adapters/codex.sh',
    '.agent-skill-chain/hooks/claude-pretooluse.sh',
    '.agent-skill-chain/scripts/cli-resolve.sh',
    '.agent-skill-chain/scripts/codex-hang-check.sh',
    '.agent-skill-chain/scripts/detect-changed-segments.sh',
    '.agent-skill-chain/scripts/gate-local-review.sh',
    '.agent-skill-chain/scripts/skill-description-budget.sh',
  ]);
});
