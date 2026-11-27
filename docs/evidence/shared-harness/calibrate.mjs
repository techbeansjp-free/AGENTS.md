// Shared harness (#1840 review H2): calibration of the answer markers and the written-file checks of a config against
// answers that earlier evaluations scored (a separate-Context grader). Not a fixed module (like dry-run.mjs): it reads the
// config's calibration.json and cases.json, and writes the table the levels are set from. No model call.
// calibration.json: {sources: [...]}; a source is
//   {case, section, scored: [{dir, condition?}]}  answers <dir>/<id>.md, keys <dir>/blind-key.json, scores <dir>/scores.json
//                                                 (the 0/1 viewpoint scores; the earlier pass of a case is derived from them)
//   {case, section, commit?, path, condition, earlierPass: true|false|null, note}   one answer with its recorded result
// Files are read from the working tree, or with `commit` by `git show <commit>:<path>`. `section` is a "## <name>" heading
// of the answer file (null: the whole file). A case with answerQuota: each group with a viewpoint is compared with that
// viewpoint's score, and the earlier pass is "at least answerQuota.min of those viewpoints scored 1". A case with writes:
// the text is checked as the one written file; each require/forbid entry with a viewpoint is compared, and the earlier
// pass is "every such viewpoint scored 1".
// Usage: node calibrate.mjs [--out <json>] [--md <file>] --config <dir>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO_ROOT, configDir, loadSpec, readCfg} from './config.mjs';
import {markersOk, markerGroupsOf, markerDeductionsOf, writeChecks} from './score.mjs';

const show = (commit, p) => {
  if (!commit) return fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
  const r = spawnSync('git', ['show', `${commit}:${p}`], {cwd: REPO_ROOT, encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`git show ${commit}:${p} failed: ${r.stderr}`);
  return r.stdout;
};
export const sectionOf = (text, name) => (name ? (text.split(/^## /m).find((s) => s.startsWith(`${name}\n`)) ?? null)?.replace(/^[^\n]*\n/, '') ?? null : text);

// The marker or written-file result of one text for a case, with the viewpoint hits.
export function evaluate(k, text) {
  if (k.writes) {
    const w = writeChecks(k.writes, ['<answer>'], () => text);
    const failed = new Set([...w.writeRequireMissing, ...w.writeViolations]);
    const vps = [...new Set([...(k.writes.require ?? []), ...(k.writes.forbid ?? [])].map((e) => e.viewpoint).filter(Boolean))];
    const viewpoints = Object.fromEntries(vps.map((v) => [v, ![...(k.writes.require ?? []), ...(k.writes.forbid ?? [])].some((e) => e.viewpoint === v && failed.has(e.id))]));
    return {pass: failed.size === 0, viewpoints, requireMissing: w.writeRequireMissing, violations: w.writeViolations, failedGroups: w.writeFailedGroups ?? []};
  }
  const groups = markerGroupsOf(k, text);
  const viewpoints = Object.fromEntries((k.answerQuota?.groups ?? []).filter((g) => g.viewpoint).map((g) => [g.viewpoint, groups[g.id]]));
  return {pass: markersOk(k, text), viewpoints, groups, deductions: markerDeductionsOf(k, text)};
}

// The earlier pass from 0/1 viewpoint scores (see the header).
export function earlierFromScores(k, scores) {
  if (k.writes) {
    const vps = [...new Set([...(k.writes.require ?? []), ...(k.writes.forbid ?? [])].map((e) => e.viewpoint).filter(Boolean))];
    return vps.length ? vps.every((v) => scores[v] === 1) : null;
  }
  const vps = (k.answerQuota?.groups ?? []).filter((g) => !g.report).map((g) => g.viewpoint).filter(Boolean);
  return vps.length ? vps.filter((v) => scores[v] === 1).length >= k.answerQuota.min : null;
}

export function calibrate(cal, spec) {
  const rows = [];
  for (const s of cal.sources) {
    const k = spec.cases.find((c) => c.id === s.case);
    if (!k) throw new Error(`calibration names unknown case ${s.case}`);
    const items = s.scored
      ? s.scored.flatMap((d) => {
        const key = JSON.parse(show(d.commit ?? null, `${d.dir}/blind-key.json`)), sc = JSON.parse(show(d.commit ?? null, `${d.dir}/scores.json`));
        return Object.keys(key).sort().map((id) => ({answer: `${d.dir}/${id}.md`, commit: d.commit ?? null, condition: key[id], scores: sc[id].scores, earlierPass: earlierFromScores(k, sc[id].scores), note: null}));
      })
      : [{answer: s.path, commit: s.commit ?? null, condition: s.condition, scores: null, earlierPass: s.earlierPass ?? null, note: s.note ?? null}];
    for (const it of items) {
      const text = sectionOf(show(it.commit, it.answer), s.section);
      if (text === null) throw new Error(`no section ${s.section} in ${it.answer}`);
      const r = evaluate(k, text);
      const vp = it.scores ? Object.fromEntries(Object.entries(r.viewpoints).map(([v, hit]) => [v, {earlier: it.scores[v] ?? null, marker: hit, agree: it.scores[v] === (hit ? 1 : 0)}])) : null;
      rows.push({case: s.case, section: s.section, answer: it.answer, commit: it.commit, condition: it.condition, skill: /^skill|^version/.test(String(it.condition)),
        earlierPass: it.earlierPass, markerPass: r.pass, agree: it.earlierPass === null ? null : it.earlierPass === r.pass, viewpoints: vp,
        ...(r.groups ? {groups: r.groups, deductions: r.deductions} : {requireMissing: r.requireMissing, violations: r.violations, failedGroups: r.failedGroups}), note: it.note});
    }
  }
  const byCase = {};
  for (const r of rows) {
    const c = (byCase[r.case] ??= {answers: 0, judged: 0, agree: 0, skillAnswers: 0, skillMarkerPass: 0, skillJudged: 0, skillEarlierPass: 0, skillJudgedMarkerPass: 0, viewpointAgree: {}});
    c.answers += 1;
    if (r.agree !== null) { c.judged += 1; if (r.agree) c.agree += 1; }
    if (r.skill) { c.skillAnswers += 1; if (r.markerPass) c.skillMarkerPass += 1; if (r.earlierPass !== null) { c.skillJudged += 1; if (r.earlierPass) c.skillEarlierPass += 1; if (r.markerPass) c.skillJudgedMarkerPass += 1; } }
    for (const [v, x] of Object.entries(r.viewpoints ?? {})) { const a = (c.viewpointAgree[v] ??= {n: 0, agree: 0}); a.n += 1; if (x.agree) a.agree += 1; }
  }
  return {rows, byCase};
}

export function markdown({rows, byCase}) {
  const L = ['# 回答の目印の照合', '', '開発時の検証資料であり、配布対象に含めない。`shared-harness/calibrate.mjs --md`がこの設定の`calibration.json`と依頼の設定（cases.json）から作る（手で直さない）。これまでの評価で採点した回答に、この設定の目印（`answerQuota`・`answerNone`）と書いたfileの照合（`writes`）を当て、これまでの採点と比べる。観点の列は「採点/目印」。', '',
    '| 依頼 | 回答 | 条件 | これまでの採点 | 目印 | 一致 | 観点（採点/目印） | 落ちた点 |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  const yn = (x) => (x === null ? '記録なし' : x ? '合格' : '不合格');
  for (const r of rows) {
    const vp = Object.entries(r.viewpoints ?? {}).map(([v, x]) => `${v} ${x.earlier}/${x.marker ? 1 : 0}`).join('、');
    const why = r.groups ? [...Object.entries(r.groups).filter(([, ok]) => !ok).map(([g]) => g), ...r.deductions.map((d) => `減点:${d}`)].join('、') : [...r.requireMissing, ...r.violations].join('、');
    L.push(`| ${r.case} | \`${r.commit ? `${r.commit.slice(0, 8)}:` : ''}${r.answer.replace(/^docs\/evidence\//, '')}\`${r.section ? ` ${r.section}` : ''} | ${r.condition} | ${yn(r.earlierPass)} | ${yn(r.markerPass)} | ${r.agree === null ? '-' : r.agree ? '一致' : '不一致'} | ${vp || '-'} | ${why || '-'} |`);
  }
  L.push('', '| 依頼 | 回答 | 合否の一致（記録のある回答） | 観点ごとの一致 | Skillありの回答で目印が合格（全部） | Skillありで記録のある回答：これまでの採点が合格 | 同：目印が合格 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [id, c] of Object.entries(byCase)) {
    L.push(`| ${id} | ${c.answers} | ${c.agree}/${c.judged} | ${Object.entries(c.viewpointAgree).map(([v, a]) => `${v} ${a.agree}/${a.n}`).join('、') || '-'} | ${c.skillMarkerPass}/${c.skillAnswers} | ${c.skillEarlierPass}/${c.skillJudged} | ${c.skillJudgedMarkerPass}/${c.skillJudged} |`);
  }
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const out = calibrate(readCfg('calibration.json'), loadSpec());
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(out, null, 1) + '\n');
  if (opt('--md')) fs.writeFileSync(opt('--md'), markdown(out));
  console.log(JSON.stringify({config: path.relative(REPO_ROOT, configDir()), byCase: out.byCase}, null, 1));
}
