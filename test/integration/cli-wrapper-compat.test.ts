// Issue #677 AC-4: 承認済み設計SHAの変更前ラッパーと、共有実装化後の全54本を同一fixtureで比較する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createWrapperFixture,
  installNodeCliStub,
  packageRoot,
  readArgvRecords,
  runWrapper,
  wrapperTargets,
  writeExecutable,
} from '../helpers/cli-wrapper-fixture.js';

const implementationBase = 'fa67956a4e3a0ed4697e32c6f0caef1aad961af6';

function revisionFile(relative: string): string {
  return execFileSync('git', ['show', `${implementationBase}:${relative}`], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
}

test('対象54本の委譲argvと終了コードが変更前と一致する', () => {
  const fixture = createWrapperFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-no-external-'));
  try {
    const targets = wrapperTargets();
    assert.equal(targets.length, 54);
    const current = new Map(targets.map((relative) => [relative, fs.readFileSync(path.join(packageRoot, relative), 'utf8')]));
    for (const relative of targets) fs.writeFileSync(path.join(fixture.root, relative), revisionFile(relative));

    const cliRecord = path.join(fixture.root, 'cli-argv.jsonl');
    const externalRecord = path.join(fixture.root, 'external-tools.log');
    installNodeCliStub(fixture.root, cliRecord);
    for (const command of ['gh', 'git']) {
      writeExecutable(
        path.join(stubDir, command),
        `#!/usr/bin/env bash\nprintf '%s\\n' ${command} >> ${JSON.stringify(externalRecord)}\nexit 97\n`,
      );
    }
    const env = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      ASC_TEST_FIXTURE_ROOT: fixture.root,
      AGENT_SKILL_CHAIN_AUTO_INSTALL: '0',
    };

    const before = new Map<string, { status: number | null; records: string[][] }>();
    for (const relative of targets) {
      fs.rmSync(cliRecord, { force: true });
      const result = runWrapper(fixture.root, relative, env);
      before.set(relative, { status: result.status, records: readArgvRecords(cliRecord) });
    }

    for (const [relative, content] of current) fs.writeFileSync(path.join(fixture.root, relative), content);
    fs.copyFileSync(
      path.join(packageRoot, '.agent-skill-chain', 'scripts', 'cli-resolve.sh'),
      path.join(fixture.root, '.agent-skill-chain', 'scripts', 'cli-resolve.sh'),
    );

    for (const relative of targets) {
      fs.rmSync(cliRecord, { force: true });
      const result = runWrapper(fixture.root, relative, env);
      const after = { status: result.status, records: readArgvRecords(cliRecord) };
      assert.deepEqual(after, before.get(relative), `${relative} の委譲契約が変更前と一致すること\nstderr=${result.stderr}`);
      if (
        relative.endsWith('/worker-launch.sh') ||
        relative.endsWith('/worker-launch-verify.sh') ||
        relative.endsWith('/gate-launch-reviewer.sh')
      ) {
        assert.ok(after.records.length >= 1, `${relative} の _cli が少なくとも1回呼ばれること`);
      }
    }
    assert.equal(fs.existsSync(externalRecord), false, 'エージェント起動・gh・git書込み系へ到達しないこと');
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});
