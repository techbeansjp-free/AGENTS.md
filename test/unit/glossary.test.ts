import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForbiddenTerms } from '../../src/lib/glossary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_GLOSSARY_PATH = path.join(REPO_ROOT, 'docs', 'GLOSSARY.md');

function withTempGlossary(content: string, fn: (filePath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-test-'));
  try {
    const filePath = path.join(dir, 'GLOSSARY.md');
    fs.writeFileSync(filePath, content, 'utf8');
    fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- バグに依存しない基本的な健全性検証 ---

test('parseForbiddenTerms: 実物のdocs/GLOSSARY.mdを解析しても例外を投げず配列を返す', () => {
  assert.ok(fs.existsSync(REAL_GLOSSARY_PATH), 'docs/GLOSSARY.md が存在すること');
  const forbidden = parseForbiddenTerms(REAL_GLOSSARY_PATH);
  assert.ok(Array.isArray(forbidden));
});

test('parseForbiddenTerms: 表が無いファイルでは空配列を返す（例外を投げない）', () => {
  const md = ['# タイトルのみ', '', '本文のみで表を含まない。'].join('\n');
  withTempGlossary(md, (filePath) => {
    assert.deepEqual(parseForbiddenTerms(filePath), []);
  });
});

test('parseForbiddenTerms: 禁止同義語が空のセルの行は何も抽出しない', () => {
  const md = ['| 用語 | 定義 | 禁止同義語 |', '|---|---|---|', '| Foo | Fooの定義 |  |'].join('\n');
  withTempGlossary(md, (filePath) => {
    const forbidden = parseForbiddenTerms(filePath);
    assert.deepEqual(forbidden, []);
  });
});

test(
  'parseForbiddenTerms: 実物GLOSSARY.mdから禁止語エントリを抽出できる',
  () => {
    const forbidden = parseForbiddenTerms(REAL_GLOSSARY_PATH);
    assert.ok(forbidden.length > 0);
    for (const entry of forbidden) {
      assert.equal(typeof entry.banned, 'string');
      assert.equal(typeof entry.correctTerm, 'string');
      assert.ok(entry.banned.length > 0);
      assert.ok(entry.correctTerm.length > 0);
    }
  },
);

test(
  'parseForbiddenTerms: 実物GLOSSARY.mdの既知エントリを含む',
  () => {
    const forbidden = parseForbiddenTerms(REAL_GLOSSARY_PATH);
    assert.ok(
      forbidden.some((f) => f.banned === 'チケット' && f.correctTerm === 'Issue'),
      'Issue の禁止同義語「チケット」が含まれること',
    );
    assert.ok(
      forbidden.some((f) => f.banned === 'ドキュメント' && f.correctTerm === '成果物'),
      '成果物の禁止同義語「ドキュメント」が含まれること',
    );
  },
);

test(
  'parseForbiddenTerms: 実物GLOSSARY.mdの括弧注釈は取り除かれる',
  () => {
    const forbidden = parseForbiddenTerms(REAL_GLOSSARY_PATH);
    // 「orchestrator（英語表記のみでの言い換え）」→ 注釈を除いた「orchestrator」のみが対象
    assert.ok(
      forbidden.some((f) => f.banned === 'orchestrator' && f.correctTerm === '進行役'),
      '進行役の禁止同義語「orchestrator」（注釈除去済み）が含まれること',
    );
    assert.ok(
      !forbidden.some((f) => f.banned.includes('（')),
      '括弧付き注釈がそのまま残っているエントリが無いこと',
    );
  },
);

// ADR-0023（Issue #503）要件11・AC-10: 「軽量プロファイル」「既定プロファイル」の用語行を追加し、
// 全体20行以内を維持する。
test('docs/GLOSSARY.md (ADR-0023 AC-10): 「軽量プロファイル」「既定プロファイル」の用語行が追加され、全体20行以内を維持する', () => {
  const lines = fs.readFileSync(REAL_GLOSSARY_PATH, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  assert.ok(lines.length <= 20, `docs/GLOSSARY.md は20行以内であること（現在${lines.length}行）`);
  assert.ok(lines.some((l) => l.includes('| 軽量プロファイル |')), '「軽量プロファイル」の用語行が存在すること');
  assert.ok(lines.some((l) => l.includes('| 既定プロファイル |')), '「既定プロファイル」の用語行が存在すること');
});

test(
  'parseForbiddenTerms: 実物GLOSSARY.mdで他の用語と完全一致する禁止語は除外される',
  () => {
    const forbidden = parseForbiddenTerms(REAL_GLOSSARY_PATH);
    // Task の禁止同義語「Issue」は、Issue 自体が正当な用語であるため対象外
    assert.ok(
      !forbidden.some((f) => f.banned === 'Issue'),
      '「Issue」は他の用語と衝突するため禁止語として抽出されないこと',
    );
    // 一方、同じ行の「タスク管理（永続化含意）」は注釈除去のうえ抽出される
    assert.ok(
      forbidden.some((f) => f.banned === 'タスク管理' && f.correctTerm === 'Task'),
      'Task の禁止同義語「タスク管理」（衝突しない方）は含まれること',
    );
  },
);

test(
  'parseForbiddenTerms: 実物GLOSSARY.mdのバッククォート付きセルは除去される',
  () => {
    const forbidden = parseForbiddenTerms(REAL_GLOSSARY_PATH);
    assert.ok(
      forbidden.some((f) => f.banned === '.agent-skill-chain/source' && f.correctTerm === 'agent-skill-chain'),
      'バッククォートで囲まれた `.agent-skill-chain/source` がバッククォート除去済みで含まれること',
    );
  },
);

test(
  'parseForbiddenTerms: 1行に複数の禁止語がある場合は全て抽出される',
  () => {
    const md = ['| 用語 | 定義 | 禁止同義語 |', '|---|---|---|', '| Foo | Fooの定義 | bar、baz、qux |'].join('\n');
    withTempGlossary(md, (filePath) => {
      const forbidden = parseForbiddenTerms(filePath);
      assert.deepEqual(
        forbidden.map((f) => f.banned).sort(),
        ['bar', 'baz', 'qux'],
      );
      for (const f of forbidden) {
        assert.equal(f.correctTerm, 'Foo');
      }
    });
  },
);

test(
  'parseForbiddenTerms: 括弧注釈付きの禁止語は注釈を除いて抽出される',
  () => {
    const md = [
      '| 用語 | 定義 | 禁止同義語 |',
      '|---|---|---|',
      '| Foo | Fooの定義 | bar（注記付き）、baz(english paren) |',
    ].join('\n');
    withTempGlossary(md, (filePath) => {
      const forbidden = parseForbiddenTerms(filePath);
      assert.deepEqual(
        forbidden.map((f) => f.banned).sort(),
        ['bar', 'baz'],
      );
    });
  },
);

test(
  'parseForbiddenTerms: 他の用語と完全一致する禁止語は除外される（衝突ケース）',
  () => {
    const md = [
      '| 用語 | 定義 | 禁止同義語 |',
      '|---|---|---|',
      '| Foo | Fooの定義 | bar、baz |',
      '| Bar | Barの定義 | Foo、qux |',
    ].join('\n');
    withTempGlossary(md, (filePath) => {
      const forbidden = parseForbiddenTerms(filePath);
      // Bar 行の禁止同義語 "Foo" は、Foo が既知の用語であるため除外される
      assert.ok(!forbidden.some((f) => f.banned === 'Foo'));
      // 除外されない qux は含まれる
      assert.ok(forbidden.some((f) => f.banned === 'qux' && f.correctTerm === 'Bar'));
      assert.deepEqual(
        forbidden.map((f) => f.banned).sort(),
        ['bar', 'baz', 'qux'],
      );
    });
  },
);

test(
  'parseForbiddenTerms: バッククォートで囲まれた用語・禁止語を正しく除去する',
  () => {
    const md = [
      '| 用語 | 定義 | 禁止同義語 |',
      '|---|---|---|',
      '| `code-term` | コード用語の定義 | `banned-code`、plain |',
    ].join('\n');
    withTempGlossary(md, (filePath) => {
      const forbidden = parseForbiddenTerms(filePath);
      assert.deepEqual(
        forbidden.map((f) => f.banned).sort(),
        ['banned-code', 'plain'],
      );
      for (const f of forbidden) {
        assert.equal(f.correctTerm, 'code-term');
      }
    });
  },
);

test(
  'parseForbiddenTerms: 表以外の行（見出し・説明文）は無視される',
  () => {
    const md = [
      '# 用語集',
      '',
      '> これは説明文です。表ではありません。',
      '',
      '| 用語 | 定義 | 禁止同義語 |',
      '|---|---|---|',
      '| Foo | Fooの定義 | bar |',
    ].join('\n');
    withTempGlossary(md, (filePath) => {
      const forbidden = parseForbiddenTerms(filePath);
      assert.deepEqual(forbidden, [{ banned: 'bar', correctTerm: 'Foo' }]);
    });
  },
);
