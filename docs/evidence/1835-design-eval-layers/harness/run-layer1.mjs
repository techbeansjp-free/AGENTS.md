// Host side (#1835): runs the probe, or the layer 1 rendering and the pixel comparison, in a disposable container.
// The image is #1807's asc-1807-tools:1 (pinned in #1815 conditions.json); the scripts of #1807 (render.mjs) and #1815
// (first-view.mjs, clock.mjs) are mounted read-only and run unchanged.
//
// Usage:
//   node run-layer1.mjs probe  <pages-dir> [--case c] [--trial t] [--write-config]
//        pages-dir is the output of degrade.mjs; probes each <case>/<trial>/original. --write-config merges the result
//        into config/page-probe.json (then run degrade.mjs again).
//   node run-layer1.mjs layer1 <pages-dir> <out-dir> [--case c] [--trial t] [--skip-render] [--cases <cases.json>] [--gold-add <gold.json>]
//        renders the original and every variant made (manifest.json), runs first-view and compare, and writes
//        <out-dir>/layer1.json. Screenshots stay in <out-dir> (do not commit them).
//        #1867: --cases replaces config/cases.json (same format; e.g. a case #1835 does not have); --gold-add adds the
//        cases of another gold file to #1804 gold.json (a case in both is refused) and the run reads the merged file from
//        <out-dir>/gold.json. Without them the run is as before.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, EVIDENCE, E1804, CASES} from './degrade.mjs';
import {layer1Record, newFailures} from './layer1.mjs';

export const IMAGE = 'asc-1807-tools:1';
export const IMAGE_ID = JSON.parse(fs.readFileSync(path.join(EVIDENCE, '1815-design-judgment/conditions.json'), 'utf8')).images?.tools?.id;
const H1807 = path.join(EVIDENCE, '1807-design-eval-browser/harness');
const H1815 = path.join(EVIDENCE, '1815-design-judgment/harness');
const H1835 = path.join(ROOT, 'harness');

// The cases file read by first-view.mjs, probe.mjs and compare.mjs: config/cases.json, with ui03 taken from #1815.
// Commands of the layer-1 run that failed (render, a first-view of a target, compare), written to <out>/failed.txt by the
// Docker shell. Any entry stops the run before layer1.json is written; this is also checked with --skip-render.
export function layer1CommandFailures(out) {
  const f = path.join(out, 'failed.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
}

export function mergedCases(cases = CASES) {
  const out = {schema: 'asc-1835-cases-merged/v1', cases: {}};
  for (const [id, c] of Object.entries(cases)) {
    let spec = {...c};
    if (c.firstViewFrom) {
      const [file, key] = c.firstViewFrom.split('#');
      const src = JSON.parse(fs.readFileSync(path.join(EVIDENCE, file), 'utf8')).cases[key];
      spec = {...spec, wide: src.wide, narrow: src.narrow, firstView: src.firstView, fixedNow: src.fixedNow, question: src.question};
    }
    out.cases[id] = spec;
  }
  return out;
}

// #1867: #1804 gold.json with the cases of another gold file added; a case in both is refused (never overridden).
export function mergedGold(addFile = null) {
  const gold = JSON.parse(fs.readFileSync(path.join(E1804, 'gold.json'), 'utf8'));
  if (!addFile) return gold;
  const add = JSON.parse(fs.readFileSync(addFile, 'utf8'));
  const cases = Object.fromEntries(Object.entries(add).filter(([k]) => !['schema', 'note'].includes(k)));
  const both = Object.keys(cases).filter((k) => k in gold);
  if (both.length) throw new Error(`--gold-add: ${both.join(', ')} already in #1804 gold.json`);
  return {...gold, ...cases};
}

function docker(pagesDir, outDir, script) {
  const worktree = path.resolve(ROOT, '../../..');
  const args = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=512m', '--shm-size', '1g',
    '--memory', '3g', '--cpus', '2', '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', 'pwuser',
    '--label', `asc.worktree=${worktree}`, '--label', 'asc.issue=1835',
    '-v', `${pagesDir}:/runs:ro`, '-v', `${H1807}:/opt/h:ro`, '-v', `${H1815}:/opt/fv:ro`, '-v', `${H1835}:/opt/l:ro`, '-v', `${E1804}:/opt/g:ro`,
    '-v', `${outDir}:/out`, '-e', 'HOME=/tmp', IMAGE, 'sh', '-c', script];
  const r = spawnSync('docker', args, {stdio: ['ignore', 'inherit', 'inherit']});
  if (r.status !== 0) throw new Error(`docker exited ${r.status}`);
}
function checkImage() {
  const r = spawnSync('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], {encoding: 'utf8'});
  const id = r.stdout.trim();
  if (!IMAGE_ID || id !== IMAGE_ID) throw new Error(`refused: ${IMAGE} is ${id || 'missing'}, expected ${IMAGE_ID} (#1815 conditions.json)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
  const [mode, pagesArg, outArg] = args;
  const pagesDir = path.resolve(pagesArg);
  const manifest = JSON.parse(fs.readFileSync(path.join(pagesDir, 'manifest.json'), 'utf8'));
  const pages = manifest.pages.filter((p) => (!opt('--case') || p.case === opt('--case')) && (!opt('--trial') || p.trial === opt('--trial')));
  checkImage();
  const sel = (p) => `/runs/${p.case}/${p.trial}`;
  if (mode === 'probe') {
    const work = path.join(pagesDir, '_probe'); fs.mkdirSync(work, {recursive: true});
    fs.writeFileSync(path.join(work, 'cases.json'), JSON.stringify(mergedCases(), null, 1));
    fs.writeFileSync(path.join(work, 'targets.json'), JSON.stringify(pages.map((p) => ({key: `${p.case}/${p.trial}`, case: p.case, file: `${sel(p)}/original/index.html`})), null, 1));
    docker(pagesDir, work, 'node /opt/l/probe.mjs /out/cases.json /out/targets.json > /out/probe.json');
    const res = JSON.parse(fs.readFileSync(path.join(work, 'probe.json'), 'utf8'));
    for (const [k, v] of Object.entries(res.pages)) console.log(k, JSON.stringify(v.dominant), v.peers ? `${v.peers.selector} x${v.peers.count}` : `peers none ${JSON.stringify(v.peersTried)}`, v.error ?? '');
    if (args.includes('--write-config')) {
      const file = path.join(ROOT, 'config/page-probe.json');
      const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {schema: 'asc-1835-page-probe/v1', note: 'harness/probe.mjsの出力（asc-1807-tools:1、広幅、時計はfixedNow）。degrade.mjsのcontrastとinconsistencyが読む。', pages: {}};
      for (const [k, v] of Object.entries(res.pages)) cur.pages[k] = {...v, sourceSha256: manifest.pages.find((p) => `${p.case}/${p.trial}` === k).sourceSha256};
      cur.pages = Object.fromEntries(Object.entries(cur.pages).sort(([a], [b]) => (a < b ? -1 : 1)));
      fs.writeFileSync(file, JSON.stringify(cur, null, 1) + '\n');
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  } else if (mode === 'layer1') {
    const out = path.resolve(outArg); fs.mkdirSync(out, {recursive: true});
    const caseDefs = opt('--cases') ? JSON.parse(fs.readFileSync(path.resolve(opt('--cases')), 'utf8')).cases : CASES;
    const cases = mergedCases(caseDefs);
    fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(cases, null, 1));
    const goldAdd = opt('--gold-add') ? path.resolve(opt('--gold-add')) : null;
    const goldMerged = mergedGold(goldAdd);
    if (goldAdd) fs.writeFileSync(path.join(out, 'gold.json'), JSON.stringify(goldMerged, null, 1));
    const goldIn = goldAdd ? '/out/gold.json' : '/opt/g/gold.json';
    const ALIAS = Object.fromEntries(Object.entries(caseDefs).map(([k, c]) => [k, c.renderAlias]));
    const made = (p) => p.variants.filter((v) => !v.excluded).map((v) => v.variant);
    const tid = (p, v) => `${p.case}__${p.trial}__${v}`;
    const targets = pages.flatMap((p) => made(p).map((v) => ({id: tid(p, v), case: ALIAS[p.case], file: `${sel(p)}/${v}/index.html`})));
    fs.writeFileSync(path.join(out, 'targets.json'), JSON.stringify(targets, null, 1));
    fs.writeFileSync(path.join(out, 'pairs.json'), JSON.stringify(pages.map((p) => ({key: `${p.case}/${p.trial}`, case: p.case, original: `${sel(p)}/original/index.html`,
      variants: Object.fromEntries(made(p).filter((v) => v !== 'original').map((v) => [v, `${sel(p)}/${v}/index.html`]))})), null, 1));
    const fv = pages.flatMap((p) => made(p).map((v) => `mkdir -p /out/${tid(p, v)} && node /opt/fv/first-view.mjs /out/cases.json ${p.case} ${sel(p)}/${v}/index.html ${goldIn} > /out/${tid(p, v)}/first-view.json || echo ${tid(p, v)} >> /out/failed.txt`)).join('; ');
    const t0 = Date.now();
    fs.rmSync(path.join(out, 'layer1.json'), {force: true}); // never leave an older record behind a failed run
    if (!args.includes('--skip-render')) {
      fs.rmSync(path.join(out, 'failed.txt'), {force: true});
      docker(pagesDir, out, `node /opt/h/render.mjs /out/targets.json /out || echo render >> /out/failed.txt; ${fv}; node /opt/l/compare.mjs /out/cases.json /out/pairs.json > /out/compare.json || echo compare >> /out/failed.txt; true`);
    }
    {
      const failed = layer1CommandFailures(out);
      if (failed.length) throw new Error(`layer 1 commands failed (not publishing layer1.json): ${failed.join(', ')}`);
    }
    const seconds = Math.round((Date.now() - t0) / 1000);
    const render = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(out, 'render.json'), 'utf8')).map((r) => [r.id, r]));
    const cmp = JSON.parse(fs.readFileSync(path.join(out, 'compare.json'), 'utf8')).pages;
    const gold = goldMerged;
    const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
    const result = {schema: 'asc-1835-layer1/v1', note: '層1の暫定の判定。合格は「使いやすい」ことを意味せず、不合格はこの限られた範囲での反証として扱う。', image: IMAGE_ID, seconds, pages: []};
    for (const p of pages) {
      const spec = cases.cases[p.case];
      const recs = {};
      for (const v of made(p)) {
        const id = tid(p, v);
        const txt = path.join(out, id, `${spec.wide.renderName}.txt`);
        recs[v] = layer1Record({render: render[id], firstView: read(path.join(out, id, 'first-view.json')), gold: gold[spec.goldKey],
          wideText: fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : null, spec});
      }
      const c = cmp[`${p.case}/${p.trial}`] ?? {};
      const variants = p.variants.map((mv) => {
        if (mv.excluded) return {variant: mv.variant, group: mv.group, excluded: mv.excluded};
        const r = recs[mv.variant];
        const px = Object.fromEntries(['wide', 'narrow'].map((s) => [s, c[s]?.variants?.[mv.variant]?.pixelsEqual ?? (mv.variant === 'original' ? null : 'error')]));
        return {variant: mv.variant, group: mv.group, pass: r.pass, checks: r.checks, newFailures: mv.variant === 'original' ? [] : newFailures(recs.original, r), pixelsEqualToOriginal: px, layer1: r};
      });
      result.pages.push({case: p.case, trial: p.trial, baselineEqual: {wide: c.wide?.baselineEqual ?? null, narrow: c.narrow?.baselineEqual ?? null}, variants});
    }
    fs.writeFileSync(path.join(out, 'layer1.json'), JSON.stringify(result, null, 1));
    for (const p of result.pages) {
      console.log(`${p.case}/${p.trial} baselineEqual ${JSON.stringify(p.baselineEqual)}`);
      for (const v of p.variants) console.log(`  ${v.variant.padEnd(22)} ${v.excluded ? `excluded: ${v.excluded}` : `pass=${v.pass} new=[${v.newFailures.join('; ')}] samePixels=${JSON.stringify(v.pixelsEqualToOriginal)}`}`);
    }
    console.log(`seconds ${seconds}`);
  } else {
    console.error('usage: run-layer1.mjs probe|layer1 ...'); process.exit(2);
  }
}
