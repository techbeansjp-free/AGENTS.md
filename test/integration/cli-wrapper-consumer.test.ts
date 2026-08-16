// Issue #677 AC-6/AC-8: consumer展開物で54本全数の共有実装到達性と失敗形を検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createWrapperFixture,
  runWrapper,
  wrapperTargets,
  writeExecutable,
} from '../helpers/cli-wrapper-fixture.js';

function installNpmStub(stubDir: string, prefix: string, log: string): void {
  const installedCli = path.join(prefix, 'bin', 'agent-skill-chain');
  const cliBody = [
    '#!/usr/bin/env bash',
    'if [[ "${1:-}" == "--help" ]]; then exit 0; fi',
    'if [[ "${1:-} ${2:-}" == "worker context" ]]; then',
    '  printf "worktree_path=%s\\nadapter=issue677-invalid\\n" "$ASC_TEST_FIXTURE_ROOT"',
    'fi',
    'if [[ "${1:-} ${2:-}" == "gate reviewer-context" ]]; then',
    '  printf "adapter=issue677-invalid\\ncore_review_required=false\\ncore_review_status=not_required\\ncore_required_profile=strict\\n"',
    'fi',
    'exit 0',
    '',
  ].join('\n');
  const cliEncoded = Buffer.from(cliBody).toString('base64');
  writeExecutable(
    path.join(stubDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      'if [[ "${1:-} ${2:-}" == "prefix -g" ]]; then',
      `  printf '%s\\n' ${JSON.stringify(prefix)}`,
      '  exit 0',
      'fi',
      'if [[ "${1:-} ${2:-}" == "install -g" ]]; then',
      `  mkdir -p ${JSON.stringify(path.dirname(installedCli))}`,
      `  printf '%s' ${JSON.stringify(cliEncoded)} | base64 -d > ${JSON.stringify(installedCli)}`,
      `  chmod +x ${JSON.stringify(installedCli)}`,
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'),
  );
}

test('consumerへ展開した54本全数が共有実装から自動導入分岐へ到達する', () => {
  const fixture = createWrapperFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-consumer-bin-'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-consumer-prefix-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-consumer-home-'));
  const npmLog = path.join(stubDir, 'npm.log');
  try {
    const targets = wrapperTargets(fixture.root);
    assert.equal(targets.length, 54);
    installNpmStub(stubDir, prefix, npmLog);
    const env = {
      PATH: `${stubDir}:/usr/bin:/bin`,
      HOME: home,
      ASC_TEST_FIXTURE_ROOT: fixture.root,
    };

    for (const relative of targets) {
      fs.rmSync(path.join(fixture.root, 'bin'), { recursive: true, force: true });
      fs.rmSync(path.join(fixture.root, 'node_modules'), { recursive: true, force: true });
      fs.rmSync(path.join(prefix, 'bin'), { recursive: true, force: true });
      fs.rmSync(npmLog, { force: true });
      const result = runWrapper(fixture.root, relative, env);
      const calls = fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8') : '';
      assert.match(
        calls,
        /^install -g github:techbeansjp-free\/AGENTS\.md$/m,
        `${relative} が自動導入を試行すること`,
      );
      assert.doesNotMatch(result.stderr, /共有実装を(?:解決|読み込)めません/, `${relative}: ${result.stderr}`);
    }
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(prefix, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('共有実装の4種の破損状態で54本全数が探索パス付き日本語エラーへ収束する', () => {
  const fixture = createWrapperFixture();
  const cliRecord = path.join(fixture.root, 'delegated.log');
  const shared = path.join(fixture.root, '.agent-skill-chain', 'scripts', 'cli-resolve.sh');
  const original = fs.readFileSync(shared, 'utf8');
  const states: Array<{ name: string; apply(): void; restore(): void }> = [
    {
      name: '欠落',
      apply: () => fs.rmSync(shared, { force: true }),
      restore: () => fs.writeFileSync(shared, original, { mode: 0o755 }),
    },
    {
      name: '部分展開',
      apply: () => fs.writeFileSync(shared, '#!/usr/bin/env bash\n'),
      restore: () => fs.writeFileSync(shared, original, { mode: 0o755 }),
    },
    {
      name: '読み取り権限なし',
      apply: () => fs.chmodSync(shared, 0o000),
      restore: () => fs.chmodSync(shared, 0o755),
    },
    {
      name: '構文エラー',
      apply: () => fs.writeFileSync(shared, '#!/usr/bin/env bash\nif then\n'),
      restore: () => fs.writeFileSync(shared, original, { mode: 0o755 }),
    },
  ];
  try {
    const targets = wrapperTargets(fixture.root);
    for (const state of states) {
      state.apply();
      try {
        for (const relative of targets) {
          fs.rmSync(cliRecord, { force: true });
          const result = runWrapper(fixture.root, relative, {
            PATH: '/usr/bin:/bin',
            HOME: fixture.root,
            ASC_TEST_FIXTURE_ROOT: fixture.root,
            ASC_TEST_DELEGATION_RECORD: cliRecord,
            AGENT_SKILL_CHAIN_AUTO_INSTALL: '0',
          });
          assert.notEqual(result.status, 0, `${state.name}: ${relative} が非ゼロ終了すること`);
          assert.match(result.stderr, /共有実装.*探索パス/u, `${state.name}: ${relative}: ${result.stderr}`);
          assert.equal(fs.existsSync(cliRecord), false, `${state.name}: ${relative} がCLIへ委譲しないこと`);
        }
      } finally {
        state.restore();
      }
    }
  } finally {
    fixture.cleanup();
  }
});
