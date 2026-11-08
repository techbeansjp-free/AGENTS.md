// Phase 0 (#1648) idea C: extract candidate decision-point events from Codex rollouts and Claude Code transcripts.
// Usage: node phase0-decisions.mjs <out.json> <since ISO> <log.jsonl[.zst]>...
// Each real user message is emitted with the immediately preceding assistant text, stop-phrase hits in it, and the
// owner-gated commands (merge/push/contract/protection) the agent ran since the previous user message.
// Output contains message text and must stay outside the repository; only counts are committed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [outFile, since, ...files] = process.argv.slice(2);
const STOP = /確認してください|承認をお願い|承認が必要|承認待ち|進めてよい|進めてもよい|よろしいですか|よいですか|いいですか|進めますか|着手しますか|しますか[？?]|どうしますか|どちらに|ご判断|判断をお願い|判断してください|指示をください|指示をお願い|選んでください|いかがでしょう|お待ちします|止めます|停止します|保留します/g;
const GATED = [
  ['merge', /\bgh\s+pr\s+merge\b|\bgit\s+merge\b(?!-base)/],
  ['push', /\bgit\s+push\b/],
  ['prCreate', /\bgh\s+pr\s+create\b|\bpr\s+create\b/],
  ['admin', /--admin\b/],
  ['protection', /branches\/[^\s/]+\/protection|rulesets?\b/],
  ['contract', /quality[-_ ]contract|OWNER_APPROVAL/i],
  ['forcePush', /push\s+[^\n]*(--force|-f\b)/],
];
const NOISE = [/^<environment_context>/, /^<recommended_plugins>/, /^# AGENTS\.md instructions/, /^<user_instructions>/, /^<turn_aborted>/, /^<subagent_notification>/, /^<command-(name|message)>/, /^<local-command-/, /^Caveat:/, /^\[Request interrupted/, /^<task-notification>/, /^<external_codex_apps_open_page>/, /^<codex_internal_context/, /^# Context from my IDE setup:/, /^<system-reminder>/];
const realText = (t) => {
  if (!t) return null;
  const m = t.match(/## My request(?: for Codex)?:/);
  const s = (m ? t.slice(m.index + m[0].length) : t).trim();
  return !s || NOISE.some((r) => r.test(s)) ? null : s;
};
const gated = (cmd) => GATED.filter(([, r]) => r.test(cmd)).map(([k]) => k);

function parse(file) {
  const out = { file: path.basename(file), id: null, kind: 'top', cwd: null, events: [] };
  const raw = fs.readFileSync(file);
  for (const line of (file.endsWith('.zst') ? zlib.zstdDecompressSync(raw) : raw).toString('utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const ts = j.timestamp;
    if (j.type === 'session_meta') {
      const p = j.payload; out.id = p.id; out.cwd = p.cwd;
      if (p.source && typeof p.source === 'object' && p.source.subagent) out.kind = 'child';
    } else if (j.type === 'response_item') {
      const p = j.payload;
      if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) out.events.push({ ts, role: p.role, text: (p.content || []).map((c) => c.text || '').join('\n') });
      else if (p.type === 'function_call' || p.type === 'custom_tool_call') out.events.push({ ts, role: 'tool', text: String(p.arguments ?? p.input ?? '') });
    } else if (j.type === 'user' || j.type === 'assistant') {
      out.id ??= j.sessionId; out.cwd ??= j.cwd;
      if (j.isSidechain) out.kind = 'child';
      const c = j.message?.content;
      if (j.type === 'user') {
        if (j.isMeta || j.toolUseResult) continue;
        const t = typeof c === 'string' ? c : Array.isArray(c) && c.every((x) => x.type === 'text') ? c.map((x) => x.text).join('\n') : null;
        if (t != null) out.events.push({ ts, role: 'user', text: t });
      } else for (const x of Array.isArray(c) ? c : []) {
        if (x.type === 'text') out.events.push({ ts, role: 'assistant', text: x.text });
        else if (x.type === 'tool_use') out.events.push({ ts, role: 'tool', text: JSON.stringify(x.input ?? {}) });
      }
    }
  }
  if (/\/subagents\//.test(file)) out.kind = 'child';
  return out;
}

const sessions = [];
const candidates = [];
const guardian = []; // Codex auto-review verdicts on escalated actions: does the Host already stop owner-gated operations?
for (const f of files) {
  const s = parse(f);
  let req = '';
  for (const e of s.events) {
    if (e.role === 'user') { req = e.text.slice(-2000); continue; }
    if (e.role !== 'assistant' || !e.text.trimStart().startsWith('{')) continue;
    let v; try { v = JSON.parse(e.text); } catch { continue; }
    if (v.outcome && !(since && e.ts < since)) guardian.push({ session: s.id, ts: e.ts, outcome: v.outcome, gated: gated(req), rationale: v.outcome === 'allow' ? undefined : v.rationale });
  }
  const users = [];
  let lastA = null, tools = [], prevUserTs = null;
  for (const e of s.events) {
    if (e.role === 'assistant') { if (e.text.trim()) lastA = e; continue; }
    if (e.role === 'tool') { const g = gated(e.text); if (g.length) tools.push({ ts: e.ts, gated: g, cmd: e.text.slice(0, 300) }); continue; }
    const t = realText(e.text);
    if (!t || (since && e.ts < since)) continue;
    const next = s.events.slice(s.events.indexOf(e) + 1).find((x) => x.role === 'assistant' && x.text.trim());
    users.push({
      session: s.id, file: s.file, kind: s.kind, ts: e.ts, prevUserTs,
      gapSec: lastA ? Math.round((Date.parse(e.ts) - Date.parse(lastA.ts)) / 1000) : null,
      user: t.slice(0, 1500),
      prevAssistant: lastA ? lastA.text.slice(-1500) : null,
      stopHits: lastA ? [...new Set(lastA.text.slice(-800).match(STOP) ?? [])] : [],
      gatedSincePrevUser: tools,
      nextAssistant: next ? next.text.slice(0, 600) : null,
    });
    prevUserTs = e.ts; tools = [];
  }
  sessions.push({ session: s.id, file: s.file, kind: s.kind, cwd: s.cwd, userMessages: users.length });
  if (s.kind === 'top') candidates.push(...users);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ since, sessions, guardian, candidates }, null, 1));
console.log(JSON.stringify({ sessions: sessions.length, top: sessions.filter((s) => s.kind === 'top').length, candidates: candidates.length, stopHit: candidates.filter((c) => c.stopHits.length).length, guardianDeny: guardian.filter((g) => g.outcome !== 'allow').length }));
