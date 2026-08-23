import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setWorldConstructor, Before, After } from '@cucumber/cucumber';

class WorkflowWorld {
  constructor() {
    this.value = undefined;
    this.error = undefined;
    /** @type {string[]} */
    this.calls = [];
    /** @type {string[]} */
    this.temporaryDirectories = [];
  }

  temp(prefix = 'asc-v03-') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    this.temporaryDirectories.push(directory);
    return directory;
  }

  initRepo() {
    const directory = this.temp();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: directory });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: directory });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: directory });
    fs.writeFileSync(path.join(directory, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: directory });
    execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: directory });
    return directory;
  }
}

setWorldConstructor(WorkflowWorld);
Before(function () {
  this.value = undefined;
  this.error = undefined;
  this.calls = [];
});
After(function () {
  for (const directory of this.temporaryDirectories.reverse()) fs.rmSync(directory, { recursive: true, force: true });
});
