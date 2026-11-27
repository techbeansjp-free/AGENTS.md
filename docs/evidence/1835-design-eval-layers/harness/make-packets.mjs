// Build the blind packets that the evaluators read (EVAL_PLAN.md sections 2-3), and the key that maps them back.
// Usage: node harness/make-packets.mjs --render-root <dir> --out <dir> --seed <text> [--allow-missing] [--config <eval.json>]
//   <render-root>: the out-dirs of run-layer1.mjs layer1 (config renderLayout: l1-<case>-<trial>/<case>__<trial>__<variant>/<shot>.png)
// Output (all under <out>, which must be in scratch; nothing here is committed):
//   packets/index.json                       [{packet, round, method}] (no screen information)
//   packets/round<r>/<packet>/BRIEF.md       the #1804 brief, as is
//   packets/round<r>/<packet>/TASK.json      the random ids to look at (P: A and B; D: groups with display order; F: screen)
//   packets/round<r>/<packet>/shots/<id>-narrow.png, <id>-wide.png   screenshots with metadata chunks removed
//   key/key.json                             seed, items, packets -> screens, missing screens, excluded items (outside packets/)
// Every packet is independent: P one per pair and round, F one per screen and round, D one per case and round.
// Ids, the side of each pair (P) and the display order (D) change between round 1 and round 2. Files get a fixed mtime.
import fs from 'node:fs';
import path from 'node:path';
import {EVIDENCE, loadConfig, makeRng, shuffle, idAllocator, stripPng, planItems, screensOf, shotPath, WIDTHS, writeJson, sha256, parseScreen} from './eval-common.mjs';

const FIXED_TIME = 946684800; // 2000-01-01T00:00:00Z

function touchTree(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) touchTree(p);
    fs.utimesSync(p, FIXED_TIME, FIXED_TIME);
  }
  fs.utimesSync(dir, FIXED_TIME, FIXED_TIME);
}

export function buildPackets({cfg = loadConfig(), renderRoot, out, seed, allowMissing = false}) {
  if (!seed) throw new Error('--seed is required (it is recorded in the key)');
  const pktRoot = path.join(out, 'packets'), keyDir = path.join(out, 'key');
  if (fs.existsSync(pktRoot)) throw new Error(`${pktRoot} exists; use a new --out`);
  const allItems = planItems(cfg);
  // screens present (both widths) or missing
  const missing = [], stripped = {};
  for (const s of screensOf(allItems)) {
    for (const w of WIDTHS) {
      const f = shotPath(cfg, renderRoot, s, w);
      if (!fs.existsSync(f)) { missing.push({screen: s, width: w, reason: 'screenshot not found'}); continue; }
      const r = stripPng(fs.readFileSync(f));
      (stripped[s] ??= {})[w] = r;
    }
  }
  const missingScreens = new Set(missing.map((m) => m.screen));
  if (missing.length && !allowMissing) {
    const e = new Error(`missing screenshots (${missing.length}); pass --allow-missing to exclude them:\n` + missing.map((m) => `  ${m.screen} ${m.width}`).join('\n'));
    e.missing = missing; throw e;
  }
  const items = allItems.map((i) => (missingScreens.has(i.first) || missingScreens.has(i.second)) ? {...i, excluded: 'screen missing'} : i);
  const live = items.filter((i) => !i.excluded);
  // a case whose layer-2 pairs fall below the fraction is undetermined for layer 2 (plan section 2)
  const l2Undetermined = [];
  for (const c of Object.keys(cfg.cases)) {
    const all = items.filter((i) => i.layer === 2 && i.case === c), ok = all.filter((i) => !i.excluded);
    if (ok.length < all.length * cfg.layer2.minPairsPerCaseFraction) l2Undetermined.push(c);
  }
  const newId = idAllocator(makeRng(seed, 'ids'));
  const newPacket = idAllocator(makeRng(seed, 'packets'), 6);
  const key = {schema: 'asc-1835-key/v1', seed, rounds: cfg.rounds, items, missing, l2Undetermined, packets: {}, screens: {}};
  for (const [s, w] of Object.entries(stripped)) key.screens[s] = Object.fromEntries(Object.entries(w).map(([k, r]) => [k, {sha256: sha256(r.png), removedChunks: r.removed}]));
  const index = [];

  const writePacket = (round, method, caseId, task, ids) => {
    const packet = newPacket('pk');
    const dir = path.join(pktRoot, `round${round}`, packet);
    fs.mkdirSync(path.join(dir, 'shots'), {recursive: true});
    fs.copyFileSync(path.join(EVIDENCE, cfg.cases[caseId].brief), path.join(dir, 'BRIEF.md'));
    for (const [id, s] of Object.entries(ids)) for (const w of WIDTHS) fs.writeFileSync(path.join(dir, 'shots', `${id}-${w}.png`), stripped[s][w].png);
    fs.writeFileSync(path.join(dir, 'TASK.json'), JSON.stringify(task, null, 1) + '\n');
    touchTree(dir);
    key.packets[packet] = {round, method, case: caseId, ids, task};
    index.push({packet, round, method});
    return packet;
  };

  const sides = {}; // P: is the item's first screen shown as A, per round
  const pItems = live;
  const rndSide = makeRng(seed, 'sides');
  const firstHalf = new Set(shuffle(pItems.map((i) => i.id), rndSide).slice(0, Math.ceil(pItems.length / 2)));
  const dOrders = {};
  for (const round of cfg.rounds) {
    const rnd = makeRng(seed, `round${round}`);
    // P: one packet per pair
    for (const it of shuffle(pItems, rnd)) {
      const firstIsA = (round % 2 === 1) === firstHalf.has(it.id);
      sides[it.id] = {...sides[it.id], [round]: firstIsA ? 'first' : 'second'};
      const [a, b] = firstIsA ? [it.first, it.second] : [it.second, it.first];
      const idA = newId(), idB = newId();
      key.packets[writePacket(round, 'P', it.case, {method: 'P', A: idA, B: idB}, {[idA]: a, [idB]: b})].item = it.id;
    }
    // F: one packet per screen
    for (const s of shuffle(screensOf(live), rnd)) {
      const id = newId();
      writePacket(round, 'F', parseScreen(s).case, {method: 'F', screen: id}, {[id]: s});
    }
    // D: one packet per case, two groups (layer 2 without the negative control; layer 3)
    for (const c of Object.keys(cfg.cases)) {
      const g2 = live.filter((i) => i.case === c && i.layer === 2 && !i.control);
      const l2 = g2.length ? [g2[0].first, ...g2.map((i) => i.second)] : [];
      const l3 = screensOf(live.filter((i) => i.case === c && i.layer === 3));
      const groups = [];
      for (const [label, screens] of [['L2', l2], ['L3', l3]]) {
        if (screens.length < 2) continue;
        let order = shuffle(screens, rnd);
        const prev = dOrders[`${c}:${label}`];
        for (let n = 0; prev && n < 20 && order.join() === prev.join(); n++) order = shuffle(screens, rnd);
        dOrders[`${c}:${label}`] = order;
        groups.push({label, order});
      }
      if (!groups.length) continue;
      const shown = shuffle(groups, rnd), ids = {}, task = {method: 'D', groups: []};
      shown.forEach((g, gi) => {
        const name = `群${gi + 1}`, order = g.order.map((s) => { const id = newId(); ids[id] = s; return id; });
        task.groups.push({name, order});
        g.name = name;
      });
      const pk = writePacket(round, 'D', c, task, ids);
      key.packets[pk].groupLayers = Object.fromEntries(shown.map((g) => [g.name, g.label]));
    }
  }
  key.sides = sides;
  writeJson(path.join(pktRoot, 'index.json'), index);
  writeJson(path.join(keyDir, 'key.json'), key);
  touchTree(pktRoot);
  return key;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  try {
    const key = buildPackets({cfg: opt('--config') ? loadConfig(path.resolve(opt('--config'))) : loadConfig(), renderRoot: path.resolve(opt('--render-root') ?? ''), out: path.resolve(opt('--out') ?? ''), seed: opt('--seed'), allowMissing: a.includes('--allow-missing')});
    const by = {}; for (const p of Object.values(key.packets)) by[`round${p.round} ${p.method}`] = (by[`round${p.round} ${p.method}`] ?? 0) + 1;
    console.log(JSON.stringify({seed: key.seed, packets: by, items: key.items.filter((i) => !i.excluded).length, excludedItems: key.items.filter((i) => i.excluded).length, missingScreenshots: key.missing.length, l2Undetermined: key.l2Undetermined}, null, 1));
  } catch (e) { console.error(e.message); process.exit(2); }
}
