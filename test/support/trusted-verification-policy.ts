import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { VerificationPolicy } from "../../src/domain/verification-run.js";

/**
 * testが共有するtrusted検証command宣言（REQ-WF-040）。`verify run`・`review export`・
 * 証跡の消費側は、既定branch（`origin/HEAD`）のtrusted commitの
 * `.agent-skill-chain/project-policy.json`から`verification`節を読む。
 */
export const FIXTURE_VERIFICATION_POLICY: VerificationPolicy = Object.freeze({
  fullCommand: Object.freeze(["npm", "test"]),
  targetedRunner: Object.freeze(["npm", "run", "test:targeted", "--"]),
});

function run(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * fixture repositoryへ最小の完全なproject policy setを書く（commitしない）。
 *
 * - `policy/default.json`が無ければpackage同梱の既定を置く
 * - manifestの`policy`は`policy/default.json`からrulesを除いた値にする。
 *   **既定policyと同じ値にし、merge条件などの観測値を動かさない**
 * - `verification`は`null`で節ごと省く（宣言なしのfixture）
 */
export function writeTrustedPolicySet(
  root: string,
  verification: VerificationPolicy | null = FIXTURE_VERIFICATION_POLICY,
): void {
  const namespace = path.join(root, ".agent-skill-chain");
  fs.mkdirSync(path.join(namespace, "policy"), { recursive: true });
  fs.mkdirSync(path.join(namespace, "project", "choices"), {
    recursive: true,
  });
  const floorFile = path.join(namespace, "policy", "default.json");
  if (!fs.existsSync(floorFile))
    fs.copyFileSync(
      path.resolve(".agent-skill-chain/policy/default.json"),
      floorFile,
    );
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/project/choices/development.json"),
    path.join(namespace, "project", "choices", "development.json"),
  );
  const floor = JSON.parse(fs.readFileSync(floorFile, "utf8")) as Record<
    string,
    unknown
  >;
  const { rules: _rules, ...policy } = floor;
  void _rules;
  fs.writeFileSync(
    path.join(namespace, "project-policy.json"),
    `${JSON.stringify(
      {
        schemaVersion: "agent-skill-chain/project-policy-manifest/v1",
        policy,
        choiceFiles: ["project/choices/development.json"],
        ruleFiles: [],
        conformanceFiles: [],
        conformanceScope: "package-attested",
        conformanceDirectory: "project/conformance",
        ...(verification === null ? {} : { verification }),
      },
      null,
      2,
    )}\n`,
  );
}

/** `writeTrustedPolicySet`が書くfile。staging等の他の`.agent-skill-chain`配下は含めない。 */
export const TRUSTED_POLICY_PATHS = [
  ".agent-skill-chain/policy/default.json",
  ".agent-skill-chain/project-policy.json",
  ".agent-skill-chain/project/choices/development.json",
] as const;

/** trusted policy setだけをstageしてcommitする。 */
export function commitTrustedPolicySet(root: string, message: string): string {
  run(root, ["add", "--", ...TRUSTED_POLICY_PATHS]);
  run(root, ["commit", "-q", "-m", message]);
  return run(root, ["rev-parse", "HEAD"]);
}

/** 現在HEADを既定branchのtrusted commit（`origin/main`・`origin/HEAD`）にする。 */
export function markTrustedDefaultBranch(root: string): string {
  const head = run(root, ["rev-parse", "HEAD"]);
  run(root, ["update-ref", "refs/remotes/origin/main", head]);
  run(root, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);
  return head;
}

/**
 * trusted policy setをcommitし、そのcommitを既定branchのtrusted commitにする。
 * 返り値はtrusted commit SHAである。
 */
export function installTrustedVerificationPolicy(
  root: string,
  verification: VerificationPolicy | null = FIXTURE_VERIFICATION_POLICY,
): string {
  writeTrustedPolicySet(root, verification);
  commitTrustedPolicySet(root, "trusted policy");
  return markTrustedDefaultBranch(root);
}
