import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Given, When, Then } from '@cucumber/cucumber';

/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function execute(args, env = process.env) {
  const cli = path.resolve(process.cwd(), 'bin', 'agent-skill-chain.js');
  return spawnSync(process.execPath, [cli, ...args], { cwd: process.cwd(), encoding: 'utf8', env });
}

When('project bootstrapをdry-runする', function () {
  this.cliResults = [execute(['project', 'bootstrap', '--new-project', '--kind=cli', '--dry-run', `--root=${this.root}`])];
});
When('project bootstrapをapplyする', function () { this.cliResults.push(execute(['project', 'bootstrap', '--new-project', '--kind=cli', '--apply', `--root=${this.root}`])); });
When('spec validate commandを実行する', function () { this.cliResults.push(execute(['spec', 'validate', `--root=${this.root}`])); });
Then('すべてのCLI終了codeは0である', function () { for (const result of this.cliResults) assert.equal(result.status, 0, result.stderr); });

Given('pass済みreview、tests、specのPR引数がある', function () {
  this.root = this.temp();
  const headSha = 'a'.repeat(40);
  const evidence = path.join(this.root, 'pr-evidence.json');
  fs.writeFileSync(evidence, `${JSON.stringify({
    headSha,
    review: { approved: true, headSha },
    tests: { passed: true, headSha, scenarioIds: ['SCN-E2E-002'] },
    spec: { consistent: true, headSha, impact: 'updated', trace: { requirements: ['FR-01'], scenarios: ['SCN-E2E-002'], tests: ['test/features/e2e/cli.feature'] } },
  })}\n`);
  this.prArgs = ['pr', 'create', '--repo=o/r', '--issue=824', '--head=x', '--base=main', `--head-sha=${headSha}`, `--evidence=${evidence}`];
  const stubDirectory = this.temp('asc-gh-stub-');
  this.ghMarker = path.join(stubDirectory, 'called');
  const stub = path.join(stubDirectory, 'gh');
  fs.writeFileSync(stub, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(this.ghMarker)}, 'called')\nprocess.exit(99)\n`);
  fs.chmodSync(stub, 0o755);
  this.cliEnv = { ...process.env, PATH: `${stubDirectory}${path.delimiter}${process.env.PATH ?? ''}` };
});
When('pr create commandをdry-runする', function () { this.cliResult = execute([...this.prArgs, '--dry-run'], this.cliEnv); });
When('authorizationなしでpr create commandをapplyする', function () { this.cliResult = execute([...this.prArgs, '--apply'], this.cliEnv); });
Then('CLI終了codeは0である', function () { assert.equal(this.cliResult.status, 0, this.cliResult.stderr); });
Then('CLI終了codeは非0である', function () { assert.notEqual(this.cliResult.status, 0); });
Then('stdoutに{string}が含まれる', function (value) { assert.ok(this.cliResult.stdout.includes(value), `args=${JSON.stringify(this.prArgs)} stdout=${JSON.stringify(this.cliResult.stdout)} stderr=${JSON.stringify(this.cliResult.stderr)} pid=${this.cliResult.pid}`); });
Then('ghは呼ばれない', function () { assert.equal(fs.existsSync(this.ghMarker), false); });
