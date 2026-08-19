import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitAll(cwd: string, message: string): string {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function write(cwd: string, relativePath: string, content: string | Buffer): void {
  const fullPath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function setPromptLimit(cwd: string, value: number): void {
  const configPath = path.join(cwd, '.agent-skill-chain/config/agent-skill-chain.yaml');
  const config = parse(fs.readFileSync(configPath, 'utf8')) as {
    review: { prompt_max_input_bytes?: number };
  };
  config.review.prompt_max_input_bytes = value;
  fs.writeFileSync(configPath, stringify(config), 'utf8');
}

function prompt(
  cwd: string,
  gate: 'spec' | 'design' | 'implementation' | 'validation',
  targetSha: string,
  baseSha?: string,
): string {
  const result = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-751', gate, targetSha, ...(baseSha ? [baseSha] : [])],
    { cwd },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function metric(output: string, label: string): number {
  const match = output.match(new RegExp(`- ${label}: (\\d+) B`));
  assert.ok(match, `${label}が出力されること`);
  return Number(match[1]);
}

test('ISSUE-751 AC-1/2/6/7: gate_id固定表・1段閉包・一意一覧を4 gateで保つ', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  write(repo.dir, 'AGENTS.md', '# AGENTS\n\nsrc/agents-only.ts\n');
  const evidence = {
    'src/spec-evidence.ts': 'SPEC_EVIDENCE_BODY  \nsrc/transitive.ts\n\n',
    'src/design-evidence.ts': 'DESIGN_EVIDENCE_BODY\n',
    'src/plan-evidence.ts': 'PLAN_EVIDENCE_BODY\n',
    'src/adr-evidence.ts': 'ADR_EVIDENCE_BODY\n',
    'src/validation-evidence.ts': 'VALIDATION_EVIDENCE_BODY\n',
    'src/transitive.ts': 'TRANSITIVE_ONLY_BODY\n',
    'src/agents-only.ts': 'AGENTS_ONLY_BODY\n',
    'src/diff-only.ts': 'DIFF_ONLY_BODY\n',
  };
  for (const [relativePath, body] of Object.entries(evidence)) write(repo.dir, relativePath, body);
  const baseSha = commitAll(repo.dir, 'test: add reviewer input base');

  write(repo.dir, 'SPEC.md', '# SPEC\n\n#### AC-1: fixed input\n\nsrc/spec-evidence.ts\n');
  write(repo.dir, 'DESIGN.md', '# DESIGN\n\nsrc/design-evidence.ts\n');
  write(repo.dir, 'PLAN.md', '# PLAN\n\nsrc/plan-evidence.ts\n');
  write(repo.dir, 'VALIDATION.md', '# VALIDATION\n\nsrc/validation-evidence.ts\n');
  write(repo.dir, 'test-execution.log', 'tests passed\n');
  write(repo.dir, 'docs/adr/ADR-0075-fixture.md', '# ADR\n\nsrc/adr-evidence.ts\n');
  write(repo.dir, 'src/changed.ts', 'export const changed = true; // src/diff-only.ts\n');
  const targetSha = commitAll(repo.dir, 'test: add reviewer input target');

  const outputs = {
    spec: prompt(repo.dir, 'spec', targetSha, baseSha),
    design: prompt(repo.dir, 'design', targetSha, baseSha),
    implementation: prompt(repo.dir, 'implementation', targetSha, baseSha),
    validation: prompt(repo.dir, 'validation', targetSha, baseSha),
  };

  assert.match(outputs.spec, /SPEC_EVIDENCE_BODY/);
  assert.doesNotMatch(outputs.spec, /DESIGN_EVIDENCE_BODY|PLAN_EVIDENCE_BODY|ADR_EVIDENCE_BODY|VALIDATION_EVIDENCE_BODY/);
  assert.match(outputs.design, /SPEC_EVIDENCE_BODY/);
  assert.match(outputs.design, /DESIGN_EVIDENCE_BODY/);
  assert.match(outputs.design, /PLAN_EVIDENCE_BODY/);
  assert.match(outputs.design, /ADR_EVIDENCE_BODY/);
  assert.doesNotMatch(outputs.design, /VALIDATION_EVIDENCE_BODY/);
  assert.match(outputs.implementation, /export const changed = true/);
  assert.match(outputs.implementation, /SPEC_EVIDENCE_BODY/);
  assert.match(outputs.implementation, /DESIGN_EVIDENCE_BODY/);
  assert.match(outputs.implementation, /PLAN_EVIDENCE_BODY/);
  assert.match(outputs.implementation, /ADR_EVIDENCE_BODY/);
  assert.doesNotMatch(outputs.implementation, /VALIDATION_EVIDENCE_BODY/);
  assert.match(outputs.validation, /tests passed/);
  assert.match(outputs.validation, /VALIDATION_EVIDENCE_BODY/);
  assert.match(outputs.validation, /ADR_EVIDENCE_BODY/);

  for (const output of Object.values(outputs)) {
    assert.match(output, /## 憲法文書\n### AGENTS\.md/);
    assert.doesNotMatch(output, /TRANSITIVE_ONLY_BODY|AGENTS_ONLY_BODY|DIFF_ONLY_BODY/);
    assert.match(output, /展開済みファイル一覧/);
    assert.match(output, /省略ファイル一覧/);
  }
  assert.equal(outputs.design.match(/SPEC_EVIDENCE_BODY/g)?.length, 1);
  assert.match(outputs.design, /src\/transitive\.ts\n\n```/);
  assert.equal(outputs.implementation.match(/^# DESIGN$/gm)?.length, 1);
  assert.equal(outputs.implementation.match(/^# PLAN$/gm)?.length, 1);
});

test('ISSUE-751 AC-3/8: target SHA設定とblobだけを読み、作業ツリー変更およびbase欠落に安全に対処する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  write(repo.dir, 'AGENTS.md', '# AGENTS\n');
  write(repo.dir, 'src/evidence.ts', 'TARGET_EVIDENCE\n');
  const baseSha = commitAll(repo.dir, 'test: add deterministic base');
  write(repo.dir, 'SPEC.md', '# SPEC\n\n#### AC-1: deterministic\n\nsrc/evidence.ts\n');
  const targetSha = commitAll(repo.dir, 'test: add deterministic target');

  const first = prompt(repo.dir, 'spec', targetSha, baseSha);
  write(repo.dir, 'SPEC.md', '# dirty SPEC\n');
  write(repo.dir, 'src/evidence.ts', 'DIRTY_EVIDENCE\n');
  setPromptLimit(repo.dir, 10);
  const second = prompt(repo.dir, 'spec', targetSha, baseSha);
  assert.equal(second, first);
  assert.match(second, /適用上限: 1500000 B/);
  assert.match(second, /TARGET_EVIDENCE/);
  assert.doesNotMatch(second, /DIRTY_EVIDENCE|dirty SPEC/);

  const withoutBase = prompt(repo.dir, 'implementation', targetSha);
  assert.match(withoutBase, /base SHA未指定のため導出不能/);
  assert.match(withoutBase, /\(未検出\)/);
});

test('ISSUE-751 AC-4/5/6: 非テキストと予算超過を全文か省略へ分類し、完成promptを上限内に保つ', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  write(repo.dir, 'AGENTS.md', '# AGENTS\n');
  setPromptLimit(repo.dir, 12_000);
  write(repo.dir, 'evidence/first.txt', 'FIRST_BODY\n');
  write(repo.dir, 'evidence/large.txt', `LARGE_START\n${'x'.repeat(12_000)}\nLARGE_END\n`);
  write(repo.dir, 'evidence/binary.bin', Buffer.from([0x41, 0x00, 0x42]));
  write(repo.dir, 'evidence/last.txt', 'LAST_BODY\n');
  const baseSha = commitAll(repo.dir, 'test: add budget base');
  write(
    repo.dir,
    'SPEC.md',
    '# SPEC\n\n#### AC-1: budget\n\nevidence/first.txt evidence/large.txt evidence/binary.bin evidence/last.txt\n',
  );
  const targetSha = commitAll(repo.dir, 'test: add budget target');

  const output = prompt(repo.dir, 'spec', targetSha, baseSha);
  assert.match(output, /FIRST_BODY/);
  assert.match(output, /LAST_BODY/);
  assert.doesNotMatch(output, /LARGE_START|LARGE_END/);
  assert.match(output, /"evidence\/large\.txt"[^\n]+理由: 予算超過/);
  assert.match(output, /"evidence\/binary\.bin"[^\n]+理由: 非テキスト/);
  assert.ok(Buffer.byteLength(output.trimEnd(), 'utf8') <= 12_000);
  assert.ok(metric(output, '必須区間のレンダー長 M') + metric(output, '一覧の予約長 L') <= 12_000);
});

test('ISSUE-751 AC-5: 必須区間超過と多数小ファイルによる一覧予約超過を件数・M・L付きで拒否する', (t) => {
  const requiredRepo = createTmpRepo({ backend: 'local' });
  t.after(() => requiredRepo.cleanup());
  write(requiredRepo.dir, 'AGENTS.md', '# AGENTS\n');
  setPromptLimit(requiredRepo.dir, 100);
  const requiredBase = commitAll(requiredRepo.dir, 'test: add required overflow base');
  write(requiredRepo.dir, 'SPEC.md', '# SPEC\n\n#### AC-1: overflow\n');
  const requiredTarget = commitAll(requiredRepo.dir, 'test: add required overflow target');
  const required = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-751', 'spec', requiredTarget, requiredBase],
    { cwd: requiredRepo.dir },
  );
  assert.notEqual(required.status, 0);
  assert.match(required.stderr, /M=\d+ B, L=\d+ B, 候補件数=\d+, 上限=100 B/);

  const listRepo = createTmpRepo({ backend: 'local' });
  t.after(() => listRepo.cleanup());
  write(listRepo.dir, 'AGENTS.md', '# AGENTS\n');
  setPromptLimit(listRepo.dir, 10_000);
  const names: string[] = [];
  for (let index = 0; index < 80; index += 1) {
    const name = `e/${String(index).padStart(3, '0')}.txt`;
    names.push(name);
    write(listRepo.dir, name, '');
  }
  const listBase = commitAll(listRepo.dir, 'test: add list overflow base');
  write(listRepo.dir, 'SPEC.md', `# SPEC\n\n#### AC-1: list overflow\n\n${names.join(' ')}\n`);
  const listTarget = commitAll(listRepo.dir, 'test: add list overflow target');
  const list = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-751', 'spec', listTarget, listBase],
    { cwd: listRepo.dir },
  );
  assert.notEqual(list.status, 0);
  const values = /M=(\d+) B, L=(\d+) B, 候補件数=(\d+), 上限=(\d+) B/.exec(list.stderr);
  assert.ok(values, list.stderr);
  const [, mandatory, reservation, count, limit] = values.map(Number);
  assert.ok(mandatory < limit);
  assert.ok(mandatory + reservation > limit);
  assert.equal(count, 82);
});

test('ISSUE-751回帰: 必須入力Mが1042451 Bのimplementation promptを既定1500000 Bで生成できる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  write(repo.dir, 'AGENTS.md', '# AGENTS\n');
  const baseSha = commitAll(repo.dir, 'test: add issue 733 size base');
  write(repo.dir, 'SPEC.md', '# SPEC\n\n#### AC-1: size regression\n');
  write(repo.dir, 'DESIGN.md', '# DESIGN\n');
  write(repo.dir, 'PLAN.md', '# PLAN\n');
  write(repo.dir, 'docs/adr/ADR-0075-size.md', '# ADR\n');
  write(repo.dir, 'large.ts', '');
  let targetSha = commitAll(repo.dir, 'test: add issue 733 size target');
  const expectedMandatoryBytes = 1_042_451;
  let fillerBytes = 0;
  let output = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    output = prompt(repo.dir, 'implementation', targetSha, baseSha);
    const current = metric(output, '必須区間のレンダー長 M');
    if (current === expectedMandatoryBytes) break;
    fillerBytes += expectedMandatoryBytes - current;
    assert.ok(fillerBytes >= 0, `fixture調整後のfillerは非負であること: ${fillerBytes}`);
    write(repo.dir, 'large.ts', 'x'.repeat(fillerBytes));
    targetSha = commitAll(repo.dir, `test: adjust issue 733 size fixture ${attempt}`);
  }
  output = prompt(repo.dir, 'implementation', targetSha, baseSha);
  assert.equal(metric(output, '必須区間のレンダー長 M'), expectedMandatoryBytes);
  assert.match(output, /適用上限: 1500000 B/);
  assert.ok(Buffer.byteLength(output.trimEnd(), 'utf8') <= 1_500_000);
});
