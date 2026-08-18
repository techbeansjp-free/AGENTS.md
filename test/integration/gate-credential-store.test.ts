import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setAdapter } from '../helpers/tmp-repo.js';
import { envWithout, readFinal, runLauncher, setupGateReview } from '../helpers/gate-launcher.js';

// Issue #758: 認証情報の所在3分類（分類A=環境変数トークン / 分類B=設定ディレクトリ配下の通常
// ファイル / 分類C=外部資格情報ストア限定）それぞれを対象とする、claude アダプタのゲートレビュア
// 起動経路の回帰テスト。実際の bash でアダプタを駆動し、実 API・実資格情報ストアへは触れない。
//
// 差し替えてよい実行系は SPEC.md が定める3つだけである。(i) 資格情報ストアへ問い合わせる
// コマンド（CLAUDE_CREDENTIAL_STORE_CMD）、(ii) 隔離環境の認証確認（CLAUDE_AUTH_PROBE_CMD）、
// (iii) レビュア実行系（GATE_REVIEWER_CMD）。分類の検出・取得可否の判定・認証ファイルの配置・
// 設定ディレクトリの決定と子プロセス環境の構成・復帰時の隔離領域削除は実経路のまま検証する。

/** 資格情報の実値。代替実行系のコマンド文字列・引数・環境変数へは置かず、必ずファイル経由で扱う。 */
const CREDENTIAL_TEXT = '{"claudeAiOauth":{"accessToken":"issue758-store-credential-value"}}';
const TOKEN_TEXT = 'issue758-env-token-value';
const CLASS_B_TEXT = '{"claudeAiOauth":{"accessToken":"issue758-class-b-credential-value"}}';
const STORE_STDERR_MARKER = 'issue758-store-stderr-marker-must-not-reach-caller';
const VERDICT = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
const ISOLATED_ROOT_RE = /^\/tmp\/agent-skill-chain-reviewer\.[^/]+$/;

interface Workspace {
  dir: string;
  callerHome: string;
  callerConfig: string;
  observation: string;
  credentialFile: string;
  tokenFile: string;
  classBFile: string;
}

/** 呼び出し元ホーム・呼び出し元設定ディレクトリ・観測用ディレクトリ・期待値ファイルを用意する。 */
function createWorkspace(prefix: string): Workspace {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const callerHome = path.join(dir, 'caller-home');
  const callerConfig = path.join(callerHome, '.claude');
  const observation = path.join(dir, 'observation');
  fs.mkdirSync(callerConfig, { recursive: true });
  fs.mkdirSync(observation, { recursive: true });
  const credentialFile = path.join(dir, 'store-credential.json');
  const tokenFile = path.join(dir, 'expected-token.txt');
  const classBFile = path.join(dir, 'expected-class-b.json');
  fs.writeFileSync(credentialFile, CREDENTIAL_TEXT, 'utf8');
  fs.writeFileSync(tokenFile, TOKEN_TEXT, 'utf8');
  fs.writeFileSync(classBFile, CLASS_B_TEXT, 'utf8');
  return { dir, callerHome, callerConfig, observation, credentialFile, tokenFile, classBFile };
}

type StoreMode = 'success' | 'failure' | 'hang';

/**
 * 資格情報ストアへ問い合わせるコマンドの代替。自身の起動列・環境変数・標準出力と標準エラーの
 * 接続先を隔離設定ディレクトリ外の観測先へ記録したうえで、資格情報テキストをファイルから
 * 標準出力へ流す（実値をコマンド引数にも環境変数にも置かない）。
 */
function createStoreStub(ws: Workspace, mode: StoreMode): string {
  const stub = path.join(ws.dir, `store-stub-${mode}`);
  const argvLog = path.join(ws.observation, 'store-argv.log');
  const envLog = path.join(ws.observation, 'store-env.log');
  const fdLog = path.join(ws.observation, 'store-fd.log');
  const invokedLog = path.join(ws.observation, 'store-invoked.log');
  const body = [
    '#!/bin/bash',
    // 記録用の複製を先に作る。記録の書き出しでリダイレクトすると本来の接続先を観測できないため、
    // 観測対象は複製した fd 3（標準出力）と fd 4（標準エラー）とする。
    'exec 3>&1 4>&2',
    `printf 'invoked\\n' >> ${JSON.stringify(invokedLog)}`,
    `{ printf 'argv0=%s\\n' "$0"; printf 'argc=%s\\n' "$#"; for a in "$@"; do printf 'arg=%s\\n' "$a"; done; } > ${JSON.stringify(argvLog)}`,
    `/usr/bin/env > ${JSON.stringify(envLog)}`,
    '{',
    `  printf 'fd1_path=%s\\n' "$(readlink /proc/self/fd/3 2>/dev/null || printf unresolved)"`,
    `  if [ -f /dev/fd/3 ]; then printf 'fd1_is_regular_file=yes\\n'; else printf 'fd1_is_regular_file=no\\n'; fi`,
    `  if [ /dev/fd/4 -ef /dev/null ]; then printf 'fd2_is_devnull=yes\\n'; else printf 'fd2_is_devnull=no\\n'; fi`,
    `} > ${JSON.stringify(fdLog)}`,
    'exec 3>&- 4>&-',
    // 資格情報ストア由来の診断を標準エラーへ出す実装を模す。実値を含めることで、破棄されずに
    // 呼び出し元へ到達する実装なら検出できるようにする。
    `printf '%s %s\\n' ${JSON.stringify(STORE_STDERR_MARKER)} "$(cat ${JSON.stringify(ws.credentialFile)})" >&2`,
  ];
  if (mode === 'success') {
    body.push(`exec cat ${JSON.stringify(ws.credentialFile)}`);
  } else if (mode === 'failure') {
    body.push('exit 7');
  } else {
    // 打ち切りまでに部分的な内容が認証ファイルへ書かれる状況を作ったうえで応答しない。
    body.push(`printf '%s' '{"claudeAiOauth":{"accessToken":"issue758-store-credential-value'`);
    body.push('exec sleep 120');
  }
  fs.writeFileSync(stub, `${body.join('\n')}\n`, { mode: 0o755 });
  return stub;
}

/** 起動事実だけを記録して失敗する取得コマンドの代替（分類A・分類Bで非問い合わせを確かめる）。 */
function createRecordingStoreStub(ws: Workspace): string {
  const stub = path.join(ws.dir, 'store-stub-recording');
  const invokedLog = path.join(ws.observation, 'store-invoked.log');
  fs.writeFileSync(stub, `#!/bin/bash\nprintf 'invoked\\n' >> ${JSON.stringify(invokedLog)}\nexit 1\n`, { mode: 0o755 });
  return stub;
}

/**
 * レビュア実行系の代替。隔離サブプロセス内で自身の環境変数名と値・隔離領域の権限・設定
 * ディレクトリの内容を隔離領域内のファイルへ記録し、そのファイルを観測先へ複製してから
 * verdict を返す。呼び出し元の標準出力・標準エラーへは何も出さない（標準出力は verdict 専用）。
 */
function reviewerRecordingCommand(ws: Workspace): string {
  const envLog = path.join(ws.observation, 'reviewer-env.log');
  const permLog = path.join(ws.observation, 'reviewer-perm.log');
  const listLog = path.join(ws.observation, 'reviewer-config-listing.log');
  const homeLog = path.join(ws.observation, 'reviewer-home.log');
  return [
    'cat >/dev/null',
    '/usr/bin/env > ../reviewer-env-record',
    '/bin/ls -ld "${CLAUDE_CONFIG_DIR}/../.." "${CLAUDE_CONFIG_DIR}" "${CLAUDE_CONFIG_DIR}/.credentials.json" > ../reviewer-perm-record 2>&1',
    '/bin/ls -A "${CLAUDE_CONFIG_DIR}" > ../reviewer-config-listing-record 2>&1',
    `printf '%s\\n' "\${HOME}" > ../reviewer-home-record`,
    `/bin/cp ../reviewer-env-record ${JSON.stringify(envLog)}`,
    `/bin/cp ../reviewer-perm-record ${JSON.stringify(permLog)}`,
    `/bin/cp ../reviewer-config-listing-record ${JSON.stringify(listLog)}`,
    `/bin/cp ../reviewer-home-record ${JSON.stringify(homeLog)}`,
    `printf '%s' '${VERDICT}'`,
  ].join('; ');
}

/** 隔離設定ディレクトリの認証ファイルと期待値ファイルを照合する認証確認の代替。 */
function credentialFileProbe(expectedFile: string): string {
  return `/usr/bin/cmp -s "\${CLAUDE_CONFIG_DIR}/.credentials.json" ${JSON.stringify(expectedFile)}`;
}

/** 隔離サブプロセスへ引き継がれた環境変数トークンと期待値ファイルを照合する認証確認の代替。 */
function envTokenProbe(variable: string, expectedFile: string): string {
  return `printf '%s' "\${${variable}:-}" | /usr/bin/cmp -s - ${JSON.stringify(expectedFile)}`;
}

/** 認証確認の代替が観測した HOME から隔離領域のパスを求める。 */
function isolatedRootFrom(homeLogPath: string): string {
  const home = fs.readFileSync(homeLogPath, 'utf8').trim();
  assert.match(home, /^\/tmp\/agent-skill-chain-reviewer\.[^/]+\/home$/, `隔離HOMEを観測できること: ${home}`);
  return path.dirname(home);
}

function readObservation(ws: Workspace, name: string): string {
  return fs.readFileSync(path.join(ws.observation, name), 'utf8');
}

/** 本リポジトリの claude アダプタ原文。実装上の禁止事項（実値を変数・引数・分岐へ渡さない等）は
 * 挙動として観測できないため、原文を検査対象にする。 */
function adapterSource(): string {
  return fs.readFileSync(new URL('../../.agent-skill-chain/adapters/claude.sh', import.meta.url), 'utf8');
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} が見つかること`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} の終端が見つかること`);
  return source.slice(start, end);
}

// --- PLAN #6: 分類C成立の回帰テスト（AC-2） -------------------------------------------

test('claude gate reviewer: 資格情報ストア限定構成（分類C）で隔離設定ディレクトリへ資格情報を配置し verdict を返す（Issue #758 AC-2）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-class-c-success');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'success'),
    CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
    GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  // 隔離設定ディレクトリの内容が取得結果と一致していたことは、認証確認の代替が成功したことと、
  // レビュアが実際に起動して verdict を返したことの両方で確認できる。
  assert.equal(readObservation(ws, 'reviewer-config-listing.log').trim(), '.credentials.json');
  assert.ok(fs.existsSync(path.join(ws.observation, 'store-invoked.log')), '資格情報ストアへ問い合わせること');
});

// --- PLAN #7: 分類A・分類Bの回帰テストと非問い合わせ検証（AC-9 / AC-11） ---------------

test('claude gate reviewer: 分類A（環境変数トークン）は資格情報ストアへ問い合わせず verdict を返す（Issue #758 AC-9 / AC-11）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-class-a');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    ANTHROPIC_API_KEY: TOKEN_TEXT,
    CLAUDE_CREDENTIAL_STORE_CMD: createRecordingStoreStub(ws),
    CLAUDE_AUTH_PROBE_CMD: envTokenProbe('ANTHROPIC_API_KEY', ws.tokenFile),
    GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  assert.equal(
    fs.existsSync(path.join(ws.observation, 'store-invoked.log')),
    false,
    '分類Aが成立する構成では資格情報ストアへ問い合わせないこと',
  );
  const reviewerEnv = readObservation(ws, 'reviewer-env.log');
  assert.match(reviewerEnv, /^ANTHROPIC_API_KEY=/m);
});

test('claude gate reviewer: 分類B（設定ディレクトリの通常ファイル）は資格情報ストアへ問い合わせず verdict を返す（Issue #758 AC-9 / AC-11）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-class-b');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');
  fs.writeFileSync(path.join(ws.callerConfig, '.credentials.json'), CLASS_B_TEXT, 'utf8');

  const env = envWithout([], {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    CLAUDE_CREDENTIAL_STORE_CMD: createRecordingStoreStub(ws),
    CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.classBFile),
    GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  assert.equal(
    fs.existsSync(path.join(ws.observation, 'store-invoked.log')),
    false,
    '分類Bが成立する構成では資格情報ストアへ問い合わせないこと',
  );
  // 分類Bの複製は取得ステップの削除対象ではない。隔離設定ディレクトリに残っていること自体が、
  // 取得側が他者の配置した認証ファイルへ触れていないことを示す。
  assert.equal(readObservation(ws, 'reviewer-config-listing.log').trim(), '.credentials.json');
});

// --- PLAN #8: 設定ディレクトリと環境変数集合の検証（AC-1 / AC-4） -----------------------

test('claude gate reviewer: 3分類いずれでも設定ディレクトリが隔離領域内を指す（Issue #758 AC-1）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-config-dir');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const base: NodeJS.ProcessEnv = {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  };
  const configurations: { name: string; env: NodeJS.ProcessEnv; before?: () => void }[] = [
    {
      name: '分類A',
      env: {
        ...base,
        ANTHROPIC_API_KEY: TOKEN_TEXT,
        CLAUDE_CREDENTIAL_STORE_CMD: createRecordingStoreStub(ws),
        CLAUDE_AUTH_PROBE_CMD: envTokenProbe('ANTHROPIC_API_KEY', ws.tokenFile),
      },
    },
    {
      name: '分類B',
      env: {
        ...base,
        CLAUDE_CREDENTIAL_STORE_CMD: createRecordingStoreStub(ws),
        CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.classBFile),
      },
      before: () => fs.writeFileSync(path.join(ws.callerConfig, '.credentials.json'), CLASS_B_TEXT, 'utf8'),
    },
    {
      name: '分類C',
      env: {
        ...base,
        CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'success'),
        CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
      },
      before: () => fs.rmSync(path.join(ws.callerConfig, '.credentials.json'), { force: true }),
    },
  ];

  for (const configuration of configurations) {
    configuration.before?.();
    const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], envWithout([], configuration.env));
    assert.equal(res.status, 0, `${configuration.name}: ${res.stderr}`);
    const reviewerEnv = readObservation(ws, 'reviewer-env.log');
    const configDir = /^CLAUDE_CONFIG_DIR=(.*)$/m.exec(reviewerEnv)?.[1] ?? '';
    assert.match(configDir, /^\/tmp\/agent-skill-chain-reviewer\.[^/]+\/auth\/claude$/, configuration.name);
    assert.notEqual(configDir, ws.callerConfig, configuration.name);
    assert.equal(configDir.startsWith(`${ws.callerHome}/`), false, configuration.name);
  }
});

test('claude gate reviewer: 分類C構成でも子プロセスの環境変数集合が基底集合と許容集合だけになる（Issue #758 AC-4）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-env-set');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'success'),
    CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
    GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
  assert.equal(res.status, 0, res.stderr);

  const reviewerEnv = readObservation(ws, 'reviewer-env.log');
  const names = reviewerEnv
    .split('\n')
    .map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
  const required = [
    'PATH', 'HOME', 'XDG_CONFIG_HOME', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
    'GIT_TERMINAL_PROMPT', 'TMPDIR', 'LANG', 'LC_ALL', 'CLAUDE_CONFIG_DIR',
  ];
  // シェルが自身の起動に伴い設定する変数だけを追加許容する。上書き用の変数は隔離サブプロセスの
  // 環境変数として渡らないため、上書きの有無で集合は変わらない。
  const allowedExtra = ['PWD', 'SHLVL', '_'];
  for (const name of required) assert.ok(names.includes(name), `必須集合の ${name} が存在すること`);
  for (const name of names) {
    assert.ok(required.includes(name) || allowedExtra.includes(name), `列挙外の環境変数が存在しないこと: ${name}`);
  }
  const home = /^HOME=(.*)$/m.exec(reviewerEnv)?.[1] ?? '';
  assert.match(home, /^\/tmp\/agent-skill-chain-reviewer\.[^/]+\/home$/);
  assert.notEqual(home, ws.callerHome);
  assert.doesNotMatch(reviewerEnv, new RegExp('issue758-store-credential-value'));
  assert.doesNotMatch(reviewerEnv, new RegExp('CLAUDE_CREDENTIAL_STORE_CMD'));
});

// --- PLAN #9: 隔離設定ディレクトリの内容限定と呼び出し元副作用の検証（AC-5 / AC-7） -----

test('claude gate reviewer: 分類C構成で隔離設定ディレクトリが認証要素のみになり呼び出し元へ副作用を残さない（Issue #758 AC-5 / AC-7）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-config-contents');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  fs.writeFileSync(path.join(ws.callerConfig, 'settings.json'), '{"hooks":{"PreToolUse":[]}}\n', 'utf8');
  fs.writeFileSync(path.join(ws.callerConfig, 'settings.local.json'), '{"permissions":{"allow":["Bash"]}}\n', 'utf8');
  fs.writeFileSync(path.join(ws.callerConfig, '.mcp.json'), '{"mcpServers":{"demo":{"command":"demo"}}}\n', 'utf8');
  fs.mkdirSync(path.join(ws.callerConfig, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(ws.callerConfig, 'hooks', 'pretooluse.sh'), '#!/bin/bash\nexit 0\n', 'utf8');

  const snapshot = (root: string): string =>
    fs
      .readdirSync(root, { recursive: true, withFileTypes: false })
      .map((entry) => String(entry))
      .sort()
      .map((rel) => `${rel} ${fs.statSync(path.join(root, rel)).mtimeMs}`)
      .join('\n');
  const before = snapshot(ws.callerHome);

  const env = envWithout([], {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'success'),
    CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
    GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readObservation(ws, 'reviewer-config-listing.log').trim(), '.credentials.json');
  assert.equal(snapshot(ws.callerHome), before, '呼び出し元ホーム・設定ディレクトリの内容と更新時刻が変わらないこと');
});

// --- PLAN #10: 権限と残存の検証（AC-6 / AC-12 / AC-13） --------------------------------

test('claude gate reviewer: 分類Cの資格情報が0600で作られ正常終了後に隔離領域ごと消える（Issue #758 AC-6）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-permissions');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'success'),
    CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
    GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  const perms = readObservation(ws, 'reviewer-perm.log').trim().split('\n');
  assert.equal(perms.length, 3);
  assert.match(perms[0], /^drwx------/, '隔離領域が0700であること');
  assert.match(perms[1], /^drwx------/, '隔離設定ディレクトリが0700であること');
  assert.match(perms[2], /^-rw-------/, '配置した資格情報が0600であること');
  const isolatedRoot = isolatedRootFrom(path.join(ws.observation, 'reviewer-home.log'));
  assert.match(isolatedRoot, ISOLATED_ROOT_RE);
  assert.equal(fs.existsSync(isolatedRoot), false, '正常終了後は隔離領域が残らないこと');
});

test('claude gate reviewer: 取得できても認証確認が不成立なら複製を残さず診断して human_required へ倒す（Issue #758 AC-12）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-probe-failure');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const homeLog = path.join(ws.observation, 'probe-home.log');
  const env = envWithout([], {
    HOME: ws.callerHome,
    CLAUDE_CONFIG_DIR: ws.callerConfig,
    CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'success'),
    // 取得は成功するが、その資格情報では認証が成立しない構成。
    CLAUDE_AUTH_PROBE_CMD: `printf '%s\\n' "\${HOME}" > ${JSON.stringify(homeLog)}; exit 1`,
    GATE_REVIEWER_CMD: `touch ${JSON.stringify(path.join(ws.observation, 'reviewer-invoked'))}`,
    GATE_REVIEWER_RETRIES: '3',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.equal(fs.existsSync(path.join(ws.observation, 'reviewer-invoked')), false, '認証不成立ではレビュアを起動しないこと');
  assert.match(res.stderr, /外部資格情報ストア: 資格情報を取得して隔離設定ディレクトリへ配置しました/);
  assert.match(res.stderr, /持ち込み可能な認証情報は検出されましたが、隔離環境の認証probeが失敗/);
  assert.doesNotMatch(res.stderr, new RegExp('issue758-store-credential-value'));
  const isolatedRoot = isolatedRootFrom(homeLog);
  assert.equal(fs.existsSync(isolatedRoot), false, '認証不成立でも隔離領域が残らないこと');
});

test('claude gate reviewer: 取得の時間上限・レビュアの時間上限のいずれでも複製を残さず human_required へ倒す（Issue #758 AC-13）', async (t) => {
  const ws = createWorkspace('issue758-timeouts');
  t.after(() => fs.rmSync(ws.dir, { recursive: true, force: true }));

  // 構成(c): 取得が時間上限内に完了しない。打ち切りまでに部分的な内容が書かれる代替を使う。
  const storeTimeout = setupGateReview();
  t.after(() => storeTimeout.repo.cleanup());
  setAdapter(storeTimeout.repo.dir, 'claude');
  const probeHomeLog = path.join(ws.observation, 'probe-home.log');
  const storeTimeoutRes = runLauncher(
    storeTimeout.repo.dir,
    ['ISSUE-1', 'spec', 'standard', storeTimeout.reportPath, storeTimeout.targetSha],
    envWithout([], {
      HOME: ws.callerHome,
      CLAUDE_CONFIG_DIR: ws.callerConfig,
      CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'hang'),
      CLAUDE_CREDENTIAL_STORE_TIMEOUT_SEC: '1',
      CLAUDE_AUTH_PROBE_CMD: `printf '%s\\n' "\${HOME}" > ${JSON.stringify(probeHomeLog)}; ${credentialFileProbe(ws.credentialFile)}`,
      GATE_REVIEWER_CMD: `touch ${JSON.stringify(path.join(ws.observation, 'reviewer-invoked'))}`,
      GATE_REVIEWER_RETRIES: '1',
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    }),
  );
  assert.notEqual(storeTimeoutRes.status, 0);
  assert.equal(readFinal(storeTimeout.reportPath), 'human_required');
  assert.match(storeTimeoutRes.stderr, /外部資格情報ストア: 取得が時間上限内に完了しなかったため打ち切りました/);
  assert.doesNotMatch(storeTimeoutRes.stderr, new RegExp('issue758-store-credential-value'));
  const storeTimeoutRoot = isolatedRootFrom(probeHomeLog);
  assert.equal(fs.existsSync(storeTimeoutRoot), false, '取得の時間上限超過でも隔離領域が残らないこと');

  // 構成(a): レビュアが時間上限内に応答しない。分類Cの資格情報は配置済みの状態から入る。
  const reviewerTimeout = setupGateReview();
  t.after(() => reviewerTimeout.repo.cleanup());
  setAdapter(reviewerTimeout.repo.dir, 'claude');
  const reviewerHomeLog = path.join(ws.observation, 'reviewer-timeout-home.log');
  const reviewerTimeoutRes = runLauncher(
    reviewerTimeout.repo.dir,
    ['ISSUE-1', 'spec', 'standard', reviewerTimeout.reportPath, reviewerTimeout.targetSha],
    envWithout([], {
      HOME: ws.callerHome,
      CLAUDE_CONFIG_DIR: ws.callerConfig,
      CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'success'),
      CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
      GATE_REVIEWER_CMD: `cat >/dev/null; printf '%s\\n' "\${HOME}" > ${JSON.stringify(reviewerHomeLog)}; while :; do :; done`,
      GATE_REVIEWER_TIMEOUT_SEC: '1',
      GATE_REVIEWER_RETRIES: '1',
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    }),
  );
  assert.notEqual(reviewerTimeoutRes.status, 0);
  assert.equal(readFinal(reviewerTimeout.reportPath), 'human_required');
  const reviewerTimeoutRoot = isolatedRootFrom(reviewerHomeLog);
  assert.equal(fs.existsSync(reviewerTimeoutRoot), false, 'レビュアの時間上限超過でも隔離領域が残らないこと');
});

test('claude gate reviewer: 監視プロセス起動失敗の復帰経路でも隔離領域を削除する（Issue #758 AC-13 構成(b)）', () => {
  // 構成(b) は隔離領域を作れたうえで watchdog だけが起動できない状態を要求する。呼び出し元から
  // 到達可能な入力（環境変数・引数）でこの状態を作れないため、復帰経路の記述そのものを検査する。
  // 当該経路は Issue #691 で導入され本 Issue では変更しないが、分類Cの資格情報が配置され得る
  // 経路になったため、削除が残っていることを固定する。
  const source = adapterSource();
  const runner = extractFunction(source, '_run_reviewer_sanitized');
  const watchdogFailures = runner
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /watchdogを(起動|準備)できない/.test(line));
  assert.equal(watchdogFailures.length, 2, 'watchdog失敗の復帰経路が2つあること');
  const lines = runner.split('\n');
  for (const { index } of watchdogFailures) {
    const preceding = lines.slice(Math.max(0, index - 6), index).join('\n');
    assert.match(preceding, /\/bin\/rm -rf -- "\$isolated_root"/, '復帰前に隔離領域を削除すること');
  }
  const stage = extractFunction(source, '_claude_credential_store_stage');
  const stageWatchdogFailures = stage.split('\n').filter((line) => /ASC_CREDENTIAL_STORE_STATE='command_failed'/.test(line));
  assert.ok(stageWatchdogFailures.length >= 3, '取得側の監視プロセス失敗も command_failed として扱うこと');
});

// --- PLAN #11: 実値非露出の検証（AC-8） -----------------------------------------------

test('claude gate reviewer: 成功・取得失敗・時間上限・認証不成立のいずれでも資格情報の実値が禁止経路へ出ない（Issue #758 AC-8）', async (t) => {
  const configurations: { name: string; store: StoreMode; probeFails: boolean; storeTimeoutSec?: string }[] = [
    { name: '構成1 取得・配置・認証確認が成功', store: 'success', probeFails: false },
    { name: '構成2 取得が失敗', store: 'failure', probeFails: true },
    { name: '構成3 取得が時間上限内に完了しない', store: 'hang', probeFails: true, storeTimeoutSec: '1' },
    { name: '構成4 取得は成功するが認証確認が不成立', store: 'success', probeFails: true },
  ];

  for (const configuration of configurations) {
    const { repo, reportPath, targetSha } = setupGateReview();
    const ws = createWorkspace('issue758-no-leak');
    t.after(() => {
      repo.cleanup();
      fs.rmSync(ws.dir, { recursive: true, force: true });
    });
    setAdapter(repo.dir, 'claude');

    const env = envWithout([], {
      HOME: ws.callerHome,
      CLAUDE_CONFIG_DIR: ws.callerConfig,
      CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, configuration.store),
      ...(configuration.storeTimeoutSec ? { CLAUDE_CREDENTIAL_STORE_TIMEOUT_SEC: configuration.storeTimeoutSec } : {}),
      CLAUDE_AUTH_PROBE_CMD: configuration.probeFails ? 'exit 1' : credentialFileProbe(ws.credentialFile),
      GATE_REVIEWER_CMD: reviewerRecordingCommand(ws),
      GATE_REVIEWER_RETRIES: '1',
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    });
    const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

    const collected = [
      res.stdout,
      res.stderr,
      readObservation(ws, 'store-argv.log'),
      readObservation(ws, 'store-env.log'),
      fs.existsSync(path.join(ws.observation, 'reviewer-env.log')) ? readObservation(ws, 'reviewer-env.log') : '',
    ].join('\n');
    assert.doesNotMatch(collected, new RegExp('issue758-store-credential-value'), `${configuration.name}: 実値が現れないこと`);
    assert.doesNotMatch(collected, new RegExp(STORE_STDERR_MARKER), `${configuration.name}: 取得ステップの標準エラーが到達しないこと`);

    const fdLog = readObservation(ws, 'store-fd.log');
    assert.match(fdLog, /fd1_is_regular_file=yes/, `${configuration.name}: 取得ステップの標準出力が通常ファイルへ接続されること`);
    assert.match(fdLog, /fd2_is_devnull=yes/, `${configuration.name}: 取得ステップの標準エラーが破棄されること`);
    const fd1Path = /fd1_path=(.*)/.exec(fdLog)?.[1] ?? '';
    if (fd1Path !== 'unresolved') {
      assert.match(
        fd1Path,
        /^\/tmp\/agent-skill-chain-reviewer\.[^/]+\/auth\/claude\/\.credentials\.json$/,
        `${configuration.name}: 取得ステップの標準出力の接続先が隔離設定ディレクトリの認証ファイルだけであること`,
      );
    }
    const argvLog = readObservation(ws, 'store-argv.log');
    assert.match(argvLog, /^argc=0$/m, `${configuration.name}: 実値を取得ステップの引数へ置かないこと`);
  }
});

test('claude gate reviewer: 取得と配置が実値を変数・引数・分岐へ渡さない実装であること（Issue #758 AC-8）', () => {
  const source = adapterSource();
  const stage = extractFunction(source, '_claude_credential_store_stage');
  // 実値の流路は「取得コマンドの標準出力 → 隔離設定ディレクトリの認証ファイル」の1本だけとする。
  assert.match(stage, /exec \/bin\/bash -c "\$store_cmd" >"\$target" 2>\/dev\/null/);
  assert.doesNotMatch(stage, /tee/);
  assert.doesNotMatch(stage, /\$\([^)]*store_cmd[^)]*\)/, '取得結果をコマンド置換で変数へ取り込まないこと');
  assert.doesNotMatch(stage, /"\$store_cmd"[^\n]*\|/, '取得結果をパイプで分岐させないこと');
  assert.doesNotMatch(stage, /export /, '実値を保持する環境変数を作らないこと');
  const structure = extractFunction(source, '_claude_credential_structure_ok');
  assert.match(structure, />\/dev\/null 2>&1/, '構造検査は内容を出力しないこと');
});

// --- PLAN #12: 診断内容の検証（AC-3） -------------------------------------------------

test('claude gate reviewer: 認証情報を用意できない場合に分類ごとの検出結果と設定ディレクトリの扱いを診断する（Issue #758 AC-3）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-diagnostics');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  // 3分類のいずれからも用意できない構成（取得手段そのものを解決できない）。
  const unavailable = runLauncher(
    repo.dir,
    ['ISSUE-1', 'spec', 'standard', reportPath, targetSha],
    envWithout([], {
      HOME: ws.callerHome,
      CLAUDE_CONFIG_DIR: ws.callerConfig,
      CLAUDE_CREDENTIAL_STORE_CMD: '',
      CLAUDE_AUTH_PROBE_CMD: 'exit 1',
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    }),
  );
  assert.notEqual(unavailable.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(unavailable.stderr, /環境変数による資格情報: ANTHROPIC_API_KEYとCLAUDE_CODE_OAUTH_TOKENは未設定/);
  assert.match(unavailable.stderr, /設定ディレクトリ配下のログイン情報: 隔離領域へ複製可能な通常ファイルが見つかりません/);
  assert.match(unavailable.stderr, /外部資格情報ストア: 取得手段を解決できません/);
  assert.match(unavailable.stderr, /設定ディレクトリの扱い: CLAUDE_CONFIG_DIRは常に隔離領域内の制御されたパスを指し/);
  assert.doesNotMatch(unavailable.stderr, new RegExp(ws.callerHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // 取得が時間上限内に完了しない構成。
  const timedOut = runLauncher(
    repo.dir,
    ['ISSUE-1', 'spec', 'standard', reportPath, targetSha],
    envWithout([], {
      HOME: ws.callerHome,
      CLAUDE_CONFIG_DIR: ws.callerConfig,
      CLAUDE_CREDENTIAL_STORE_CMD: createStoreStub(ws, 'hang'),
      CLAUDE_CREDENTIAL_STORE_TIMEOUT_SEC: '1',
      CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    }),
  );
  assert.notEqual(timedOut.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(timedOut.stderr, /外部資格情報ストア: 取得が時間上限内に完了しなかったため打ち切りました/);
  assert.match(timedOut.stderr, /設定ディレクトリの扱い: CLAUDE_CONFIG_DIRは常に隔離領域内の制御されたパスを指し/);
  assert.doesNotMatch(timedOut.stderr, new RegExp('issue758-store-credential-value'));
});

test('claude gate reviewer: 認証確認の成立後に取得が失敗した経路でも原因を診断へ出す（Issue #758 AC-3）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const ws = createWorkspace('issue758-second-stage');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(ws.dir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  // 隔離サブプロセスの構成は1回のゲートレビュア起動につき2回行われる（1回目=認証確認、
  // 2回目=レビュア本体）。1回目で取得できた後、2回目の取得だけが失敗する状態を、起動回数で
  // 挙動を変える代替で作る。この経路は認証確認を通過しているため認証不成立の診断が出ず、
  // 取得側の診断が無ければ原因を特定できない。
  const counter = path.join(ws.observation, 'store-attempts');
  const storeStub = path.join(ws.dir, 'store-stub-second-fails');
  fs.writeFileSync(
    storeStub,
    [
      '#!/bin/bash',
      `printf 'x' >> ${JSON.stringify(counter)}`,
      `attempts="$(/usr/bin/wc -c < ${JSON.stringify(counter)} | /usr/bin/tr -d ' ')"`,
      'if [ "$attempts" = "1" ]; then',
      `  exec cat ${JSON.stringify(ws.credentialFile)}`,
      'fi',
      'exit 9',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const res = runLauncher(
    repo.dir,
    ['ISSUE-1', 'spec', 'standard', reportPath, targetSha],
    envWithout([], {
      HOME: ws.callerHome,
      CLAUDE_CONFIG_DIR: ws.callerConfig,
      CLAUDE_CREDENTIAL_STORE_CMD: storeStub,
      CLAUDE_AUTH_PROBE_CMD: credentialFileProbe(ws.credentialFile),
      GATE_REVIEWER_CMD: 'cat >/dev/null; exit 1',
      GATE_REVIEWER_RETRIES: '1',
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    }),
  );

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /分類C（外部資格情報ストア）の資格情報を隔離設定ディレクトリへ用意できませんでした/);
  assert.match(res.stderr, /外部資格情報ストア: 取得コマンドが失敗したか出力が空でした/);
  assert.doesNotMatch(res.stderr, new RegExp('issue758-store-credential-value'));
});
