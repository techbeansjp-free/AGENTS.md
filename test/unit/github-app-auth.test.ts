import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createGithubAppJwt, createInstallationToken } from '../../src/lib/github-app-auth.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

test('GitHub App JWTはRS256署名・固定iat/exp・App IDを持つ', () => {
  const jwt = createGithubAppJwt(
    { appId: '12345', privateKey: PRIVATE_KEY },
    new Date('2026-07-25T21:00:00Z'),
  );
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
    iat: 1785013140,
    exp: 1785013740,
    iss: 12345,
  });
  assert.equal(
    crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
    true,
  );
});

test('installation tokenはrepository IDと専用App権限だけへdownscopeし秘密を露出しない', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/installation')) {
      return new Response(JSON.stringify({ id: 777 }), { status: 200 });
    }
    return new Response(JSON.stringify({ token: 'installation-token', expires_at: '2026-07-25T22:00:00Z' }), {
      status: 201,
    });
  };
  const result = await createInstallationToken({
    appId: '12345',
    privateKey: PRIVATE_KEY,
    repository: 'techbeansjp-free/AGENTS.md',
    repositoryId: 888,
    now: new Date('2026-07-25T21:00:00Z'),
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert.deepEqual(result, {
    token: 'installation-token',
    expiresAt: '2026-07-25T22:00:00Z',
    appId: 12345,
    installationId: 777,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    repository_ids: [888],
    permissions: { checks: 'write', metadata: 'read' },
  });
  assert.ok(!JSON.stringify(calls).includes(PRIVATE_KEY));
  assert.ok(!JSON.stringify(calls).includes('installation-token'));
});

test('不正なApp IDとrepositoryをAPI呼出し前に拒否する', async () => {
  assert.throws(() => createGithubAppJwt({ appId: '0', privateKey: PRIVATE_KEY }), /正の整数/);
  let called = false;
  await assert.rejects(
    createInstallationToken({
      appId: '12345',
      privateKey: PRIVATE_KEY,
      repository: 'not-a-repository',
      fetchImpl: (async () => {
        called = true;
        return new Response();
      }) as typeof fetch,
    }),
    /owner\/repo/,
  );
  assert.equal(called, false);
});
