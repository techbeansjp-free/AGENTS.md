// Shared harness (#1840 review H2, re-review High/Medium-1): calibration of the answer markers and the written-file
// checks of a config against answers that earlier evaluations scored (a separate-Context grader), and against answers
// that must fail. Not a fixed module (like dry-run.mjs): it reads the config's calibration.json and cases.json, and writes
// the table the levels are set from. No model call.
// calibration.json: {bases: {<id>: {commit, dir, as}}, sources: [...]}. A base is the set of template files a fixture
// installs (the files under <dir> at <commit>, at the path <as>/<rest>): the lines score.mjs leaves out of a written file
// (cases.json markerBase), and the template lines each marker is checked against. A source is
//   {case, section, scored: [{dir}], form?, as?, base?, answerText?}
//       answers <dir>/<id>.md, keys <dir>/blind-key.json, scores <dir>/scores.json (the 0/1 viewpoint scores; the earlier
//       pass of a case is derived from them: see earlierFromScores). form "written": the answer section is the text of
//       the file <as> the trial wrote, the answer is answerText (default empty), with the lines of base left out.
//   {case, section, commit?, path, condition, earlierPass: true|false|null, note, form?, as?, base?, answerText?}
//       one answer with its recorded result (form "written" as above).
//   {case, condition, mustFail: true, note, base?, answerText, written: [file]}  an answer that must fail (a copied template,
//       its headings and tables, the guide only, one row filled in): the answer text and the written files.
//   {case, condition, earlierPass, note, form: "written", commit, path, base?, answerText?, written: [file]}  written files
//       cut from one recorded answer (e.g. FN-003 and SCR-005 in separate files, with a change log).
// A file is {as, text} or {as, commit?, path?, section?, fromBase?, fromLine?, untilLine?, keep?, replace?}: the text of
// <commit>:<path> (default the source's), or of the base's <dir>/<fromBase>; the "## <section>"; the lines from the first
// matching fromLine up to (not including) the first later untilLine; keep "headingsAndTables" keeps the lines starting
// with # or |; replace [{from, to}] replaces substrings (each must be present).
// Files are read from the working tree, or with `commit` by `git show <commit>:<path>`. A case with answerQuota: each
// group with a viewpoint is compared with that viewpoint's score, and the earlier pass is "at least answerQuota.min of the
// counted viewpoints scored 1". A case with writes: each require/forbid entry with a viewpoint is compared, and the earlier
// pass is "every such viewpoint scored 1"; an answer that is not form "written" is checked as the one written file.
// Usage: node calibrate.mjs [--out <json>] [--md <file>] --config <dir>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO_ROOT, configDir, loadSpec, readCfg} from './config.mjs';
import {markersOk, markerGroupsOf, markerDeductionsOf, writeChecks, groupOk, baseLinesOf, markerTextOf} from './score.mjs';

const show = (commit, p) => {
  if (!commit) return fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
  const r = spawnSync('git', ['show', `${commit}:${p}`], {cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28});
  if (r.status !== 0) throw new Error(`git show ${commit}:${p} failed: ${r.stderr}`);
  return r.stdout;
};
export const sectionOf = (text, name) => (name ? (text.split(/^## /m).find((s) => s.startsWith(`${name}\n`)) ?? null)?.replace(/^[^\n]*\n/, '') ?? null : text);

// The files of a base: [{rel, text}] (rel under <as>).
const baseCache = new Map();
export function baseFiles(b) {
  const key = `${b.commit}:${b.dir}`;
  if (!baseCache.has(key)) {
    const r = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', b.commit, '--', b.dir], {cwd: REPO_ROOT, encoding: 'utf8'});
    if (r.status !== 0 || !r.stdout.trim()) throw new Error(`git ls-tree ${b.commit} ${b.dir} failed: ${r.stderr}`);
    baseCache.set(key, r.stdout.split('\0').filter(Boolean).map((f) => ({rel: `${b.as}/${f.slice(b.dir.length + 1)}`, text: show(b.commit, f)})));
  }
  return baseCache.get(key);
}

// The text of one file of a source (see the header).
export function fileOf(f, s, bases) {
  if (typeof f.text === 'string') return f.text;
  let text;
  if (f.fromBase) { const b = bases[s.base]; if (!b) throw new Error(`fromBase needs the source's base (${s.case} ${s.condition})`); text = show(b.commit, `${b.dir}/${f.fromBase}`); }
  else text = show(f.commit ?? s.commit ?? null, f.path ?? s.path);
  text = sectionOf(text, f.section ?? null);
  if (text === null) throw new Error(`no section ${f.section} in ${f.path ?? s.path}`);
  if (f.fromLine || f.untilLine) {
    const lines = text.split('\n');
    const a = f.fromLine ? lines.findIndex((l) => new RegExp(f.fromLine).test(l)) : 0;
    if (a < 0) throw new Error(`no line ${f.fromLine}`);
    const rest = lines.slice(a + (f.fromLine ? 1 : 0)).findIndex((l) => f.untilLine && new RegExp(f.untilLine).test(l));
    const z = rest < 0 ? lines.length : a + (f.fromLine ? 1 : 0) + rest;
    text = lines.slice(a, z).join('\n');
  }
  if (f.keep === 'headingsAndTables') text = text.split('\n').filter((l) => /^\s*(#|\|)/.test(l)).join('\n');
  else if (f.keep) throw new Error(`unknown keep ${f.keep}`);
  for (const r of f.replace ?? []) {
    if (!text.includes(r.from)) throw new Error(`replace: "${r.from}" not in ${f.fromBase ?? f.path ?? s.path}`);
    text = text.replace(r.from, r.to);
  }
  return text;
}

const viewpointsOfWrites = (k) => [...new Set([...(k.writes.require ?? []), ...(k.writes.forbid ?? [])].map((e) => e.viewpoint).filter(Boolean))];

// The marker or written-file result of one answer for a case, with the viewpoint hits. written: null (the answer is the
// one written file of a writes case, or the answer of a marker case) or [{rel, text}]; base: the lines left out.
export function evaluate(k, spec, {answer, written = null, base = null}) {
  if (k.writes) {
    let files = ['<answer>'], fileText = () => answer;
    if (written) {
      const m = new Map(written.map((w) => [w.rel, w.text]));
      fileText = (r) => m.get(r) ?? null;
      files = written.map((w) => w.rel).filter((f) => new RegExp(k.writes.pathPattern).test(f));
    }
    const w = writeChecks(k.writes, files, fileText, {base});
    const failed = new Set([...w.writeRequireMissing, ...w.writeViolations]);
    const entries = [...(k.writes.require ?? []), ...(k.writes.forbid ?? [])];
    const viewpoints = Object.fromEntries(viewpointsOfWrites(k).map((v) => [v, !entries.some((e) => e.viewpoint === v && failed.has(e.id))]));
    const out = {pass: failed.size === 0 && (!k.writes.mustWrite || files.length > 0) && !w.writeMissingText, viewpoints, written: files, requireMissing: w.writeRequireMissing, violations: w.writeViolations, failedGroups: w.writeFailedGroups ?? []};
    if (written && base) { const u = writeChecks(k.writes, files, fileText); out.passWithoutBase = u.writeRequireMissing.length === 0 && u.writeViolations.length === 0 && (!k.writes.mustWrite || files.length > 0); }
    if (written && k.writesReport) {
      const r = writeChecks(k.writesReport, written.map((x) => x.rel).filter((f) => new RegExp(k.writesReport.pathPattern).test(f)), fileText);
      out.report = {written: r.written, violations: r.writeViolations};
    }
    return out;
  }
  const mt = markerTextOf(spec, answer, written ?? [], base);
  const groups = markerGroupsOf(k, mt.text);
  const viewpoints = Object.fromEntries((k.answerQuota?.groups ?? []).filter((g) => g.viewpoint).map((g) => [g.viewpoint, groups[g.id]]));
  const out = {pass: markersOk(k, mt.text), viewpoints, groups, deductions: markerDeductionsOf(k, mt.text)};
  if (written) { out.excludedLines = mt.excludedLines; out.passWithoutBase = markersOk(k, markerTextOf(spec, answer, written, null).text); }
  return out;
}

// The earlier pass from 0/1 viewpoint scores (see the header). It is derived here, not a judgement the earlier
// evaluation made: the same viewpoints and min as the markers, applied to its 0/1 scores.
export function earlierFromScores(k, scores) {
  if (k.writes) {
    const vps = viewpointsOfWrites(k);
    return vps.length ? vps.every((v) => scores[v] === 1) : null;
  }
  const vps = (k.answerQuota?.groups ?? []).filter((g) => !g.report).map((g) => g.viewpoint).filter(Boolean);
  return vps.length ? vps.filter((v) => scores[v] === 1).length >= k.answerQuota.min : null;
}

const isSkill = (c) => /^skill|^version/.test(String(c));

// Template lines (of every base) a marker group or a writes entry matches, per base.
export function templateHits(k, bases) {
  const lines = Object.fromEntries(Object.entries(bases).map(([id, b]) => [id, baseFiles(b).flatMap((f) => f.text.split('\n'))]));
  const entries = [...(k.answerQuota?.groups ?? []).map((g) => ({id: g.id, test: (l) => groupOk({...g, unless: null}, l)})),
    ...(k.writes ? [...(k.writes.require ?? []), ...(k.writes.forbid ?? [])].map((e) => ({id: e.id, test: (l) => new RegExp(e.pattern, 'i').test(l)})) : [])];
  return Object.fromEntries(entries.map((e) => [e.id, Object.fromEntries(Object.entries(lines).map(([b, ls]) => [b, ls.filter(e.test).length]))]));
}

export function calibrate(cal, spec) {
  const bases = cal.bases ?? {};
  const baseOf = (s) => {
    if (!s.base) return null;
    const b = bases[s.base];
    if (!b) throw new Error(`calibration names unknown base ${s.base}`);
    const re = spec.markerBase ? new RegExp(spec.markerBase.pathPattern) : null;
    return baseLinesOf(baseFiles(b).filter((f) => !re || re.test(f.rel)).map((f) => f.text));
  };
  const rows = [];
  for (const s of cal.sources) {
    const k = spec.cases.find((c) => c.id === s.case);
    if (!k) throw new Error(`calibration names unknown case ${s.case}`);
    const form = s.mustFail ? 'mustFail' : s.form ?? 'answer';
    const base = baseOf(s);
    const items = s.scored
      ? s.scored.flatMap((d) => {
        const key = JSON.parse(show(d.commit ?? null, `${d.dir}/blind-key.json`)), sc = JSON.parse(show(d.commit ?? null, `${d.dir}/scores.json`));
        return Object.keys(key).sort().map((id) => ({answer: `${d.dir}/${id}.md`, commit: d.commit ?? null, condition: key[id], scores: sc[id].scores, earlierPass: earlierFromScores(k, sc[id].scores), note: null}));
      })
      : [{answer: s.path ?? null, commit: s.commit ?? null, condition: s.condition, scores: null, earlierPass: s.mustFail ? false : s.earlierPass ?? null, note: s.note ?? null}];
    for (const it of items) {
      let answer, written = null;
      if (s.written) { answer = s.answerText ?? ''; written = s.written.map((f) => ({rel: f.as, text: fileOf(f, s, bases)})); }
      else {
        const text = sectionOf(show(it.commit, it.answer), s.section ?? null);
        if (text === null) throw new Error(`no section ${s.section} in ${it.answer}`);
        if (form === 'written') { answer = s.answerText ?? ''; written = [{rel: s.as, text}]; } else answer = text;
      }
      const r = evaluate(k, spec, {answer, written, base});
      const vp = it.scores ? Object.fromEntries(Object.entries(r.viewpoints).map(([v, hit]) => [v, {earlier: it.scores[v] ?? null, marker: hit, agree: it.scores[v] === (hit ? 1 : 0)}])) : null;
      rows.push({case: s.case, form, section: s.section ?? null, answer: it.answer, commit: it.commit, condition: it.condition, skill: form === 'mustFail' ? null : isSkill(it.condition), base: s.base ?? null,
        written: written ? written.map((w) => w.rel) : null, earlierPass: it.earlierPass, markerPass: r.pass, agree: it.earlierPass === null ? null : it.earlierPass === r.pass, viewpoints: vp, viewpointHits: r.viewpoints,
        ...(r.groups ? {groups: r.groups, deductions: r.deductions} : {requireMissing: r.requireMissing, violations: r.violations, failedGroups: r.failedGroups}),
        ...('passWithoutBase' in r ? {passWithoutBase: r.passWithoutBase} : {}), ...('excludedLines' in r ? {excludedLines: r.excludedLines} : {}), ...(r.report ? {report: r.report} : {}), note: it.note});
    }
  }
  const summary = (form) => {
    const out = {};
    for (const r of rows.filter((x) => x.form === form)) {
      const c = (out[r.case] ??= {answers: 0, judged: 0, agree: 0, skillAnswers: 0, skillMarkerPass: 0, skillJudged: 0, skillEarlierPass: 0, skillJudgedMarkerPass: 0, noSkillAnswers: 0, noSkillMarkerPass: 0, viewpointAgree: {}});
      c.answers += 1;
      if (r.agree !== null) { c.judged += 1; if (r.agree) c.agree += 1; }
      if (r.skill) { c.skillAnswers += 1; if (r.markerPass) c.skillMarkerPass += 1; if (r.earlierPass !== null) { c.skillJudged += 1; if (r.earlierPass) c.skillEarlierPass += 1; if (r.markerPass) c.skillJudgedMarkerPass += 1; } }
      else { c.noSkillAnswers += 1; if (r.markerPass) c.noSkillMarkerPass += 1; }
      for (const [v, x] of Object.entries(r.viewpoints ?? {})) { const a = (c.viewpointAgree[v] ??= {n: 0, agree: 0}); a.n += 1; if (x.agree) a.agree += 1; }
    }
    return out;
  };
  // Per viewpoint (marker group or writes entry): how often the markers hit in the answers with and without the Skill,
  // the earlier 0/1 scores of that viewpoint, and the template lines it matches.
  const viewpointRates = {};
  for (const id of [...new Set(rows.map((r) => r.case))]) {
    const k = spec.cases.find((c) => c.id === id);
    const rs = rows.filter((r) => r.case === id && r.form === 'answer');
    const hits = templateHits(k, bases);
    const defs = k.answerQuota ? k.answerQuota.groups.map((g) => ({id: g.id, viewpoint: g.viewpoint ?? null, counted: !g.report, hit: (r) => r.groups?.[g.id]}))
      : k.writes ? viewpointsOfWrites(k).map((v) => ({id: v, viewpoint: v, counted: true, hit: (r) => r.viewpointHits?.[v] === true})) : [];
    const rate = (sel, f) => { const xs = rs.filter(sel); return {n: xs.length, hit: xs.filter(f).length}; };
    viewpointRates[id] = defs.map((d) => ({id: d.id, viewpoint: d.viewpoint, counted: d.counted,
      skillMarker: rate((r) => r.skill, d.hit), noSkillMarker: rate((r) => !r.skill, d.hit),
      skillScore: rate((r) => r.skill && r.viewpoints?.[d.viewpoint], (r) => r.viewpoints[d.viewpoint].earlier === 1), noSkillScore: rate((r) => !r.skill && r.viewpoints?.[d.viewpoint], (r) => r.viewpoints[d.viewpoint].earlier === 1),
      // A writes viewpoint: the template lines of its require entries, summed (a forbid entry is not a hit).
      templateLines: hits[d.id] ?? Object.fromEntries(Object.keys(bases).map((b) => [b, k.writes ? (k.writes.require ?? []).filter((e) => e.viewpoint === d.viewpoint).reduce((a, e) => a + (hits[e.id]?.[b] ?? 0), 0) : null]))}));
  }
  const mf = rows.filter((r) => r.form === 'mustFail');
  return {rows, byCase: summary('answer'), byCaseWritten: summary('written'), mustFail: {n: mf.length, failed: mf.filter((r) => !r.markerPass).length, failedWithoutBase: mf.filter((r) => r.passWithoutBase === false).length}, viewpointRates};
}

export function markdown({rows, byCase, byCaseWritten, mustFail, viewpointRates}) {
  const L = ['# 回答の目印の照合', '',
    '開発時の検証資料であり、配布対象に含めない。`shared-harness/calibrate.mjs --md`がこの設定の`calibration.json`と依頼の設定（cases.json）から作る（手で直さない）。これまでの評価で採点した回答と、落ちるべき回答（雛形そのまま等）に、この設定の目印（`answerQuota`・`answerNone`）と書いたfileの照合（`writes`）を当て、これまでの採点と比べる。観点の列は「採点/目印」。',
    '',
    '- **#1828の「これまでの採点」の合否は、#1828の判定ではない。** 目印と同じ観点の選び方（`report: true`の観点を除く）と同じ`min`を、#1828の採点者が付けた観点ごとの0/1の点に当てて、この表が作ったものである。#1829・#1832の行は、それぞれの評価の記録（`00_評価.md`・`00_比較.md`）の合否である。',
    '- 形：`回答`は回答の文に目印を当てる。`書いたfile`は回答を試行が書いたfileとして扱い、回答と書いたfileの和に当てる（`markerText: answer+writes`）。導入した雛形（`base`）と同じ行は、目印を当てる前に除く（依頼の設定の`markerBase`）。`落ちるべき`は雛形をそのまま写した等の回答で、目印で不合格になることを確かめる。',
    '- 「行を除かない場合」は、雛形と同じ行を除かずに当てた結果（除く仕組みの効果を見るためのもの）。',
    '',
    '| 依頼 | 形 | 回答 | 条件 | これまでの採点 | 目印 | 一致 | 行を除かない場合 | 観点（採点/目印） | 落ちた点 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  const yn = (x) => (x === null || x === undefined ? '記録なし' : x ? '合格' : '不合格');
  const formName = {answer: '回答', written: '書いたfile', mustFail: '落ちるべき'};
  for (const r of rows) {
    const vp = Object.entries(r.viewpoints ?? {}).map(([v, x]) => `${v} ${x.earlier}/${x.marker ? 1 : 0}`).join('、');
    const why = r.groups ? [...Object.entries(r.groups).filter(([, ok]) => !ok).map(([g]) => g), ...r.deductions.map((d) => `減点:${d}`)].join('、') : [...r.requireMissing, ...r.violations, ...(r.report?.violations.length ? [`本文の外（報告だけ）:${r.report.violations.join('・')}`] : [])].join('、');
    const where = r.answer ? `\`${r.commit ? `${r.commit.slice(0, 8)}:` : ''}${r.answer.replace(/^docs\/evidence\//, '')}\`${r.section ? ` ${r.section}` : ''}` : r.note ?? '-';
    const files = r.written && r.form !== 'answer' ? `→ ${r.written.length ? r.written.map((w) => `\`${w}\``).join('・') : '（対象のfileなし）'}${r.base ? `（雛形${r.base}）` : ''}` : '';
    L.push(`| ${r.case} | ${formName[r.form]} | ${where}${files ? ` ${files}` : ''} | ${r.condition} | ${yn(r.earlierPass)} | ${yn(r.markerPass)} | ${r.agree === null ? '-' : r.agree ? '一致' : '不一致'} | ${'passWithoutBase' in r ? yn(r.passWithoutBase) : '-'} | ${vp || '-'} | ${why || '-'} |`);
  }
  const sumTable = (title, by) => {
    L.push('', title, '', '| 依頼 | 回答 | 合否の一致（記録のある回答） | 観点ごとの一致 | Skillありの回答で目印が合格（全部） | Skillありで記録のある回答：これまでの採点が合格 | 同：目印が合格 | Skillなしの回答で目印が合格 |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [id, c] of Object.entries(by)) {
      L.push(`| ${id} | ${c.answers} | ${c.agree}/${c.judged} | ${Object.entries(c.viewpointAgree).map(([v, a]) => `${v} ${a.agree}/${a.n}`).join('、') || '-'} | ${c.skillMarkerPass}/${c.skillAnswers} | ${c.skillEarlierPass}/${c.skillJudged} | ${c.skillJudgedMarkerPass}/${c.skillJudged} | ${c.noSkillMarkerPass}/${c.noSkillAnswers} |`);
    }
  };
  sumTable('## 依頼ごと（形：回答）', byCase);
  sumTable('## 依頼ごと（形：書いたfile。回答と書いたfileの和、雛形と同じ行を除く）', byCaseWritten);
  L.push('', '## 落ちるべき回答', '', `落ちるべき回答${mustFail.n}件のうち、目印・書いたfileの照合で不合格は${mustFail.failed}件（雛形と同じ行を除かない場合の不合格は${mustFail.failedWithoutBase}件）。`);
  L.push('', '## 観点ごとの当たる率（形：回答）', '', 'Skillあり・なしは、これまでの評価の条件（#1828の`skill*`、#1829・#1832の`version`がSkillあり。#1828の`tpl*`（雛形だけ）と`none`、変更前の版がSkillなし）。「数える」が「報告だけ」の観点は合否の数に入れない（Skillの有無を分けられない、または雛形の語に当たる）。雛形の行は、条件ごとの雛形（R：`c9288126`、C：`98aabea2`の`v05/templates/specs/`）のうち、その目印に合う行の数。',
    '', '| 依頼 | 観点 | 数える | Skillあり：目印 | Skillなし：目印 | Skillあり：採点1 | Skillなし：採点1 | 雛形の行（R/C） |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  const f = (x) => (x.n ? `${x.hit}/${x.n}` : '-');
  for (const [id, vs] of Object.entries(viewpointRates)) for (const v of vs) {
    L.push(`| ${id} | ${v.id}${v.viewpoint && v.viewpoint !== v.id ? `（${v.viewpoint}）` : ''} | ${v.counted ? '数える' : '報告だけ'} | ${f(v.skillMarker)} | ${f(v.noSkillMarker)} | ${f(v.skillScore)} | ${f(v.noSkillScore)} | ${Object.values(v.templateLines).map((x) => (x === null ? '-' : x)).join('/')} |`);
  }
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const out = calibrate(readCfg('calibration.json'), loadSpec());
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(out, null, 1) + '\n');
  if (opt('--md')) fs.writeFileSync(opt('--md'), markdown(out));
  console.log(JSON.stringify({config: path.relative(REPO_ROOT, configDir()), byCase: out.byCase, byCaseWritten: out.byCaseWritten, mustFail: out.mustFail}, null, 1));
}
