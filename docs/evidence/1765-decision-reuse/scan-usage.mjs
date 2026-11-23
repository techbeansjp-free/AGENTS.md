// 読取りだけの集計script（#1765）。本文・path・案件名は出力しない。
// 使い方: node scan-usage.mjs <~/.claude/projects> [asc]
// Claude Codeのログは1つのmessage idをcontent blockごとに複数行へ分けるため、id単位でblockを合算して判定する。
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const files = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) w(p);
    else if (p.endsWith('.jsonl')) files.push(p);
  }
})(root);
const z = () => ({ n: 0, i: 0, o: 0, cr: 0, cw: 0 });
const add = (a, u) => {
  a.n++;
  a.i += u.input_tokens || 0;
  a.o += u.output_tokens || 0;
  a.cr += u.cache_read_input_tokens || 0;
  a.cw += u.cache_creation_input_tokens || 0;
};
const T = {
  all: z(), noStopReason: z(),
  afterOkToolUseOnly: z(), // 直前が成功したtool結果で、合算blockがtool_useのみ
  candidateSmall: z(), candidateSmallNoStop: z(), candidateSmallStopOnly: z(), candidateSmallBash: z(), candidateSmallSameTools: z(),
  afterOkToolUseOnlyBig: z(),
};
const bigTools = {};
let asc = 0, used = 0, noUsage = 0;
const onlyAsc = process.argv[3] === 'asc';
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const isAsc = /agent-skill-chain|skills\/asc/.test(raw);
  if (isAsc) asc++;
  if (onlyAsc && !isAsc) continue;
  used++;
  const msgs = new Map(); // id -> {prev, blocks, usage, stop}
  const order = [];
  let prev = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    const msg = m.message;
    if (!msg) continue;
    if (m.type === 'user' && Array.isArray(msg.content)) {
      const r = msg.content.filter((c) => c.type === 'tool_result');
      prev = r.length ? { err: r.some((c) => c.is_error) } : { text: true };
      continue;
    }
    if (m.type === 'assistant' && Array.isArray(msg.content)) {
      let e = msgs.get(msg.id);
      if (!e) { e = { prev, blocks: [], usage: null, stop: false }; msgs.set(msg.id, e); order.push(msg.id); }
      e.blocks.push(...msg.content);
      if (msg.usage && (!e.usage || (msg.usage.output_tokens || 0) >= (e.usage.output_tokens || 0))) e.usage = msg.usage;
      if (msg.stop_reason) e.stop = true;
    }
  }
  let lastTools = null;
  for (const id of order) {
    const e = msgs.get(id);
    if (!e.usage) { noUsage++; continue; }
    add(T.all, e.usage);
    if (!e.stop) add(T.noStopReason, e.usage);
    const tu = e.blocks.filter((c) => c.type === 'tool_use');
    const tx = e.blocks.some((c) => (c.type === 'text' && c.text.trim()) || c.type === 'thinking');
    const names = tu.map((c) => c.name).join(',');
    if (e.prev && e.prev.err === false && tu.length && !tx) {
      add(T.afterOkToolUseOnly, e.usage);
      if ((e.usage.output_tokens || 0) <= 200) {
        add(T.candidateSmall, e.usage);
        add(e.stop ? T.candidateSmallStopOnly : T.candidateSmallNoStop, e.usage);
        if (tu.every((c) => c.name === 'Bash')) add(T.candidateSmallBash, e.usage);
        if (lastTools === names) add(T.candidateSmallSameTools, e.usage);
      } else {
        add(T.afterOkToolUseOnlyBig, e.usage);
        for (const c of tu) bigTools[c.name] = (bigTools[c.name] || 0) + 1;
      }
    }
    lastTools = names;
  }
}
console.log(JSON.stringify({ files: files.length, filesUsed: used, ascFiles: asc, messagesWithoutUsage: noUsage, bigTools, T }, null, 1));
