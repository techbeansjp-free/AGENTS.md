import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readOwnerOnlyFile,
  readPrivateCorpusAuthorization,
  readTrustedPrivateAuthorizationPins,
} from "../src/adapters/laya-private-authorization.js";
import {
  assertAuthorizedPrivateRepository,
  assertExternalPrivateFile,
  createStructuralCasesFromJsonl,
  writePrivateCorpusNoReplace,
} from "../src/adapters/laya-private-corpus-v2.js";
import {
  assessPrivateStructuralLeakage,
  validatePrivateStructuralCorpus,
} from "../src/domain/laya-private-corpus-v2.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { stableJson } from "../src/lib/security.js";

function required(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) throw new Error(`${prefix}<value>が必要です`);
  return value;
}

async function runLayaPrivateSanitizeInternal(): Promise<void> {
  const repositoryRoot = path.resolve(required("repository-root"));
  const ascRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const authorizationPath = path.resolve(required("authorization"));
  const pins = await readTrustedPrivateAuthorizationPins();
  const authorization = readPrivateCorpusAuthorization(authorizationPath, pins);
  assertAuthorizedPrivateRepository(repositoryRoot, authorization.remote);
  const storePrefix = path.resolve(required("store-root"));
  const input = assertExternalPrivateFile(
    repositoryRoot,
    path.resolve(required("input")),
    64 * 1024 * 1024,
  );
  assertExternalPrivateFile(ascRoot, input, 64 * 1024 * 1024);
  const inputBytes = readOwnerOnlyFile(input, 64 * 1024 * 1024);
  const inputSha256 = crypto
    .createHash("sha256")
    .update(inputBytes)
    .digest("hex");
  if (inputSha256 !== authorization.inputSha256)
    throw new Error("private corpus input digestがowner承認値と一致しません");
  assertExternalPrivateFile(repositoryRoot, authorizationPath, 65_536);
  assertExternalPrivateFile(ascRoot, authorizationPath, 65_536);
  const keyPath = assertExternalPrivateFile(
    repositoryRoot,
    path.resolve(required("pseudonym-key-file")),
    32,
  );
  assertExternalPrivateFile(ascRoot, keyPath, 32);
  const pseudonymKey = readOwnerOnlyFile(keyPath, 32);
  if (pseudonymKey.length !== 32 || new Set(pseudonymKey).size < 20)
    throw new Error("pseudonym keyが不正です");
  const keyId = crypto.createHash("sha256").update(pseudonymKey).digest("hex");
  if (keyId !== authorization.keyId)
    throw new Error("pseudonym key IDがowner承認値と一致しません");
  const corpusSalt = crypto.randomBytes(32).toString("hex");
  const outputName = "corpus.json";
  const cases = createStructuralCasesFromJsonl(
    repositoryRoot,
    authorization.revision,
    input,
    {
      authorizedRepository: authorization.repository,
      pseudonymKey,
      corpusSalt,
      forbiddenLiterals: authorization.forbiddenLiterals,
    },
    authorization.remote,
    authorization.inputSha256,
  );
  const report = assessPrivateStructuralLeakage(
    cases,
    authorization.forbiddenLiterals,
  );
  if (!report.eligible)
    throw new Error("private corpus leakage gateが不合格です");
  const corpus = validatePrivateStructuralCorpus(
    {
      schemaVersion: "asc/laya-private-structural-corpus/v1",
      cases,
      report,
    },
    authorization.forbiddenLiterals,
  );
  const payload = `${stableJson(corpus)}\n`;
  const outputId = writePrivateCorpusNoReplace(
    storePrefix,
    outputName,
    payload,
  );
  process.stdout.write(
    `${stableJson({ outputId, output: outputName, report })}\n`,
  );
}

export async function runLayaPrivateSanitize(): Promise<void> {
  try {
    await runLayaPrivateSanitizeInternal();
  } catch {
    throw new Error("private corpus sanitization failed");
  }
}

if (isExecutionEntry(import.meta.url)) {
  void runLayaPrivateSanitize().catch(() => {
    process.stderr.write("private corpus sanitization failed\n");
    process.exitCode = 1;
  });
}
