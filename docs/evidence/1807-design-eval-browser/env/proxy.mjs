// Allowlist-enforcing forward proxy (#1807). Node built-ins only; no third-party code.
// Usage: node proxy.mjs <allowlist.json> [--log <file>]
// Listeners (from the config):
//   model  : CONNECT only, to config.model.hosts (the model API used by the generator CLI).
//   browse : CONNECT and absolute-URI GET/HEAD, to config.browse.hosts (pages the generator may view).
// Every hop is checked here, so a redirect to a host outside the list fails when the client follows it.
// Rules: host must match the list (exact, or ".suffix" for subdomains); IP literals are refused;
// port must be in config.ports; with denyPrivateAddresses, a name resolving to a private/loopback/link-local
// address is refused, and the upstream connection is pinned to the checked address (no re-resolution).
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';

const args = process.argv.slice(2);
const cfgPath = args[0];
if (!cfgPath) { console.error('usage: node proxy.mjs <allowlist.json> [--log <file>]'); process.exit(2); }
const logPath = args.includes('--log') ? args[args.indexOf('--log') + 1] : null;
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const ports = new Set(cfg.ports ?? [443]);
const denyPrivate = cfg.denyPrivateAddresses !== false;
const listeners = {
  model: {port: cfg.model?.port ?? 3128, hosts: (cfg.model?.hosts ?? []).map(norm), http: false, max: cfg.model?.maxRequests ?? null, count: 0},
  browse: {port: cfg.browse?.port ?? 3129, hosts: (cfg.browse?.hosts ?? []).map(norm), http: true, max: cfg.browse?.maxRequests ?? null, count: 0},
};

function norm(h) { return String(h).trim().toLowerCase().replace(/\.$/, ''); }
function log(rec) {
  const line = JSON.stringify({t: new Date().toISOString(), ...rec});
  console.log(line);
  if (logPath) { try { fs.appendFileSync(logPath, line + '\n'); } catch { /* log dir may be read-only in probes */ } }
}
export function hostAllowed(host, list) {
  const h = norm(host);
  if (!/^[a-z0-9.-]+$/.test(h) || net.isIP(h)) return false;
  return list.some((e) => (e.startsWith('.') ? h.endsWith(e) && h.length > e.length : h === e));
}
export function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return isPrivate(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') ||
    x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
}
async function decide(L, name, host, port) {
  if (L.max !== null && L.count >= L.max) return {ok: false, reason: 'request-cap'};
  if (net.isIP(norm(host))) return {ok: false, reason: 'ip-literal'};
  if (!hostAllowed(host, L.hosts)) return {ok: false, reason: 'host-not-allowlisted'};
  if (!ports.has(Number(port))) return {ok: false, reason: 'port-not-allowed'};
  let addrs;
  try { addrs = await dns.lookup(norm(host), {all: true}); } catch (e) { return {ok: false, reason: 'dns-failed', detail: e.code}; }
  if (denyPrivate && addrs.some((a) => isPrivate(a.address))) return {ok: false, reason: 'private-address', detail: addrs.map((a) => a.address)};
  L.count += 1;
  return {ok: true, address: addrs[0].address};
}

function start(name) {
  const L = listeners[name];
  const server = http.createServer(async (req, res) => {
    let u;
    try { u = new URL(req.url); } catch { u = null; }
    if (!L.http || !u || u.protocol !== 'http:' || !['GET', 'HEAD'].includes(req.method)) {
      log({listener: name, method: req.method, url: String(req.url).slice(0, 300), decision: 'deny', reason: 'method-or-form'});
      res.writeHead(403, {'content-type': 'text/plain'}); res.end('denied by proxy: method-or-form\n'); return;
    }
    const port = u.port || 80;
    const d = await decide(L, name, u.hostname, port);
    if (!d.ok) {
      log({listener: name, method: req.method, url: u.href.slice(0, 300), decision: 'deny', reason: d.reason, detail: d.detail});
      res.writeHead(403, {'content-type': 'text/plain'}); res.end(`denied by proxy: ${d.reason}\n`); return;
    }
    const headers = {...req.headers, host: u.host};
    for (const k of Object.keys(headers)) if (/^(proxy-|connection$|keep-alive$|te$|trailer$|upgrade$)/i.test(k)) delete headers[k];
    const up = http.request({host: d.address, port, method: req.method, path: u.pathname + u.search, headers, timeout: 30000}, (ur) => {
      log({listener: name, method: req.method, url: u.href.slice(0, 300), decision: 'allow', status: ur.statusCode, location: ur.headers.location ?? null});
      res.writeHead(ur.statusCode ?? 502, ur.headers); ur.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', (e) => {
      log({listener: name, method: req.method, url: u.href.slice(0, 300), decision: 'allow', status: 502, error: e.message});
      if (!res.headersSent) res.writeHead(502); res.end();
    });
    up.end();
  });
  server.on('connect', async (req, socket) => {
    socket.on('error', () => {});
    const m = /^([^:\s]+):(\d+)$/.exec(req.url ?? '');
    if (!m) { log({listener: name, method: 'CONNECT', target: req.url, decision: 'deny', reason: 'bad-target'}); socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const d = await decide(L, name, m[1], m[2]);
    if (!d.ok) {
      log({listener: name, method: 'CONNECT', target: req.url, decision: 'deny', reason: d.reason, detail: d.detail});
      socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\ndenied by proxy: ${d.reason}\n`); return;
    }
    const up = net.connect({host: d.address, port: Number(m[2]), timeout: 30000}, () => {
      log({listener: name, method: 'CONNECT', target: req.url, decision: 'allow'});
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.pipe(socket); socket.pipe(up);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', (e) => { log({listener: name, method: 'CONNECT', target: req.url, decision: 'allow', error: e.message}); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  });
  server.listen(L.port, '0.0.0.0', () => log({listener: name, event: 'listening', port: L.port, hosts: L.hosts.length}));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  start('model');
  start('browse');
}
