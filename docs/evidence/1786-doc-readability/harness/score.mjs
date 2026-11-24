// 回答を固定gold（gold.json）で採点する読取りだけのscript（#1786）。
// 使い方: node score.mjs <runsDir> [outJson]
// runsDir の各 <case>-<cond>-<rep>.json は run.mjs の記録（result に回答の原文）。
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const evDir = path.resolve(here, '..');

export const norm = (s) => String(s ?? '').replace(/[\s　「」『』"“”]/gu, '');

function matches(quote, anchor) {
  const q = norm(quote);
  const a = norm(anchor);
  if (!q || !a) return false;
  return q.includes(a) || (q.length >= 8 && a.includes(q));
}

export function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(t);
  if (fence) t = fence[1];
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return { ok: true, value: JSON.parse(t.slice(s, e + 1)), recovered: true };
      } catch {
        /* fallthrough */
      }
    }
    return { ok: false, error: 'invalid-json' };
  }
}

function sections(md) {
  const out = [];
  let cur = { heading: '', body: '' };
  for (const line of String(md).split('\n')) {
    if (/^#{1,6}\s/u.test(line)) {
      out.push(cur);
      cur = { heading: line, body: '' };
    } else cur.body += `${line}\n`;
  }
  out.push(cur);
  return out;
}

export function scoreReview(caseId, text, gold, documentText) {
  const g = gold.review[caseId];
  const p = parseJson(text);
  if (!p.ok || !Array.isArray(p.value?.findings)) return { valid: false, error: p.ok ? 'no-findings-array' : p.error };
  const findings = p.value.findings.filter((f) => f && typeof f === 'object');
  const docN = norm(documentText);
  const hit = (d) =>
    findings.some(
      (f) =>
        d.docAnchors.some((a) => matches(f.quote, a)) ||
        d.keywords.some((k) => norm(f.source_quote).includes(norm(k)) || norm(f.reason).includes(norm(k))),
    );
  const detected = g.defects.filter(hit).map((d) => d.id);
  const missed = g.defects.filter((d) => !hit(d)).map((d) => d.id);
  const isRedundancyClaim = (f) => /冗長|重複/u.test(String(f.type ?? '')) || f.action === '削除';
  const harmful = [];
  for (const k of g.keeps) {
    if (findings.some((f) => k.docAnchors.some((a) => matches(f.quote, a)) && isRedundancyClaim(f))) harmful.push(k.id);
  }
  const cleanFlagged = g.clean.filter((c) => findings.some((f) => matches(f.quote, c) && (f.action === '修正' || f.action === '削除'))).length;
  const misquoted = findings.filter((f) => norm(f.quote) && !docN.includes(norm(f.quote))).length;
  const goldAnchors = [...g.defects.flatMap((d) => d.docAnchors), ...g.keeps.flatMap((k) => k.docAnchors), ...g.clean];
  const goldKeywords = g.defects.flatMap((d) => d.keywords);
  const unmatched = findings.filter(
    (f) =>
      !goldAnchors.some((a) => matches(f.quote, a)) &&
      !goldKeywords.some((k) => norm(f.source_quote).includes(norm(k)) || norm(f.reason).includes(norm(k))),
  ).length;
  const res = {
    valid: true,
    recovered: Boolean(p.recovered),
    defects: g.defects.length,
    detected,
    missed,
    recall: detected.length / g.defects.length,
    harmful,
    cleanFlagged,
    misquoted,
    unmatched,
    findings: findings.length,
  };
  if (g.revisedChecks) {
    const rev = typeof p.value.revised === 'string' ? p.value.revised : '';
    const checks = {};
    for (const c of g.revisedChecks) {
      let scope = rev;
      if (c.section) {
        scope = sections(rev)
          .filter((s) => s.heading.includes(c.section) && !(c.sectionExclude && s.heading.includes(c.sectionExclude)))
          .map((s) => s.body)
          .join('\n');
      }
      const okAll = (c.all ?? []).every((w) => norm(scope).includes(norm(w)));
      const okNone = (c.none ?? []).every((w) => !norm(scope).includes(norm(w)));
      checks[c.id] = Boolean(rev) && Boolean(scope) && okAll && okNone;
    }
    res.revised = { present: Boolean(rev), chars: rev.length, checks, retained: Object.values(checks).filter(Boolean).length, total: g.revisedChecks.length };
  }
  return res;
}

export function scoreReader(caseId, text, gold) {
  const g = gold.reader[caseId];
  const p = parseJson(text);
  if (!p.ok || typeof p.value?.answers !== 'object' || p.value.answers === null) return { valid: false, error: p.ok ? 'no-answers' : p.error };
  const ans = p.value.answers;
  let correct = 0;
  let misread = 0;
  let unknownQ = 0;
  let unknownOk = 0;
  let overUnknown = 0;
  let wrongDirection = 0;
  let missing = 0;
  const perQ = {};
  for (const [q, ok] of Object.entries(g.answers)) {
    const raw = ans[q];
    const choice = String((raw && typeof raw === 'object' ? raw.choice : raw) ?? '').trim().slice(0, 1).toUpperCase();
    perQ[q] = choice;
    const undeterminable = ok.every((c) => c === 'X' || c === 'Y');
    if (undeterminable) unknownQ++;
    if (!choice) {
      missing++;
      continue;
    }
    if (ok.includes(choice)) {
      correct++;
      if (undeterminable) unknownOk++;
    } else if (choice === 'X' || choice === 'Y') overUnknown++;
    else misread++;
    if (g.wrongDirection?.[q]?.includes(choice)) wrongDirection++;
  }
  const quotes = [
    ...(Array.isArray(p.value.ambiguities) ? p.value.ambiguities.map((a) => a?.quote) : []),
    ...(Array.isArray(p.value.unknowns) ? p.value.unknowns.map((u) => u?.related_quote) : []),
  ];
  const ambDetected = g.ambiguityAnchors.filter((a) => quotes.some((q) => a.anchors.some((x) => matches(q, x)))).map((a) => a.id);
  return {
    valid: true,
    recovered: Boolean(p.recovered),
    questions: Object.keys(g.answers).length,
    correct,
    misread,
    unknownQ,
    unknownOk,
    overUnknown,
    wrongDirection,
    missing,
    perQ,
    ambiguityGold: g.ambiguityAnchors.length,
    ambDetected,
    ambiguitiesReported: Array.isArray(p.value.ambiguities) ? p.value.ambiguities.length : 0,
    unknownsReported: Array.isArray(p.value.unknowns) ? p.value.unknowns.length : 0,
  };
}

export function scoreRecord(rec, gold) {
  const doc = fs.readFileSync(path.join(evDir, 'cases', rec.case, 'document.md'), 'utf8');
  return rec.case.startsWith('R') ? scoreReview(rec.case, rec.result, gold, doc) : scoreReader(rec.case, rec.result, gold);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [runsDir, outJson] = process.argv.slice(2);
  const gold = JSON.parse(fs.readFileSync(path.join(evDir, 'gold.json'), 'utf8'));
  const rows = [];
  for (const f of fs.readdirSync(runsDir).filter((x) => /^[RP]\d-[ABC]-\d\.json$/u.test(x)).sort()) {
    const rec = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
    rows.push({ key: f.replace(/\.json$/u, ''), case: rec.case, cond: rec.cond, rep: rec.rep, metrics: rec.metrics, score: scoreRecord(rec, gold) });
  }
  const out = JSON.stringify(rows, null, 1);
  if (outJson) fs.writeFileSync(outJson, `${out}\n`);
  else process.stdout.write(`${out}\n`);
}
