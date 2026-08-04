import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectLegacyAssets, formatLegacyAssetWarning } from '../../src/lib/legacy-migration.js';

function mkScratch(t: TestContext): string {
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-legacy-migration-'));
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  return targetDir;
}

function writeSkillFile(targetDir: string, skillName: string, fileName: 'SKILL.md' | 'README.md', content: string): string {
  const filePath = path.join(targetDir, '.claude', 'skills', skillName, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const staleMarkers = [
  '00_要求定義',
  '01_要件定義',
  '02_設計',
  '03_実装計画',
  '04_review',
  '.agent-skill-chain/source',
  'skills/agent/run_command',
  'workflow.db',
] as const;

for (const [index, marker] of staleMarkers.entries()) {
  test(`detectLegacyAssets: 旧skill-chainマーカー「${marker}」を検知する`, (t) => {
    const targetDir = mkScratch(t);
    const fileName = index % 2 === 0 ? 'SKILL.md' : 'README.md';
    const filePath = writeSkillFile(targetDir, `legacy-${index}`, fileName, `# legacy\n${marker}\n`);
    const before = fs.readFileSync(filePath);

    assert.deepEqual(detectLegacyAssets(targetDir), [
      {
        kind: 'stale-skill-content',
        relativePath: path.join('.claude', 'skills', `legacy-${index}`, fileName),
        message: `${path.join('.claude', 'skills', `legacy-${index}`, fileName)} は廃止済みの旧skill-chain方式への参照を含みます。`,
      },
    ]);
    assert.deepEqual(fs.readFileSync(filePath), before, '検知時にskill文書を書き換えないこと');
  });
}

test('detectLegacyAssets: skillsディレクトリがない場合はfindingを返さない', (t) => {
  const targetDir = mkScratch(t);

  assert.deepEqual(detectLegacyAssets(targetDir), []);
});

test('detectLegacyAssets: 現行方式のskill文書と対象外ファイルはfindingを返さない', (t) => {
  const targetDir = mkScratch(t);
  writeSkillFile(targetDir, 'current', 'SKILL.md', '# current skill\nUse AGENTS.md and the current CLI.\n');
  writeSkillFile(targetDir, 'current', 'README.md', '# current documentation\n');
  const otherPath = path.join(targetDir, '.claude', 'skills', 'current', 'NOTES.md');
  fs.writeFileSync(otherPath, 'workflow.db\n');
  const nestedPath = path.join(targetDir, '.claude', 'skills', 'current', 'nested', 'SKILL.md');
  fs.mkdirSync(path.dirname(nestedPath), { recursive: true });
  fs.writeFileSync(nestedPath, '00_要求定義\n');

  assert.deepEqual(detectLegacyAssets(targetDir), []);
});

test('formatLegacyAssetWarning: 旧skill文書のfindingとプロジェクト側の推奨対応を整形する', () => {
  const relativePath = path.join('.claude', 'skills', 'agent', 'SKILL.md');
  const warning = formatLegacyAssetWarning([
    {
      kind: 'stale-skill-content',
      relativePath,
      message: `${relativePath} は廃止済みの旧skill-chain方式への参照を含みます。`,
    },
  ]);

  assert.match(warning, /\.claude\/skills\/agent\/SKILL\.md は廃止済みの旧skill-chain方式への参照を含みます/);
  assert.match(warning, /現行方式に沿った内容へ書き換えるか削除するかをプロジェクト側で判断する/);
});
