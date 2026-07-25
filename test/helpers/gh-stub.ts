import fs from 'node:fs';
import path from 'node:path';

// gh CLI の代替スタブ本体。tmp bin dir へ実行可能ファイル `gh` として書き出す。
// 拡張子なし・shebang実行のため、配置先に package.json が無いことを前提に CommonJS で書く
// （Node は package.json が見つからない場合スクリプトを CommonJS として扱う）。
const GH_STUB_SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const childProcess = require('child_process');
const crypto = require('crypto');

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
function pageItems(apiPath, items) {
  const query = String(apiPath || '').split('?')[1] || '';
  const params = new URLSearchParams(query);
  const page = Number(params.get('page') || '1');
  const perPage = Number(params.get('per_page') || '100');
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

function git(args) {
  childProcess.execFileSync('git', args, { cwd: process.cwd(), stdio: 'pipe' });
}

// Issue #266の結合テスト専用。merge要求を受けた瞬間に別の自動化がmainを更新した状態を、
// 実git remoteへcommit/pushして再現する。release bumpプロセスは直後にfetchして再同期する。
function advanceMainForBaseRace() {
  git(['checkout', 'main']);
  fs.appendFileSync('release-bump-base-race.txt', 'base advanced\\n');
  git(['add', 'release-bump-base-race.txt']);
  git(['commit', '-m', 'test: advance main during release bump merge']);
  git(['push', 'origin', 'main']);
}

// Issue #266の結合テスト専用。実GitHubのsquash merge相当として、許可されたbump branchの
// 内容をmainへ反映する。通常のスタブ経路は従来どおりPR状態だけを更新する。
function applyMergedBumpPrToMain(head) {
  git(['checkout', 'main']);
  git(['merge', '--squash', head]);
  git(['commit', '-m', 'chore(release): simulated merged bump']);
  git(['push', 'origin', 'main']);
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
    // findOpenPrByHead（release bump・root-cleanup runが共有）が直後に
    // 'gh pr view <head>' で解決できるよう、head branch をキーに PR を登録する
    // （実PR番号は本スタブ専用の採番、既存のnextId列とは独立）。
    state.prsByBranch = state.prsByBranch || {};
    state.nextPrNumber = state.nextPrNumber || 1;
    const number = state.nextPrNumber++;
    const paths = state.defaultPrFiles || ['package.json'];
    const stats = state.defaultPrFileStats || {};
    state.prsByBranch[head] = {
      number,
      state: 'OPEN',
      headRefName: head,
      // additions/deletions は root-cleanup run のスコープ検査（削除のみで構成されているか）が
      // 参照する。既定は「削除のみ」（additions:0）とし、release bump 側は現状これらの値を
      // 見ないため既定値のままで従来どおり動作する。
      files: paths.map((p) => ({
        path: p,
        additions: typeof stats[p]?.additions === 'number' ? stats[p].additions : 0,
        deletions: typeof stats[p]?.deletions === 'number' ? stats[p].deletions : 1,
      })),
    };
  }
  saveState(state);
  process.stdout.write('https://github.com/test/repo/pull/1\\n');
  process.exit(0);
}

if (cmd === 'pr' && sub === 'list') {
  const head = flag('--head');
  const state = loadState();
  if (head) {
    const prs = (state.prs || {})[head] || [];
    process.stdout.write(JSON.stringify(prs));
    process.exit(0);
  }
  // root-cleanup run が既存のcleanup PRをブランチ名パターンで探すために使う
  // 'gh pr list --state open --json number,headRefName' 相当（headを指定しない全件列挙）。
  const all = Object.values(state.prsByBranch || {}).filter((pr) => pr.state === 'OPEN');
  process.stdout.write(JSON.stringify(all.map((pr) => ({ number: pr.number, headRefName: pr.headRefName }))));
  process.exit(0);
}

if (cmd === 'pr' && sub === 'view') {
  // release bump・root-cleanup run の findOpenPrByHead が
  // 'gh pr view <branch> --json number,state,headRefName,files' として呼ぶ
  // （常にbranch名で問い合わせる、PR番号ではない）。
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
      files: pr.files,
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
    if (state.advanceMainOnNextMerge) {
      state.advanceMainOnNextMerge = false;
      advanceMainForBaseRace();
    }
    saveState(state);
    process.stderr.write(state.failMergeMessage || 'gh-stub: simulated admin merge failure\\n');
    process.exit(1);
  }
  let mergedHead;
  for (const key of Object.keys(state.prsByBranch || {})) {
    if (String(state.prsByBranch[key].number) === String(number)) {
      state.prsByBranch[key].state = 'MERGED';
      mergedHead = key;
    }
  }
  if (state.applyMergedPrToMain && mergedHead) applyMergedBumpPrToMain(mergedHead);
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

if (cmd === 'attestation' && sub === 'verify') {
  const state = loadState();
  const subjectPath = args[2];
  const subject = fs.readFileSync(subjectPath);
  const envelope = JSON.parse(subject.toString('utf8'));
  state.attestationVerifyCalls = state.attestationVerifyCalls || [];
  state.attestationVerifyCalls.push({ args });
  saveState(state);
  if (state.failAttestationVerify) {
    process.stderr.write('gh-stub: simulated attestation verification failure\\n');
    process.exit(1);
  }
  const verification = state.attestationVerification || [{
    verificationResult: {
      signature: {
        certificate: {
          runInvocationUri:
            'https://github.com/' + envelope.repository.full_name + '/actions/runs/' +
            envelope.workflow.run_id + '/attempts/' + envelope.workflow.run_attempt,
        },
      },
      statement: {
        subject: [{
          digest: { sha256: crypto.createHash('sha256').update(subject).digest('hex') },
        }],
      },
    },
  }];
  process.stdout.write(JSON.stringify(verification));
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

  if (apiPath === 'repos/{owner}/{repo}' && method === 'GET') {
    process.stdout.write(JSON.stringify({
      id: state.repositoryId || 77,
      full_name: state.repositoryFullName || 'test/repo',
      default_branch: state.defaultBranch || 'main',
    }));
    process.exit(0);
  }

  if (apiPath === 'user' && method === 'GET') {
    process.stdout.write((state.apiActor || 'trusted-reviewer') + '\\n');
    process.exit(0);
  }

  if (apiPath === 'repos/{owner}/{repo}/dispatches' && method === 'POST') {
    if (state.failRepositoryDispatch) {
      process.stderr.write('gh-stub: simulated repository dispatch failure\\n');
      process.exit(1);
    }
    state.repositoryDispatches = state.repositoryDispatches || [];
    state.repositoryDispatches.push(JSON.parse(body));
    saveState(state);
    process.exit(0);
  }

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

  const pullMatch = /\\/pulls\\/(\\d+)$/.exec(apiPath || '');
  if (pullMatch && method === 'GET') {
    process.stdout.write(JSON.stringify(state.pullMetadata || {}));
    process.exit(0);
  }

  const issueMatch = /\\/issues\\/(\\d+)$/.exec(apiPath || '');
  if (issueMatch && method === 'GET') {
    const number = Number(issueMatch[1]);
    process.stdout.write(JSON.stringify(state.issueMetadata || {
      number,
      state: 'open',
      labels: state.issueApiLabels || [],
    }));
    process.exit(0);
  }

  if (/\\/pulls\\/\\d+\\/commits(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify(pageItems(apiPath, state.pullCommits || [])));
    process.exit(0);
  }

  if (/\\/pulls\\/\\d+\\/reviews(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify(pageItems(apiPath, state.pullReviews || [])));
    process.exit(0);
  }

  if (/\\/pulls\\/\\d+\\/reviews$/.test(apiPath || '') && method === 'POST') {
    const parsed = JSON.parse(body);
    const id = state.nextId++;
    const record = {
      id,
      body: parsed.body,
      commit_id: parsed.commit_id,
      state: 'COMMENTED',
      user: { login: state.apiActor || 'trusted-reviewer' },
    };
    state.pullReviews = state.pullReviews || [];
    state.pullReviews.push(record);
    saveState(state);
    process.stdout.write(JSON.stringify(record));
    process.exit(0);
  }

  if (/\\/commits\\/[^/]+\\/check-runs(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify({ check_runs: pageItems(apiPath, state.checkRuns || []) }));
    process.exit(0);
  }

  if (/\\/actions\\/workflows\\/.+\\/runs(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify({ workflow_runs: pageItems(apiPath, state.actionRuns || []) }));
    process.exit(0);
  }

  if (/\\/check-runs$/.test(apiPath || '') && method === 'POST') {
    const parsed = JSON.parse(body);
    const id = state.nextId++;
    state.checkRuns = state.checkRuns || [];
    state.checkRuns.push(Object.assign({
      id,
      app: state.checkApp || {
        id: 15368,
        name: 'GitHub Actions',
        slug: state.checkAppSlug || 'github-actions',
      },
    }, parsed));
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

export interface GhStubPrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface GhStubBumpPr {
  number: number;
  state: string;
  headRefName: string;
  files: GhStubPrFile[];
}

export interface GhStubState {
  nextId: number;
  clock: number;
  comments: Record<string, { id: string; url: string; body: string; createdAt: string }[]>;
  rulesets: unknown[];
  prs: Record<string, unknown[]>;
  labels: string[];
  issueLabels: Record<string, string[]>;
  apiActor?: string;
  defaultBranch?: string;
  checkAppSlug?: string;
  checkApp?: { id: number; name: string; slug?: string };
  checkRuns?: unknown[];
  repositoryId?: number;
  repositoryFullName?: string;
  issueMetadata?: unknown;
  issueApiLabels?: ({ name: string } | string)[];
  actionRuns?: unknown[];
  repositoryDispatches?: unknown[];
  failRepositoryDispatch?: boolean;
  attestationVerification?: unknown;
  attestationVerifyCalls?: { args: string[] }[];
  failAttestationVerify?: boolean;
  pullMetadata?: unknown;
  pullCommits?: unknown[];
  pullReviews?: unknown[];
  prCreateCalls?: { args: string[]; body: string | undefined }[];
  // ---- Issue #196 release bump/tag/publish・Issue #208 root-cleanup run 検証用
  //      (gh pr view/list/merge, gh release view/create) ----
  prsByBranch?: Record<string, GhStubBumpPr>;
  nextPrNumber?: number;
  defaultPrFiles?: string[];
  defaultPrFileStats?: Record<string, { additions: number; deletions: number }>;
  mergeCalls?: { number: string; args: string[] }[];
  failMergeCount?: number;
  failMergeMessage?: string;
  advanceMainOnNextMerge?: boolean;
  applyMergedPrToMain?: boolean;
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
  /** `gh pr create` で新規登録される PR の files 一覧（パスのみ）の既定値を上書きする
   * （release bump・root-cleanup run のスコープ検査違反シナリオを再現するために使う。
   * Issue #196・#208）。各ファイルの additions/deletions は既定で削除のみ（0/1）になる。 */
  setDefaultPrFiles(files: string[]): void;
  /** `setDefaultPrFiles` で指定したパスのうち、特定ファイルの additions/deletions を上書きする
   * （root-cleanup run のスコープ検査が要求する「削除のみ」条件に違反するケース、すなわち
   * additions > 0 のファイルが混入したケースを再現するために使う。Issue #208）。 */
  setDefaultPrFileStats(stats: Record<string, { additions: number; deletions: number }>): void;
  /** 直後の `gh pr merge` 呼び出しを count 回だけ失敗させる（PRはOPENのまま）。
   * 「PR作成後、admin mergeに失敗」自己修復シナリオの検証用（Issue #196・#208）。 */
  failNextMerge(count?: number): void;
  /** Issue #266: 最初のmerge要求時にmainを実際に前進させ、GitHubのbase更新競合を返す。
   * 次の成功mergeはテスト用remoteのmainへ反映し、tag/publish後続契約まで検証可能にする。 */
  simulateBaseBranchRaceOnNextMerge(): void;
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
    defaultBranch: 'main',
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
    setDefaultPrFileStats(stats: Record<string, { additions: number; deletions: number }>): void {
      const state = this.readState();
      state.defaultPrFileStats = stats;
      this.writeState(state);
    },
    failNextMerge(count = 1): void {
      const state = this.readState();
      state.failMergeCount = count;
      delete state.failMergeMessage;
      this.writeState(state);
    },
    simulateBaseBranchRaceOnNextMerge(): void {
      const state = this.readState();
      state.failMergeCount = 1;
      state.failMergeMessage = 'GraphQL: Base branch was modified. Review and try the merge again.\\n';
      state.advanceMainOnNextMerge = true;
      state.applyMergedPrToMain = true;
      this.writeState(state);
    },
  };
}
