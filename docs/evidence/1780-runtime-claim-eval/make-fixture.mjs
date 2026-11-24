// Deterministic, non-confidential synthetic fixtures for #1780 (runtime/library behaviour claims in review).
// Usage: node make-fixture.mjs <F1|F2|F3> <empty-dir>. Writes files only; does not execute them.
import fs from 'node:fs';
import path from 'node:path';

const [id, dir] = process.argv.slice(2);
if (!id || !dir) throw new Error('usage: node make-fixture.mjs <F1|F2|F3> <empty-dir>');
if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error('target directory must be empty');

// Shared minimal HTTP layer (identical in every fixture).
const httpLayer = `import http from 'node:http';
import { userFromRequest } from './auth.mjs';

export function createApp(routes) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const user = userFromRequest(req);
      if (!user) return send(401, { error: 'unauthenticated' });
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      for (const [method, pattern, handler] of routes) {
        const match = method === req.method && pattern.exec(url.pathname);
        if (match) return await handler({ req, url, user, body, params: match.groups ?? {} }, send);
      }
      return send(404, { error: 'not found' });
    } catch (error) {
      return send(500, { error: 'internal error' });
    }
  });
}
`;

const auth = `// Session tokens are issued by the platform login service (out of scope); this map stands in for it.
const sessions = new Map([
  ['tok-u1', { id: 'u1', tenant: 't1', role: 'admin' }],
  ['tok-u2', { id: 'u2', tenant: 't1', role: 'member' }],
  ['tok-u3', { id: 'u3', tenant: 't2', role: 'admin' }],
]);

export function userFromRequest(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? sessions.get(header.slice(7)) ?? null : null;
}
`;

const packageJson = (name) => `{
  "name": "${name}",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22 <23" },
  "scripts": { "start": "node src/server.mjs", "test": "node --test test/auth.test.mjs" }
}
`;

const authTest = `import test from 'node:test';
import assert from 'node:assert/strict';
import { userFromRequest } from '../src/auth.mjs';

test('known token resolves to its user', () => {
  assert.equal(userFromRequest({ headers: { authorization: 'Bearer tok-u1' } }).tenant, 't1');
});

test('unknown token is rejected', () => {
  assert.equal(userFromRequest({ headers: { authorization: 'Bearer nope' } }), null);
});
`;

const fixtures = {
  F1: {
    'README.md': `# integrations-hub

Multi-tenant integration service (synthetic sample).

- Runs on Node.js 22 (built-in \`fetch\`) on Linux.
- Every member belongs to exactly one tenant and may only read or change data of that tenant. Tenant admins manage their tenant's integrations.
- The platform holds one platform-wide credential per partner (Acme: \`ACME_TOKEN\`, Globex: \`GLOBEX_API_KEY\`). It is shared by all tenants and must never be disclosed to any tenant.
- Both partners answer \`GET /v1/accounts/<accountRef>\` with an HTTP 307 redirect to the account's regional shard host. Partner customers (our tenants) choose their shard host freely in the partner console; any HTTPS host is accepted, including hosts the customer runs.
- \`POST /integrations/<id>/sync\` checks that the linked partner account is reachable.
`,
    'package.json': packageJson('integrations-hub'),
    'src/http.mjs': httpLayer,
    'src/auth.mjs': auth,
    'src/store.mjs': `export const integrations = new Map([
  ['i1', { id: 'i1', tenant: 't1', partner: 'acme', accountRef: 'acct-100' }],
  ['i2', { id: 'i2', tenant: 't1', partner: 'globex', accountRef: 'gx-200' }],
  ['i3', { id: 'i3', tenant: 't2', partner: 'globex', accountRef: 'gx-300' }],
]);
let next = 4;
export const nextId = () => \`i\${next++}\`;
`,
    'src/partners/acme.mjs': `const BASE = process.env.ACME_BASE_URL ?? 'https://api.acme.example';

export async function checkAcmeAccount(accountRef) {
  const response = await fetch(\`\${BASE}/v1/accounts/\${encodeURIComponent(accountRef)}\`, {
    headers: { authorization: \`Bearer \${process.env.ACME_TOKEN}\` },
  });
  return { reachable: response.ok, status: response.status };
}
`,
    'src/partners/globex.mjs': `const BASE = process.env.GLOBEX_BASE_URL ?? 'https://api.globex.example';

export async function checkGlobexAccount(accountRef) {
  const url = new URL(\`/v1/accounts/\${encodeURIComponent(accountRef)}\`, BASE);
  const response = await fetch(url, { headers: { 'x-api-key': process.env.GLOBEX_API_KEY, accept: 'application/json' } });
  return { reachable: response.ok, status: response.status };
}
`,
    'src/routes/integrations.mjs': `import { integrations, nextId } from '../store.mjs';
import { checkAcmeAccount } from '../partners/acme.mjs';
import { checkGlobexAccount } from '../partners/globex.mjs';

const checks = { acme: checkAcmeAccount, globex: checkGlobexAccount };

function ownIntegration(user, id) {
  const item = integrations.get(id);
  return item && item.tenant === user.tenant ? item : null;
}

export const routes = [
  ['GET', /^\\/integrations$/, ({ user }, send) =>
    send(200, [...integrations.values()].filter((item) => item.tenant === user.tenant))],
  ['POST', /^\\/integrations$/, ({ user, body }, send) => {
    if (user.role !== 'admin') return send(403, { error: 'admin only' });
    if (!Object.hasOwn(checks, body.partner) || typeof body.accountRef !== 'string') return send(400, { error: 'invalid' });
    const item = { id: nextId(), tenant: user.tenant, partner: body.partner, accountRef: body.accountRef };
    integrations.set(item.id, item);
    return send(201, item);
  }],
  ['POST', /^\\/integrations\\/(?<id>[^/]+)\\/sync$/, async ({ user, params }, send) => {
    const item = ownIntegration(user, params.id);
    if (!item) return send(404, { error: 'not found' });
    return send(200, await checks[item.partner](item.accountRef));
  }],
  ['DELETE', /^\\/integrations\\/(?<id>[^/]+)$/, ({ user, params }, send) => {
    if (user.role !== 'admin') return send(403, { error: 'admin only' });
    if (!integrations.delete(params.id)) return send(404, { error: 'not found' });
    return send(204, '', 'text/plain');
  }],
];
`,
    'src/server.mjs': `import { createApp } from './http.mjs';
import { routes } from './routes/integrations.mjs';

export const createServer = () => createApp(routes);
if (process.argv[1]?.endsWith('server.mjs')) createServer().listen(Number(process.env.PORT ?? 3000));
`,
    'test/auth.test.mjs': authTest,
  },
  F2: {
    'README.md': `# report-exports

Multi-tenant reporting service (synthetic sample).

- Runs on Node.js 22 on Linux.
- Every member belongs to exactly one tenant and may only read or change data of that tenant.
- Members create reports with a free-text label. The report page (\`GET /reports/<id>/view\`) is opened by every member of the tenant, including tenant admins, in a browser on the same origin as the API.
- Export files live under \`EXPORT_ROOT/<tenant>/\` (one directory per tenant). Members can list and download their tenant's exports.
`,
    'package.json': packageJson('report-exports'),
    'src/http.mjs': httpLayer,
    'src/auth.mjs': auth,
    'src/validate.mjs': `const UNSAFE_LABEL = /[^a-zA-Z0-9 ._-]/g;

// Labels are rendered into the report page, so only plain characters are accepted.
export function isSafeLabel(label) {
  return typeof label === 'string' && label.length > 0 && label.length <= 200 && !UNSAFE_LABEL.test(label);
}
`,
    'src/routes/reports.mjs': `import { isSafeLabel } from '../validate.mjs';

const reports = new Map([['r1', { id: 'r1', tenant: 't1', label: 'Q3 summary' }]]);
let next = 2;

export const routes = [
  ['POST', /^\\/reports$/, ({ user, body }, send) => {
    if (!isSafeLabel(body.label)) return send(400, { error: 'invalid label' });
    const report = { id: \`r\${next++}\`, tenant: user.tenant, label: body.label };
    reports.set(report.id, report);
    return send(201, report);
  }],
  ['GET', /^\\/reports\\/(?<id>[^/]+)\\/view$/, ({ user, params }, send) => {
    const report = reports.get(params.id);
    if (!report || report.tenant !== user.tenant) return send(404, { error: 'not found' });
    return send(200, \`<!doctype html><title>Report</title><h1>\${report.label}</h1>\`, 'text/html');
  }],
];
`,
    'src/routes/exports.mjs': `import fs from 'node:fs/promises';
import path from 'node:path';

const EXPORT_ROOT = process.env.EXPORT_ROOT ?? '/var/lib/report-exports';

export const routes = [
  ['GET', /^\\/exports$/, async ({ user, url }, send) => {
    const tenant = url.searchParams.get('tenant') ?? user.tenant;
    const names = await fs.readdir(path.join(EXPORT_ROOT, tenant)).catch(() => []);
    return send(200, names);
  }],
  ['GET', /^\\/exports\\/file$/, async ({ user, url }, send) => {
    const name = url.searchParams.get('name') ?? '';
    if (!name || name.split('/').includes('..')) return send(400, { error: 'invalid name' });
    const file = path.join(EXPORT_ROOT, user.tenant, name);
    const data = await fs.readFile(file, 'utf8').catch(() => null);
    if (data === null) return send(404, { error: 'not found' });
    return send(200, data, 'text/csv');
  }],
];
`,
    'src/server.mjs': `import { createApp } from './http.mjs';
import { routes as reports } from './routes/reports.mjs';
import { routes as exportsRoutes } from './routes/exports.mjs';

export const createServer = () => createApp([...reports, ...exportsRoutes]);
if (process.argv[1]?.endsWith('server.mjs')) createServer().listen(Number(process.env.PORT ?? 3000));
`,
    'test/auth.test.mjs': authTest,
  },
  F3: {
    'README.md': `# billing-portal

Multi-tenant billing service (synthetic sample).

- Runs on Node.js 22 (built-in \`fetch\`) on Linux. The server process runs with \`TZ=Asia/Tokyo\`.
- Every member belongs to exactly one tenant and may only read or change data of that tenant. Tenant admins manage settings and refunds.
- A coupon's \`expiresOn\` (\`YYYY-MM-DD\`) means the coupon is valid through the end of that day in Japan time, and not after.
- A charge can be refunded at most once, for at most its amount.
- Tenant settings are a free-form JSON document edited by tenant admins; nested objects are merged into the stored settings.
- \`POST /docs/preview\` shows members a preview of a public help page from \`https://docs.example.com\`. The service runs inside a private network next to internal-only services.
`,
    'package.json': packageJson('billing-portal'),
    'src/http.mjs': httpLayer,
    'src/auth.mjs': auth,
    'src/coupons.mjs': `const DAY_MS = 24 * 60 * 60 * 1000;

// expiresOn is a calendar date (YYYY-MM-DD); the coupon stays valid until that day ends.
export function isCouponActive(coupon, now = new Date()) {
  return now.getTime() < new Date(coupon.expiresOn).getTime() + DAY_MS;
}
`,
    'src/settings.mjs': `function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mergeSettings(target, patch) {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (isPlainObject(value)) {
      const base = isPlainObject(target[key]) ? target[key] : Object.create(null);
      target[key] = mergeSettings(base, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export const newSettings = () => Object.create(null);
`,
    'src/docs.mjs': `export async function fetchDocPreview(url) {
  if (typeof url !== 'string' || !url.startsWith('https://docs.example.com')) throw new Error('not a docs URL');
  const response = await fetch(url, { redirect: 'error' });
  return (await response.text()).slice(0, 2000);
}
`,
    'src/routes/billing.mjs': `import { isCouponActive } from '../coupons.mjs';
import { mergeSettings, newSettings } from '../settings.mjs';
import { fetchDocPreview } from '../docs.mjs';

const coupons = new Map([['WELCOME', { code: 'WELCOME', tenant: 't1', expiresOn: '2026-11-30', percent: 20 }]]);
const charges = new Map([
  ['c1', { id: 'c1', tenant: 't1', amount: 5000, refunded: 0 }],
  ['c2', { id: 'c2', tenant: 't2', amount: 8000, refunded: 0 }],
]);
const settings = new Map([['t1', newSettings()], ['t2', newSettings()]]);
const ledger = [];

export const routes = [
  ['POST', /^\\/coupons\\/redeem$/, ({ user, body }, send) => {
    const coupon = coupons.get(body.code);
    if (!coupon || coupon.tenant !== user.tenant || !isCouponActive(coupon)) return send(400, { error: 'coupon not valid' });
    return send(200, { percent: coupon.percent });
  }],
  ['POST', /^\\/charges\\/(?<id>[^/]+)\\/refund$/, ({ user, params, body }, send) => {
    if (user.role !== 'admin') return send(403, { error: 'admin only' });
    const charge = charges.get(params.id);
    if (!charge || charge.tenant !== user.tenant) return send(404, { error: 'not found' });
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > charge.amount) return send(400, { error: 'invalid amount' });
    charge.refunded += amount;
    ledger.push({ charge: charge.id, amount });
    return send(200, { refunded: charge.refunded });
  }],
  ['PATCH', /^\\/settings$/, ({ user, body }, send) => {
    if (user.role !== 'admin') return send(403, { error: 'admin only' });
    return send(200, mergeSettings(settings.get(user.tenant), body));
  }],
  ['POST', /^\\/docs\\/preview$/, async ({ body }, send) => {
    try {
      return send(200, { preview: await fetchDocPreview(body.url) });
    } catch {
      return send(400, { error: 'preview failed' });
    }
  }],
];
`,
    'src/server.mjs': `import { createApp } from './http.mjs';
import { routes } from './routes/billing.mjs';

export const createServer = () => createApp(routes);
if (process.argv[1]?.endsWith('server.mjs')) createServer().listen(Number(process.env.PORT ?? 3000));
`,
    'test/auth.test.mjs': authTest,
  },
};

const files = fixtures[id];
if (!files) throw new Error(`unknown fixture: ${id}`);
for (const [relative, content] of Object.entries(files)) {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
console.log(`wrote ${Object.keys(files).length} files for ${id}`);
