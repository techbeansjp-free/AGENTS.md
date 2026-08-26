import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  checkProjectQualityContract,
  normalizeLockfileForProtection,
} from "../../scripts/check_project_quality.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

interface Lockfile {
  name: string;
  version: string;
  lockfileVersion: number;
  requires: boolean;
  packages: Record<string, Record<string, unknown>>;
}

function baseLockfile(): Lockfile {
  return {
    name: "fixture-package",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "fixture-package",
        version: "1.0.0",
        license: "MIT",
        devDependencies: { left: "^1.0.0" },
      },
      "node_modules/left": {
        version: "1.0.0",
        resolved: "https://registry.invalid/left/-/left-1.0.0.tgz",
        integrity: "sha512-AAAA",
        dev: true,
      },
    },
  };
}

function render(lockfile: Lockfile): string {
  return `${JSON.stringify(lockfile, null, 2)}\n`;
}

function normalizedEqual(mutate: (lockfile: Lockfile) => void): boolean {
  const original = baseLockfile();
  const changed = baseLockfile();
  mutate(changed);
  return (
    normalizeLockfileForProtection(render(original)) ===
    normalizeLockfileForProtection(render(changed))
  );
}

const TRUSTED_COPY = [
  ".github",
  ".prettierignore",
  "cucumber.mjs",
  "eslint.config.mjs",
  "package.json",
  "package-lock.json",
  "scripts",
  "src",
  "test",
  "tsconfig.json",
  "tsconfig.build.json",
  ".agent-skill-chain",
] as const;

function candidateCopy(world: WorkflowWorld): string {
  const root = world.temp("asc-lockprot-");
  for (const relative of TRUSTED_COPY)
    fs.cpSync(path.resolve(relative), path.join(root, relative), {
      recursive: true,
    });
  return root;
}

function mutateCandidateLockfile(
  root: string,
  mutate: (lockfile: Record<string, unknown>) => void,
): void {
  const file = path.join(root, "package-lock.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  mutate(parsed);
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
}

function contractErrors(root: string): string[] {
  return checkProjectQualityContract(root, process.cwd()).errors.filter(
    (error) => error.includes("versioned staged proposal"),
  );
}

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-UNIT-LOCKPROT-001": () => {
    assert.equal(
      normalizedEqual((lockfile) => {
        lockfile.version = "9.9.9";
      }),
      true,
    );
  },
  "SCN-UNIT-LOCKPROT-002": () => {
    assert.equal(
      normalizedEqual((lockfile) => {
        lockfile.packages[""]!.version = "9.9.9";
      }),
      true,
    );
  },
  "SCN-UNIT-LOCKPROT-003": () => {
    assert.equal(
      normalizedEqual((lockfile) => {
        lockfile.packages["node_modules/left"]!.integrity = "sha512-TAMPERED";
      }),
      false,
    );
  },
  "SCN-UNIT-LOCKPROT-004": () => {
    assert.equal(
      normalizedEqual((lockfile) => {
        lockfile.packages["node_modules/left"]!.version = "2.0.0";
      }),
      false,
    );
  },
  "SCN-UNIT-LOCKPROT-005": () => {
    assert.equal(
      normalizedEqual((lockfile) => {
        lockfile.packages["node_modules/right"] = {
          version: "1.0.0",
          integrity: "sha512-BBBB",
        };
      }),
      false,
    );
  },
  "SCN-UNIT-LOCKPROT-006": () => {
    assert.equal(
      normalizedEqual((lockfile) => {
        lockfile.lockfileVersion = 2;
      }),
      false,
    );
  },
  "SCN-UNIT-LOCKPROT-007": (world) => {
    const root = candidateCopy(world);
    mutateCandidateLockfile(root, (lockfile) => {
      lockfile.version = "9.9.9-fixture";
      const packages = lockfile.packages as Record<
        string,
        Record<string, unknown>
      >;
      packages[""]!.version = "9.9.9-fixture";
    });
    assert.deepEqual(contractErrors(root), []);
  },
  "SCN-UNIT-LOCKPROT-008": (world) => {
    const root = candidateCopy(world);
    mutateCandidateLockfile(root, (lockfile) => {
      const packages = lockfile.packages as Record<
        string,
        Record<string, unknown>
      >;
      const first = Object.keys(packages).find((name) =>
        name.startsWith("node_modules/"),
      );
      if (first === undefined) throw new Error("依存が1件もありません");
      packages[first]!.integrity = "sha512-TAMPERED";
    });
    assert.equal(contractErrors(root).length, 1);
  },
};

Given("lockfile保護単体検査の準備がある", function () {
  this.value = undefined;
});

When("{string}のlockfile保護単体検査を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  if (!check) return;
  check(this);
  this.validationOutcome = { valid: true };
});

Then("lockfile保護単体検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
