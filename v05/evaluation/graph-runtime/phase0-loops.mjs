// Phase 0 (#1648) idea A: would an explicit loop-termination rule (round cap + escalation) have shortened merged PRs?
// Reconstructs remediation rounds R per PR from GitHub only: a round is the group of non-merge commits pushed after a
// review result (CodeRabbit review with findings, or a non-bot review-thread root / PR comment) that arrived after the
// previous round began. Commits after PR creation that follow no review result are self-driven, not a round.
// Variants for sensitivity (PHASE0_PROTOCOL.md A): L = literal (GitHub-visible review results only);
// M = L plus commits whose headline says they remediate a review finding (local independent review, not on GitHub);
// B = upper bound, every burst of post-creation commits separated by > BURST_GAP_MIN is a round;
// D = L plus independent remediation rounds stated in the PR body (manual, optional classification file; no timestamps);
// X = max(B, D) per PR, the most generous count. D and X have no round times, so they only feed the R>=3 share.
// Usage: node phase0-loops.mjs <out.json> [classification.json] [windows.json]   (repo from GH_REPO or the cwd's gh default)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [outFile, classFile, windowsFile] = process.argv.slice(2);
if (!outFile) throw new Error('usage: phase0-loops.mjs <out.json> [classification.json] [windows.json]');
const SINCE = process.env.PHASE0_SINCE || '2026-10-16', UNTIL = process.env.PHASE0_UNTIL || '2026-11-08', BURST_GAP_MIN = 20;
const gh = (args, tries = 3) => {
  try { return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })); } catch (e) { if (tries <= 1) throw e; return gh(args, tries - 1); } // network timeouts are transient
};
const repo = process.env.GH_REPO || gh(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
const [owner, name] = repo.split('/');
const BOT = /\[bot\]$|^coderabbitai$|^github-actions$/;
// A review result must carry findings; an empty-bodied CodeRabbit review is a reply inside an existing thread.
const crFindings = (b) => { const m = /Actionable comments posted: (\d+)/.exec(b); return (m ? +m[1] : 0) + (/Outside diff range comments|Nitpick comments \(\d+\)/.test(b) ? 1 : 0); };
// Headline of a commit that remediates a review finding (the repo's product is review tooling, so bare "review" is not enough).
const REMEDIATION = /指摘|review findings?|address(?:es|ed)? .*review|CodeRabbit/i;

const Q = `query($o:String!,$n:String!,$pr:Int!,$c:String,$r:String,$k:String,$t:String){repository(owner:$o,name:$n){pullRequest(number:$pr){
 number createdAt mergedAt author{login} mergeCommit{oid} allCommits:commits{totalCount}
 commits(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{commit{oid authoredDate committedDate messageHeadline parents{totalCount}}}}
 reviews(first:100,after:$r){pageInfo{hasNextPage endCursor} nodes{author{login} submittedAt body}}
 comments(first:100,after:$k){pageInfo{hasNextPage endCursor} nodes{author{login} createdAt body}}
 reviewThreads(first:100,after:$t){pageInfo{hasNextPage endCursor} nodes{comments(first:1){nodes{author{login} createdAt body}}}}}}}`;
function fetchPr(pr) {
  // Page each connection independently; a finished connection is still requested (one query) but its nodes are ignored.
  const conns = { commits: 'c', reviews: 'r', comments: 'k', reviewThreads: 't' }, acc = {}, cur = {}, done = {};
  for (const f of Object.keys(conns)) acc[f] = [];
  let head;
  while (Object.keys(conns).some((f) => !done[f])) {
    const args = ['api', 'graphql', '-f', `query=${Q}`, '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `pr=${pr}`];
    for (const [f, v] of Object.entries(conns)) if (cur[f]) args.push('-f', `${v}=${cur[f]}`);
    const p = gh(args).data.repository.pullRequest; head ??= p;
    for (const f of Object.keys(conns)) if (!done[f]) { acc[f].push(...p[f].nodes); if (p[f].pageInfo.hasNextPage) cur[f] = p[f].pageInfo.endCursor; else done[f] = true; }
  }
  return { ...head, ...acc };
}

const gitCommits = (m) => execFileSync('git', ['log', '--format=%aI%x09%cI%x09%P%x09%s', `${m}^1..${m}^2`], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n')
  .map((l) => { const [a, c, par, ...h] = l.split('\t'); return { at: Date.parse(c), authored: Date.parse(a), merge: par.split(' ').length > 1, head: h.join('\t') }; });
const t = (s) => Date.parse(s), iso = (ms) => (ms == null ? null : new Date(ms).toISOString()), hours = (ms) => +(ms / 36e5).toFixed(2);
function rounds(commits, events) {
  // commits: [{at}], events: sorted ms; a round opens at the first commit after an event later than the last round start.
  const out = []; let last = -Infinity;
  for (const c of commits) {
    const ev = events.filter((e) => e > last && e < c.at);
    if (ev.length) { out.push({ start: c.at, trigger: ev[0], commits: 1 }); last = c.at; } else if (out.length && c.at >= out.at(-1).start) out.at(-1).commits++;
  }
  return out;
}
function bursts(commits) {
  const out = [];
  for (const c of commits) { if (!out.length || c.at - out.at(-1).end > BURST_GAP_MIN * 6e4) out.push({ start: c.at, end: c.at, commits: 1 }); else { out.at(-1).end = c.at; out.at(-1).commits++; } }
  return out;
}

const list = gh(['pr', 'list', '-R', repo, '--state', 'merged', '--search', `merged:${SINCE}..${UNTIL}`, '--limit', '500', '--json', 'number']).map((p) => p.number).sort((a, b) => a - b);
const manual = classFile && fs.existsSync(classFile) ? Object.fromEntries(JSON.parse(fs.readFileSync(classFile, 'utf8')).prs.map((x) => [x.pr, x])) : {};
const prs = [];
for (const n of list) {
  const p = fetchPr(n), created = t(p.createdAt), merged = t(p.mergedAt);
  let all = p.commits.map(({ commit: c }) => ({ at: t(c.committedDate), authored: t(c.authoredDate), merge: c.parents.totalCount > 1, head: c.messageHeadline }));
  // GitHub caps PR commit listings at 250; past that, read the merge commit's second-parent side from the local clone.
  if (p.allCommits.totalCount > all.length && p.mergeCommit) all = gitCommits(p.mergeCommit.oid);
  all.sort((a, b) => a.at - b.at);
  const work = all.filter((c) => !c.merge), pre = work.filter((c) => c.at <= created), post = work.filter((c) => c.at > created);
  const ev = [];
  for (const r of p.reviews) if (r.author && BOT.test(r.author.login) && crFindings(r.body) > 0) ev.push({ at: t(r.submittedAt), src: 'coderabbit', findings: crFindings(r.body) });
  for (const th of p.reviewThreads) { const c = th.comments.nodes[0]; if (c?.author && !BOT.test(c.author.login)) ev.push({ at: t(c.createdAt), src: 'human-thread' }); }
  for (const c of p.comments) if (c.author && !BOT.test(c.author.login) && !/^\s*@coderabbitai\b/.test(c.body) && !/への対応|対応しました|addressed/i.test(c.body)) ev.push({ at: t(c.createdAt), src: 'human-comment' });
  ev.sort((a, b) => a.at - b.at);
  const evL = ev.map((e) => e.at), evM = [...evL, ...post.filter((c) => REMEDIATION.test(c.head)).map((c) => c.at - 1)].sort((a, b) => a - b);
  const rL = rounds(post, evL), rM = rounds(post, evM), rB = bursts(post);
  const firstCommit = Math.min(...all.map((c) => c.authored)), lead = merged - firstCommit;
  const bodyRounds = manual[n]?.bodyIndependentRemediationRounds ?? 0;
  const r3 = (r) => (r.length >= 3 ? r[2].start : null);
  prs.push({
    pr: n, createdAt: p.createdAt, mergedAt: p.mergedAt, firstCommitAt: iso(firstCommit), leadTimeH: hours(lead), prOpenH: hours(merged - created),
    commits: { total: all.length, githubTotal: p.allCommits.totalCount, nonMerge: work.length, prePr: pre.length, postPr: post.length, prePrRemediation: pre.filter((c) => REMEDIATION.test(c.head)).length, postPrRemediation: post.filter((c) => REMEDIATION.test(c.head)).length },
    reviewEvents: ev.map((e) => ({ ...e, at: iso(e.at) })),
    R: { L: rL.length, M: rM.length, B: rB.length, D: rL.length + bodyRounds, X: Math.max(rB.length, rL.length + bodyRounds) },
    roundsL: rL.map((r) => ({ start: iso(r.start), trigger: iso(r.trigger), commits: r.commits })),
    round3Start: { L: iso(r3(rL)), M: iso(r3(rM)), B: iso(r3(rB)) },
    excessH: { L: r3(rL) ? hours(merged - r3(rL)) : 0, M: r3(rM) ? hours(merged - r3(rM)) : 0, B: r3(rB) ? hours(merged - r3(rB)) : 0 },
  });
}

const summarize = (v) => {
  const dist = {}; for (const p of prs) dist[p.R[v]] = (dist[p.R[v]] || 0) + 1;
  const ge3 = prs.filter((p) => p.R[v] >= 3).length, leadSum = prs.reduce((s, p) => s + p.leadTimeH, 0), openSum = prs.reduce((s, p) => s + p.prOpenH, 0);
  const excessSum = v === 'D' || v === 'X' ? null : prs.reduce((s, p) => s + p.excessH[v], 0);
  return { distribution: dist, rGe3: ge3, shareRGe3: +(ge3 / prs.length).toFixed(3), cond1: ge3 / prs.length >= 0.2, excessH: excessSum && +excessSum.toFixed(2), leadSumH: +leadSum.toFixed(2), prOpenSumH: +openSum.toFixed(2), excessShareOfLead: excessSum == null ? null : +(excessSum / leadSum).toFixed(3), excessShareOfPrOpen: excessSum == null ? null : +(excessSum / openSum).toFixed(3), cond2: excessSum == null ? null : excessSum / leadSum >= 0.1 };
};
const recurrences = Object.values(manual).filter((x) => x.sameTypeRecurrence);
const summary = { repo, period: [SINCE, UNTIL], prCount: prs.length, burstGapMin: BURST_GAP_MIN, variants: Object.fromEntries(['L', 'M', 'B', 'D', 'X'].map((v) => [v, summarize(v)])), prePrRemediationCommits: prs.reduce((s, p) => s + p.commits.prePrRemediation, 0), sameTypeRecurrence: recurrences.length, cond3: recurrences.some((x) => x.capWouldShorten) };
fs.writeFileSync(outFile, JSON.stringify({ summary, prs }, null, 1) + '\n');
if (windowsFile) fs.writeFileSync(windowsFile, JSON.stringify(prs.filter((p) => p.round3Start.L || p.round3Start.M || p.round3Start.B).map((p) => ({ pr: p.pr, round3Start: p.round3Start, mergedAt: p.mergedAt })), null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
