// Builds REPOSITORY_GRAPH_EVIDENCE.json from the raw outputs of the other scripts.
// usage: node build-evidence.mjs <config.json>   (the config maps anonymous ids to local clones and output files;
// keep it outside the repository because consumer repository names must not be published)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const summary = (f) => JSON.parse(execFileSync(process.execPath, [path.join(here, 'phase0-summary.mjs'), f], { encoding: 'utf8' }));
const tracked = (dir) => execFileSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean).length;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null; };
const dist = (a) => ({ p50: q(a, 0.5), p95: q(a, 0.95), max: q(a, 1) });
const pick = (a) => ({ multiCommitPRs: a.multiCommitPRs, prsWithLateExistingFiles: a.withLateExisting, lateExistingFiles: a.lateExisting, lateNewFiles: a.newLate,
  recall: { graph: a.graph.recall, importOneHop: a.imp1.recall, importReverseTransitive: a.impRev.recall, sharedId: a.id.recall, sameDirectory: a.sameDir.recall, coChange: a.coChange.recall, baselineUnion: a.baseUnion.recall },
  meanPredictedFiles: { graph: a.graph.meanSize, sameDirectory: a.sameDir.meanSize, coChange: a.coChange.meanSize }, precision: { graph: a.graph.precision, sameDirectory: a.sameDir.precision, coChange: a.coChange.precision },
  graphOnlyLateFiles: a.graphOnly.lateFiles, graphOnlyPrs: a.graphOnly.prs, reviewFix: a.reviewFound });
const equivalence = ({ name, file }) => {
  const [head, ...rows] = lines(file);
  return { repository: name, firstCommit: head.first, codeFilesAtFirst: head.code, edgesAtFirst: head.edges, incrementalUpdates: rows.length,
    probeMismatch: rows.filter((r) => !r.probeEq).length, naiveMismatchCommits: rows.filter((r) => !r.naiveEq).length,
    mutantsKilledCommits: Object.fromEntries(['noAdd', 'noDel', 'noCfg', 'noPkg'].map((m) => [m, rows.filter((r) => r.mut?.[m]).length])),
    incrementalMs: dist(rows.map((r) => r.probeMs)), fullResolveMs: dist(rows.map((r) => r.fullMs)), edgeChurnPerCommit: dist(rows.map((r) => r.churn)) };
};
const out = {
  schema: 'asc-repository-graph-evaluation/v1', issue: 1614, measuredOn: cfg.measuredOn, environment: cfg.environment,
  phase0: { question: 'Do dependency/ID-trace graphs predict existing files a PR touched only after its first commit, beyond same-directory and co-change baselines?',
    method: 'PR heads from refs/pull/*/head; base = first ancestor on the default branch first-parent chain; seeds = first non-merge commit files; late = files touched by later non-merge commits; reviewFix = late files from commits whose message matches the REVIEW pattern in phase0.mjs. Lock files, build output, docs/reviews and the bundled ASC runtime are excluded. JS/TS (and the script blocks of .astro/.vue/.svelte/.mdx) use the TypeScript-checked resolver; Python/PHP/Rust/HCL use unverified lightweight extractors. coChange is size-matched to the graph; sameDirectory is not capped.',
    thresholdPreregistered: false,
    consumers: cfg.consumers.map((c) => ({ id: c.id, language: c.language, trackedFiles: tracked(c.repo), ...pick(summary(c.phase0)) })),
    asc: { id: cfg.asc.id, language: cfg.asc.language, head: execFileSync('git', ['-C', cfg.asc.repo, 'rev-parse', cfg.asc.ref], { encoding: 'utf8' }).trim(), trackedFiles: tracked(cfg.asc.repo), ...pick(summary(cfg.asc.phase0)) } },
  correctness: { historyEquivalence: cfg.equivalence.map(equivalence), syntheticInvalidation: read(cfg.synthetic).verdict,
    resolverVsTypeScript: cfg.oracle.map(({ name, file }) => { const j = read(file); return { repository: name, recall: j.recall, precisionCodeTargets: j.precisionCode, precisionAllTargets: j.precision, counts: j.stat }; }) },
  storage: cfg.storage.map(({ name, file }) => ({ ...read(file), repo: name })), // never publish the local clone path
  contentAddressedResults: cfg.contentAddressed.map(({ name, file }) => ({ ...lines(file)[0], repo: name })), // never publish the local clone path
  syntheticReachability: read(cfg.syntheticReachability),
  traceability: { test262: read(cfg.test262).stat, asc: read(cfg.ascTrace).sample.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'topNever'))) },
  executionHistoryRefs: read(cfg.executionHistoryRefs),
};
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
