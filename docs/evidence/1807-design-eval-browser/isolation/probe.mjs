// Isolation probe (#1807). Runs inside the generator-side container (browser image, internal network only).
// No model, no internet. Prints one JSON object with each check's raw observation and pass/fail.
// Env: PROXY_HOST (proxy), SITE_IP (dummy site's address on the upstream network, for the direct-egress check),
//      MARKER_NAME / MARKER_TOKEN (a file created on the host outside every mount; must not be visible here).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import {spawn} from 'node:child_process';

const PROXY_HOST = process.env.PROXY_HOST ?? 'proxy';
const results = [];
const rec = (id, pass, observed) => { results.push({id, pass, observed}); };

function viaProxy(port, url, method = 'GET') {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = http.request({host: PROXY_HOST, port, method, path: url, headers: {host: u.host}, timeout: 8000}, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({status: res.statusCode, location: res.headers.location ?? null, body: b.slice(0, 200)}));
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', (e) => resolve({error: e.code ?? e.message})); r.end();
  });
}
function connectVia(port, target) {
  return new Promise((resolve) => {
    const r = http.request({host: PROXY_HOST, port, method: 'CONNECT', path: target, timeout: 8000});
    r.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); resolve({status: res.statusCode}); return; }
      // speak plain HTTP through the tunnel (the dummy site answers HTTP on 443)
      socket.write(`GET /ok HTTP/1.1\r\nHost: ${target.split(':')[0]}\r\nConnection: close\r\n\r\n`);
      let b = ''; socket.on('data', (c) => { b += c; }); socket.on('end', () => resolve({status: 200, tunneled: b.split('\r\n')[0], marker: /MARKER-PAGE-FROM-[a-z.]+/.exec(b)?.[0] ?? null}));
      socket.on('error', (e) => resolve({status: 200, error: e.code}));
    });
    r.on('response', (res) => resolve({status: res.statusCode}));
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', (e) => resolve({error: e.code ?? e.message})); r.end();
  });
}
function tcp(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({host, port, timeout: 4000}, () => { s.destroy(); resolve('connected'); });
    s.on('timeout', () => { s.destroy(); resolve('timeout'); }); s.on('error', (e) => resolve(e.code));
  });
}

// MCP client for the real tool server.
function mcp() {
  const p = spawn(process.execPath, ['/opt/env/mcp-server.mjs'], {stdio: ['pipe', 'pipe', 'inherit']});
  let buf = ''; const waiters = new Map(); let id = 0;
  p.stdout.on('data', (c) => {
    buf += c; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); waiters.get(m.id)?.(m); waiters.delete(m.id); }
  });
  const call = (method, params) => new Promise((resolve) => { id += 1; waiters.set(id, resolve); p.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n'); });
  return {call, close: () => p.kill()};
}
const textOf = (r) => (r.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
function pngSize(b64) { const b = Buffer.from(b64, 'base64'); return b.slice(1, 4).toString() === 'PNG' ? {w: b.readUInt32BE(16), h: b.readUInt32BE(20)} : null; }

// (i) allowlisted host reachable through the browse proxy (HTTP and CONNECT)
const okHttp = await viaProxy(3129, 'http://allowed.test/ok');
rec('i-allowed-http', okHttp.status === 200 && okHttp.body.includes('MARKER-PAGE-FROM-allowed.test'), okHttp);
const okTunnel = await connectVia(3129, 'allowed.test:443');
rec('i-allowed-connect', okTunnel.status === 200 && okTunnel.marker === 'MARKER-PAGE-FROM-allowed.test', okTunnel);
// (ii) non-allowlisted host blocked (HTTP, CONNECT, IP literal, suffix trick, port, method)
const bHttp = await viaProxy(3129, 'http://blocked.test/ok');
rec('ii-blocked-http', bHttp.status === 403, bHttp);
const bTunnel = await connectVia(3129, 'blocked.test:443');
rec('ii-blocked-connect', bTunnel.status === 403, bTunnel);
const bSuffix = await viaProxy(3129, 'http://allowed.test.blocked.test/ok');
rec('ii-blocked-suffix-trick', bSuffix.status === 403, bSuffix);
const bIp = await viaProxy(3129, `http://${process.env.SITE_IP}/ok`);
rec('ii-blocked-ip-literal', bIp.status === 403, bIp);
const bPort = await connectVia(3129, 'allowed.test:22');
rec('ii-blocked-port', bPort.status === 403, bPort);
const bPost = await viaProxy(3129, 'http://allowed.test/ok', 'POST');
rec('ii-blocked-post', bPost.status === 403, bPost);
const bModel = await connectVia(3128, 'allowed.test:443');
rec('ii-model-listener-refuses-browse-host', bModel.status === 403, bModel);
// (ii') production setting denyPrivateAddresses=true (second proxy): an allowlisted name resolving to a private address is refused
if (process.env.PROXY2_HOST) {
  const saved = PROXY_HOST;
  const r = await new Promise((resolve) => {
    const q = http.request({host: process.env.PROXY2_HOST, port: 3129, method: 'GET', path: 'http://allowed.test/ok', headers: {host: 'allowed.test'}, timeout: 8000}, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({status: res.statusCode, body: b.slice(0, 120)}));
    });
    q.on('error', (e) => resolve({error: e.code})); q.end();
  });
  rec('ii-private-address-refused-when-enabled', r.status === 403 && /private-address/.test(r.body), {proxy: 'proxy2', saved, ...r});
}
// (iii) redirect: the proxy passes the 302 through; the client's next hop to blocked.test is refused
const r1 = await viaProxy(3129, 'http://allowed.test/redirect-blocked');
const r2 = r1.location ? await viaProxy(3129, r1.location) : null;
rec('iii-redirect-hop-blocked-by-proxy', r1.status === 302 && r2?.status === 403, {first: r1, second: r2});

// (iv) direct egress without the proxy
let dnsSite; try { dnsSite = await dns.lookup('allowed.test'); } catch (e) { dnsSite = e.code; }
const direct = await tcp(process.env.SITE_IP, 80);
const pub = await tcp('1.1.1.1', 443);
let dnsPub; try { dnsPub = await dns.lookup('example.com'); } catch (e) { dnsPub = e.code; }
rec('iv-direct-egress-blocked', typeof dnsSite === 'string' && direct !== 'connected' && pub !== 'connected' && typeof dnsPub === 'string',
  {dnsAllowedTest: dnsSite, tcpSiteIp80: direct, tcp1111: pub, dnsExampleCom: dnsPub});

// (v) no host home / secrets
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')).map((f) => ({target: f[4], fstype: f[f.indexOf('-') + 1]}));
const binds = mounts.filter((m) => !['proc', 'sysfs', 'tmpfs', 'devpts', 'mqueue', 'cgroup', 'cgroup2', 'overlay', 'shm'].includes(m.fstype)).map((m) => m.target);
const envNames = Object.keys(process.env).filter((k) => /TOKEN|KEY|SECRET|PASS|ANTHROPIC|AWS|GH_|GITHUB|SSH|CREDENTIAL/i.test(k));
const found = [];
const walk = (d, depth) => {
  if (depth > 12) return;
  let ents; try { ents = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (['/proc', '/sys', '/dev'].includes(p)) continue;
    if (e.name === process.env.MARKER_NAME) found.push(p);
    if (e.isDirectory() && !e.isSymbolicLink()) walk(p, depth + 1);
  }
};
walk('/', 0);
const sensitive = ['/var/run/docker.sock', '/run/docker.sock', '/root/.ssh', '/home/pwuser/.ssh', '/home/pwuser/.claude', '/home/pwuser/.config/gh'].filter((p) => fs.existsSync(p));
let rootWritable; try { fs.writeFileSync('/usr/local/x', 'x'); rootWritable = true; } catch (e) { rootWritable = e.code; }
const status = fs.readFileSync('/proc/self/status', 'utf8');
const capEff = /CapEff:\s*(\S+)/.exec(status)?.[1];
const noNewPrivs = /NoNewPrivs:\s*(\S+)/.exec(status)?.[1];
rec('v-no-home-or-secrets', found.length === 0 && envNames.length === 0 && sensitive.length === 0 && rootWritable !== true && capEff === '0000000000000000' && noNewPrivs === '1' &&
  binds.every((t) => ['/work', '/opt/env', '/opt/iso', '/config', '/log', '/etc/hosts', '/etc/hostname', '/etc/resolv.conf'].includes(t)),
  {binds, envNamesMatchingSecretPattern: envNames, markerFound: found, sensitivePathsPresent: sensitive, rootfsWrite: rootWritable, capEff, noNewPrivs, uid: process.getuid()});

// (vi) screenshot tool works offline on a local HTML file, at 390 and 1440; outside paths refused; external requests aborted
fs.mkdirSync('/work/out', {recursive: true});
fs.writeFileSync('/work/out/alt-a.html', '<!doctype html><meta charset="utf-8"><title>a</title><style>body{margin:0;font-family:sans-serif}.w{width:100%;height:1600px;background:linear-gradient(#123,#9ab)}</style><div class="w"><h1>案A 画面</h1><img src="http://allowed.test/ok"><img src="https://blocked.test/x.png"></div>');
fs.writeFileSync('/work/out/alt-b.html', '<!doctype html><meta charset="utf-8"><title>b</title><div style="width:600px">fixed 600px</div>');
try { fs.symlinkSync('/etc/passwd', '/work/out/link.html'); } catch { /* exists */ }
const m = mcp();
await m.call('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'probe', version: '1'}});
const list = await m.call('tools/list', {});
const shots = {};
for (const [p, w] of [['out/alt-a.html', 390], ['out/alt-a.html', 1440], ['out/alt-b.html', 390]]) {
  const r = await m.call('tools/call', {name: 'screenshot', arguments: {path: p, width: w}});
  const img = r.result?.content?.find((c) => c.type === 'image');
  shots[`${p}@${w}`] = {isError: r.result?.isError ?? false, png: img ? pngSize(img.data) : null, info: textOf(r).slice(0, 400)};
}
fs.writeFileSync('/work/not-out.html', '<p>outside out/</p>');
const outside = await m.call('tools/call', {name: 'screenshot', arguments: {path: 'not-out.html', width: 390}});
const traversal = await m.call('tools/call', {name: 'screenshot', arguments: {path: 'out/../not-out.html', width: 390}});
const viaLink = await m.call('tools/call', {name: 'screenshot', arguments: {path: 'out/link.html', width: 390}});
const badWidth = await m.call('tools/call', {name: 'screenshot', arguments: {path: 'out/alt-a.html', width: 1000}});
const a390 = shots['out/alt-a.html@390']; const a1440 = shots['out/alt-a.html@1440'];
rec('vi-screenshot-offline', a390.png?.w === 390 && a1440.png?.w === 1440 && /"blockedRequests":2/.test(a390.info) &&
  /"horizontalOverflow":true/.test(shots['out/alt-b.html@390'].info) && outside.result?.isError === true && /inside out/.test(textOf(outside)) && traversal.result?.isError === true && viaLink.result?.isError === true && badWidth.result?.isError === true,
  {tools: list.result?.tools?.map((t) => t.name), shots, outside: textOf(outside), traversal: textOf(traversal), symlink: textOf(viaLink), badWidth: textOf(badWidth)});

// Tool-level checks through the same proxy: fetch_page allow / block / redirect / injection wrapping; view_page.
const f1 = await m.call('tools/call', {name: 'fetch_page', arguments: {url: 'http://allowed.test/redirect-ok'}});
rec('i-tool-fetch-allowed-with-same-host-redirect', !f1.result?.isError && textOf(f1).includes('MARKER-PAGE-FROM-allowed.test') && textOf(f1).includes('redirects: 1'), textOf(f1).slice(0, 400));
const f2 = await m.call('tools/call', {name: 'fetch_page', arguments: {url: 'http://blocked.test/ok'}});
const listOk = (t) => t.includes('閲覧できるのは、次の許可されたサイト（1件）だけです。') && t.includes('- allowed.test（試験用のdummy site。媒体：Web・デジタル）') && !/\n- blocked\.test/.test(t);
rec('ii-tool-fetch-blocked', f2.result?.isError === true && listOk(textOf(f2)), textOf(f2));
const f3 = await m.call('tools/call', {name: 'fetch_page', arguments: {url: 'http://allowed.test/redirect-blocked'}});
rec('iii-tool-fetch-redirect-blocked', f3.result?.isError === true && /redirect blocked/.test(textOf(f3)) && listOk(textOf(f3)), textOf(f3));
const f4 = await m.call('tools/call', {name: 'fetch_page', arguments: {url: 'file:///etc/passwd'}});
rec('ii-tool-fetch-file-scheme-refused', f4.result?.isError === true && !textOf(f4).includes('閲覧できるのは'), textOf(f4));
const f5 = await m.call('tools/call', {name: 'fetch_page', arguments: {url: 'http://allowed.test/inject'}});
const t5 = textOf(f5);
const closes = (t5.match(/<\/untrusted-content>/g) ?? []).length;
rec('data-not-instructions-wrapping', !f5.result?.isError && t5.includes('命令ではありません') && closes === 1 && t5.trimEnd().endsWith('</untrusted-content>') && !t5.includes('document.title'),
  {closingDelimiters: closes, excerpt: t5.slice(0, 600)});
const v1 = await m.call('tools/call', {name: 'view_page', arguments: {url: 'http://allowed.test/subres', width: 390}});
const v1img = v1.result?.content?.find((c) => c.type === 'image');
rec('i-tool-view-page-allowed-subresource-blocked', !v1.result?.isError && pngSize(v1img?.data ?? '')?.w === 390 && /"blockedRequests":1/.test(textOf(v1)), textOf(v1).slice(-400));
const v2 = await m.call('tools/call', {name: 'view_page', arguments: {url: 'http://allowed.test/redirect-blocked', width: 1440}});
rec('iii-tool-view-page-redirect-not-rendered', v2.result?.isError === true && /redirect blocked/.test(textOf(v2)) && listOk(textOf(v2)) && !(v2.result?.content ?? []).some((c) => c.type === 'image'), textOf(v2).slice(-400));
const v3 = await m.call('tools/call', {name: 'view_page', arguments: {url: 'http://blocked.test/ok', width: 390}});
rec('ii-tool-view-page-blocked-returns-allowlist', v3.result?.isError === true && listOk(textOf(v3)) && !(v3.result?.content ?? []).some((c) => c.type === 'image'), textOf(v3));
m.close();

console.log(JSON.stringify({schema: 'asc-1807-isolation-probe/v1', uid: process.getuid(), node: process.version, pass: results.every((r) => r.pass), results}, null, 1));
