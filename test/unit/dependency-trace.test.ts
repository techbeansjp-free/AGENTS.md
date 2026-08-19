// Issue #759 DESIGN E12: 実行時依存の解決先の観測点。観測は判定の入力にせず、未設定時は何も
// 出力せず、追記に失敗しても本番経路の挙動を変えない（AGENTS.md 不変条件I8）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { traceRuntimeDependencyResolution } from '../../src/lib/dependency-trace.js';

function withTraceFile<T>(run: (traceFile: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-dependency-trace-'));
  const previous = process.env.ASC_DEPENDENCY_TRACE_FILE;
  try {
    const traceFile = path.join(dir, 'dependencies.txt');
    process.env.ASC_DEPENDENCY_TRACE_FILE = traceFile;
    return run(traceFile);
  } finally {
    if (previous === undefined) delete process.env.ASC_DEPENDENCY_TRACE_FILE;
    else process.env.ASC_DEPENDENCY_TRACE_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('dependency trace: ASC_DEPENDENCY_TRACE_FILE 未設定時は何も出力しない', () => {
  const previous = process.env.ASC_DEPENDENCY_TRACE_FILE;
  delete process.env.ASC_DEPENDENCY_TRACE_FILE;
  try {
    // 例外を投げず、書き込み先も作らない（未設定が既定の運用形態である）。
    assert.doesNotThrow(() => traceRuntimeDependencyResolution(import.meta.url, ['yaml']));
  } finally {
    if (previous !== undefined) process.env.ASC_DEPENDENCY_TRACE_FILE = previous;
  }
});

test('dependency trace: 参照経路を全て解決した実体パスを1行ずつ追記する', () => {
  withTraceFile((traceFile) => {
    traceRuntimeDependencyResolution(import.meta.url, ['yaml', 'ajv']);
    const lines = fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const bySpecifier = new Map(lines.map((line) => line.split('\t') as [string, string]));
    for (const specifier of ['yaml', 'ajv']) {
      const resolved = bySpecifier.get(specifier);
      assert.ok(resolved, `${specifier} が記録されること`);
      assert.equal(path.isAbsolute(resolved), true, '絶対パスで記録されること');
      // 実体パス（symbolic link を解決した後）であること。
      assert.equal(resolved, fs.realpathSync(resolved));
    }

    // 追記であり、既存の記録を切り詰めない。
    traceRuntimeDependencyResolution(import.meta.url, ['yaml']);
    assert.equal(fs.readFileSync(traceFile, 'utf8').trim().split('\n').length, 3);
  });
});

test('dependency trace: 解決できない指定は unresolved として記録し例外を投げない', () => {
  withTraceFile((traceFile) => {
    assert.doesNotThrow(() =>
      traceRuntimeDependencyResolution(import.meta.url, ['@agent-skill-chain/not-installed']),
    );
    assert.match(fs.readFileSync(traceFile, 'utf8'), /@agent-skill-chain\/not-installed\tunresolved/);
  });
});

test('dependency trace: 追記に失敗しても例外を投げない（観測は判定の入力ではない）', () => {
  const previous = process.env.ASC_DEPENDENCY_TRACE_FILE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-dependency-trace-fail-'));
  process.env.ASC_DEPENDENCY_TRACE_FILE = path.join(dir, 'missing-directory', 'dependencies.txt');
  try {
    assert.doesNotThrow(() => traceRuntimeDependencyResolution(import.meta.url, ['yaml']));
  } finally {
    if (previous === undefined) delete process.env.ASC_DEPENDENCY_TRACE_FILE;
    else process.env.ASC_DEPENDENCY_TRACE_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
