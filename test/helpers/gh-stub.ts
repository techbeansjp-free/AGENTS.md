import fs from 'node:fs';
import path from 'node:path';

// gh CLI の代替スタブ本体。tmp bin dir へ実行可能ファイル `gh` として書き出す。
// 拡張子なし・shebang実行のため、配置先に package.json が無いことを前提に CommonJS で書く
// （Node は package.json が見つからない場合スクリプトを CommonJS として扱う）。
const GH_STUB_SCRIPT = `#!/usr/bin/env node
const fs = require('fs');

const statePath = process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
const args = process.argv.slice(2);

function loadState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}
function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const [cmd, sub] = args;

if (cmd === 'auth' && sub === 'status') {
  process.exit(0);
}

if (cmd === 'label' && sub === 'create') {
  const name = args[2];
  const state = loadState();
  state.labels = state.labels || [];
  state.labels.push(name);
  saveState(state);
  process.stdout.write(name + '\\n');
  process.exit(0);
}

if (cmd === 'issue' && sub === 'comment') {
  const issueNumber = args[2];
  const body = flag('--body') ?? '';
  const state = loadState();
  const id = state.nextId++;
  state.comments[issueNumber] = state.comments[issueNumber] || [];
  state.comments[issueNumber].push({
    id: String(id),
    url: 'https://github.com/test/repo/issues/' + issueNumber + '#issuecomment-' + id,
    body,
    createdAt: new Date(state.clock).toISOString(),
  });
  state.clock += 1000;
  saveState(state);
  process.stdout.write('https://github.com/test/repo/issues/' + issueNumber + '#issuecomment-' + id + '\\n');
  process.exit(0);
}

if (cmd === 'issue' && sub === 'view') {
  const issueNumber = args[2];
  const state = loadState();
  const comments = state.comments[issueNumber] || [];
  process.stdout.write(JSON.stringify({ comments }));
  process.exit(0);
}

if (cmd === 'pr' && sub === 'create') {
  process.stdout.write('https://github.com/test/repo/pull/1\\n');
  process.exit(0);
}

if (cmd === 'pr' && sub === 'list') {
  const head = flag('--head');
  const state = loadState();
  const prs = (state.prs || {})[head] || [];
  process.stdout.write(JSON.stringify(prs));
  process.exit(0);
}

if (cmd === 'api') {
  let method = 'GET';
  let i = 1;
  if (args[i] === '-X') {
    method = args[i + 1];
    i += 2;
  }
  const apiPath = args[i];
  const hasInput = args.includes('--input');
  const body = hasInput ? readStdin() : '';
  const state = loadState();

  const commentDeleteMatch = /\\/issues\\/comments\\/(\\d+)$/.exec(apiPath || '');
  if (commentDeleteMatch && method === 'DELETE') {
    const id = commentDeleteMatch[1];
    for (const key of Object.keys(state.comments)) {
      state.comments[key] = state.comments[key].filter((c) => c.id !== id);
    }
    saveState(state);
    process.exit(0);
  }

  if (/\\/rulesets$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify(state.rulesets || []));
    process.exit(0);
  }

  if (/\\/rulesets$/.test(apiPath || '') && method === 'POST') {
    const parsed = JSON.parse(body);
    const id = state.nextId++;
    const record = Object.assign({ id }, parsed);
    state.rulesets = state.rulesets || [];
    state.rulesets.push(record);
    saveState(state);
    process.stdout.write(JSON.stringify(record));
    process.exit(0);
  }

  const rulesetUpdateMatch = /\\/rulesets\\/(\\d+)$/.exec(apiPath || '');
  if (rulesetUpdateMatch && method === 'PUT') {
    const id = Number(rulesetUpdateMatch[1]);
    const parsed = JSON.parse(body);
    state.rulesets = (state.rulesets || []).map((r) => (r.id === id ? Object.assign({ id }, parsed) : r));
    saveState(state);
    process.stdout.write(JSON.stringify(Object.assign({ id }, parsed)));
    process.exit(0);
  }

  if (/\\/check-runs$/.test(apiPath || '') && method === 'POST') {
    const parsed = JSON.parse(body);
    const id = state.nextId++;
    state.checkRuns = state.checkRuns || [];
    state.checkRuns.push(Object.assign({ id }, parsed));
    saveState(state);
    process.stdout.write(JSON.stringify({ id, html_url: 'https://github.com/test/repo/runs/' + id }));
    process.exit(0);
  }

  process.stderr.write('gh-stub: unhandled api call: ' + method + ' ' + apiPath + '\\n');
  process.exit(1);
}

process.stderr.write('gh-stub: unhandled command: ' + args.join(' ') + '\\n');
process.exit(1);
`;

export interface GhStubState {
  nextId: number;
  clock: number;
  comments: Record<string, { id: string; url: string; body: string; createdAt: string }[]>;
  rulesets: unknown[];
  prs: Record<string, unknown[]>;
  labels: string[];
}

export interface GhStub {
  binDir: string;
  statePath: string;
  env(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  readState(): GhStubState;
  writeState(state: GhStubState): void;
  seedPrList(branch: string, prs: unknown[]): void;
}

/**
 * PATH注入で `gh` を差し替える最小スタブ。label create / issue comment・view /
 * pr create・list / api（rulesets・check-runs・comment DELETE）を状態ファイル（JSON）越しに
 * ステートフルに模擬する。実際の GitHub API・ネットワークへは一切アクセスしない。
 */
export function createGhStub(baseDir: string): GhStub {
  const binDir = path.join(baseDir, 'gh-stub-bin');
  fs.mkdirSync(binDir, { recursive: true });
  const statePath = path.join(baseDir, 'gh-stub-state.json');
  const initialState: GhStubState = { nextId: 1, clock: 1700000000000, comments: {}, rulesets: [], prs: {}, labels: [] };
  fs.writeFileSync(statePath, JSON.stringify(initialState));

  const scriptPath = path.join(binDir, 'gh');
  fs.writeFileSync(scriptPath, GH_STUB_SCRIPT, { mode: 0o755 });

  return {
    binDir,
    statePath,
    env(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
      return { ...baseEnv, PATH: `${binDir}${path.delimiter}${baseEnv.PATH}`, AGENT_SKILL_CHAIN_GH_STUB_STATE: statePath };
    },
    readState(): GhStubState {
      return JSON.parse(fs.readFileSync(statePath, 'utf8')) as GhStubState;
    },
    writeState(state: GhStubState): void {
      fs.writeFileSync(statePath, JSON.stringify(state));
    },
    seedPrList(branch: string, prs: unknown[]): void {
      const state = this.readState();
      state.prs[branch] = prs;
      this.writeState(state);
    },
  };
}
