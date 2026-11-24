// Positive control for RF3 (added after measurement, at the independent review's request; gold is unchanged).
// Records the headers that the partner (first hop) and the shard (redirect target) receive for the F1 fixture code.
// Usage (inside the container): node /probe/rf3-control.mjs
import http from 'node:http';

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(server));
});
const base = (server) => `http://127.0.0.1:${server.address().port}`;
const seen = { partner: [], shard: [] };
const shard = await listen((req, res) => { seen.shard.push(req.headers); res.end('{}'); });
const partner = await listen((req, res) => {
  seen.partner.push(req.headers);
  res.writeHead(307, { location: `${base(shard)}${req.url}` });
  res.end();
});
process.env.ACME_BASE_URL = base(partner);
process.env.GLOBEX_BASE_URL = base(partner);
process.env.ACME_TOKEN = 'DUMMY-ACME-TOKEN';
process.env.GLOBEX_API_KEY = 'DUMMY-GLOBEX-KEY';
const { checkAcmeAccount } = await import('/target/src/partners/acme.mjs');
const { checkGlobexAccount } = await import('/target/src/partners/globex.mjs');
await checkAcmeAccount('acct-100');
await checkGlobexAccount('gx-200');
console.log(JSON.stringify({ check: 'RF3-positive-control-acme', authorizationAtPartner: seen.partner[0]?.authorization ?? null, authorizationAtShard: seen.shard[0]?.authorization ?? null }));
console.log(JSON.stringify({ check: 'RF2-positive-control-globex', xApiKeyAtPartner: seen.partner[1]?.['x-api-key'] ?? null, xApiKeyAtShard: seen.shard[1]?.['x-api-key'] ?? null }));
partner.close();
shard.close();
