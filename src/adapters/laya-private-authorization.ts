import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict } from "../lib/security.js";

export interface PrivateCorpusAuthorization {
  schemaVersion: "asc/laya-private-authorization/v1";
  repository: string;
  remote: string;
  revision: string;
  inputSha256: string;
  keyId: string;
  sanitizerVersion: "asc/laya-private-structural/v1";
  structuralSchemaVersion: "asc/laya-private-structural-case/v1";
  forbiddenLiterals: string[];
}

export interface PrivateAuthorizationPins {
  schemaVersion: "asc/laya-private-authorization-pins/v1";
  sha256: string[];
}

const CANONICAL_MAIN_API =
  "https://api.github.com/repos/techbeansjp-free/AGENTS.md/git/ref/heads/main";
const CANONICAL_PIN_RAW_PREFIX =
  "https://raw.githubusercontent.com/techbeansjp-free/AGENTS.md/";
const CANONICAL_PIN_PATH =
  ".agent-skill-chain/policy/laya-private-training-authorization-pins.json";
function githubRequest(): RequestInit {
  return {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "agent-skill-chain",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  };
}

export function readOwnerOnlyFile(file: string, maximumBytes: number): Buffer {
  const resolved = path.resolve(file);
  const direct = fs.lstatSync(resolved);
  if (direct.isSymbolicLink() || fs.realpathSync(resolved) !== resolved)
    throw new Error(
      "private fileのsymbolic linkまたはsymlink祖先を拒否しました",
    );
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.size > maximumBytes ||
      (before.mode & 0o077) !== 0
    )
      throw new Error(
        "private fileはownerだけが読める上限以下の通常fileが必要です",
      );
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0)
        throw new Error("private fileの読取中に内容が変化しました");
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw new Error("private fileの読取中に内容が変化しました");
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readPrivateAuthorizationPins(
  file: string,
): PrivateAuthorizationPins {
  return parsePrivateAuthorizationPins(
    readOwnerOnlyFile(file, 65_536).toString("utf8"),
  );
}

function parsePrivateAuthorizationPins(
  source: string,
): PrivateAuthorizationPins {
  const parsed = parseJsonStrict(source, "private authorization pins");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("private authorization pinsはobjectが必要です");
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["schemaVersion", "sha256"].includes(key),
    ) ||
    value.schemaVersion !== "asc/laya-private-authorization-pins/v1" ||
    !Array.isArray(value.sha256) ||
    value.sha256.some(
      (digest) => typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest),
    ) ||
    new Set(value.sha256).size !== value.sha256.length
  )
    throw new Error("private authorization pins contractが不正です");
  return value as unknown as PrivateAuthorizationPins;
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.ok) throw new Error("ASC公式GitHubの読取に失敗しました");
  const source = await response.text();
  if (Buffer.byteLength(source) > maximumBytes)
    throw new Error("ASC公式GitHubの応答が上限を超えました");
  return source;
}

export async function readTrustedPrivateAuthorizationPins(): Promise<PrivateAuthorizationPins> {
  const commitSource = await readBoundedResponse(
    await fetch(CANONICAL_MAIN_API, githubRequest()),
    65_536,
  );
  const commit = parseJsonStrict(commitSource, "ASC canonical main commit");
  if (!commit || typeof commit !== "object" || Array.isArray(commit))
    throw new Error("ASC trusted main SHAを認証できません");
  const object = (commit as Record<string, unknown>).object;
  const trustedSha =
    object && typeof object === "object" && !Array.isArray(object)
      ? (object as Record<string, unknown>).sha
      : undefined;
  if (typeof trustedSha !== "string" || !/^[0-9a-f]{40}$/u.test(trustedSha))
    throw new Error("ASC trusted main SHAを認証できません");
  const pinUrl = `${CANONICAL_PIN_RAW_PREFIX}${trustedSha}/${CANONICAL_PIN_PATH}`;
  const source = await readBoundedResponse(
    await fetch(pinUrl, githubRequest()),
    65_536,
  );
  return parsePrivateAuthorizationPins(source);
}

export function readPrivateCorpusAuthorization(
  file: string,
  pins: PrivateAuthorizationPins,
): PrivateCorpusAuthorization {
  const bytes = readOwnerOnlyFile(file, 65_536);
  const observed = crypto.createHash("sha256").update(bytes).digest("hex");
  if (!pins.sha256.includes(observed))
    throw new Error("private authorizationがowner承認済みdigestと一致しません");
  const parsed = parseJsonStrict(
    bytes.toString("utf8"),
    "private authorization",
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("private authorizationはobjectが必要です");
  const value = parsed as Record<string, unknown>;
  const allowed = [
    "schemaVersion",
    "repository",
    "remote",
    "revision",
    "inputSha256",
    "keyId",
    "sanitizerVersion",
    "structuralSchemaVersion",
    "forbiddenLiterals",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("private authorizationに未知fieldがあります");
  if (
    value.schemaVersion !== "asc/laya-private-authorization/v1" ||
    typeof value.repository !== "string" ||
    typeof value.remote !== "string" ||
    typeof value.revision !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.revision) ||
    typeof value.inputSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.inputSha256) ||
    typeof value.keyId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.keyId) ||
    value.sanitizerVersion !== "asc/laya-private-structural/v1" ||
    value.structuralSchemaVersion !== "asc/laya-private-structural-case/v1" ||
    !Array.isArray(value.forbiddenLiterals) ||
    value.forbiddenLiterals.length === 0 ||
    value.forbiddenLiterals.some(
      (item) => typeof item !== "string" || item.length < 4,
    )
  )
    throw new Error("private authorization contractが不正です");
  return value as unknown as PrivateCorpusAuthorization;
}
