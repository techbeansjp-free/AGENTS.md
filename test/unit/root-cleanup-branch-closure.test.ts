// ISSUE-798 / AC-2 / DESIGN D13: 本コマンドが「LLMまたは対話エージェントの起動を含まない」ことを、
// 宣言ではなく実装モジュールの推移的 import 閉包という構造で担保する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entryPoint = 'src/commands/root-cleanup-branch.ts';

/** アダプタ起動・ワーカー起動・ゲートレビュア起動の実装を持つモジュール（閉包に現れてはならない）。 */
const LAUNCHER_MODULES = [
  'src/commands/segment.ts',
  'src/commands/gate.ts',
  'src/commands/worker.ts',
  'src/commands/report.ts',
  'src/lib/worker-selection.ts',
  'src/lib/model-selection.ts',
  'src/lib/reviewer-prompt-inputs.ts',
];

/** 起動系の実体を指す literal（閉包内のどのモジュールも保持してはならない）。 */
const LAUNCH_LITERALS = [
  '.agent-skill-chain/adapters/',
  'launch_worker',
  'launch_gate_reviewer',
  'WORKER_CMD',
  'GATE_REVIEWER_CMD',
];

const RELATIVE_IMPORT_RE = /\bfrom\s+'(\.[^']*)'/g;
/** 型のみの import/export は型検査で消えるため実行時の依存辺にならない。閉包から除く。 */
const TYPE_ONLY_STATEMENT_RE = /\b(?:import|export)\s+type\s[\s\S]*?from\s+'[^']*'/g;

function toRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** ビルド後の `.js` 指定を実ソースの `.ts` へ戻しつつ、実行時の相対importだけを推移的に辿る。 */
function importClosure(entry: string): string[] {
  const visited = new Set<string>();
  const queue = [path.join(repoRoot, entry)];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const relative = toRelative(current);
    if (visited.has(relative)) continue;
    visited.add(relative);
    const source = fs.readFileSync(current, 'utf8').replace(TYPE_ONLY_STATEMENT_RE, '');
    RELATIVE_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RELATIVE_IMPORT_RE.exec(source))) {
      const resolved = path.resolve(path.dirname(current), match[1].replace(/\.js$/, '.ts'));
      assert.equal(fs.existsSync(resolved), true, `${relative} の import 先を解決できません: ${match[1]}`);
      queue.push(resolved);
    }
  }
  return [...visited].sort();
}

test('AC-2 (D13): 本コマンドの推移的import閉包に、アダプタ・ワーカー・レビュアの起動実装が現れない', () => {
  const closure = importClosure(entryPoint);

  // 閉包の走査そのものが機能していること（自明に空でないこと）を先に確かめる。
  assert.ok(closure.includes(entryPoint));
  for (const expected of ['src/lib/root-artifact-state.ts', 'src/lib/github-lease.ts', 'src/lib/exec.ts']) {
    assert.ok(closure.includes(expected), `閉包に ${expected} が含まれること（走査が機能している証拠）`);
  }

  for (const launcher of LAUNCHER_MODULES) {
    assert.equal(closure.includes(launcher), false, `閉包に ${launcher} が含まれないこと`);
  }
  for (const module of closure) {
    const source = fs.readFileSync(path.join(repoRoot, module), 'utf8');
    for (const literal of LAUNCH_LITERALS) {
      assert.equal(source.includes(literal), false, `${module} が起動系のliteral '${literal}' を保持しないこと`);
    }
  }
});

test('AC-2: 本コマンドは標準入力を読む経路を持たない', () => {
  const source = fs.readFileSync(path.join(repoRoot, entryPoint), 'utf8');
  for (const literal of ['process.stdin', 'readFileSync(0', '/dev/stdin', 'createInterface']) {
    assert.equal(source.includes(literal), false, `標準入力経路 '${literal}' を持たないこと`);
  }
});
