// Which ASC files a generation trial actually read (#1815), from the stream-json tool records only.
// A read counts only for a Read tool call whose tool_result exists and is not an error (as #1814 score.mjs). Paths are
// taken relative to the session cwd (init event = sample project root); /private/tmp and /tmp are the same on macOS.
// Grep/Glob hits and the Skill tool are recorded separately and do not count as reading a body or reference: the Skill
// tool loads the thin entry .claude/skills/<name>/SKILL.md, which only links to the body.
import path from 'node:path';
import {parseStream} from '../../1807-design-eval-browser/harness/core-steps.mjs';

// Each target is installed twice by project-assets (skills/ = what the read trigger and the entries point to, and the
// managed-runtime/ copy); a successful Read of either copy counts, and the paths actually read are listed.
const both = (rel) => [`.agent-skill-chain/skills/${rel}`, `.agent-skill-chain/managed-runtime/skills/${rel}`];
export const TARGETS = {
  ascBody: both('asc/SKILL.md'),
  implementation: both('asc/references/implementation.md'),
  ujaBody: both('user-journey-acceptance/SKILL.md'),
  journeys: both('user-journey-acceptance/references/journeys.md'),
};

// Copied from #1814 harness/score.mjs projectRelative (that module also pulls in #1814 scoring).
export function projectRelative(p, root) {
  if (!p || !root) return null;
  const strip = (x) => x.replace(/^\/private(?=\/(tmp|var)\/)/, '');
  const abs = strip(path.posix.normalize(path.posix.isAbsolute(p) ? p : path.posix.join(root, p)));
  const rel = path.posix.relative(strip(path.posix.normalize(root)), abs);
  return rel === '' || rel.startsWith('..') || path.posix.isAbsolute(rel) ? null : rel;
}

export function readRecord(text, {cwd = null} = {}) {
  const {events} = parseStream(text);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? null;
  const root = cwd ?? init?.cwd ?? null;
  const results = new Map();
  for (const e of events) if (e.type === 'user' && Array.isArray(e.message?.content)) for (const c of e.message.content) if (c?.type === 'tool_result') results.set(c.tool_use_id, c);
  const uses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c?.type === 'tool_use'));
  const ok = (u) => { const r = results.get(u.id); return Boolean(r) && r.is_error !== true; };
  const reads = uses.filter((u) => u.name === 'Read' && ok(u)).map((u) => projectRelative(String(u.input?.file_path ?? ''), root));
  const ascReads = [...new Set(reads.filter((r) => r && (r.startsWith('.agent-skill-chain/') || r.startsWith('.claude/'))))].sort();
  const out = Object.fromEntries(Object.entries(TARGETS).map(([k, rels]) => [`${k}Read`, rels.some((r) => reads.includes(r))]));
  // Order of first successful reads of the four targets (when a reference was read before or after the body).
  out.firstReadOrder = Object.entries(TARGETS).map(([k, rels]) => [k, Math.min(...rels.map((r) => reads.indexOf(r)).filter((i) => i >= 0))]).filter(([, i]) => Number.isFinite(i)).sort((a, b) => a[1] - b[1]).map(([k]) => k);
  out.relevantReferenceRead = out.implementationRead || out.journeysRead;
  out.skillCalls = uses.filter((u) => u.name === 'Skill').map((u) => u.input?.skill ?? u.input?.command ?? null);
  out.ascFilesRead = ascReads;
  out.readsOutsideProject = reads.filter((r) => r === null).length;
  out.readAttempts = uses.filter((u) => u.name === 'Read').length;
  const count = {};
  for (const u of uses) count[u.name] = (count[u.name] ?? 0) + 1;
  out.toolCounts = count;
  out.cwd = root;
  return out;
}
