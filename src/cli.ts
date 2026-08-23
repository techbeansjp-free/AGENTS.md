import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createIssueStaging, validateIssue } from "./domain/issue.js";
import {
  bootstrapProject,
  validateSpecs,
  type ProjectKind,
} from "./domain/spec.js";
import { buildReviewEvidence, evaluateReview } from "./domain/review.js";
import { createPullRequest, authorizeMerge } from "./domain/delivery.js";
import { createWorktree, inspectFinalizeState } from "./domain/worktree.js";
import { buildFinalizeReport, applyFinalize } from "./domain/finalize.js";
import { init, upgrade, uninstall, doctor } from "./domain/lifecycle.js";
import {
  loadConsumerPolicyAtCommit,
  loadEffectiveTrustedPolicySet,
  loadOperationPolicy,
  loadProjectPolicySet,
  loadProjectPolicySetAtCommit,
  validatePolicy,
} from "./domain/policy.js";
import {
  applyMigration,
  compareTrustedPolicy,
  enforceOperation,
  planMigration,
  resolveEffectivePolicy,
  retryMigration,
  rollbackMigration,
  sanitizeOutput,
  serializeDiagnostic,
  type ConceptualMigrationState,
} from "./domain/enforcement.js";
import {
  applyFileMigration,
  planFileMigration,
  recoverFileMigration,
  retryFileMigration,
  rollbackFileMigration,
  type MigrationState,
} from "./domain/migration.js";
import { validateScenarioTrace } from "./domain/trace.js";
import {
  github,
  GitHubProviderUnavailableError,
  samePolicyAuthorityObservation,
} from "./adapters/github.js";
import { git } from "./lib/process.js";
import { writeFileAtomic } from "./lib/atomic.js";
import { validateRepositoryConformance } from "./domain/conformance.js";
import { parseJsonStrict, resolveContained } from "./lib/security.js";
import {
  canonicalLifecycleCommand,
  CLI_USAGE,
  PUBLIC_LIFECYCLE_COMMANDS,
} from "./cli-contract.js";
import { type Policy, isRecord } from "./types.js";
import { type PolicySet } from "./domain/policy.js";
import { type ModeAnswer } from "./domain/mode.js";

type Flags = Record<string, string | boolean>;

function parse(args: string[]): { flags: Flags; positionals: string[] } {
  const flags: Flags = {};
  const positionals: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) positionals.push(arg);
    else {
      const [rawKey, ...rest] = arg.slice(2).split("=");
      if (flags[rawKey] !== undefined)
        throw new Error(`オプションが重複しています: --${rawKey}`);
      flags[rawKey] = rest.length ? rest.join("=") : true;
    }
  }
  return { flags, positionals };
}

function required(flags: Flags, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || value === "")
    throw new Error(`--${key}=...が必要です`);
  return value;
}

function requiredExpectedRevision(flags: Flags): number {
  const raw = required(flags, "expected-revision");
  if (!/^\d+$/.test(raw))
    throw new Error("--expected-revisionは0以上の整数でなければなりません");
  return Number(raw);
}

function policyAuthorityFailure(
  status: "pending" | "rejected",
  reason: string,
) {
  return serializeDiagnostic({
    allowed: false,
    status,
    diagnostic: {
      ruleId:
        status === "pending"
          ? "ASC-POLICY-PROVIDER-001"
          : "ASC-POLICY-AUTHORITY-001",
      purpose: "PR policy authorityをtrusted provider観測へ拘束する",
      risk: "authority",
      reasons: [reason],
      scope: ["policy validate", "pull_request"],
      checks: ["repository、PR、default/base/head tupleを検証した"],
      autoFixes: [],
      next:
        status === "pending"
          ? "local安全結果を保持し、provider接続後に同じ固定commitで再実行してください"
          : "入力とtrusted provider観測の不一致を修正して再実行してください",
      requiredAuthority: "repository read",
      rollback: "policy適用や外部状態変更を行わない",
    },
  });
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(sanitizeOutput(value), null, 2)}\n`);
}
function readJson<T = unknown>(file: string): T {
  return parseJsonStrict(fs.readFileSync(file, "utf8"), file) as T;
}

/** Fragmented policy input is loaded as a complete inventory; legacy input remains a single policy object. */
function readPolicyInput(file: string): Policy | PolicySet {
  const value = readJson<Record<string, unknown>>(file);
  if (value.schemaVersion !== "agent-skill-chain/project-policy-manifest/v1")
    return value as unknown as Policy;
  if (
    path.basename(file) !== "project-policy.json" ||
    path.basename(path.dirname(file)) !== ".agent-skill-chain"
  )
    throw new Error(
      "fragmented project policy manifestは.agent-skill-chain/project-policy.jsonから読み込んでください",
    );
  return loadProjectPolicySet(path.dirname(path.dirname(file)));
}

function isPolicySet(input: Policy | PolicySet): input is PolicySet {
  return "policy" in input;
}
function assembledPolicy(input: Policy | PolicySet): Policy {
  return isPolicySet(input) ? input.policy : input;
}

function printableMigration(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.artifacts)) return value;
  const artifacts = value.artifacts as unknown[];
  return {
    ...value,
    artifacts: artifacts.map((artifact) => {
      if (!isRecord(artifact)) return artifact;
      const { before: _before, after: _after, ...printable } = artifact;
      return printable;
    }),
  };
}

function applyMode(flags: Flags): boolean {
  if (flags.apply === true && flags["dry-run"] === true)
    throw new Error("--applyと--dry-runは同時に指定できません");
  if (flags.apply !== true && flags["dry-run"] !== true)
    throw new Error(
      "書き込み可能なコマンドには--dry-runまたは--applyが必要です",
    );
  return flags.apply === true;
}

/** Lifecycle operations are preview-only unless --apply is explicit. */
function lifecycleApplyMode(flags: Flags): boolean {
  if (flags.apply === true && flags["dry-run"] === true)
    throw new Error("--applyと--dry-runは同時に指定できません");
  return flags.apply === true;
}

function defaultBranch(root: string): string {
  const symbolic = git(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    root,
    { allowFailure: true },
  );
  if (symbolic.status === 0)
    return symbolic.stdout.trim().replace(/^origin\//, "");
  throw new Error("既定ブランチが不明です。origin/HEADを設定してください");
}

export async function main(argv: string[]): Promise<number> {
  const [command, subcommand, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    print({
      usage: CLI_USAGE,
      lifecycle: PUBLIC_LIFECYCLE_COMMANDS.map(
        (name) => `npx agent-skill-chain ${name}`,
      ),
    });
    return 0;
  }
  if (command === "issue" && subcommand === "create") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const assessment = readJson<Record<string, ModeAnswer>>(
      required(flags, "assessment"),
    );
    print(
      createIssueStaging(root, {
        title: required(flags, "title"),
        answers: assessment,
      }),
    );
    return 0;
  }
  if (command === "issue" && subcommand === "validate") {
    const { flags, positionals } = parse(rest);
    const target = positionals[0] ?? required(flags, "path");
    const result = validateIssue(path.resolve(target), {
      changedFiles:
        typeof flags.changed === "string"
          ? flags.changed.split(",").filter(Boolean)
          : [],
    });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "issue" && subcommand === "sync") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const input = {
      operation: "issue.sync",
      repository: required(flags, "repo"),
      issue: Number(required(flags, "issue")),
      bodyFile: path.resolve(required(flags, "body-file")),
    };
    if (!apply) {
      print({ state: "preview", ...input });
      return 0;
    }
    if (flags.authorize !== "approved")
      throw new Error("Issue同期には--authorize=approvedが必要です");
    print(github("issue.sync", input, process.cwd()));
    return 0;
  }
  if (command === "project" && subcommand === "bootstrap") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const kind = required(flags, "kind");
    if (
      ![
        "cli",
        "api",
        "service",
        "library",
        "batch",
        "data",
        "ui",
        "theme",
        "responsive",
        "design-system",
      ].includes(kind)
    )
      throw new Error("--kindが不正です");
    print(
      bootstrapProject(root, {
        apply,
        newProject: flags["new-project"] === true,
        onboardExisting: flags["onboard-existing"] === true,
        projectKind: kind as ProjectKind,
      }),
    );
    return 0;
  }
  if (command === "spec" && subcommand === "validate") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const review =
      typeof flags.review === "string"
        ? readJson<NonNullable<Parameters<typeof validateSpecs>[1]>["review"]>(
            flags.review,
          )
        : undefined;
    const result = validateSpecs(root, {
      changedFiles:
        typeof flags.changed === "string"
          ? flags.changed.split(",").filter(Boolean)
          : [],
      review,
    });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "review" && subcommand === "validate") {
    const { flags, positionals } = parse(rest);
    const file = positionals[0] ?? required(flags, "file");
    const result = evaluateReview(readJson(file));
    if (result.approved) {
      const pending = {
        ...result,
        approved: false,
        status: "pending",
        errors: [
          ...result.errors,
          "file由来のGitHub metadataはauthorityではありません。review evidenceでtrusted providerを実観測してください",
        ],
      };
      print(pending);
      return 1;
    }
    print(result);
    return 1;
  }
  if (command === "review" && subcommand === "evidence") {
    const { flags } = parse(rest);
    if (flags.external !== undefined)
      throw new Error(
        "--externalの自己申告JSONはreview証拠として使用できません。trusted GitHub providerの明示IDを指定してください",
      );
    if (flags["implementer-actor-id"] !== undefined)
      throw new Error(
        "--implementer-actor-idは自己申告authorityになるため使用できません。H_impl commit authorをGitHubから観測します",
      );
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const implementationCommitSha = required(flags, "implementation-commit");
    const finalCommitSha = required(flags, "final-commit");
    if (
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(implementationCommitSha) ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(finalCommitSha)
    )
      throw new Error(
        "implementation/final commitは完全なGit OIDで指定してください",
      );
    const artifactInput = required(flags, "artifact");
    const artifactFile = resolveContained(root, artifactInput);
    const artifactPath = path
      .relative(root, artifactFile)
      .split(path.sep)
      .join("/");
    if (artifactPath !== artifactInput)
      throw new Error(
        "--artifactは正規化済みrepository相対pathで指定してください",
      );
    const resolveCommit = (oid: string): string =>
      git(["rev-parse", "--verify", `${oid}^{commit}`], root).stdout.trim();
    if (
      resolveCommit(implementationCommitSha) !== implementationCommitSha ||
      resolveCommit(finalCommitSha) !== finalCommitSha
    )
      throw new Error("指定commitを完全OIDへ一意に解決できません");
    const implementationTreeSha = git(
      ["rev-parse", `${implementationCommitSha}^{tree}`],
      root,
    ).stdout.trim();
    const ancestry = git(
      ["merge-base", "--is-ancestor", implementationCommitSha, finalCommitSha],
      root,
      { allowFailure: true },
    );
    const changedPaths = git(
      [
        "diff",
        "--name-only",
        `${implementationCommitSha}..${finalCommitSha}`,
        "--",
      ],
      root,
    )
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    const blobOid = git(
      ["rev-parse", `${finalCommitSha}:${artifactPath}`],
      root,
    ).stdout.trim();
    const artifactContent = git(
      ["show", `${finalCommitSha}:${artifactPath}`],
      root,
    ).stdout;
    const repository = required(flags, "repo");
    const prRaw = required(flags, "pr");
    const runId = required(flags, "run-id");
    const reviewId = required(flags, "review-id");
    if (
      !/^[1-9]\d*$/u.test(prRaw) ||
      !/^[1-9]\d*$/u.test(runId) ||
      !/^[1-9]\d*$/u.test(reviewId)
    )
      throw new Error(
        "PR、Actions run、reviewは正のimmutable IDで指定してください",
      );
    const externalEvidence = github(
      "review.evidence",
      {
        repository,
        pr: Number(prRaw),
        runId,
        reviewId,
        implementationCommitSha,
      },
      root,
    );
    const result = buildReviewEvidence({
      implementationCommitSha,
      finalCommitSha,
      implementationTreeSha,
      implementationIsAncestor: ancestry.status === 0,
      changedPaths,
      artifact: {
        path: artifactPath,
        sha256: crypto
          .createHash("sha256")
          .update(artifactContent)
          .digest("hex"),
        blobOid,
      },
      externalEvidence,
    });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "trace" && subcommand === "validate") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const choices = loadProjectPolicySet(root).policy.projectChoices;
    const result = validateScenarioTrace(
      readJson(path.resolve(required(flags, "evidence"))),
      { layers: choices?.testLayers },
    );
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "conformance" && subcommand === "validate") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const contract = readJson(path.resolve(required(flags, "contract")));
    const binding = readJson(path.resolve(required(flags, "binding")));
    const evidence = readJson<
      Parameters<typeof validateRepositoryConformance>[3]
    >(path.resolve(required(flags, "evidence")));
    const result = validateRepositoryConformance(
      root,
      contract,
      binding,
      evidence,
    );
    print(
      result.valid
        ? result
        : serializeDiagnostic({
            ...result,
            diagnostic: {
              ruleId: "ASC-CONFORMANCE-001",
              purpose: "機能拡張不変条件を実行可能な証拠へ結ぶ",
              risk: "quality",
              reasons: result.errors,
              scope: ["conformance"],
              checks: [
                "exact invariant、source、export、SCN、成功証拠を検証した",
              ],
              autoFixes: [],
              next: "不足するproject bindingまたは成功証拠を追加してください",
              requiredAuthority: "project owner",
              rollback: "不完全なbindingを適用しない",
            },
          }),
    );
    return result.valid ? 0 : 1;
  }
  if (command === "policy" && subcommand === "validate") {
    const { flags, positionals } = parse(rest);
    const file = path.resolve(positionals[0] ?? required(flags, "file"));
    const root = path.resolve(
      typeof flags.root === "string"
        ? flags.root
        : path.join(path.dirname(file), ".."),
    );
    const explicitKeys = [
      "trusted-commit",
      "expected-base-sha",
      "candidate-head-sha",
      "base-ref",
      "default-branch",
      "repo",
      "pr",
    ];
    const explicitMode = explicitKeys.some((key) => flags[key] !== undefined);
    let explicitTrusted;
    if (explicitMode) {
      const trustedCommit = required(flags, "trusted-commit");
      const expectedBaseSha = required(flags, "expected-base-sha");
      const candidateHeadSha = required(flags, "candidate-head-sha");
      const baseRef = required(flags, "base-ref");
      const defaultBranch = required(flags, "default-branch");
      const repository = required(flags, "repo");
      const prRaw = required(flags, "pr");
      if (!/^[1-9]\d*$/u.test(prRaw))
        throw new Error("--prは正のPR numberで指定してください");
      const pr = Number(prRaw);
      let provider;
      try {
        provider = github("policy.authority", { repository, pr }, root);
      } catch (error) {
        if (error instanceof GitHubProviderUnavailableError) {
          print(policyAuthorityFailure("pending", error.message));
          return 1;
        }
        throw error;
      }
      explicitTrusted = {
        trustedCommit,
        expectedBaseSha,
        candidateHeadSha,
        baseRef,
        defaultBranch,
        repository,
        pr,
        provider,
      };
      const entrypoint = path.resolve(
        root,
        ".agent-skill-chain/project-policy.json",
      );
      if (file !== entrypoint)
        throw new Error(
          "explicit PR validateのentrypointは.agent-skill-chain/project-policy.jsonに限定されます",
        );
      let trustedSet;
      let candidateSet;
      try {
        trustedSet = loadOperationPolicy(root, explicitTrusted);
        candidateSet = loadProjectPolicySetAtCommit(root, candidateHeadSha);
        if (
          candidateSet.manifest.schemaVersion !==
          "agent-skill-chain/project-policy-manifest/v1"
        )
          throw new Error(
            "explicit trusted commitを使うCI validateはcandidate commitの完全なfragmented project policy setを必須とします",
          );
      } catch (error) {
        print(
          policyAuthorityFailure(
            "rejected",
            error instanceof Error ? error.message : String(error),
          ),
        );
        return 1;
      }
      const effective = resolveEffectivePolicy(
        trustedSet.policy,
        candidateSet.policy,
      );
      if (!effective.valid) {
        print(
          serializeDiagnostic({
            allowed: false,
            candidateSetHash: candidateSet.setHash,
            trustedSetHash: trustedSet.setHash,
            diagnostic: effective.diagnostic,
          }),
        );
        return 1;
      }
      const comparison = compareTrustedPolicy(
        trustedSet.policy,
        effective.policy,
      );
      if (!comparison.allowed) {
        const result = {
          valid: false,
          status: "rejected",
          candidateSetHash: candidateSet.setHash,
          trustedSetHash: trustedSet.setHash,
          errors: comparison.rejected.flatMap((item) => item.reasons),
        };
        print(
          serializeDiagnostic({
            ...result,
            diagnostic: comparison.rejected[0],
          }),
        );
        return 1;
      }
      let recheckedProvider;
      try {
        recheckedProvider = github(
          "policy.authority",
          { repository, pr },
          root,
        );
      } catch (error) {
        print(
          policyAuthorityFailure(
            "pending",
            error instanceof Error ? error.message : String(error),
          ),
        );
        return 1;
      }
      if (!samePolicyAuthorityObservation(provider, recheckedProvider)) {
        print(
          policyAuthorityFailure(
            "pending",
            "provider authority tupleが検証中に変更されました",
          ),
        );
        return 1;
      }
      const result = {
        valid: true,
        status: "validated",
        candidateSetHash: candidateSet.setHash,
        candidateSemanticPolicyHash: candidateSet.semanticPolicyHash,
        candidateProvenance: candidateSet.provenance,
        trustedSetHash: trustedSet.setHash,
        trustedProvenance: trustedSet.provenance,
        stagedAdditions: comparison.stagedAdditions,
        errors: [],
      };
      print(
        result.valid
          ? result
          : serializeDiagnostic({
              ...result,
              diagnostic: comparison.rejected[0],
            }),
      );
      return result.valid ? 0 : 1;
    }
    const parsed = readJson<Record<string, unknown>>(file);
    if (
      parsed.schemaVersion === "agent-skill-chain/project-policy-manifest/v1"
    ) {
      const candidateSet = loadProjectPolicySet(root);
      const trustedSet = loadOperationPolicy(root);
      const effective = resolveEffectivePolicy(
        trustedSet.policy,
        candidateSet.policy,
      );
      if (!effective.valid) {
        print(
          serializeDiagnostic({
            allowed: false,
            candidateSetHash: candidateSet.setHash,
            trustedSetHash: trustedSet.setHash,
            diagnostic: effective.diagnostic,
          }),
        );
        return 1;
      }
      const comparison = compareTrustedPolicy(
        trustedSet.policy,
        effective.policy,
      );
      const result = {
        valid: comparison.allowed,
        candidateSetHash: candidateSet.setHash,
        candidateSemanticPolicyHash: candidateSet.semanticPolicyHash,
        trustedSetHash: trustedSet.setHash,
        trustedProvenance: trustedSet.provenance,
        stagedAdditions: comparison.stagedAdditions,
        errors: comparison.rejected.flatMap((item) => item.reasons),
      };
      print(
        result.valid
          ? result
          : serializeDiagnostic({
              ...result,
              diagnostic: comparison.rejected[0],
            }),
      );
      return result.valid ? 0 : 1;
    }
    const policy = parsed;
    const result = validatePolicy(policy);
    print(
      result.valid
        ? result
        : serializeDiagnostic({ ...result, diagnostic: result.diagnostics[0] }),
    );
    return result.valid ? 0 : 1;
  }
  if (command === "policy" && subcommand === "evaluate") {
    const { flags } = parse(rest);
    const trusted = readJson<Policy>(path.resolve(required(flags, "trusted")));
    const candidate = readJson<Policy>(
      path.resolve(required(flags, "candidate")),
    );
    const trustedValidation = validatePolicy(trusted);
    const candidateValidation = validatePolicy(candidate);
    if (!trustedValidation.valid || !candidateValidation.valid) {
      const diagnostic =
        trustedValidation.diagnostics[0] ?? candidateValidation.diagnostics[0];
      print(
        serializeDiagnostic({
          allowed: false,
          code: "ASC-POLICY-INVALID",
          trustedErrors: trustedValidation.errors,
          candidateErrors: candidateValidation.errors,
          diagnostic,
        }),
      );
      return 1;
    }
    const result = compareTrustedPolicy(trusted, candidate);
    print(
      result.allowed
        ? result
        : serializeDiagnostic({ ...result, diagnostic: result.rejected[0] }),
    );
    return result.allowed ? 0 : 1;
  }
  if (command === "policy" && subcommand === "enforce") {
    const { flags } = parse(rest);
    const policy = readJson<Policy>(path.resolve(required(flags, "policy")));
    const input = readJson<
      Omit<Parameters<typeof enforceOperation>[0], "policy">
    >(path.resolve(required(flags, "input")));
    const result = enforceOperation({ ...input, policy });
    print(result.allowed ? result : serializeDiagnostic(result));
    return result.allowed ? 0 : 1;
  }
  if (command === "policy" && subcommand === "migrate") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const expectedRevision = apply
      ? requiredExpectedRevision(flags)
      : undefined;
    const operation =
      typeof flags.operation === "string" ? flags.operation : "apply";
    if (!["apply", "rollback", "retry", "recover"].includes(operation))
      throw new Error(
        "--operationはapply、rollback、retry、recoverのいずれかです",
      );
    const stateFile =
      typeof flags.state === "string" ? path.resolve(flags.state) : undefined;
    if (apply && !stateFile)
      throw new Error("--applyには--state=...が必要です");
    let result;
    const trustedFile =
      typeof flags.trusted === "string"
        ? path.resolve(flags.trusted)
        : undefined;
    const candidateFile =
      typeof flags.candidate === "string"
        ? path.resolve(flags.candidate)
        : undefined;
    const trusted = trustedFile ? readPolicyInput(trustedFile) : undefined;
    const candidate = candidateFile
      ? readPolicyInput(candidateFile)
      : undefined;
    if (operation === "apply") {
      if (!trusted || !candidate)
        throw new Error("applyには--trustedと--candidateが必要です");
      const trustedValidation = validatePolicy(assembledPolicy(trusted));
      const candidateValidation = validatePolicy(assembledPolicy(candidate));
      if (!trustedValidation.valid || !candidateValidation.valid) {
        const diagnostic =
          trustedValidation.diagnostics[0] ??
          candidateValidation.diagnostics[0];
        print(
          serializeDiagnostic({
            state: "rejected",
            allowed: false,
            diagnostic,
          }),
        );
        return 1;
      }
      if (typeof flags.manifest === "string") {
        const manifest = readJson<{
          root: string;
          entries: Parameters<typeof planFileMigration>[3];
        }>(path.resolve(flags.manifest));
        const plan = planFileMigration(
          path.resolve(manifest.root),
          trusted,
          candidate,
          manifest.entries ?? [],
        );
        if (apply) {
          const approvedPlanHash = required(flags, "approved-plan-hash");
          if (
            !("planFingerprint" in plan) ||
            approvedPlanHash !== plan.planFingerprint
          )
            throw new Error("approved plan hashがdry-run planと一致しません");
          const durableStateFile = stateFile;
          if (durableStateFile === undefined)
            throw new Error("--stateが必要です");
          const persist = (value: unknown): void =>
            writeFileAtomic(
              durableStateFile,
              `${JSON.stringify(value, null, 2)}\n`,
            );
          persist(plan);
          result = applyFileMigration(
            plan as MigrationState,
            trusted,
            candidate,
            { approvedPlanHash, expectedRevision, persist },
          );
        } else result = plan;
      } else {
        if (isPolicySet(trusted) || isPolicySet(candidate))
          throw new Error(
            "fragmented project policy setのmigrationにはraw inventoryを列挙する--manifestが必要です",
          );
        const plan = planMigration(trusted, candidate);
        if (apply && stateFile !== undefined)
          writeFileAtomic(stateFile, `${JSON.stringify(plan, null, 2)}\n`);
        result = apply
          ? applyMigration(plan, {
              approvedPlanHash: required(flags, "approved-plan-hash"),
              expectedRevision,
            })
          : plan;
      }
    } else {
      if (!stateFile || !fs.existsSync(stateFile))
        throw new Error("rollback/retryには既存の--stateが必要です");
      const state = readJson<Record<string, unknown>>(stateFile);
      if (!apply) {
        print({
          state: "preview",
          operation,
          currentRevision: state.revision,
          requiredApproval: "approved-plan-hash",
          requiredExpectedRevision: state.revision,
        });
        return 0;
      }
      if (state.manifest) {
        if (!trusted || !candidate)
          throw new Error(
            "実manifestのrollback/retryには--trustedと--candidateが必要です",
          );
        const approvedPlanHash = required(flags, "approved-plan-hash");
        const persist = (value: unknown): void =>
          writeFileAtomic(stateFile, `${JSON.stringify(value, null, 2)}\n`);
        const migrationState = state as unknown as MigrationState;
        result =
          operation === "rollback"
            ? rollbackFileMigration(migrationState, trusted, candidate, {
                approvedPlanHash,
                expectedRevision,
                persist,
              })
            : operation === "retry"
              ? retryFileMigration(migrationState, trusted, candidate, {
                  approvedPlanHash,
                  expectedRevision,
                  persist,
                })
              : recoverFileMigration(migrationState, trusted, candidate, {
                  approvedPlanHash,
                  expectedRevision,
                  persist,
                });
      } else {
        if (operation === "retry" && (!trusted || !candidate))
          throw new Error("retryには--trustedと--candidateが必要です");
        const authority = {
          approvedPlanHash: required(flags, "approved-plan-hash"),
          expectedRevision,
        };
        const conceptualState = state as unknown as ConceptualMigrationState;
        result =
          operation === "rollback"
            ? rollbackMigration(conceptualState, authority)
            : retryMigration(
                conceptualState,
                assembledPolicy(trusted as Policy | PolicySet),
                assembledPolicy(candidate as Policy | PolicySet),
                authority,
              );
      }
    }
    if (apply && result.state === "rejected") {
      const reportFile =
        typeof flags.report === "string"
          ? path.resolve(flags.report)
          : `${stateFile}.report.json`;
      writeFileAtomic(reportFile, `${JSON.stringify(result, null, 2)}\n`);
    } else if (apply) {
      if (stateFile === undefined) throw new Error("--stateが必要です");
      writeFileAtomic(stateFile, `${JSON.stringify(result, null, 2)}\n`);
    }
    print(
      result.state === "rejected"
        ? serializeDiagnostic(result)
        : printableMigration(result),
    );
    return result.state === "rejected" || result.allowed === false ? 1 : 0;
  }
  if (command === "worktree" && subcommand === "create") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const trustedSet = loadOperationPolicy(root);
    print(
      createWorktree({
        repoRoot: root,
        worktreePath: required(flags, "path"),
        branch: required(flags, "branch"),
        base: required(flags, "base"),
        expectedRepository:
          typeof flags.repo === "string" ? flags.repo : undefined,
        trustedPolicy: trustedSet.policy,
      }),
    );
    return 0;
  }
  if (command === "worktree" && subcommand === "finalize") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(required(flags, "root"));
    const target = path.resolve(required(flags, "path"));
    const evidence = readJson<Parameters<typeof inspectFinalizeState>[2]>(
      required(flags, "evidence"),
    );
    const state = inspectFinalizeState(root, target, evidence);
    const report = buildFinalizeReport(state);
    if (!apply) {
      print(report);
      return report.safe ? 0 : 1;
    }
    const approvedHash = required(flags, "report-hash");
    if (flags.authorize !== "approved")
      throw new Error("完了処理の適用には--authorize=approvedが必要です");
    const result = applyFinalize(
      {
        report,
        approvedHash,
        currentState: inspectFinalizeState(root, target, evidence),
        trustedPolicy: loadOperationPolicy(root).policy,
      },
      (operation, payload) => {
        if (operation !== "worktree.remove")
          throw new Error("未対応の完了処理です");
        if (typeof payload.path !== "string")
          throw new Error("worktree pathが不正です");
        git(["worktree", "remove", payload.path], root);
      },
    );
    print(result);
    return 0;
  }
  if (command === "pr" && subcommand === "create") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const evidence = readJson<
      Parameters<typeof createPullRequest>[0]["evidence"]
    >(path.resolve(required(flags, "evidence")));
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const headSha = required(flags, "head-sha");
    if (!/^[a-f0-9]{40}$/iu.test(headSha))
      throw new Error("--head-shaは完全な40桁Git SHAで指定してください");
    const input = {
      apply,
      authorization:
        typeof flags.authorize === "string" ? flags.authorize : undefined,
      repository: required(flags, "repo"),
      issue: Number(required(flags, "issue")),
      head: required(flags, "head"),
      headSha,
      base: required(flags, "base"),
      evidence,
      trustedPolicy: loadOperationPolicy(root).policy,
      candidatePolicy: loadConsumerPolicyAtCommit(root, headSha),
    };
    print(
      createPullRequest(input, (operation, payload) =>
        github(operation, payload, root),
      ),
    );
    return 0;
  }
  if (command === "pr" && subcommand === "merge") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const repository = required(flags, "repo");
    const prRaw = required(flags, "pr");
    if (!/^[1-9]\d*$/u.test(prRaw))
      throw new Error("--prは正の整数で指定してください");
    const pr = Number(prRaw);
    const method = required(flags, "method");
    if (!["merge", "squash", "rebase"].includes(method))
      throw new Error("--methodが不正です");
    const base = defaultBranch(root);
    const trustedSet = loadEffectiveTrustedPolicySet(root, base);
    const trustedPolicy = trustedSet.policy;
    const inspected = github("pr.inspect", { repository, pr }, root);
    if (inspected.baseRefName !== base)
      throw new Error("PRの基点が検証済み既定ブランチではありません");
    if (
      trustedSet.provenance?.commitSha &&
      inspected.baseRefOid !== trustedSet.provenance.commitSha
    )
      throw new Error(
        "PR base SHAがtrusted policy setのcommit SHAと一致しません",
      );
    const protection = github(
      "branch.protection",
      { repository, branch: base },
      root,
    );
    const checks = (inspected.statusCheckRollup ?? [])
      .filter((item) => (item.conclusion ?? item.status) === "SUCCESS")
      .map((item) => item.name ?? item.context)
      .filter((item): item is string => typeof item === "string");
    const approvals = github("pr.reviews", { repository, pr }, root);
    if (typeof inspected.headRefOid !== "string")
      throw new Error("PR HEAD SHAが不正です");
    const implementation = github(
      "commit.inspect",
      { repository, sha: inspected.headRefOid },
      root,
    );
    if (implementation.sha !== inspected.headRefOid)
      throw new Error("実装commitのtrusted観測がPR HEADと一致しません");
    const authorization = authorizeMerge({
      trustedPolicy,
      method: method as "merge" | "squash" | "rebase",
      checks,
      approvals,
      headSha: inspected.headRefOid,
      prAuthorActorId: inspected.author?.id,
      implementationAuthorActorId: implementation.authorActorId,
      branch: inspected.headRefName ?? "",
      repositoryVerified: true,
      shaVerified: Boolean(inspected.headRefOid && inspected.baseRefOid),
      protectionVerified: protection.known && protection.protected,
      mergeableVerified:
        inspected.isDraft === false && inspected.mergeStateStatus === "CLEAN",
    });
    if (!authorization.allowed)
      throw new Error(`マージを拒否しました: ${authorization.reason}`);
    if (!apply) {
      print({
        state: "preview",
        authorization,
        pr: inspected.url,
        headSha: inspected.headRefOid,
        baseSha: inspected.baseRefOid,
      });
      return 0;
    }
    const rechecked = github("pr.inspect", { repository, pr }, root);
    if (
      rechecked.headRefOid !== inspected.headRefOid ||
      rechecked.baseRefOid !== inspected.baseRefOid ||
      rechecked.headRefName !== inspected.headRefName ||
      rechecked.baseRefName !== inspected.baseRefName ||
      rechecked.author?.id !== inspected.author?.id
    )
      throw new Error("マージ直前にPR状態が変化しました（TOCTOU）");
    const recheckedProtection = github(
      "branch.protection",
      { repository, branch: base },
      root,
    );
    const recheckedApprovals = github("pr.reviews", { repository, pr }, root);
    const recheckedChecks = (rechecked.statusCheckRollup ?? [])
      .filter((item) => (item.conclusion ?? item.status) === "SUCCESS")
      .map((item) => item.name ?? item.context)
      .filter((item): item is string => typeof item === "string");
    const reauthorization = authorizeMerge({
      trustedPolicy,
      method: method as "merge" | "squash" | "rebase",
      checks: recheckedChecks,
      approvals: recheckedApprovals,
      headSha: rechecked.headRefOid,
      prAuthorActorId: rechecked.author?.id,
      implementationAuthorActorId: implementation.authorActorId,
      branch: rechecked.headRefName ?? "",
      repositoryVerified: true,
      shaVerified: true,
      protectionVerified:
        recheckedProtection.known && recheckedProtection.protected,
      mergeableVerified:
        rechecked.isDraft === false && rechecked.mergeStateStatus === "CLEAN",
    });
    if (!reauthorization.allowed)
      throw new Error(
        `マージ直前の再認可を拒否しました: ${reauthorization.reason}`,
      );
    print(
      github(
        "pr.merge",
        { repository, pr, method: method as "merge" | "squash" | "rebase" },
        root,
      ),
    );
    return 0;
  }
  const lifecycleCommand = canonicalLifecycleCommand(command);
  if (["install", "update", "delete"].includes(lifecycleCommand)) {
    const forwarded = subcommand ? [subcommand, ...rest] : rest;
    const { flags, positionals } = parse(forwarded);
    const apply = lifecycleApplyMode(flags);
    const root = path.resolve(
      positionals[0] ??
        (typeof flags.root === "string" ? flags.root : process.cwd()),
    );
    print(
      lifecycleCommand === "install"
        ? init(root, { apply })
        : lifecycleCommand === "update"
          ? upgrade(root, { apply })
          : uninstall(root, { apply }),
    );
    return 0;
  }
  if (command === "doctor") {
    const forwarded = subcommand ? [subcommand, ...rest] : rest;
    const { flags, positionals } = parse(forwarded);
    const root = path.resolve(
      positionals[0] ??
        (typeof flags.root === "string" ? flags.root : process.cwd()),
    );
    const result = doctor(root);
    print(result);
    return result.healthy ? 0 : 1;
  }
  throw new Error(`不明なコマンドです: ${argv.join(" ")}`);
}
