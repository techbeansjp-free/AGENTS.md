import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSpecAcIds, parseSpecAcDeclarationHeading } from '../../src/lib/spec-ac-ids.js';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

test('extractSpecAcIds: 正規の第4レベル見出しだけを重複排除して数値昇順で返す', () => {
  const spec = [
    '# SPEC',
    '',
    '本文中の AC-90 は宣言ではない。',
    '<!-- AC-91 -->',
    '- AC-92',
    '> AC-93',
    '### AC-94: 第3レベル',
    '##### AC-95: 第5レベル',
    '#### AC-96 コロンなし',
    '#### AC-97 : コロン直前に空白',
    '#### AC-10:空白なしの要約',
    '####   AC-2: 複数空白',
    '####\tAC-1: タブ',
    '#### AC-2: 重複宣言',
  ].join('\n');

  assert.deepEqual(extractSpecAcIds(spec), ['AC-1', 'AC-2', 'AC-10']);
});

test('extractSpecAcIds: 正規宣言が無ければ本文中に同形文字列があっても空配列を返す', () => {
  assert.deepEqual(extractSpecAcIds('# SPEC\n\nAC-1 と AC-2\n<!-- AC-3 -->\n'), []);
});

test('extractSpecAcIds: コードフェンス内外を区別せず宣言形の行を収集する', () => {
  const spec = ['```markdown', '#### AC-20: 記法例', '```'].join('\n');
  assert.deepEqual(extractSpecAcIds(spec), ['AC-20']);
});

test('parseSpecAcDeclarationHeading: コロン直後の空白は任意だが直前の空白は許容しない', () => {
  assert.deepEqual(parseSpecAcDeclarationHeading('#### AC-1:要約'), { id: 'AC-1', summary: '要約' });
  assert.deepEqual(parseSpecAcDeclarationHeading('#### AC-2:  要約'), { id: 'AC-2', summary: '  要約' });
  assert.equal(parseSpecAcDeclarationHeading('#### AC-3 : 要約'), undefined);
});

test('AC-ID抽出経路: ゲート生成と突合検査は共有実装を使い、全文単純一致を残さない', () => {
  const gateSource = fs.readFileSync(path.join(packageRoot, 'src/commands/gate.ts'), 'utf8');
  const verifySource = fs.readFileSync(path.join(packageRoot, 'src/commands/verify.ts'), 'utf8');
  const sharedSource = fs.readFileSync(path.join(packageRoot, 'src/lib/spec-ac-ids.ts'), 'utf8');
  const combined = [gateSource, verifySource, sharedSource].join('\n');

  assert.match(gateSource, /import \{ extractSpecAcIds \} from '\.\.\/lib\/spec-ac-ids\.js'/);
  assert.match(verifySource, /import \{ extractSpecAcIds, parseSpecAcDeclarationHeading,/);
  assert.equal(combined.match(/function\s+(?:collectAcIds|extractSpecAcIds)\s*\(/g)?.length, 1);
  assert.doesNotMatch(combined, /specText\.matchAll/);
});
