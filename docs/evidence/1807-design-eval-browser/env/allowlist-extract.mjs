// Extracts rows and cited hosts from the Art Direction works catalogue (references/design-works.md at the fixed commit).
// Usage: node allowlist-extract.mjs <design-works.md> <out.json>. Reads the file as data only. Node built-ins only.
// Ported from the earlier Python version (same rules; the proposal it feeds is reproduced byte-for-byte).
import fs from 'node:fs';

export function hostOf(url) {
  // Same result as Python urllib.parse.urlsplit(url).hostname for http(s) URLs: drop userinfo and port, lowercase.
  const netloc = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)?.[1] ?? '';
  let h = netloc.includes('@') ? netloc.slice(netloc.lastIndexOf('@') + 1) : netloc;
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']'));
  else if (h.includes(':')) h = h.slice(0, h.indexOf(':'));
  return h ? h.toLowerCase() : null;
}

export function extract(text) {
  const rows = []; let sec = null;
  const lines = text.split(/(?<=\n)/);
  lines.forEach((l, idx) => {
    const i = idx + 1;
    if (l.startsWith('## ')) { sec = l.slice(3).trim(); return; }
    if (!l.startsWith('| ') || l.startsWith('| ---') || l.startsWith('| 作品')) return;
    const cells = l.trim().replace(/^\|+|\|+$/g, '').split(' | ').map((c) => c.trim());
    if (cells.length < 4) return;
    const links = [...cells[1].matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => ({label: m[1], url: m[2], host: hostOf(m[2])}));
    rows.push({line: i, section: sec, work: cells[0], medium: cells[3], links});
  });
  const hosts = new Map();
  for (const r of rows) {
    for (const h of [...new Set(r.links.map((k) => k.host))].sort()) {
      if (!hosts.has(h)) hosts.set(h, []);
      hosts.get(h).push(r.line);
    }
  }
  return {rows, hosts: Object.fromEntries(hosts)};
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [src, out] = process.argv.slice(2);
  const d = extract(fs.readFileSync(src, 'utf8'));
  fs.writeFileSync(out, JSON.stringify(d, null, 1));
  console.log(`${d.rows.length} rows ${Object.keys(d.hosts).length} hosts`);
}
