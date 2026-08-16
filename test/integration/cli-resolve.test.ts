// Issue #677 AC-2/AC-3/AC-7/AC-9/AC-10/AC-11: 共有CLI解決ライブラリの分岐を実行検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  createWrapperFixture,
  packageRoot,
  writeExecutable,
} from '../helpers/cli-wrapper-fixture.js';

interface ResolverFixture {
  root: string;
  script: string;
  cleanup(): void;
}

function createResolverFixture(): ResolverFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-resolver-'));
  const shared = path.join(root, '.agent-skill-chain', 'scripts', 'cli-resolve.sh');
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  fs.copyFileSync(path.join(packageRoot, '.agent-skill-chain', 'scripts', 'cli-resolve.sh'), shared);
  const script = path.join(root, 'run-resolver.sh');
  writeExecutable(
    script,
    '#!/usr/bin/env bash\nset -euo pipefail\nsource .agent-skill-chain/scripts/cli-resolve.sh\nasc_resolve_cli\n"${ASC_CLI[@]}" "$@"\n',
  );
  return { root, script, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function run(fixture: ResolverFixture, env: NodeJS.ProcessEnv, args = ['delegated']): SpawnSyncReturns<string> {
  return spawnSync('bash', [fixture.script, ...args], { cwd: fixture.root, env, encoding: 'utf8' });
}

function baseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: os.tmpdir(), ...extra };
}

function commandStub(file: string, name: string, record: string, { node = false, helpStatus = 0 } = {}): void {
  if (node) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(record)},${JSON.stringify(name + '\n')});\n`,
    );
    return;
  }
  writeExecutable(
    file,
    `#!/usr/bin/env bash\nif [[ "\${1:-}" == "--help" ]]; then exit ${helpStatus}; fi\nprintf '%s\\n' ${JSON.stringify(name)} >> ${JSON.stringify(record)}\n`,
  );
}

test('3経路は bin → node_modules → PATH の固定順で選ばれる', () => {
  const fixture = createResolverFixture();
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-path-'));
  const record = path.join(fixture.root, 'selected.log');
  try {
    const first = path.join(fixture.root, 'bin', 'agents-md.js');
    const second = path.join(fixture.root, 'node_modules', '.bin', 'agent-skill-chain');
    const third = path.join(pathDir, 'agent-skill-chain');
    commandStub(first, 'bin', record, { node: true });
    commandStub(second, 'node_modules', record);
    commandStub(third, 'PATH', record);
    const env = baseEnv({
      PATH: `${pathDir}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      AGENT_SKILL_CHAIN_AUTO_INSTALL: '0',
    });

    assert.equal(run(fixture, env).status, 0);
    assert.equal(fs.readFileSync(record, 'utf8'), 'bin\n');
    fs.rmSync(first);
    fs.rmSync(record);
    assert.equal(run(fixture, env).status, 0);
    assert.equal(fs.readFileSync(record, 'utf8'), 'node_modules\n');
    fs.rmSync(second);
    fs.rmSync(record);
    assert.equal(run(fixture, env).status, 0);
    assert.equal(fs.readFileSync(record, 'utf8'), 'PATH\n');
  } finally {
    fixture.cleanup();
    fs.rmSync(pathDir, { recursive: true, force: true });
  }
});

function installNpmBehavior(
  stubDir: string,
  prefix: string,
  npmLog: string,
  mode: 'success' | 'no-cli' | 'bad-help' | 'failure',
  delegatedLog: string,
  installedVersion = '9.9.9',
): void {
  const cli = path.join(prefix, 'bin', 'agent-skill-chain');
  const globalRoot = path.join(prefix, 'lib', 'node_modules');
  const packageJson = path.join(globalRoot, 'agent-skill-chain', 'package.json');
  const helpStatus = mode === 'bad-help' ? 23 : 0;
  const cliBody = `#!/usr/bin/env bash\nif [[ "\${1:-}" == "--help" ]]; then exit ${helpStatus}; fi\nprintf '%s\\n' "$*" >> ${JSON.stringify(delegatedLog)}\n`;
  const cliEncoded = Buffer.from(cliBody).toString('base64');
  writeExecutable(
    path.join(stubDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> ${JSON.stringify(npmLog)}`,
      `if [[ "\${1:-} \${2:-}" == "install -g" ]]; then`,
      mode === 'failure' ? '  exit 42' : '  :',
      mode === 'success' || mode === 'bad-help' ? `  mkdir -p ${JSON.stringify(path.dirname(cli))}` : '  :',
      mode === 'success' || mode === 'bad-help'
        ? `  printf '%s' ${JSON.stringify(cliEncoded)} | base64 -d > ${JSON.stringify(cli)}`
        : '  :',
      mode === 'success' || mode === 'bad-help' ? `  chmod +x ${JSON.stringify(cli)}` : '  :',
      mode === 'success' || mode === 'bad-help'
        ? `  mkdir -p ${JSON.stringify(path.dirname(packageJson))}`
        : '  :',
      mode === 'success' || mode === 'bad-help'
        ? `  printf '%s\n' ${JSON.stringify(JSON.stringify({ name: 'agent-skill-chain', version: installedVersion }))} > ${JSON.stringify(packageJson)}`
        : '  :',
      '  exit 0',
      'fi',
      `if [[ "\${1:-} \${2:-}" == "prefix -g" ]]; then printf '%s\\n' ${JSON.stringify(prefix)}; exit 0; fi`,
      `if [[ "\${1:-} \${2:-}" == "root -g" ]]; then printf '%s\\n' ${JSON.stringify(globalRoot)}; exit 0; fi`,
      'exit 1',
      '',
    ].join('\n'),
  );
}

test('導入元指定を省略すると既定ブランチから自動導入し、PATH外の導入先を加えて再解決する', () => {
  const fixture = createResolverFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-npm-'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-prefix-'));
  const npmLog = path.join(fixture.root, 'npm.log');
  const delegated = path.join(fixture.root, 'delegated.log');
  try {
    installNpmBehavior(stubDir, prefix, npmLog, 'success', delegated);
    const result = run(fixture, baseEnv({ PATH: `${stubDir}:/usr/bin:/bin` }), ['hello', 'two words']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', '共有実装は標準出力へ書かないこと');
    assert.match(fs.readFileSync(npmLog, 'utf8'), /^install -g github:techbeansjp-free\/AGENTS\.md$/m);
    assert.match(fs.readFileSync(npmLog, 'utf8'), /^prefix -g$/m);
    assert.equal(fs.readFileSync(delegated, 'utf8'), 'hello two words\n');
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

test('ASC_CLI_INSTALL_SOURCEで固定refを指定すると同じrefから自動導入する', () => {
  const fixture = createResolverFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue683-fixed-ref-npm-'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'issue683-fixed-ref-prefix-'));
  const npmLog = path.join(fixture.root, 'npm.log');
  const delegated = path.join(fixture.root, 'delegated.log');
  const source = 'github:techbeansjp-free/AGENTS.md#v0.2.117';
  try {
    installNpmBehavior(stubDir, prefix, npmLog, 'success', delegated);
    const result = run(
      fixture,
      baseEnv({ PATH: `${stubDir}:/usr/bin:/bin`, ASC_CLI_INSTALL_SOURCE: source }),
      ['fixed-ref'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(npmLog, 'utf8'), /^install -g github:techbeansjp-free\/AGENTS\.md#v0\.2\.117$/m);
    assert.equal(fs.readFileSync(delegated, 'utf8'), 'fixed-ref\n');
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

test('自動導入CLIとconsumer assetsの版が異なる場合は警告して処理を続行する', () => {
  const fixture = createResolverFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue683-version-warning-npm-'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'issue683-version-warning-prefix-'));
  const delegated = path.join(fixture.root, 'delegated.log');
  try {
    fs.writeFileSync(path.join(fixture.root, '.agent-skill-chain', '.installed_version'), '1.2.3\n');
    installNpmBehavior(stubDir, prefix, path.join(fixture.root, 'npm.log'), 'success', delegated, '9.9.9');
    const result = run(
      fixture,
      baseEnv({ PATH: `${stubDir}:${path.dirname(process.execPath)}:/usr/bin:/bin` }),
      ['version-mismatch'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /CLIの版（9\.9\.9）.*assetsの版（1\.2\.3）.*処理を続行/u);
    assert.match(result.stderr, /ASC_CLI_INSTALL_SOURCEへ固定ref/u);
    assert.equal(fs.readFileSync(delegated, 'utf8'), 'version-mismatch\n');
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

test('npm失敗・再解決不能・起動不能はいずれも理由付き日本語エラーで非ゼロ終了する', () => {
  for (const mode of ['failure', 'no-cli', 'bad-help'] as const) {
    const fixture = createResolverFixture();
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-npm-failure-'));
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-prefix-failure-'));
    try {
      installNpmBehavior(stubDir, prefix, path.join(fixture.root, 'npm.log'), mode, path.join(fixture.root, 'delegated.log'));
      const result = run(fixture, baseEnv({ PATH: `${stubDir}:/usr/bin:/bin` }));
      assert.notEqual(result.status, 0, `${mode} が非ゼロ終了すること`);
      assert.match(result.stderr, /agent-skill-chain CLI.*(?:失敗|再解決できません)/u, `${mode}: ${result.stderr}`);
      assert.equal(result.stdout, '');
    } finally {
      fixture.cleanup();
      fs.rmSync(stubDir, { recursive: true, force: true });
      fs.rmSync(prefix, { recursive: true, force: true });
    }
  }
});

test('opt-outは値0だけで有効になり、それ以外は既定の自動導入を維持する', () => {
  for (const value of ['0', '', 'false', 'no', '1']) {
    const fixture = createResolverFixture();
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-optout-'));
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-optout-prefix-'));
    const npmLog = path.join(fixture.root, 'npm.log');
    try {
      installNpmBehavior(stubDir, prefix, npmLog, 'no-cli', path.join(fixture.root, 'delegated.log'));
      const env = baseEnv({ PATH: `${stubDir}:/usr/bin:/bin`, AGENT_SKILL_CHAIN_AUTO_INSTALL: value });
      const result = run(fixture, env);
      const calls = fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8') : '';
      if (value === '0') {
        assert.notEqual(result.status, 0);
        assert.equal(calls, '');
        assert.match(result.stderr, /AGENT_SKILL_CHAIN_AUTO_INSTALL=0.*自動導入を行いません/u);
      } else {
        assert.match(
          calls,
          /^install -g github:techbeansjp-free\/AGENTS\.md$/m,
          `値 ${JSON.stringify(value)} は自動導入すること`,
        );
      }
    } finally {
      fixture.cleanup();
      fs.rmSync(stubDir, { recursive: true, force: true });
      fs.rmSync(prefix, { recursive: true, force: true });
    }
  }
});

test('GitHub導入元の到達性検査は自動導入と同じsourceをnpmへ渡す', () => {
  const fixture = createResolverFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue683-source-check-'));
  const npmLog = path.join(fixture.root, 'npm-source.log');
  try {
    writeExecutable(
      path.join(stubDir, 'npm'),
      [
        '#!/usr/bin/env bash',
        `printf '%s\n' "$*" >> ${JSON.stringify(npmLog)}`,
        'if [[ "$*" == "view github:techbeansjp-free/AGENTS.md version" ]]; then',
        "  printf '9.9.9\\n'",
        '  exit 0',
        'fi',
        'exit 1',
        '',
      ].join('\n'),
    );
    const result = spawnSync(
      'bash',
      ['-c', 'source .agent-skill-chain/scripts/cli-resolve.sh; asc_verify_cli_install_source'],
      { cwd: fixture.root, env: baseEnv({ PATH: `${stubDir}:/usr/bin:/bin` }), encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(npmLog, 'utf8'), 'view github:techbeansjp-free/AGENTS.md version\n');
    assert.match(result.stdout, /github:techbeansjp-free\/AGENTS\.md.*9\.9\.9/u);
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

// ネットワーク障害で既定スイートを不安定にしないため通常はskipし、明示した場合だけ実GitHub sourceへ接続する。
test('GitHub導入元へ実際に到達してpackage versionを取得できる', (t) => {
  if (process.env.ASC_TEST_LIVE_CLI_INSTALL_SOURCE !== '1') {
    t.skip('ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 が指定された場合だけlive到達性を確認する');
    return;
  }
  const result = spawnSync(
    'bash',
    ['-c', 'unset ASC_CLI_INSTALL_SOURCE; source .agent-skill-chain/scripts/cli-resolve.sh; asc_verify_cli_install_source'],
    { cwd: packageRoot, env: process.env, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /github:techbeansjp-free\/AGENTS\.md.*version [0-9]+\.[0-9]+\.[0-9]+/u);
});

test('対話確認で拒否するとnpmを呼ばず理由付き日本語エラーで停止する', (t) => {
  if (spawnSync('bash', ['-c', 'command -v script'], { stdio: 'ignore' }).status !== 0) {
    t.skip('擬似端末を提供する script コマンドが無いため手動検証へ回す');
    return;
  }
  const fixture = createResolverFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-pty-'));
  const npmLog = path.join(fixture.root, 'npm.log');
  try {
    writeExecutable(path.join(stubDir, 'npm'), `#!/usr/bin/env bash\necho called >> ${JSON.stringify(npmLog)}\n`);
    const command = `bash ${JSON.stringify(fixture.script)}`;
    const result = spawnSync('script', ['-qec', command, '/dev/null'], {
      cwd: fixture.root,
      env: baseEnv({ PATH: `${stubDir}:/usr/bin:/bin` }),
      input: 'n\n',
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /利用者が拒否/u);
    assert.equal(fs.existsSync(npmLog), false);
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('第3経路は空・実行不可・help失敗の部分配置状態を採用しない', () => {
  const fixture = createResolverFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-partial-'));
  const cli = path.join(stubDir, 'agent-skill-chain');
  try {
    const env = baseEnv({ PATH: `${stubDir}:/usr/bin:/bin`, AGENT_SKILL_CHAIN_AUTO_INSTALL: '0' });
    fs.writeFileSync(cli, '');
    fs.chmodSync(cli, 0o755);
    assert.notEqual(run(fixture, env).status, 0);
    fs.writeFileSync(cli, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(cli, 0o644);
    assert.notEqual(run(fixture, env).status, 0);
    writeExecutable(cli, '#!/usr/bin/env bash\n[[ "${1:-}" == "--help" ]] && exit 9\nexit 0\n');
    assert.notEqual(run(fixture, env).status, 0);
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('並行自動導入中も部分配置CLIを委譲せず、各プロセスが定義済み挙動へ収束する', async () => {
  const fixture = createResolverFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-concurrent-'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-concurrent-prefix-'));
  const cli = path.join(prefix, 'bin', 'agent-skill-chain');
  const delegated = path.join(fixture.root, 'parallel-delegated.log');
  try {
    const cliBody = [
      '#!/usr/bin/env bash',
      `if [[ "\${1:-}" == "--help" ]]; then [[ -f ${JSON.stringify(path.join(prefix, 'ready'))} ]]; exit; fi`,
      `printf '%s\\n' "$*" >> ${JSON.stringify(delegated)}`,
      '',
    ].join('\n');
    const cliEncoded = Buffer.from(cliBody).toString('base64');
    writeExecutable(
      path.join(stubDir, 'npm'),
      [
        '#!/usr/bin/env bash',
        `if [[ "\${1:-} \${2:-}" == "prefix -g" ]]; then printf '%s\\n' ${JSON.stringify(prefix)}; exit 0; fi`,
        `mkdir -p ${JSON.stringify(path.dirname(cli))}`,
        `: > ${JSON.stringify(cli)}`,
        'sleep 0.05',
        `printf '%s' ${JSON.stringify(cliEncoded)} | base64 -d > ${JSON.stringify(cli)}`,
        'sleep 0.05',
        `chmod +x ${JSON.stringify(cli)}`,
        `touch ${JSON.stringify(path.join(prefix, 'help-fails'))}`,
        'sleep 0.15',
        `touch ${JSON.stringify(path.join(prefix, 'ready'))}`,
        'exit 0',
        '',
      ].join('\n'),
    );
    const env = baseEnv({ PATH: `${stubDir}:/usr/bin:/bin` });
    const processes = Array.from({ length: 4 }, (_unused, index) =>
      new Promise<{ status: number | null; stderr: string }>((resolve) => {
        const child = spawn('bash', [fixture.script, `parallel-${index}`], { cwd: fixture.root, env });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => (stderr += chunk));
        child.on('close', (status) => resolve({ status, stderr }));
      }),
    );

    const deadline = Date.now() + 3000;
    while (!fs.existsSync(path.join(prefix, 'help-fails')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(fs.existsSync(path.join(prefix, 'help-fails')), 'help失敗段階を観測できること');
    const optOut = run(fixture, { ...env, AGENT_SKILL_CHAIN_AUTO_INSTALL: '0' }, ['optout-during-partial']);
    assert.notEqual(optOut.status, 0);
    assert.match(optOut.stderr, /自動導入を行いません/u);

    const results = await Promise.all(processes);
    for (const result of results) {
      assert.ok(
        result.status === 0 || (result.status !== 0 && /agent-skill-chain CLI/u.test(result.stderr)),
        `並行プロセスが定義済み挙動へ収束すること: ${JSON.stringify(result)}`,
      );
    }
    const delegatedLines = fs.existsSync(delegated) ? fs.readFileSync(delegated, 'utf8').trim().split('\n') : [];
    assert.ok(delegatedLines.every((line) => !line.includes('optout-during-partial')));
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

test('adapterはsourceだけではCLI解決も自動導入も行わない', () => {
  const fixture = createWrapperFixture();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-adapter-source-'));
  const npmLog = path.join(fixture.root, 'npm.log');
  try {
    writeExecutable(path.join(stubDir, 'npm'), `#!/usr/bin/env bash\necho called >> ${JSON.stringify(npmLog)}\nexit 99\n`);
    for (const name of ['claude.sh', 'human.sh']) {
      const adapter = path.join(fixture.root, '.agent-skill-chain', 'adapters', name);
      const result = spawnSync(
        'bash',
        ['-c', 'set -euo pipefail; source "$1"; declare -F asc_resolve_cli >/dev/null; declare -F _asc_cli >/dev/null', '_', adapter],
        { cwd: fixture.root, env: baseEnv({ PATH: `${stubDir}:/usr/bin:/bin` }), encoding: 'utf8' },
      );
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    }
    assert.equal(fs.existsSync(npmLog), false);
  } finally {
    fixture.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('実CLIは第3経路の起動可能性検証が前提とする --help exit 0 を維持する', () => {
  const result = spawnSync('node', [path.join(packageRoot, 'bin', 'agents-md.js'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
