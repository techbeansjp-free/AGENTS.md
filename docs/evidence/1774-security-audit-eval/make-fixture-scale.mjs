// Deterministic, non-confidential synthetic fixture for #1774 (scale case: 36 similar resource modules).
// Usage: node make-fixture-scale.mjs <empty-dir>. Writes files only; does not execute them.
import fs from 'node:fs';
import path from 'node:path';

// --seed (Phase 1c) adds src/seed.mjs so every store starts with one record per tenant; resource modules are unchanged.
const dir = process.argv[2];
const seeded = process.argv[3] === '--seed';
if (!dir) throw new Error('usage: node make-fixture-scale.mjs <empty-dir> [--seed]');
if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error('target directory must be empty');

const names = ['accounts', 'addresses', 'alerts', 'approvals', 'assets', 'attachments', 'audit', 'budgets', 'calendars',
  'campaigns', 'catalog', 'comments', 'contacts', 'contracts', 'deals', 'devices', 'documents', 'expenses', 'forms', 'goals',
  'invoices', 'issues', 'leads', 'legacy-exports', 'locations', 'meetings', 'milestones', 'orders', 'payments', 'projects',
  'quotes', 'reports', 'shipments', 'tags', 'tasks', 'timesheets'];
const notMounted = new Set(['legacy-exports']);
const fields = ['label', 'title', 'summary', 'status', 'note', 'owner_note'];
const ident = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const header = (name) => `import { routes } from '../router.mjs';
import { storeFor } from '../store.mjs';
import { loadScoped } from '../scoped.mjs';

const store = storeFor('${name}');
`;
const listRoute = `    ['GET', '/', (req, res) => res.send(200, [...store.values()].filter((item) => item.tenantId === req.user.tenantId))],\n`;
const getRoute = `    ['GET', '/:id', (req, res) => res.send(200, loadScoped(store, req.params.id, req.user))],\n`;
const putRoute = (field) => `    ['PUT', '/:id', (req, res) => {
      const item = loadScoped(store, req.params.id, req.user);
      item.${field} = String(req.body.${field} ?? item.${field});
      return res.send(200, item);
    }],\n`;
const postRoute = (field) => `    ['POST', '/', (req, res) => {
      const item = { id: newId(), tenantId: req.user.tenantId, ownerId: req.user.id, ${field}: String(req.body.${field} ?? '') };
      store.set(item.id, item);
      return res.send(201, item);
    }],\n`;
const deleteRoute = `    ['DELETE', '/:id', (req, res) => {
      loadScoped(store, req.params.id, req.user);
      store.delete(req.params.id);
      return res.send(204, {});
    }],\n`;

function moduleSource(name, index) {
  const field = fields[index % fields.length];
  const withPost = index % 3 !== 0;
  let table;
  const extraImport = "import { newId } from '../ids.mjs';\n";
  if (name === 'invoices') {
    table = listRoute + `    ['GET', '/:id', (req, res) => {
      const item = store.get(req.params.id);
      if (!item || item.tenantId !== (req.query.tenant ?? req.user.tenantId)) return res.send(404, { error: 'not found' });
      return res.send(200, item);
    }],\n` + putRoute(field) + deleteRoute;
  } else if (name === 'attachments') {
    table = listRoute + getRoute + putRoute(field) + `    ['DELETE', '/:id', (req, res) => {
      store.delete(req.params.id);
      return res.send(204, {});
    }],\n`;
  } else if (name === 'reports') {
    table = listRoute + getRoute + `    ['PUT', '/:id', (req, res) => {
      const item = store.get(req.params.id);
      if (!item) return res.send(404, { error: 'not found' });
      if (item.ownerId !== req.user.id && req.user.role !== 'manager') return res.send(403, { error: 'forbidden' });
      item.${field} = String(req.body.${field} ?? item.${field});
      return res.send(200, item);
    }],\n` + deleteRoute;
  } else if (name === 'audit') {
    table = `    ['GET', '/', (req, res) => res.send(200, [...store.values()].filter((entry) => entry.tenantId === req.user.tenantId))],
    ['GET', '/:id', (req, res) => {
      const entry = store.get(req.params.id);
      if (!entry || entry.tenantId !== req.user.tenantId) return res.send(404, { error: 'not found' });
      return res.send(200, entry);
    }],\n`;
  } else if (name === 'catalog') {
    table = `    ['GET', '/', (req, res) => res.send(200, [...store.values()])],
    ['GET', '/:id', (req, res) => {
      const entry = store.get(req.params.id);
      return entry ? res.send(200, entry) : res.send(404, { error: 'not found' });
    }],\n`;
  } else if (name === 'legacy-exports') {
    table = `    ['GET', '/:id', (req, res) => {
      const item = store.get(req.params.id);
      return item ? res.send(200, item) : res.send(404, { error: 'not found' });
    }],\n`;
  } else {
    table = listRoute + getRoute + (withPost ? postRoute(field) : '') + putRoute(field) + deleteRoute;
  }
  return `${header(name)}${table.includes('newId(') ? extraImport : ''}
export default function ${ident(name)}Routes() {
  return routes([
${table}  ]);
}
`;
}

const files = {
  'README.md': `# workspace-api

Multi-tenant workspace service (synthetic sample).

- Every user belongs to exactly one tenant. Users may only read or change records of their own tenant.
- Any user may edit records of their own tenant, except reports: a report may be edited only by its owner or by a \`manager\` of the same tenant.
- \`/catalog\` is a global, read-only product catalog shared by all tenants.
- Every other resource under \`src/resources\` is tenant-scoped.
`,
  'package.json': `{
  "name": "workspace-api",
  "private": true,
  "type": "module",
  "scripts": { "start": "node src/server.mjs", "test": "node --test test/" }
}
`,
  'src/store.mjs': seeded
    ? `import { seedRecords } from './seed.mjs';

const stores = new Map();

export function storeFor(name) {
  if (!stores.has(name)) stores.set(name, new Map(seedRecords(name).map((record) => [record.id, record])));
  return stores.get(name);
}
`
    : `const stores = new Map();

export function storeFor(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
}
`,
  'src/ids.mjs': `import crypto from 'node:crypto';

export function newId() {
  return crypto.randomUUID();
}
`,
  'src/scoped.mjs': `export function loadScoped(store, id, user) {
  const item = store.get(id);
  if (!item || item.tenantId !== user.tenantId) {
    throw Object.assign(new Error('not found'), { status: 404, expose: true });
  }
  return item;
}
`,
  'src/users.mjs': `export const users = new Map([
  ['u1', { id: 'u1', tenantId: 't1', role: 'member' }],
  ['m1', { id: 'm1', tenantId: 't1', role: 'manager' }],
  ['u2', { id: 'u2', tenantId: 't2', role: 'member' }],
  ['m2', { id: 'm2', tenantId: 't2', role: 'manager' }],
]);
`,
  'src/auth.mjs': `import crypto from 'node:crypto';
import { users } from './users.mjs';

const SECRET = process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');

function mac(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}

export function sign(sub, ttlSeconds = 3600) {
  const body = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return \`\${body}.\${mac(body)}\`;
}

export function verify(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null;
  return claims;
}

export async function authenticate(req, res, next) {
  const header = String(req.headers.authorization ?? '');
  const claims = header.startsWith('Bearer ') ? verify(header.slice(7)) : null;
  req.user = claims ? users.get(claims.sub) ?? null : null;
  if (!req.user) return res.send(401, { error: 'unauthenticated' });
  return next();
}
`,
};

// Reuse the same router source as the small fixture to keep framework behavior identical.
{
  const small = fs.readFileSync(new URL('./make-fixture.mjs', import.meta.url), 'utf8');
  const start = small.indexOf("'src/router.mjs': `") + "'src/router.mjs': `".length;
  const end = small.indexOf("`,\n  'src/db.mjs'");
  files['src/router.mjs'] = small.slice(start, end);
}

const mounted = names.filter((name) => !notMounted.has(name));
files['src/registry.mjs'] = mounted.map((name) => `import ${ident(name)}Routes from './resources/${name}.mjs';`).join('\n')
  + `\n\nexport const resources = [\n${mounted.map((name) => `  ['/${name}', ${ident(name)}Routes],`).join('\n')}\n];\n`;
files['src/server.mjs'] = `import http from 'node:http';
import { Router } from './router.mjs';
import { authenticate } from './auth.mjs';
import { resources } from './registry.mjs';

const router = new Router();
for (const [prefix, factory] of resources) router.mount(prefix, authenticate, factory());

export function createServer() {
  return http.createServer((req, res) => router.handle(req, res));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createServer().listen(Number(process.env.PORT ?? 8080));
}
`;
names.forEach((name, index) => { files[`src/resources/${name}.mjs`] = moduleSource(name, index); });
if (seeded) {
  files['src/seed.mjs'] = `// Demo data loaded at startup: one record per tenant in every store.
export function seedRecords(name) {
  return [
    { id: \`\${name}-t1\`, tenantId: 't1', ownerId: 'u1', label: 'one', title: 'one', summary: 'one', status: 'open', note: 'one', owner_note: 'one' },
    { id: \`\${name}-t2\`, tenantId: 't2', ownerId: 'u2', label: 'two', title: 'two', summary: 'two', status: 'open', note: 'two', owner_note: 'two' },
  ];
}
`;
}
files['test/scoped.test.mjs'] = `import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScoped } from '../src/scoped.mjs';

test('loadScoped hides other tenants', () => {
  const store = new Map([['a', { id: 'a', tenantId: 't1' }]]);
  assert.equal(loadScoped(store, 'a', { tenantId: 't1' }).id, 'a');
  assert.throws(() => loadScoped(store, 'a', { tenantId: 't2' }));
});
`;

for (const [relative, content] of Object.entries(files)) {
  if (typeof content !== 'string') throw new Error(`missing content for ${relative}`);
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
console.log(`wrote ${Object.keys(files).length} files`);
