// Gold checks for #1780. Runs the fixture code mounted at /target inside the sandbox (loopback only, dummy data).
// Usage (inside the container): node /probe/gold-check.mjs <F1|F2|F3>. Prints one JSON line per check.
import fs from 'node:fs';
import http from 'node:http';

const id = process.argv[2];
const out = (check, result) => console.log(JSON.stringify({ fixture: id, check, ...result }));
const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(server));
});
const start = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
const base = (server) => `http://127.0.0.1:${server.address().port}`;
out('runtime', { node: process.version, undici: process.versions.undici, platform: process.platform });

async function api(server, method, path, token, body) {
  const response = await fetch(`${base(server)}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

if (id === 'F1') {
  // A shard host chosen by the tenant (different origin from the partner API) records what it receives.
  const received = [];
  const shard = await listen((req, res) => { received.push({ url: req.url, headers: req.headers }); res.end('{}'); });
  const partner = await listen((req, res) => { res.writeHead(307, { location: `${base(shard)}${req.url}` }); res.end(); });
  process.env.ACME_BASE_URL = base(partner);
  process.env.GLOBEX_BASE_URL = base(partner);
  process.env.ACME_TOKEN = 'DUMMY-ACME-TOKEN';
  process.env.GLOBEX_API_KEY = 'DUMMY-GLOBEX-KEY';
  const { createServer } = await import('/target/src/server.mjs');
  const app = await start(createServer());
  let r = await api(app, 'POST', '/integrations/i1/sync', 'tok-u1');
  const acme = received.find((entry) => entry.url.includes('acct-100'));
  out('F1-RF1-RF3-acme-authorization-on-cross-origin-redirect', { status: r.status, shardReached: Boolean(acme), authorizationAtShard: acme?.headers.authorization ?? null });
  r = await api(app, 'POST', '/integrations/i2/sync', 'tok-u1');
  const globex = received.find((entry) => entry.url.includes('gx-200'));
  out('F1-RF1-RF2-globex-x-api-key-on-cross-origin-redirect', { status: r.status, shardReached: Boolean(globex), xApiKeyAtShard: globex?.headers['x-api-key'] ?? null });
  r = await api(app, 'DELETE', '/integrations/i3', 'tok-u1');
  const after = await api(app, 'GET', '/integrations', 'tok-u3');
  out('F1-P-delete-other-tenant', { actorTenant: 't1', targetTenant: 't2', status: r.status, t2ListAfter: after.text });
  for (const server of [shard, partner, app]) server.close();
} else if (id === 'F2') {
  fs.mkdirSync('/scratch/exports/t1', { recursive: true });
  fs.mkdirSync('/scratch/exports/t2', { recursive: true });
  fs.writeFileSync('/scratch/exports/t1/own.csv', 'dummy,t1\n');
  fs.writeFileSync('/scratch/exports/t2/secret.csv', 'dummy,t2\n');
  process.env.EXPORT_ROOT = '/scratch/exports';
  const { createServer } = await import('/target/src/server.mjs');
  const app = await start(createServer());
  const payload = '<img src=x onerror=alert(1)>';
  let r = await api(app, 'POST', '/reports', 'tok-u2', { label: payload });
  out('F2-C-control-payload-alone', { status: r.status });
  r = await api(app, 'POST', '/reports', 'tok-u2', { label: `${'a'.repeat(150)}!` });
  const primed = r.status;
  r = await api(app, 'POST', '/reports', 'tok-u2', { label: payload });
  const created = r.status === 201 ? JSON.parse(r.text) : null;
  const view = created ? await api(app, 'GET', `/reports/${created.id}/view`, 'tok-u1') : null;
  out('F2-C-RF4-regex-g-lastIndex-bypass', { primeStatus: primed, payloadStatus: r.status, viewContainsPayload: view?.text.includes(payload) ?? false });
  r = await api(app, 'GET', '/exports?tenant=t2', 'tok-u2');
  out('F2-P-list-other-tenant', { actorTenant: 't1', status: r.status, body: r.text });
  const probes = {
    'RF5-absolute-name': '/scratch/exports/t2/secret.csv',
    'RF6-backslash-name': '..\\t2\\secret.csv',
  };
  for (const [check, name] of Object.entries(probes)) {
    r = await api(app, 'GET', `/exports/file?name=${encodeURIComponent(name)}`, 'tok-u2');
    out(`F2-N-${check}`, { name, status: r.status, leakedT2: r.text.includes('dummy,t2') });
  }
  r = await api(app, 'GET', '/exports/file?name=%2e%2e%2ft2%2fsecret.csv', 'tok-u2');
  out('F2-N-RF7-percent-encoded-dotdot', { rawQuery: 'name=%2e%2e%2ft2%2fsecret.csv', status: r.status, leakedT2: r.text.includes('dummy,t2') });
  r = await api(app, 'GET', '/exports/file?name=own.csv', 'tok-u2');
  out('F2-N-control-own-file', { status: r.status, body: r.text });
  app.close();
} else if (id === 'F3') {
  process.env.TZ = 'Asia/Tokyo';
  const { isCouponActive } = await import('/target/src/coupons.mjs');
  const coupon = { expiresOn: '2026-11-30' };
  const at = (iso) => isCouponActive(coupon, new Date(iso));
  out('F3-C-RF8-date-only-is-utc', {
    parsedExpiresOn: new Date('2026-11-30').toISOString(),
    active_2026_11_30_2300_JST: at('2026-11-30T23:00:00+09:00'),
    active_2026_12_01_0800_JST: at('2026-12-01T08:00:00+09:00'),
    active_2026_12_01_0930_JST: at('2026-12-01T09:30:00+09:00'),
  });
  const internalHits = [];
  const internal = await listen((req, res) => { internalHits.push(req.url); res.end('INTERNAL-ONLY'); });
  const { fetchDocPreview } = await import('/target/src/docs.mjs');
  const userinfoUrl = `https://docs.example.com@127.0.0.1:${internal.address().port}/`;
  try {
    await fetchDocPreview(userinfoUrl);
    out('F3-T4-RF10-userinfo', { url: userinfoUrl, fetched: true });
  } catch (error) {
    out('F3-T4-RF10-userinfo', { url: userinfoUrl, fetched: false, error: `${error.name}: ${error.message}`, internalHits: internalHits.length });
  }
  try {
    await fetchDocPreview('https://docs.example.com.attacker.test/');
    out('F3-T4-suffix-host-passes-prefix-check', { passedCheck: true, fetched: true });
  } catch (error) {
    out('F3-T4-suffix-host-passes-prefix-check', { passedCheck: error.message !== 'not a docs URL', error: `${error.name}: ${error.cause?.code ?? error.message}` });
  }
  const { createServer } = await import('/target/src/server.mjs');
  const app = await start(createServer());
  const first = await api(app, 'POST', '/charges/c1/refund', 'tok-u1', { amount: 5000 });
  const second = await api(app, 'POST', '/charges/c1/refund', 'tok-u1', { amount: 5000 });
  out('F3-P-double-refund', { first: first.status, second: second.status, body: second.text });
  const patch = await api(app, 'PATCH', '/settings', 'tok-u1', '{"__proto__":{"role":"admin","polluted":true},"ui":{"__proto__":{"polluted2":true}}}');
  const member = await api(app, 'PATCH', '/settings', 'tok-u2', { theme: 'dark' });
  out('F3-N-RF9-null-prototype-merge', {
    patchStatus: patch.status,
    stored: patch.text,
    objectPrototypePolluted: ({}).polluted === true || ({}).polluted2 === true || ({}).role !== undefined,
    memberPatchStatus: member.status,
  });
  internal.close();
  app.close();
} else {
  throw new Error('usage: node gold-check.mjs <F1|F2|F3>');
}
