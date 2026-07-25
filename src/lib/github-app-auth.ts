import crypto from 'node:crypto';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const JWT_LIFETIME_SECONDS = 9 * 60;

export interface GithubAppCredentials {
  appId: string;
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
  appId: number;
  installationId: number;
}

export interface GithubAppAuthOptions extends GithubAppCredentials {
  repository: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${label} は正の整数である必要があります`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} が安全な整数範囲を超えています`);
  return parsed;
}

function validateRepository(value: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`repository は owner/repo 形式である必要があります: ${value}`);
  }
}

export function createGithubAppJwt(credentials: GithubAppCredentials, now: Date = new Date()): string {
  const appId = parsePositiveInteger(credentials.appId, 'GitHub App ID');
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + JWT_LIFETIME_SECONDS,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = crypto.createPrivateKey(credentials.privateKey);
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url');
  return `${signingInput}.${signature}`;
}

async function githubJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit & { token: string },
): Promise<T> {
  const { token, ...requestInit } = init;
  const response = await fetchImpl(`${GITHUB_API}${path}`, {
    ...requestInit,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...requestInit.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 512);
    throw new Error(`GitHub App API ${path} が HTTP ${response.status} で失敗しました: ${body}`);
  }
  return (await response.json()) as T;
}

/**
 * App秘密鍵は引数とメモリ内だけで扱い、子process・stdout・一時fileへ渡さない。
 * installation tokenはChecks APIだけへdownscopeし、candidate codeには返さない。
 */
export async function createInstallationToken(options: GithubAppAuthOptions): Promise<InstallationToken> {
  validateRepository(options.repository);
  const appId = parsePositiveInteger(options.appId, 'GitHub App ID');
  const fetchImpl = options.fetchImpl ?? fetch;
  const jwt = createGithubAppJwt(options, options.now);
  const installation = await githubJson<{ id?: number }>(
    fetchImpl,
    `/repos/${options.repository}/installation`,
    { method: 'GET', token: jwt },
  );
  if (!Number.isSafeInteger(installation.id) || Number(installation.id) <= 0) {
    throw new Error('GitHub App installation IDを取得できませんでした');
  }
  const installationId = Number(installation.id);
  const issued = await githubJson<{ token?: string; expires_at?: string }>(
    fetchImpl,
    `/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      token: jwt,
      body: JSON.stringify({
        repositories: [options.repository.split('/')[1]],
        permissions: { checks: 'write' },
      }),
      headers: { 'Content-Type': 'application/json' },
    },
  );
  if (!issued.token || !issued.expires_at || Number.isNaN(Date.parse(issued.expires_at))) {
    throw new Error('GitHub App installation token応答が不正です');
  }
  return { token: issued.token, expiresAt: issued.expires_at, appId, installationId };
}
