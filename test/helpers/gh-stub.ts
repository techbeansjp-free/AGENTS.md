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

function git(args) {
  childProcess.execFileSync('git', args, { cwd: process.cwd(), stdio: 'pipe' });
}

// Issue #354 issue-sync のマーカー区間。本体（src/lib/issue-sync.ts）と同一文字列でなければ
// 区間置換・競合検知の模擬が成立しないため、値を変える場合は両方を揃える。
const SYNC_BEGIN = '<!-- agent-skill-chain:issue-sync:begin (do not edit manually) -->';
const SYNC_END = '<!-- agent-skill-chain:issue-sync:end -->';

// Issue #354: 本文読み取りのたびに別プロセスがマーカー区間を書き換えた状態を再現する。
// bodyRaceRemaining が残っている間、読み手には読み取り時点の本文を返しつつ、保存済み本文を
// 次回以降別内容へ差し替える（読み直し比較による競合検知が発火する条件そのもの）。
function readBodyWithRace(state, storeKey, key) {
  state[storeKey] = state[storeKey] || {};
  const body = state[storeKey][key] || '';
  if ((state.bodyRaceRemaining || 0) > 0) {
    state.bodyRaceRemaining -= 1;
    state.bodyRaceSeq = (state.bodyRaceSeq || 0) + 1;
    const block = SYNC_BEGIN + '\\nconcurrent write #' + state.bodyRaceSeq + '\\n' + SYNC_END;
    const start = body.indexOf(SYNC_BEGIN);
    const end = body.indexOf(SYNC_END);
    state[storeKey][key] =
      start === -1 || end === -1
        ? (body ? body + '\\n\\n' + block + '\\n' : block + '\\n')
        : body.slice(0, start) + block + body.slice(end + SYNC_END.length);
    saveState(state);
  }
  return body;
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

// ISSUE-619 design-gate再通過分: root-cleanup run自身が作成したクリーンアップPR
// （chore/root-cleanup-*）のadmin mergeをシミュレートする際は、実GitHubのsquash merge同様に
// origin側のbase branch参照そのものを前進させる（ローカルのworking tree/チェックアウトには
// 一切触れない、applyMergedBumpPrToMainとは異なりcheckout/mergeをローカルで行わない）。
// root-cleanup run自身のsyncBaseBranchAfterAdminMergeがその後のgit fetch + merge --ff-onlyで
// ローカルへ反映することを、実git remoteに対して検証可能にするための最小シミュレーション。
const ROOT_CLEANUP_BRANCH_RE = /^chore\\/root-cleanup-[0-9]{8}T[0-9]{6}Z$/;
function applyRootCleanupMergeToOriginBase(head, base) {
  let remoteDir;
  try {
    remoteDir = childProcess.execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch {
    return;
  }
  let headSha;
  try {
    headSha = childProcess
      .execFileSync('git', ['rev-parse', 'refs/remotes/origin/' + head], { cwd: process.cwd(), encoding: 'utf8' })
      .trim();
  } catch {
    return;
  }
  try {
    childProcess.execFileSync('git', ['--git-dir', remoteDir, 'update-ref', 'refs/heads/' + base, headSha], { stdio: 'pipe' });
  } catch {
    // best-effortシミュレーションのため、失敗してもadmin merge自体の応答は変えない
  }
}

const [cmd, sub] = args;

if (cmd === 'auth' && sub === 'status') {
  process.exit(0);
}

if (cmd === 'label' && sub === 'create') {
  const name = args[2];
  const color = flag('--color');
  const description = flag('--description');
  const state = loadState();
  state.labels = state.labels || [];
  if (!state.labels.includes(name)) state.labels.push(name);
  state.labelDetails = state.labelDetails || {};
  state.labelDetails[name] = { color: color || 'ededed', description: description || '' };
  saveState(state);
  process.stdout.write(name + '\\n');
  process.exit(0);
}

// Issue #272: doctor の「GitHub labels同期」検査が使う gh label list --json name,color,description。
// 実GitHubへは一切アクセスせず、これまでに label create で記録済みの状態のみを返す。
if (cmd === 'label' && sub === 'list') {
  const state = loadState();
  const names = state.labels || [];
  const details = state.labelDetails || {};
  const result = names.map((name) => ({
    name,
    color: details[name]?.color || 'ededed',
    description: details[name]?.description || '',
  }));
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

if (cmd === 'issue' && sub === 'comment') {
  const issueNumber = args[2];
  const body = flag('--body') ?? '';
  const state = loadState();
  const issueCommentFailure = (state.issueCommentFailures || {})[issueNumber];
  if (issueCommentFailure) {
    process.stderr.write(issueCommentFailure);
    process.exit(1);
  }
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
  const fields = (flag('--json') || 'comments').split(',');
  const issueContentResponse = (state.issueContentResponses || {})[issueNumber];
  if (issueContentResponse && fields.includes('number') && fields.includes('title') && fields.includes('body')) {
    if (issueContentResponse.stderr) process.stderr.write(issueContentResponse.stderr);
    if (issueContentResponse.stdout) process.stdout.write(issueContentResponse.stdout);
    process.exit(issueContentResponse.status || 0);
  }
  const issueViewFailure = (state.issueViewFailures || {})[issueNumber];
  if (issueViewFailure && fields.includes('comments')) {
    process.stderr.write(issueViewFailure);
    process.exit(1);
  }
  const payload = {};
  if (fields.includes('comments')) payload.comments = state.comments[issueNumber] || [];
  if (fields.includes('number')) payload.number = Number(issueNumber);
  if (fields.includes('body')) payload.body = readBodyWithRace(state, 'issueBodies', issueNumber);
  // Issue #425: quick モード判定は 'gh issue view <n> --json labels' でラベルを読む。
  // 実GitHub同様、labels は {name: ...} オブジェクトの配列として返す。
  if (fields.includes('labels')) {
    payload.labels = ((state.issueLabels || {})[issueNumber] || []).map((name) => ({ name }));
  }
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

if (cmd === 'issue' && sub === 'edit') {
  const issueNumber = args[2];
  const addLabel = flag('--add-label');
  const removeLabel = flag('--remove-label');
  const bodyFile = flag('--body-file');
  const state = loadState();
  if (bodyFile) {
    state.issueBodies = state.issueBodies || {};
    state.issueBodies[issueNumber] = fs.readFileSync(bodyFile, 'utf8');
    state.issueEditBodyCalls = (state.issueEditBodyCalls || []).concat([{ number: issueNumber }]);
  }
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
  // ISSUE-619: AC-5（commit・push・PR作成等の途中でコマンドが異常終了した場合の
  // チェックアウト復元）検証用。failMergeCount/failMergeMessageと同型。
  if ((state.failPrCreateCount || 0) > 0) {
    state.failPrCreateCount -= 1;
    saveState(state);
    process.stderr.write(state.failPrCreateMessage || 'gh-stub: simulated pr create failure\\n');
    process.exit(1);
  }
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
      // ISSUE-619 design-gate再通過分: applyRootCleanupMergeToOriginBaseがadmin merge時に
      // どのbase branchを前進させるかを解決するために保持する。
      baseRefName: flag('--base') || 'main',
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
  // Issue #354 issue-sync は同じ列挙に body を加えて要求するため、--json の指定フィールドだけを
  // 返す（既存呼び出しの出力は従来と同一のまま）。
  const fields = (flag('--json') || 'number,headRefName').split(',');
  const all = Object.values(state.prsByBranch || {}).filter((pr) => pr.state === 'OPEN');
  process.stdout.write(
    JSON.stringify(
      all.map((pr) => {
        const record = {};
        if (fields.includes('number')) record.number = pr.number;
        if (fields.includes('headRefName')) record.headRefName = pr.headRefName;
        if (fields.includes('body')) record.body = (state.prBodies || {})[String(pr.number)] || '';
        return record;
      }),
    ),
  );
  process.exit(0);
}

if (cmd === 'pr' && sub === 'edit') {
  const prNumber = args[2];
  const bodyFile = flag('--body-file');
  const addLabel = flag('--add-label');
  const state = loadState();
  if (bodyFile) {
    state.prBodies = state.prBodies || {};
    state.prBodies[prNumber] = fs.readFileSync(bodyFile, 'utf8');
    state.prEditBodyCalls = (state.prEditBodyCalls || []).concat([{ number: prNumber }]);
  }
  if (addLabel) {
    state.prLabels = state.prLabels || {};
    state.prLabels[prNumber] = state.prLabels[prNumber] || [];
    if (!state.prLabels[prNumber].includes(addLabel)) state.prLabels[prNumber].push(addLabel);
  }
  saveState(state);
  process.exit(0);
}

// Issue #554: release automation の human_required 通知（対象PRへの理由コメント）。
// PR番号とIssue番号は同一リポジトリ内で番号空間を共有するため、'gh issue comment' と同じ
// comments ストレージ（PR番号キー）を再利用する。
if (cmd === 'pr' && sub === 'comment') {
  const prNumber = args[2];
  const body = flag('--body') ?? '';
  const state = loadState();
  const id = state.nextId++;
  state.comments[prNumber] = state.comments[prNumber] || [];
  state.comments[prNumber].push({
    id: String(id),
    url: 'https://github.com/test/repo/pull/' + prNumber + '#issuecomment-' + id,
    body,
    createdAt: new Date(state.clock).toISOString(),
  });
  state.clock += 1000;
  saveState(state);
  process.stdout.write('https://github.com/test/repo/pull/' + prNumber + '#issuecomment-' + id + '\\n');
  process.exit(0);
}

if (cmd === 'pr' && sub === 'view') {
  // release bump・root-cleanup run の findOpenPrByHead が
  // 'gh pr view <branch> --json number,state,headRefName,files' として呼ぶ
  // ほか、worker resumeのreview status取得はPR番号で問い合わせる。
  // Issue #493: 対象識別子省略時（rawKeyがフラグから始まる、または未指定）は
  // pr-freshness.ts の resolveMergeTarget() フォールバック（cwdの現在ブランチに紐づくPRの
  // 暗黙解決）と同じ呼び出し形（'gh pr view --json number' [--repo <repo>]）を模擬する。
  const rawKey = args[2];
  const hasExplicitKey = rawKey !== undefined && !rawKey.startsWith('-');
  // Issue #493実装ゲート2回目是正: 対象識別子がPR URL（実GitHubの'gh pr view'が受け付ける
  // 'https://github.com/<owner>/<repo>/pull/<n>'形式）の場合、実際のghはURL自体からリポジトリ・
  // PR番号を解決する。本スタブも同じ入力を受け取れるよう、URL形式ならPR番号部分を抽出して
  // 以降のPR登録参照キーとして使う（登録がcwdの既定リポジトリと異なるリポジトリのPRであっても
  // 参照できるようにするため）。
  const urlMatch = /^https:\\/\\/github\\.com\\/([^/]+\\/[^/]+)\\/pull\\/(\\d+)/.exec(rawKey || '');
  const urlOwnerRepo = urlMatch ? urlMatch[1] : undefined;
  const key = hasExplicitKey ? (urlMatch ? urlMatch[2] : rawKey) : undefined;
  const state = loadState();
  // Issue #354 issue-sync は PR 番号 + '--json body' で本文だけを読む（ブランチ名では引かない）。
  const viewFields = (flag('--json') || '').split(',');
  const repoFlagIndex = args.indexOf('--repo') !== -1 ? args.indexOf('--repo') : args.indexOf('-R');
  const repoOverride = repoFlagIndex !== -1 ? args[repoFlagIndex + 1] : undefined;
  state.prViewCalls = (state.prViewCalls || []).concat([{ key: key ?? '(implicit)', fields: viewFields, repo: repoOverride }]);
  saveState(state);

  if (!hasExplicitKey) {
    // resolveMergeTarget() のcwdベース暗黙解決フォールバック（対象識別子を伴わない呼び出し）。
    if (state.failImplicitPrResolution) {
      process.stderr.write('gh-stub: no pull requests found for current branch\\n');
      process.exit(1);
    }
    let branch;
    try {
      branch = childProcess
        .execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' })
        .trim();
    } catch {
      branch = undefined;
    }
    const pr = branch ? (state.prsByBranch || {})[branch] : undefined;
    if (!pr) {
      process.stderr.write('gh-stub: no pull requests found for current branch "' + (branch || '') + '"\\n');
      process.exit(1);
    }
    process.stdout.write(JSON.stringify({ number: pr.number }));
    process.exit(0);
  }

  if (viewFields.includes('body')) {
    const payload = {};
    if (viewFields.includes('number')) payload.number = Number(key);
    payload.body = readBodyWithRace(state, 'prBodies', key);
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }
  const pr =
    (state.prsByBranch || {})[key] ||
    Object.values(state.prsByBranch || {}).find((candidate) => String(candidate.number) === String(key));

  // Issue #493: pr-freshness.ts の checkFreshness() が問い合わせる mergeStateStatus。
  // 事前登録（gh pr create・seedOpenPr）が無いPR番号（例: 既存テストの 'gh pr merge 1' 直接指定）
  // でも、AC-5（既存挙動からの回帰なし）を満たすため既定でfresh相当を返す。テストが
  // seedPrFreshnessQueue() で明示制御した場合はそれを優先する。
  // Issue #615: 'baseRefOid' は実際の 'gh pr view --json' には存在しないフィールドのため、本番
  // コードはもう要求しない（viewFieldsに含まれ得ない）。この分岐条件自体はmergeStateStatusの
  // 判定だけで足りるが、seedPrFreshnessQueue()経由のentry.baseRefOid（base branchのコミット
  // SHA、compare API応答のbase_commit.shaとして使う）は引き続きここで解決する。
  if (viewFields.includes('mergeStateStatus')) {
    const freshnessViewFailure = (state.prViewFailures || {})[key];
    if (freshnessViewFailure) {
      process.stderr.write(freshnessViewFailure);
      process.exit(1);
    }
    // Issue #493実装ゲート是正: 対象識別子（key）がPR番号でなくブランチ名／URLの場合でも
    // prFreshnessQueues/freshnessCompareはPR番号で一貫して引けるよう、pr登録があれば
    // PR番号へ正規化したキーを使う（無ければ従来どおりkey自体をキーにする）。
    const resolvedKey = pr ? String(pr.number) : key;
    const queues = state.prFreshnessQueues || {};
    const queue = queues[resolvedKey];
    const counts = (state.prFreshnessCallCounts = state.prFreshnessCallCounts || {});
    const payload = {};
    let prState = pr ? pr.state : 'OPEN';
    let mergeStateStatus = 'CLEAN';
    let baseRefOid = state.defaultBaseRefOid || 'default-base-sha';
    let compareStatus;
    let compareBehindBy;
    let compareFail = false;
    if (queue && queue.length > 0) {
      const idx = Math.min(counts[resolvedKey] || 0, queue.length - 1);
      counts[resolvedKey] = (counts[resolvedKey] || 0) + 1;
      const entry = queue[idx];
      if (entry.fail) {
        saveState(state);
        process.stderr.write('gh-stub: simulated freshness check failure (queued)\\n');
        process.exit(1);
      }
      if (entry.state !== undefined) prState = entry.state;
      if (entry.mergeStateStatus !== undefined) mergeStateStatus = entry.mergeStateStatus;
      if (entry.baseRefOid !== undefined) baseRefOid = entry.baseRefOid;
      compareStatus = entry.compareStatus;
      compareBehindBy = entry.compareBehindBy;
      compareFail = !!entry.compareFail;
    } else if (pr && pr.mergeStateStatus !== undefined) {
      mergeStateStatus = pr.mergeStateStatus;
    }
    // compareStatus/compareBehindByの明示指定が無い場合は、mergeStateStatus由来の既定値
    // （BEHINDならbehind、それ以外はidentical）を使う（既存テスト・AC-5回帰防止のための
    // 後方互換動作。反例〔mergeStateStatusはCLEAN等だが実際にはbehind〕はテストが
    // compareStatus/compareBehindByを明示指定することで再現する）。
    if (compareStatus === undefined && typeof compareBehindBy !== 'number') {
      compareStatus = mergeStateStatus === 'BEHIND' ? 'behind' : 'identical';
      compareBehindBy = mergeStateStatus === 'BEHIND' ? 1 : 0;
    }
    // Issue #615: baseRefOid（seedPrFreshnessQueue()経由でテストが指定するbase branchのコミット
    // SHA）は 'gh pr view --json' の応答フィールドとしては存在しないため payload には含めず、
    // 実GitHubのcompare APIが返す base_commit.sha として freshnessCompare 経由でのみ渡す。
    state.freshnessCompare = state.freshnessCompare || {};
    state.freshnessCompare[resolvedKey] = { compareStatus, compareBehindBy, compareFail, baseRefOid };
    saveState(state);
    if (viewFields.includes('number')) payload.number = pr ? pr.number : Number(key);
    if (viewFields.includes('state')) payload.state = prState;
    // 実PR登録が無い対象（AC-1等、numericな仮PR番号のみをseedPrFreshnessQueueで指定するテスト）
    // でも headRefName/baseRefName は常に返す（実GitHubのgh pr viewは常にこれらを返すため）。
    // compare API呼び出し（下記 'gh api .../compare/...'）がこの値からresolvedKeyを逆引きできる
    // よう、pr未登録時は 'stub-head-<resolvedKey>' という規約付き値を使う。
    if (viewFields.includes('headRefName')) payload.headRefName = pr ? pr.headRefName : 'stub-head-' + resolvedKey;
    if (viewFields.includes('baseRefName')) payload.baseRefName = 'main';
    if (viewFields.includes('mergeStateStatus')) payload.mergeStateStatus = mergeStateStatus;
    // Issue #493実装ゲート2回目是正: pr-freshness.ts の checkFreshness() が対象PRの実際の
    // 所属リポジトリを導出するために追加取得する url/isCrossRepository/headRepositoryOwner。
    // 優先順位は (1) 対象識別子自体がPR URLだった場合はそのURLの owner/repo（実ghの挙動）、
    // (2) seedPrCrossRepoInfo() で明示投入した値、(3) --repo/-R フラグ指定値（実ghは
    // '--repo owner/repo <番号>' で指定リポジトリ内のPRとして解決するため、返るurlもその
    // リポジトリを反映する）、(4) 既定リポジトリ、の順。
    const crossInfo = (state.prCrossRepoInfo || {})[resolvedKey] || {};
    const repoFullName = urlOwnerRepo || crossInfo.repoFullName || repoOverride || state.repositoryFullName || 'test/repo';
    const prNumberForUrl = pr ? pr.number : Number(key);
    const outputUrl = crossInfo.url || 'https://github.com/' + repoFullName + '/pull/' + prNumberForUrl;
    if (viewFields.includes('url')) payload.url = outputUrl;
    if (viewFields.includes('isCrossRepository')) payload.isCrossRepository = !!crossInfo.isCrossRepository;
    if (viewFields.includes('headRepositoryOwner')) payload.headRepositoryOwner = crossInfo.headRepositoryOwner;
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }

  const prViewFailure = (state.prViewFailures || {})[key];
  if (prViewFailure && (viewFields.includes('reviews') || viewFields.includes('latestReviews') || viewFields.includes('comments'))) {
    process.stderr.write(prViewFailure);
    process.exit(1);
  }
  if (!pr) {
    process.stderr.write(
      viewFields.includes('reviews') || viewFields.includes('latestReviews') || viewFields.includes('comments')
        ? 'no pull requests found for branch "' + key + '"\\n'
        : 'gh-stub: no PR found for ' + key + '\\n',
    );
    process.exit(1);
  }
  if (state.failPrReviewStatusView && (viewFields.includes('reviews') || viewFields.includes('latestReviews') || viewFields.includes('comments'))) {
    process.stderr.write('gh-stub: simulated review status view failure\\n');
    process.exit(1);
  }
  const payload = {};
  if (viewFields.includes('number')) payload.number = pr.number;
  if (viewFields.includes('state')) payload.state = pr.state;
  if (viewFields.includes('headRefName')) payload.headRefName = pr.headRefName;
  if (viewFields.includes('headRefOid')) {
    if (Object.prototype.hasOwnProperty.call(pr, 'headRefOid')) {
      if (typeof pr.headRefOid === 'string') payload.headRefOid = pr.headRefOid;
    } else {
      payload.headRefOid = childProcess.execFileSync(
        'git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' },
      ).trim();
    }
  }
  if (viewFields.includes('files')) payload.files = pr.files;
  if (viewFields.includes('latestReviews')) payload.latestReviews = pr.latestReviews || [];
  if (viewFields.includes('reviews')) payload.reviews = pr.reviews || [];
  if (viewFields.includes('comments')) payload.comments = pr.comments || [];
  process.stdout.write(JSON.stringify(payload));
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
  let mergedBase;
  for (const key of Object.keys(state.prsByBranch || {})) {
    if (String(state.prsByBranch[key].number) === String(number)) {
      state.prsByBranch[key].state = 'MERGED';
      mergedHead = key;
      mergedBase = state.prsByBranch[key].baseRefName;
    }
  }
  if (state.applyMergedPrToMain && mergedHead) applyMergedBumpPrToMain(mergedHead);
  if (mergedHead && ROOT_CLEANUP_BRANCH_RE.test(mergedHead)) {
    applyRootCleanupMergeToOriginBase(mergedHead, mergedBase || 'main');
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
  state.apiCalls = state.apiCalls || [];
  state.apiCalls.push({ method, path: apiPath });
  saveState(state);
  if ((state.failApiPaths || []).some((fragment) => apiPath.includes(fragment))) {
    process.stderr.write('gh-stub: simulated api failure: ' + method + ' ' + apiPath + '\\n');
    process.exit(1);
  }

  if (apiPath === 'repos/{owner}/{repo}' && method === 'GET') {
    const repository = {
      id: state.repositoryId || 77,
      full_name: state.repositoryFullName || 'test/repo',
      default_branch: state.defaultBranch || 'main',
    };
    if (flag('--jq') === '.default_branch') {
      process.stdout.write(repository.default_branch + '\\n');
    } else {
      process.stdout.write(JSON.stringify(repository));
    }
    process.exit(0);
  }

  const repositoryContentMatch = /^repos\\/\\{owner\\}\\/\\{repo\\}\\/contents\\/(.+)\\?ref=([^&]+)$/.exec(apiPath || '');
  if (repositoryContentMatch && method === 'GET') {
    const contentPath = decodeURIComponent(repositoryContentMatch[1]);
    const ref = decodeURIComponent(repositoryContentMatch[2]);
    try {
      const remoteDir = childProcess.execFileSync(
        'git',
        ['remote', 'get-url', 'origin'],
        { cwd: process.cwd(), encoding: 'utf8' },
      ).trim();
      const content = childProcess.execFileSync(
        'git',
        ['--git-dir', remoteDir, 'show', 'refs/heads/' + ref + ':' + contentPath],
      );
      process.stdout.write(JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }));
      process.exit(0);
    } catch {
      process.stderr.write('gh-stub: repository content not found\\n');
      process.exit(1);
    }
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

  const permissionMatch = /\\/collaborators\\/([^/]+)\\/permission$/.exec(apiPath || '');
  if (permissionMatch && method === 'GET') {
    process.stdout.write(JSON.stringify({
      permission: state.collaboratorPermissions?.[decodeURIComponent(permissionMatch[1])] || 'read',
    }));
    process.exit(0);
  }

  const issueCommentsMatch = /\\/issues\\/(\\d+)\\/comments(?:\\?.*)?$/.exec(apiPath || '');
  if (issueCommentsMatch && method === 'GET') {
    const issueNumber = issueCommentsMatch[1];
    process.stdout.write(JSON.stringify((state.comments[issueNumber] || []).map((comment) => ({
      id: Number(comment.id),
      body: comment.body,
    }))));
    process.exit(0);
  }
  if (issueCommentsMatch && method === 'POST') {
    const issueNumber = issueCommentsMatch[1];
    const parsed = JSON.parse(body);
    const id = state.nextId++;
    const record = {
      id: String(id),
      url: 'https://github.com/test/repo/issues/' + issueNumber + '#issuecomment-' + id,
      body: parsed.body,
      createdAt: new Date(state.clock).toISOString(),
    };
    state.clock += 1000;
    state.comments[issueNumber] = state.comments[issueNumber] || [];
    state.comments[issueNumber].push(record);
    saveState(state);
    process.stdout.write(JSON.stringify({ id, body: record.body }));
    process.exit(0);
  }

  const issueEventsMatch = /\\/issues\\/(\\d+)\\/events$/.exec(apiPath || '');
  if (issueEventsMatch && method === 'GET') {
    const issueNumber = issueEventsMatch[1];
    const failure = (state.issueEventFailures || {})[issueNumber];
    if (failure) {
      process.stderr.write(failure);
      process.exit(1);
    }
    const events = (state.issueEvents || {})[issueNumber] || [];
    process.stdout.write(args.includes('--slurp') ? JSON.stringify([events]) : JSON.stringify(events));
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

  // Issue #493実装ゲート是正: pr-freshness.ts の checkFreshness() が呼ぶ
  // 'gh api repos/<repo>/compare/<base>...<head>'（GitHub REST APIのcompareエンドポイント）。
  // 実GitHubのcompare APIはブランチ名のみをキーとするが、本スタブは直前の 'gh pr view'
  // （mergeStateStatus問い合わせ）が freshnessCompare へ保存した解決結果を、
  // headRef（'gh pr create'/seedOpenPr登録済みブランチ名、または未登録PR向けの
  // 'stub-head-<PR番号>' 規約値のいずれか）から逆引きして返す。
  const compareMatch = /^repos\\/(.+)\\/compare\\/(.+)$/.exec(apiPath || '');
  if (compareMatch && method === 'GET') {
    const compareRepo = compareMatch[1];
    const rest = compareMatch[2];
    const sepIndex = rest.indexOf('...');
    const headRef = sepIndex === -1 ? rest : rest.slice(sepIndex + 3);
    // git のブランチ名に ':' は使えないため、含まれていれば fork PR 向けの
    // '<owner>:<branch>' 修飾形式とみなし、比較・逆引きの対象は branch部分のみとする
    // （<owner>部分自体はrepos/<repo>/...のrepoセグメントに現れる実際のリポジトリ検証のみに使う）。
    const qualifiedMatch = /^([^:]+):(.+)$/.exec(headRef);
    const headBranch = qualifiedMatch ? qualifiedMatch[2] : headRef;
    const stubHeadMatch = /^stub-head-(.+)$/.exec(headBranch);
    let compareKey;
    if (stubHeadMatch) {
      compareKey = stubHeadMatch[1];
    } else {
      const matchedPr = Object.values(state.prsByBranch || {}).find((candidate) => candidate.headRefName === headBranch);
      compareKey = matchedPr ? String(matchedPr.number) : undefined;
    }
    state.compareRepoCalls = state.compareRepoCalls || [];
    state.compareRepoCalls.push({ repo: compareRepo, head: headRef });
    saveState(state);
    const resolved = (compareKey && (state.freshnessCompare || {})[compareKey]) || {};
    if (resolved.compareFail) {
      process.stderr.write('gh-stub: simulated compare api failure\\n');
      process.exit(1);
    }
    const status = resolved.compareStatus !== undefined ? resolved.compareStatus : 'identical';
    const behindBy = typeof resolved.compareBehindBy === 'number' ? resolved.compareBehindBy : 0;
    // Issue #615: 実GitHubのcompare APIは解決済みbase branchのコミットSHAを base_commit.sha
    // として返す。checkFreshness() はこれを FreshnessResult.baseSha の唯一の取得源として使う。
    const baseCommitSha = resolved.baseRefOid || state.defaultBaseRefOid || 'default-base-sha';
    process.stdout.write(
      JSON.stringify({ status, behind_by: behindBy, base_commit: { sha: baseCommitSha } }),
    );
    process.exit(0);
  }

  // Issue #493: pr-freshness.ts の attemptUpdateBranch() が呼ぶ
  // 'gh api -X PUT repos/<repo>/pulls/{n}/update-branch'（<repo>は ':owner/:repo' プレースホルダ、
  // または -R/--repo 由来の実値のいずれか）。<repo> 部分にスラッシュを含むため、
  // '/pulls/(\\d+)/update-branch' までの後方一致で repo 全体を捕捉する。
  const updateBranchMatch = /^repos\\/(.+)\\/pulls\\/(\\d+)\\/update-branch$/.exec(apiPath || '');
  if (updateBranchMatch && method === 'PUT') {
    const repo = updateBranchMatch[1];
    const prNumber = updateBranchMatch[2];
    state.updateBranchCalls = state.updateBranchCalls || [];
    state.updateBranchCalls.push({ repo, prNumber });
    saveState(state);
    if ((state.updateBranchFailures || {})[prNumber]) {
      process.stderr.write('gh-stub: simulated update-branch failure\\n');
      process.exit(1);
    }
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
    const pull = state.pullMetadata || {};
    if (flag('--jq') === '.base.ref + " " + .base.sha + " " + .head.sha') {
      process.stdout.write([pull.base && pull.base.ref, pull.base && pull.base.sha, pull.head && pull.head.sha].join(' ') + '\\n');
    } else {
      process.stdout.write(JSON.stringify(pull));
    }
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
    process.stdout.write(JSON.stringify(state.pullCommits || []));
    process.exit(0);
  }

  const pullCommentsMatch = /\\/pulls\\/(\\d+)\\/comments(?:\\?(.*))?$/.exec(apiPath || '');
  if (pullCommentsMatch && method === 'GET') {
    const prNumber = pullCommentsMatch[1];
    const failure = (state.prReviewThreadCommentFailures || {})[prNumber];
    if (failure) {
      process.stderr.write(failure);
      process.exit(1);
    }
    const params = new URLSearchParams(pullCommentsMatch[2] || '');
    const page = Number(params.get('page') || '1');
    const perPage = Number(params.get('per_page') || '100');
    const comments = (state.prReviewThreadComments || {})[prNumber] || [];
    process.stdout.write(JSON.stringify(comments.slice((page - 1) * perPage, page * perPage)));
    process.exit(0);
  }

  if (/\\/commits\\/[^/]+\\/pulls(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify(state.commitPulls || []));
    process.exit(0);
  }

  if (/\\/pulls\\/\\d+\\/reviews(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify(state.pullReviews || []));
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

  const commitChecksMatch = /\\/commits\\/([^/]+)\\/check-runs(?:\\?(.*))?$/.exec(apiPath || '');
  if (commitChecksMatch && method === 'GET') {
    const params = new URLSearchParams(commitChecksMatch[2] || '');
    const checkName = params.get('check_name');
    const headSha = decodeURIComponent(commitChecksMatch[1]);
    const checkRuns = (state.checkRuns || []).filter((check) =>
      (!checkName || check.name === checkName) && check.head_sha === headSha,
    );
    process.stdout.write(JSON.stringify({ check_runs: checkRuns }));
    process.exit(0);
  }

  if (/\\/actions\\/runs(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    const params = new URLSearchParams((apiPath.split('?')[1] || ''));
    const checkSuiteId = params.get('check_suite_id');
    const headSha = params.get('head_sha');
    const actionRuns = (state.actionRuns || []).filter((run) =>
      (!checkSuiteId || String(run.check_suite_id) === checkSuiteId) && (!headSha || run.head_sha === headSha),
    );
    process.stdout.write(JSON.stringify({ workflow_runs: actionRuns }));
    process.exit(0);
  }

  if (/\\/actions\\/workflows\\/.+\\/runs(?:\\?.*)?$/.test(apiPath || '') && method === 'GET') {
    process.stdout.write(JSON.stringify({ workflow_runs: state.actionRuns || [] }));
    process.exit(0);
  }

  if (/\\/check-runs$/.test(apiPath || '') && method === 'POST') {
    if (state.failCheckRunPost) {
      process.stderr.write(state.failCheckRunPost + '\\n');
      process.exit(1);
    }
    const parsed = JSON.parse(body);
    const id = state.nextId++;
    const checkSuiteId = state.nextCheckSuiteId || 1000;
    state.nextCheckSuiteId = checkSuiteId + 1;
    state.checkRuns = state.checkRuns || [];
    state.checkRuns.push(Object.assign({
      id,
      check_suite: { id: checkSuiteId },
      app: state.checkApp || {
        id: 15368,
        name: 'GitHub Actions',
        slug: state.checkAppSlug || 'github-actions',
      },
    }, parsed));
    state.actionRuns = state.actionRuns || [];
    state.actionRuns.push({
      id: state.nextId++,
      check_suite_id: checkSuiteId,
      head_sha: parsed.head_sha,
      path: state.publishedCheckWorkflowPath || '.github/workflows/agent-skill-chain-gate.yml',
      event: state.publishedCheckWorkflowEvent || 'pull_request_target',
    });
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
  headRefOid?: string | null;
  files: GhStubPrFile[];
  latestReviews?: unknown[];
  reviews?: unknown[];
  comments?: unknown[];
  mergeStateStatus?: string;
  /** ISSUE-619 design-gate再通過分: applyRootCleanupMergeToOriginBaseがadmin merge時に
   * どのbase branchを前進させるかを解決するために保持する。 */
  baseRefName?: string;
}

/** Issue #493: `checkFreshness()` の `gh pr view` 問い合わせ1回ぶんの応答を制御するエントリ。
 * `state`/`mergeStateStatus`/`baseRefOid` は省略したフィールドをそのPRの既定値（またはfresh相当）
 * のまま維持する。
 * Issue #493実装ゲート是正: `compareStatus`/`compareBehindBy` は同じ問い合わせに対応する
 * `gh api .../compare/<base>...<head>` 応答（`checkFreshness()` が最新性判定の唯一の根拠とする側）
 * を独立に制御する。省略した場合は `mergeStateStatus` 由来の既定値（`BEHIND` なら `behind`、
 * それ以外は `identical`）を使う（既存テスト・AC-5回帰防止）。`mergeStateStatus` を `CLEAN`/`BLOCKED`
 * 等にしたまま `compareStatus: 'behind'` を明示することで、「`mergeStateStatus` はBEHIND以外だが
 * 実際にはbehind」という反例（findings merge-state-status-masks-behind）を再現できる。 */
export interface GhStubFreshnessEntry {
  state?: 'OPEN' | 'MERGED' | 'CLOSED';
  mergeStateStatus?: string;
  baseRefOid?: string;
  compareStatus?: 'identical' | 'ahead' | 'behind' | 'diverged';
  compareBehindBy?: number;
  /** trueの場合、このエントリを消費する呼び出し自体を `gh pr view` 失敗として模擬する
   * （マージ成立後のベストエフォート事後確認のみを失敗させる等、呼び出し単位の制御に使う）。 */
  fail?: boolean;
  /** trueの場合、同じ問い合わせに対応する `gh api .../compare/...` 呼び出し自体を失敗として模擬する。 */
  compareFail?: boolean;
}

export interface GhStubState {
  nextId: number;
  clock: number;
  comments: Record<string, { id: string; url: string; body: string; createdAt: string }[]>;
  rulesets: unknown[];
  prs: Record<string, unknown[]>;
  labels: string[];
  labelDetails?: Record<string, { color: string; description: string }>;
  issueLabels: Record<string, string[]>;
  issueEvents?: Record<string, unknown[]>;
  issueEventFailures?: Record<string, string>;
  apiActor?: string;
  defaultBranch?: string;
  checkAppSlug?: string;
  checkApp?: { id: number; name: string; slug?: string };
  checkRuns?: unknown[];
  repositoryId?: number;
  repositoryFullName?: string;
  collaboratorPermissions?: Record<string, string>;
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
  commitPulls?: unknown[];
  pullReviews?: unknown[];
  nextCheckSuiteId?: number;
  publishedCheckWorkflowPath?: string;
  publishedCheckWorkflowEvent?: string;
  failApiPaths?: string[];
  apiCalls?: { method: string; path: string }[];
  prCreateCalls?: { args: string[]; body: string | undefined }[];
  failPrReviewStatusView?: boolean;
  issueViewFailures?: Record<string, string>;
  issueContentResponses?: Record<string, { status?: number; stdout?: string; stderr?: string }>;
  issueCommentFailures?: Record<string, string>;
  prViewFailures?: Record<string, string>;
  prViewCalls?: { key: string; fields: string[]; repo?: string }[];
  prReviewThreadComments?: Record<string, unknown[]>;
  prReviewThreadCommentFailures?: Record<string, string>;
  /** Issue #554: `gh pr edit <n> --add-label <label>` で付与されたラベルをPR番号ごとに記録する。 */
  prLabels?: Record<string, string[]>;
  // ---- Issue #196 release bump/tag/publish・Issue #208 root-cleanup run 検証用
  //      (gh pr view/list/merge, gh release view/create) ----
  prsByBranch?: Record<string, GhStubBumpPr>;
  nextPrNumber?: number;
  defaultPrFiles?: string[];
  defaultPrFileStats?: Record<string, { additions: number; deletions: number }>;
  mergeCalls?: { number: string; args: string[] }[];
  failMergeCount?: number;
  failMergeMessage?: string;
  /** ISSUE-619: 直後の `gh pr create` 呼び出しを count 回だけ失敗させる（PR未作成のまま）。
   * root-cleanup run のAC-5（一時ブランチへのチェックアウト切り替え後・PR作成前後の失敗時も
   * チェックアウト状態が復元されること）の検証用。failMergeCount/failMergeMessageと同型。 */
  failPrCreateCount?: number;
  failPrCreateMessage?: string;
  advanceMainOnNextMerge?: boolean;
  applyMergedPrToMain?: boolean;
  releases?: string[];
  releaseCreateCalls?: { args: string[] }[];
  // ---- Issue #354 issue-sync 検証用（gh issue/pr view --json body・edit --body-file） ----
  issueBodies?: Record<string, string>;
  prBodies?: Record<string, string>;
  issueEditBodyCalls?: { number: string }[];
  prEditBodyCalls?: { number: string }[];
  bodyRaceRemaining?: number;
  bodyRaceSeq?: number;
  // ---- Issue #493 pr merge base freshness 検証用 ----
  /** PR番号ごとの `gh pr view <target> --json ...mergeStateStatus...` 応答キュー。
   * 呼び出しのたび先頭から1件ずつ消費し、末尾到達後は最後のエントリを維持する。未設定の場合は
   * 既定でfresh相当（state: OPEN, mergeStateStatus: CLEAN）を返す（AC-5の回帰防止）。
   * `baseRefOid`（各エントリの base branch コミットSHA）は Issue #615 是正後、`gh pr view` の
   * 応答フィールドではなく compare API 応答（`base_commit.sha`）としてのみ経由する。 */
  prFreshnessQueues?: Record<string, GhStubFreshnessEntry[]>;
  prFreshnessCallCounts?: Record<string, number>;
  defaultBaseRefOid?: string;
  /** Issue #493実装ゲート是正: 直前の `gh pr view`（mergeStateStatus問い合わせ）が解決した
   * `compareStatus`/`compareBehindBy`/`compareFail`/`baseRefOid`（Issue #615: compare API応答の
   * `base_commit.sha`として使う）を、PR番号（正規化済みキー）ごとに引き継ぐ。後続の
   * `gh api .../compare/...` 呼び出しがheadRef経由でこのキーを逆引きして読む。 */
  freshnessCompare?: Record<
    string,
    { compareStatus?: string; compareBehindBy?: number; compareFail?: boolean; baseRefOid?: string }
  >;
  /** `resolveMergeTarget()` のcwdベース暗黙解決フォールバック（'gh pr view --json number'）を
   * 強制失敗させる。 */
  failImplicitPrResolution?: boolean;
  updateBranchCalls?: { repo: string; prNumber: string }[];
  /** PR番号ごとに `gh api -X PUT .../update-branch` 呼び出し自体を失敗させる。 */
  updateBranchFailures?: Record<string, boolean>;
  /** Issue #493実装ゲート2回目是正: PR番号（正規化済みキー）ごとの、`gh pr view` が返す
   * `url`/`isCrossRepository`/`headRepositoryOwner` の明示投入値。fork由来PR・cwdの既定
   * リポジトリと異なるリポジトリのPRを再現するために使う。未設定時は既定リポジトリ・
   * 非fork（`isCrossRepository: false`）として扱う。 */
  prCrossRepoInfo?: Record<string, { repoFullName?: string; url?: string; isCrossRepository?: boolean; headRepositoryOwner?: { login: string } }>;
  /** `gh api repos/<repo>/compare/<base>...<head>` 呼び出しごとの repo セグメント・head引数の記録
   * （fork PRのhead修飾・対象リポジトリの検証に使う）。 */
  compareRepoCalls?: { repo: string; head: string }[];
  /** ISSUE-593: `gh api -X POST .../check-runs` を強制失敗させる（個人アカウント認証による
   * Check Run発行不能を再現し、失敗時もsyncGateArtifacts()が独立して試行されることを検証する）。 */
  failCheckRunPost?: string;
}

export interface GhStub {
  binDir: string;
  statePath: string;
  env(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  readState(): GhStubState;
  writeState(state: GhStubState): void;
  seedPrList(branch: string, prs: unknown[]): void;
  seedPrReviews(prNumber: number, reviews: unknown[]): void;
  seedPrComments(prNumber: number, comments: unknown[]): void;
  seedPrReviewThreadComments(prNumber: number, comments: unknown[]): void;
  seedPrReviewThreadCommentsFailure(prNumber: number, failure: { stderr: string }): void;
  seedIssueViewFailure(issueNumber: string, failure: { stderr: string }): void;
  seedIssueContentResponse(
    issueNumber: string,
    response?: { status?: number; stdout?: string; stderr?: string },
  ): void;
  seedIssueEvents(issueNumber: string, events: unknown[]): void;
  seedIssueEventsFailure(issueNumber: string, stderr: string): void;
  seedIssueCommentFailure(issueNumber: string, failure: { stderr: string }): void;
  seedPrViewFailure(branch: string, failure: { stderr: string }): void;
  /** doctor の「GitHub labels同期」検査（`gh label list`）向けに、実リポジトリに存在するラベルを
   * 直接投入する（Issue #272）。`label create` を経由せず、既存ラベルが定義と食い違う状態や、
   * 定義の一部が欠けている状態を直接再現するために使う。 */
  seedLabels(labels: { name: string; color: string; description: string }[]): void;
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
  /** ISSUE-619: 直後の `gh pr create` 呼び出しを count 回だけ失敗させる（PR未作成のまま）。
   * root-cleanup run AC-5（一時ブランチへのチェックアウト切り替え後、PR作成前後の失敗時にも
   * チェックアウト状態が実行前へ復元されること）の検証用。 */
  failNextPrCreate(count?: number, message?: string): void;
  /** Issue #266: 最初のmerge要求時にmainを実際に前進させ、GitHubのbase更新競合を返す。
   * 次の成功mergeはテスト用remoteのmainへ反映し、tag/publish後続契約まで検証可能にする。 */
  simulateBaseBranchRaceOnNextMerge(): void;
  /** Issue #354: `gh issue view <n> --json body` が返す本文を直接投入する。 */
  seedIssueBody(issueNumber: string, body: string): void;
  /** Issue #425: `gh issue view <n> --json labels` が返すラベル一覧を直接投入する
   * （`issue edit --add-label` を経由せず、任意のラベル状態を再現するために使う）。 */
  seedIssueLabels(issueNumber: string, labels: string[]): void;
  /** Issue #354: `gh pr list --state open` が返す open PR を1件投入する（本文つき）。 */
  seedOpenPr(pr: {
    number: number;
    headRefName: string;
    headRefOid?: string | null;
    body: string;
    state?: 'OPEN' | 'CLOSED' | 'MERGED';
  }): void;
  /** Issue #354: 本文読み取り count 回ぶん、読み取り直後に別プロセスがマーカー区間を
   * 書き換えた状態を再現する（読み直し比較による競合検知の発火条件）。 */
  simulateConcurrentBodyWrites(count: number): void;
  /** Issue #493: `checkFreshness()` が対象PR番号へ問い合わせるたびに先頭から1件ずつ消費する
   * 応答キューを設定する（末尾到達後は最後のエントリを維持）。BEHIND→CLEANの複数回ポーリング、
   * ポーリング中に対象PRがOPENでなくなるケース等を再現するために使う。 */
  seedPrFreshnessQueue(prNumber: number, queue: GhStubFreshnessEntry[]): void;
  /** Issue #493: `resolveMergeTarget()` のcwdベース暗黙解決フォールバック
   * （'gh pr view --json number'、対象識別子省略時）を強制失敗させる。 */
  failImplicitPrResolution(): void;
  /** Issue #493: 指定PR番号への `gh api -X PUT .../update-branch` 呼び出し自体を失敗させる
   * （コンフリクト等でAPI呼び出しそのものが非0終了する状況を再現する）。 */
  failUpdateBranch(prNumber: number): void;
  /** Issue #493実装ゲート2回目是正: 指定PR番号への `gh pr view` が返す
   * `url`/`isCrossRepository`/`headRepositoryOwner` を明示投入する（fork由来PR、cwdの既定
   * リポジトリと異なるリポジトリのPRを再現するために使う）。 */
  seedPrCrossRepoInfo(
    prNumber: number,
    info: { repoFullName?: string; url?: string; isCrossRepository?: boolean; headRepositoryOwner?: { login: string } },
  ): void;
  /** ISSUE-593: 以後の `gh api -X POST .../check-runs` を強制失敗させる（個人アカウント認証による
   * Check Run発行不能を再現する）。 */
  failCheckRunPost(stderr: string): void;
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
    seedPrReviews(prNumber: number, reviews: unknown[]): void {
      const state = this.readState();
      const pr = Object.values(state.prsByBranch ?? {}).find((candidate) => candidate.number === prNumber);
      if (!pr) throw new Error(`gh-stub: PR #${prNumber} が登録されていません`);
      pr.reviews = reviews;
      this.writeState(state);
    },
    seedPrComments(prNumber: number, comments: unknown[]): void {
      const state = this.readState();
      const pr = Object.values(state.prsByBranch ?? {}).find((candidate) => candidate.number === prNumber);
      if (!pr) throw new Error(`gh-stub: PR #${prNumber} が登録されていません`);
      pr.comments = comments;
      this.writeState(state);
    },
    seedPrReviewThreadComments(prNumber: number, comments: unknown[]): void {
      const state = this.readState();
      state.prReviewThreadComments = {
        ...(state.prReviewThreadComments ?? {}),
        [String(prNumber)]: comments,
      };
      this.writeState(state);
    },
    seedPrReviewThreadCommentsFailure(prNumber: number, failure: { stderr: string }): void {
      const state = this.readState();
      state.prReviewThreadCommentFailures = {
        ...(state.prReviewThreadCommentFailures ?? {}),
        [String(prNumber)]: failure.stderr,
      };
      this.writeState(state);
    },
    seedIssueViewFailure(issueNumber: string, failure: { stderr: string }): void {
      const state = this.readState();
      state.issueViewFailures = { ...(state.issueViewFailures ?? {}), [issueNumber]: failure.stderr };
      this.writeState(state);
    },
    seedIssueContentResponse(
      issueNumber: string,
      response?: { status?: number; stdout?: string; stderr?: string },
    ): void {
      const state = this.readState();
      state.issueContentResponses = { ...(state.issueContentResponses ?? {}) };
      if (response === undefined) delete state.issueContentResponses[issueNumber];
      else state.issueContentResponses[issueNumber] = response;
      this.writeState(state);
    },
    seedIssueCommentFailure(issueNumber: string, failure: { stderr: string }): void {
      const state = this.readState();
      state.issueCommentFailures = { ...(state.issueCommentFailures ?? {}), [issueNumber]: failure.stderr };
      this.writeState(state);
    },
    seedPrViewFailure(branch: string, failure: { stderr: string }): void {
      const state = this.readState();
      state.prViewFailures = { ...(state.prViewFailures ?? {}), [branch]: failure.stderr };
      this.writeState(state);
    },
    seedLabels(labels: { name: string; color: string; description: string }[]): void {
      const state = this.readState();
      state.labels = labels.map((l) => l.name);
      state.labelDetails = Object.fromEntries(labels.map((l) => [l.name, { color: l.color, description: l.description }]));
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
    failNextPrCreate(count = 1, message?: string): void {
      const state = this.readState();
      state.failPrCreateCount = count;
      if (message === undefined) delete state.failPrCreateMessage;
      else state.failPrCreateMessage = message;
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
    seedIssueBody(issueNumber: string, body: string): void {
      const state = this.readState();
      state.issueBodies = { ...(state.issueBodies ?? {}), [issueNumber]: body };
      this.writeState(state);
    },
    seedIssueLabels(issueNumber: string, labels: string[]): void {
      const state = this.readState();
      state.issueLabels = { ...(state.issueLabels ?? {}), [issueNumber]: labels };
      this.writeState(state);
    },
    seedIssueEvents(issueNumber: string, events: unknown[]): void {
      const state = this.readState();
      state.issueEvents = { ...(state.issueEvents ?? {}), [issueNumber]: events };
      this.writeState(state);
    },
    seedIssueEventsFailure(issueNumber: string, stderr: string): void {
      const state = this.readState();
      state.issueEventFailures = { ...(state.issueEventFailures ?? {}), [issueNumber]: stderr };
      this.writeState(state);
    },
    seedOpenPr(pr: {
      number: number;
      headRefName: string;
      headRefOid?: string | null;
      body: string;
      state?: 'OPEN' | 'CLOSED' | 'MERGED';
    }): void {
      const state = this.readState();
      state.prsByBranch = {
        ...(state.prsByBranch ?? {}),
        [pr.headRefName]: {
          number: pr.number,
          state: pr.state ?? 'OPEN',
          headRefName: pr.headRefName,
          ...(pr.headRefOid !== undefined ? { headRefOid: pr.headRefOid } : {}),
          files: [],
        },
      };
      state.prBodies = { ...(state.prBodies ?? {}), [String(pr.number)]: pr.body };
      this.writeState(state);
    },
    simulateConcurrentBodyWrites(count: number): void {
      const state = this.readState();
      state.bodyRaceRemaining = count;
      this.writeState(state);
    },
    seedPrFreshnessQueue(prNumber: number, queue: GhStubFreshnessEntry[]): void {
      const state = this.readState();
      state.prFreshnessQueues = { ...(state.prFreshnessQueues ?? {}), [String(prNumber)]: queue };
      state.prFreshnessCallCounts = { ...(state.prFreshnessCallCounts ?? {}), [String(prNumber)]: 0 };
      this.writeState(state);
    },
    failImplicitPrResolution(): void {
      const state = this.readState();
      state.failImplicitPrResolution = true;
      this.writeState(state);
    },
    failUpdateBranch(prNumber: number): void {
      const state = this.readState();
      state.updateBranchFailures = { ...(state.updateBranchFailures ?? {}), [String(prNumber)]: true };
      this.writeState(state);
    },
    seedPrCrossRepoInfo(
      prNumber: number,
      info: { repoFullName?: string; url?: string; isCrossRepository?: boolean; headRepositoryOwner?: { login: string } },
    ): void {
      const state = this.readState();
      state.prCrossRepoInfo = { ...(state.prCrossRepoInfo ?? {}), [String(prNumber)]: info };
      this.writeState(state);
    },
    failCheckRunPost(stderr: string): void {
      const state = this.readState();
      state.failCheckRunPost = stderr;
      this.writeState(state);
    },
  };
}
