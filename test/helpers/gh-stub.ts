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

if (cmd === 'issue' && sub === 'edit') {
  const issueNumber = args[2];
  const addLabel = flag('--add-label');
  const removeLabel = flag('--remove-label');
  const state = loadState();
  state.issueLabels = state.issueLabels || {};
  state.issueLabels[issueNumber] = state.issueLabels[issueNumber] || [];
  if (addLabel && !state.issueLabels[issueNumber].includes(addLabel)) {
    state.issueLabels[issueNumber].push(addLabel);
  }
  if (removeLabel) {
    state.issueLabels[issueNumber] = state.issueLabels[issueNumber].filter((l) => l !== removeLabel);
  }
  saveState(state);
  process.exit(0);
}

if (cmd === 'issue' && sub === 'list') {
  const label = flag('--label');
  const state = loadState();
  const issueLabels = state.issueLabels || {};
  const numbers = Object.keys(issueLabels).filter((n) => !label || (issueLabels[n] || []).includes(label));
  process.stdout.write(JSON.stringify(numbers.map((n) => ({ number: Number(n) }))));
  process.exit(0);
}

if (cmd === 'pr' && sub === 'create') {
  const state = loadState();
  state.prCreateCalls = state.prCreateCalls || [];
  state.prCreateCalls.push({ args, body: flag('--body') });
  const head = flag('--head');
  if (head) {
    // Issue #196 release bump: findOpenBumpPr が直後に 'gh pr view <head>' で解決できるよう、
    // head branch をキーに PR を登録する（実PR番号は本スタブ専用の採番、既存のnextId列とは独立）。
    state.prsByBranch = state.prsByBranch || {};
    state.nextPrNumber = state.nextPrNumber || 1;
    const number = state.nextPrNumber++;
    state.prsByBranch[head] = {
      number,
      state: 'OPEN',
      headRefName: head,
      files: state.defaultPrFiles || ['package.json'],
    };
  }
  saveState(state);
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

if (cmd === 'pr' && sub === 'view') {
  // release bump の findOpenBumpPr が 'gh pr view <branch> --json number,state,headRefName,files'
  // として呼ぶ（常にbranch名で問い合わせる、PR番号ではない）。
  const key = args[2];
  const state = loadState();
  const pr = (state.prsByBranch || {})[key];
  if (!pr) {
    process.stderr.write('gh-stub: no PR found for ' + key + '\\n');
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      number: pr.number,
      state: pr.state,
      headRefName: pr.headRefName,
      files: pr.files.map((p) => ({ path: p })),
    }),
  );
  process.exit(0);
}

if (cmd === 'pr' && sub === 'merge') {
  const number = args[2];
  const state = loadState();
  state.mergeCalls = state.mergeCalls || [];
  state.mergeCalls.push({ number, args });
  if ((state.failMergeCount || 0) > 0) {
    // 障害シナリオ検証用（DESIGN.md「PR作成後、admin mergeに失敗」の自己修復パス）:
    // PRはOPENのまま（マージ扱いにしない）で失敗を模擬する。1回消費して残数を減らす。
    state.failMergeCount -= 1;
    saveState(state);
    process.stderr.write('gh-stub: simulated admin merge failure\\n');
    process.exit(1);
  }
  for (const key of Object.keys(state.prsByBranch || {})) {
    if (String(state.prsByBranch[key].number) === String(number)) {
      state.prsByBranch[key].state = 'MERGED';
    }
  }
  saveState(state);
  process.stdout.write('https://github.com/test/repo/pull/' + number + '\\n');
  process.exit(0);
}

if (cmd === 'release' && sub === 'view') {
  const tagName = args[2];
  const state = loadState();
  const releases = state.releases || [];
  if (releases.includes(tagName)) {
    process.stdout.write(JSON.stringify({ tagName }));
    process.exit(0);
  }
  process.stderr.write('gh-stub: release not found: ' + tagName + '\\n');
  process.exit(1);
}

if (cmd === 'release' && sub === 'create') {
  const tagName = args[2];
  const state = loadState();
  state.releases = state.releases || [];
  state.releaseCreateCalls = state.releaseCreateCalls || [];
  state.releaseCreateCalls.push({ args });
  if (!state.releases.includes(tagName)) state.releases.push(tagName);
  saveState(state);
  process.stdout.write('https://github.com/test/repo/releases/tag/' + tagName + '\\n');
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

export interface GhStubBumpPr {
  number: number;
  state: string;
  headRefName: string;
  files: string[];
}

export interface GhStubState {
  nextId: number;
  clock: number;
  comments: Record<string, { id: string; url: string; body: string; createdAt: string }[]>;
  rulesets: unknown[];
  prs: Record<string, unknown[]>;
  labels: string[];
  issueLabels: Record<string, string[]>;
  prCreateCalls?: { args: string[]; body: string | undefined }[];
  // ---- Issue #196 release bump/tag/publish 検証用（gh pr view/merge, gh release view/create） ----
  prsByBranch?: Record<string, GhStubBumpPr>;
  nextPrNumber?: number;
  defaultPrFiles?: string[];
  mergeCalls?: { number: string; args: string[] }[];
  failMergeCount?: number;
  releases?: string[];
  releaseCreateCalls?: { args: string[] }[];
}

export interface GhStub {
  binDir: string;
  statePath: string;
  env(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  readState(): GhStubState;
  writeState(state: GhStubState): void;
  seedPrList(branch: string, prs: unknown[]): void;
  /** `gh pr create` で新規登録される PR の files 一覧の既定値を上書きする（release bump の
   * スコープ検査違反シナリオを再現するために使う。Issue #196）。 */
  setDefaultPrFiles(files: string[]): void;
  /** 直後の `gh pr merge` 呼び出しを count 回だけ失敗させる（PRはOPENのまま）。
   * DESIGN.md の「PR作成後、admin mergeに失敗」自己修復シナリオの検証用（Issue #196）。 */
  failNextMerge(count?: number): void;
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
  const initialState: GhStubState = {
    nextId: 1,
    clock: 1700000000000,
    comments: {},
    rulesets: [],
    prs: {},
    labels: [],
    issueLabels: {},
  };
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
    setDefaultPrFiles(files: string[]): void {
      const state = this.readState();
      state.defaultPrFiles = files;
      this.writeState(state);
    },
    failNextMerge(count = 1): void {
      const state = this.readState();
      state.failMergeCount = count;
      this.writeState(state);
    },
  };
}
