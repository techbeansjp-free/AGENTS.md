// Deterministic, non-confidential synthetic fixture for #1774 (multi-tenant notes API).
// Usage: node make-fixture.mjs <empty-dir>. Writes files only; does not execute them.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node make-fixture.mjs <empty-dir>');
if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error('target directory must be empty');

const files = {
  'README.md': `# notes-api

Multi-tenant notes service (synthetic sample).

- Every member belongs to exactly one tenant and may only read or change data of that tenant.
- Operators (\`role: "admin"\`, no tenant) manage tenants through \`/admin\`.
- Avatars are public profile images shared by all tenants.
- Support impersonation is a support-team feature for local debugging.
- The agent endpoint executes tools requested by the assistant on behalf of the signed-in member.
- Payment webhooks come from the payment provider and credit account balances.
`,
  'package.json': `{
  "name": "notes-api",
  "private": true,
  "type": "module",
  "scripts": { "start": "node src/server.mjs", "test": "node --test test/" }
}
`,
  'docker-compose.dev.yml': `services:
  app:
    image: node:22-alpine
    command: node src/server.mjs
    working_dir: /app
    volumes: ["./:/app"]
    environment:
      SUPPORT_IMPERSONATION: "on"
    ports: ["8080:8080"]
`,
  '.github/workflows/pr.yml': `name: pr-checks
on:
  pull_request_target:
    types: [opened, synchronize]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm test
        env:
          PREVIEW_DEPLOY_TOKEN: \${{ secrets.PREVIEW_DEPLOY_TOKEN }}
`,
  'src/server.mjs': `import http from 'node:http';
import { Router } from './router.mjs';
import { authenticate, requireAdmin } from './auth.mjs';
import { notesRoutes } from './routes/notes.mjs';
import { adminRoutes } from './routes/admin.mjs';
import { exportRoutes } from './routes/export.mjs';
import { avatarRoutes } from './routes/avatars.mjs';
import { searchRoutes } from './routes/search.mjs';
import { webhookRoutes } from './webhooks.mjs';
import { agentRoutes } from './agent/routes.mjs';

const router = new Router();
router.mount('/webhooks', webhookRoutes());
router.mount('/notes', authenticate, notesRoutes());
router.mount('/export', authenticate, exportRoutes());
router.mount('/avatars', authenticate, avatarRoutes());
router.mount('/search', authenticate, searchRoutes());
router.mount('/agent', authenticate, agentRoutes());
router.mount('/admin', authenticate, requireAdmin, adminRoutes());

export function createServer() {
  return http.createServer((req, res) => router.handle(req, res));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createServer().listen(Number(process.env.PORT ?? 8080));
}
`,
  'src/router.mjs': `export class Router {
  constructor() {
    this.mounts = [];
  }

  mount(prefix, ...chain) {
    this.mounts.push({ prefix, chain });
  }

  async handle(req, res) {
    res.send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      req.query = Object.fromEntries(url.searchParams);
      req.body = await readJson(req);
      for (const { prefix, chain } of this.mounts) {
        if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) continue;
        req.path = url.pathname.slice(prefix.length) || '/';
        let index = 0;
        const next = async () => {
          const step = chain[index++];
          if (step) await step(req, res, next);
        };
        await next();
        return;
      }
      res.send(404, { error: 'not found' });
    } catch (error) {
      res.send(error.status ?? 500, { error: error.expose ? error.message : 'internal error' });
    }
  }
}

export function routes(table) {
  return async (req, res) => {
    for (const [method, pattern, handler] of table) {
      if (req.method !== method) continue;
      const params = match(pattern, req.path);
      if (params) {
        req.params = params;
        return handler(req, res);
      }
    }
    return res.send(404, { error: 'not found' });
  };
}

function match(pattern, actual) {
  const expected = pattern.split('/');
  const segments = actual.split('/');
  if (expected.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < expected.length; i++) {
    if (expected[i].startsWith(':')) params[expected[i].slice(1)] = decodeURIComponent(segments[i]);
    else if (expected[i] !== segments[i]) return null;
  }
  return params;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('payload too large'), { status: 413, expose: true });
    chunks.push(chunk);
  }
  req.rawBody = Buffer.concat(chunks).toString('utf8');
  if (req.rawBody.length === 0) return {};
  try {
    return JSON.parse(req.rawBody);
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400, expose: true });
  }
}
`,
  'src/db.mjs': `export const users = new Map([
  ['u1', { id: 'u1', tenantId: 't1', role: 'member' }],
  ['u2', { id: 'u2', tenantId: 't2', role: 'member' }],
  ['ops1', { id: 'ops1', tenantId: null, role: 'admin' }],
]);

export const tenants = new Map([
  ['t1', { id: 't1', name: 'Tenant One' }],
  ['t2', { id: 't2', name: 'Tenant Two' }],
]);

export const notes = new Map([
  ['n1', { id: 'n1', tenantId: 't1', ownerId: 'u1', title: 'plan', body: 'tenant one note' }],
  ['n2', { id: 'n2', tenantId: 't2', ownerId: 'u2', title: 'budget', body: 'tenant two note' }],
]);

export const balances = new Map([['acct-t1', 0], ['acct-t2', 0]]);

// Stand-in for a driver that binds $1..$n placeholders separately from the SQL text.
export function run(query) {
  if (typeof query.text !== 'string' || !Array.isArray(query.params)) throw new Error('bad query');
  return [];
}
`,
  'src/auth.mjs': `import crypto from 'node:crypto';
import { users } from './db.mjs';

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
  if (process.env.SUPPORT_IMPERSONATION === 'on' && req.headers['x-impersonate-user']) {
    req.user = users.get(String(req.headers['x-impersonate-user'])) ?? null;
  } else {
    const header = String(req.headers.authorization ?? '');
    const claims = header.startsWith('Bearer ') ? verify(header.slice(7)) : null;
    req.user = claims ? users.get(claims.sub) ?? null : null;
  }
  if (!req.user) return res.send(401, { error: 'unauthenticated' });
  return next();
}

export async function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.send(403, { error: 'forbidden' });
  return next();
}
`,
  'src/routes/notes.mjs': `import { routes } from '../router.mjs';
import { notes } from '../db.mjs';

export function notesRoutes() {
  return routes([
    ['GET', '/', (req, res) => res.send(200, [...notes.values()].filter((note) => note.tenantId === req.user.tenantId))],
    ['GET', '/:id', (req, res) => {
      const note = notes.get(req.params.id);
      if (!note) return res.send(404, { error: 'not found' });
      return res.send(200, note);
    }],
    ['PUT', '/:id', (req, res) => {
      const note = notes.get(req.params.id);
      if (!note || note.tenantId !== req.user.tenantId) return res.send(404, { error: 'not found' });
      note.body = String(req.body.body ?? '');
      return res.send(200, note);
    }],
  ]);
}
`,
  'src/routes/admin.mjs': `import { routes } from '../router.mjs';
import { notes, tenants } from '../db.mjs';

export function adminRoutes() {
  return routes([
    ['GET', '/tenants', (req, res) => res.send(200, [...tenants.values()])],
    ['DELETE', '/tenants/:id', (req, res) => {
      if (!tenants.delete(req.params.id)) return res.send(404, { error: 'not found' });
      for (const [id, note] of notes) if (note.tenantId === req.params.id) notes.delete(id);
      return res.send(204, {});
    }],
  ]);
}
`,
  'src/routes/export.mjs': `import fs from 'node:fs/promises';
import path from 'node:path';
import { routes } from '../router.mjs';

const EXPORT_ROOT = path.resolve(process.env.EXPORT_ROOT ?? './var/exports');

export function exportRoutes() {
  return routes([
    ['GET', '/', async (req, res) => {
      const name = String(req.query.name ?? '');
      if (!name.endsWith('.csv')) return res.send(400, { error: 'csv only' });
      const file = path.join(EXPORT_ROOT, String(req.user.tenantId), name);
      const data = await fs.readFile(file, 'utf8').catch(() => null);
      if (data === null) return res.send(404, { error: 'not found' });
      return res.send(200, { name, data });
    }],
  ]);
}
`,
  'src/routes/avatars.mjs': `import fs from 'node:fs/promises';
import path from 'node:path';
import { routes } from '../router.mjs';

const AVATAR_ROOT = path.resolve(process.env.AVATAR_ROOT ?? './var/avatars');

export function avatarRoutes() {
  return routes([
    ['GET', '/:name', async (req, res) => {
      const file = path.resolve(AVATAR_ROOT, req.params.name);
      if (!file.startsWith(AVATAR_ROOT + path.sep)) return res.send(400, { error: 'bad name' });
      const data = await fs.readFile(file).catch(() => null);
      if (data === null) return res.send(404, { error: 'not found' });
      return res.send(200, { name: path.basename(file), base64: data.toString('base64') });
    }],
  ]);
}
`,
  'src/routes/search.mjs': `import { routes } from '../router.mjs';
import { run } from '../db.mjs';

const SORTABLE = new Set(['created_at', 'updated_at', 'title']);

export function searchRoutes() {
  return routes([
    ['GET', '/', (req, res) => {
      const column = SORTABLE.has(req.query.sort) ? req.query.sort : 'created_at';
      const direction = req.query.dir === 'asc' ? 'ASC' : 'DESC';
      const query = {
        text: \`SELECT id, title FROM notes WHERE tenant_id = $1 AND title ILIKE $2 ORDER BY \${column} \${direction} LIMIT 50\`,
        params: [req.user.tenantId, \`%\${String(req.query.q ?? '')}%\`],
      };
      return res.send(200, { results: run(query) });
    }],
  ]);
}
`,
  'src/webhooks.mjs': `import crypto from 'node:crypto';
import { routes } from './router.mjs';
import { balances } from './db.mjs';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? '';

export function webhookRoutes() {
  return routes([
    ['POST', '/payments', (req, res) => {
      const timestamp = String(req.headers['x-signature-timestamp'] ?? '');
      const given = Buffer.from(String(req.headers['x-signature'] ?? ''));
      const expected = Buffer.from(crypto.createHmac('sha256', WEBHOOK_SECRET).update(\`\${timestamp}.\${req.rawBody}\`).digest('hex'));
      if (!WEBHOOK_SECRET || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        return res.send(401, { error: 'bad signature' });
      }
      const event = req.body;
      if (event.type === 'payment.succeeded' && balances.has(event.account)) {
        balances.set(event.account, balances.get(event.account) + Number(event.amount));
      }
      return res.send(200, { ok: true });
    }],
  ]);
}
`,
  'src/agent/tools.mjs': `import { notes } from '../db.mjs';

const DOCS_PREFIX = 'https://docs.example.com';

export const tools = {
  async fetch_doc({ url }) {
    if (!String(url).startsWith(DOCS_PREFIX)) {
      throw Object.assign(new Error('url not allowed'), { status: 400, expose: true });
    }
    const response = await fetch(String(url), { redirect: 'error' });
    return (await response.text()).slice(0, 20000);
  },
  async list_notes(_args, user) {
    return [...notes.values()].filter((note) => note.tenantId === user.tenantId).map((note) => note.id);
  },
};
`,
  'src/agent/routes.mjs': `import { routes } from '../router.mjs';
import { tools } from './tools.mjs';

export function agentRoutes() {
  return routes([
    ['POST', '/tool-call', async (req, res) => {
      const name = String(req.body.name ?? '');
      if (!Object.hasOwn(tools, name)) return res.send(400, { error: 'unknown tool' });
      return res.send(200, { result: await tools[name](req.body.args ?? {}, req.user) });
    }],
  ]);
}
`,
  'test/auth.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../src/auth.mjs';

test('signed token verifies', () => {
  assert.equal(verify(sign('u1')).sub, 'u1');
});

test('tampered token is rejected', () => {
  const [body] = sign('u1').split('.');
  assert.equal(verify(\`\${body}.AAAA\`), null);
});
`,
};

for (const [relative, content] of Object.entries(files)) {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
console.log(`wrote ${Object.keys(files).length} files`);
