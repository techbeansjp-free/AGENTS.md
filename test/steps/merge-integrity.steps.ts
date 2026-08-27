import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkFileAudit,
  collectMergeObservations,
} from "../../scripts/check_file_audit.js";
import {
  evaluateMergeIntegrity,
  extractLossTokens,
  type MergeObservation,
  type MergePathObservation,
  type TokenObservation,
} from "../../src/domain/merge-integrity.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

type AuditResult = ReturnType<typeof checkFileAudit>;
type IntegrityResult = ReturnType<typeof evaluateMergeIntegrity>;

const AUDIT_RESULT_KEYS = [
  "valid",
  "errors",
  "base",
  "implementation",
  "current",
  "auditPath",
  "auditedFiles",
  "distributedPaths",
];

const PROCEDURE_DOCUMENTS = [
  ".agent-skill-chain/docs/02_品質基準.md",
  ".agent-skill-chain/templates/issue/04_レビュー.md",
  ".agent-skill-chain/templates/issue/11_プルリクエスト事前確認.md",
];

class MergeIntegrityWorld extends WorkflowWorld {
  root = "";
  tokens: string[] = [];
  observations: MergeObservation[] = [];
  integrity: IntegrityResult | undefined = undefined;
  audit: AuditResult | undefined = undefined;
  collected: MergeObservation[] = [];
  documents: string[] = [];
  contents: string[] = [];
}

const { Given, When, Then } = stepDefinitions<MergeIntegrityWorld>();

function present(tokens: string[]): TokenObservation {
  return { kind: "present", tokens };
}

function observation(
  paths: MergePathObservation[],
  overrides: Partial<MergeObservation> = {},
): MergeObservation {
  return {
    commit: "0123456789abcdef0123456789abcdef01234567",
    parents: [
      "1111111111111111111111111111111111111111",
      "2222222222222222222222222222222222222222",
    ],
    mergeBases: ["3333333333333333333333333333333333333333"],
    paths,
    ...overrides,
  };
}

function pathObservation(
  filePath: string,
  base: string[],
  first: string[],
  second: string[],
  merged: TokenObservation,
  renameTargets?: MergePathObservation["renameTargets"],
): MergePathObservation {
  return {
    path: filePath,
    base: present(base),
    firstParent: present(first),
    secondParent: present(second),
    merged,
    ...(renameTargets === undefined ? {} : { renameTargets }),
  };
}

function repositoryRoot(): string {
  return path.resolve(".");
}

// ---------- 隔離repositoryの構築 ----------

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gitAllowFailure(root: string, args: string[]): void {
  try {
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  } catch {
    // 衝突は呼び出し側が解消する
  }
}

function writeFile(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commit(root: string, message: string, paths: string[]): string {
  git(root, ["add", "--", ...paths]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function auditMarkdown(
  base: string,
  implementation: string,
  rows: Array<{ path: string; status: string }>,
): string {
  const body = rows
    .map(
      (row) =>
        `| \`${row.path}\` | ${row.status} | test owner | fixture | 監査対象 | 依存なし | AC-962 | commitを戻す | pass |`,
    )
    .join("\n");
  return `# fixture実装レビュー

| 項目 | 値 |
|---|---|
| 比較基点 | \`${base}\` |
| H_impl | \`${implementation}\` |
| ラウンド数 | 1 |
| Step chain | 迂回: fixtureのため製品経路を通していない |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
${body}
`;
}

function changedRows(
  root: string,
  base: string,
  implementation: string,
): Array<{ path: string; status: string }> {
  const output = git(root, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--name-status",
    `${base}..${implementation}`,
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const cells = line.split("\t");
      return { status: cells[0]?.[0] ?? "", path: cells.at(-1) ?? "" };
    });
}

function recordArtifact(
  world: MergeIntegrityWorld,
  base: string,
  implementation: string,
): void {
  const artifactPath = "docs/reviews/01_課題962追随レビュー.md";
  writeFile(
    world.root,
    artifactPath,
    auditMarkdown(
      base,
      implementation,
      changedRows(world.root, base, implementation),
    ),
  );
  commit(world.root, "docs: review artifactを記録する", [artifactPath]);
}

/** 既定branch上に共通の基点を作ってからcandidate branchを切る。 */
function startCandidate(
  world: MergeIntegrityWorld,
  baseFiles: Record<string, string> = {},
): void {
  world.root = world.initRepo();
  const paths = Object.keys(baseFiles);
  if (paths.length > 0) {
    for (const [relative, content] of Object.entries(baseFiles))
      writeFile(world.root, relative, content);
    commit(world.root, "chore: 共通の基点を作る", paths);
  }
  git(world.root, ["checkout", "-q", "-b", "cand"]);
}

/** 既定branchが動いた状態を作り、candidateへ取り込んでmerge commitを返す。 */
function advanceDefaultBranch(
  world: MergeIntegrityWorld,
  message: string,
  files: Record<string, string>,
): string {
  git(world.root, ["checkout", "-q", "main"]);
  for (const [relative, content] of Object.entries(files))
    writeFile(world.root, relative, content);
  const tip = commit(world.root, message, Object.keys(files));
  git(world.root, ["checkout", "-q", "cand"]);
  return tip;
}

// ---------- unit ----------

Given("損失検知tokenを含む文字列がある", function () {
  this.value = "REQ-WF-010 と TERM-ASC-068 と AC-01 を SHA-256 で固定する";
});

Given("損失検知tokenを含まない文字列がある", function () {
  this.value = "worktree を main で v0.3.1 として X-1 に置く";
});

When("損失検知tokenを取り出す", function () {
  this.tokens = extractLossTokens(String(this.value));
});

Then(
  "取り出したtokenに {string}、{string}、{string}、{string} が含まれる",
  function (a: string, b: string, c: string, d: string) {
    for (const token of [a, b, c, d])
      assert.ok(this.tokens.includes(token), `${token}が含まれていません`);
  },
);

Then(
  "取り出したtokenに {string}、{string}、{string}、{string} が含まれない",
  function (a: string, b: string, c: string, d: string) {
    for (const token of [a, b, c, d])
      assert.ok(!this.tokens.includes(token), `${token}が含まれています`);
  },
);

Given(
  "両親が保持していたtokenがmerge結果から消えたmerge観測がある",
  function () {
    this.observations = [
      observation([
        pathObservation(
          "docs/table.md",
          ["REQ-WF-010"],
          ["REQ-WF-010"],
          ["REQ-WF-010"],
          present([]),
        ),
      ]),
    ];
  },
);

Given("第2親だけが導入したtokenがmerge結果に無いmerge観測がある", function () {
  this.observations = [
    observation([
      pathObservation("docs/table.md", [], [], ["REQ-WF-010"], present([])),
    ]),
  ];
});

Given(
  "第2親が2つのpathへ同じtokenを導入し片方だけがmerge結果に残るmerge観測がある",
  function () {
    this.observations = [
      observation([
        pathObservation(
          "docs/a.md",
          [],
          [],
          ["REQ-WF-010"],
          present(["REQ-WF-010"]),
        ),
        pathObservation("docs/b.md", [], [], ["REQ-WF-010"], present([])),
      ]),
    ];
  },
);

Given("両親が導入したtokenがすべてmerge結果にあるmerge観測がある", function () {
  this.observations = [
    observation([
      pathObservation(
        "docs/table.md",
        [],
        ["REQ-XX-001"],
        ["REQ-WF-010"],
        present(["REQ-XX-001", "REQ-WF-010"]),
      ),
    ]),
  ];
});

Given("merge-baseにあるtokenを第1親だけが削除したmerge観測がある", function () {
  this.observations = [
    observation([
      pathObservation(
        "docs/table.md",
        ["REQ-OLD-001"],
        [],
        ["REQ-OLD-001"],
        present([]),
      ),
    ]),
  ];
});

Given("merge結果にpathが無くrename移動先が一意なmerge観測がある", function () {
  this.observations = [
    observation([
      pathObservation(
        "docs/old.md",
        [],
        [],
        ["REQ-WF-010"],
        { kind: "absent" },
        [
          {
            kind: "resolved",
            parent: "2222222222222222222222222222222222222222",
            path: "docs/new.md",
            observation: present(["REQ-WF-010"]),
          },
        ],
      ),
    ]),
  ];
});

Given("merge結果にpathが無くrename移動先も無いmerge観測がある", function () {
  this.observations = [
    observation([
      pathObservation(
        "docs/old.md",
        [],
        [],
        ["REQ-WF-010"],
        { kind: "absent" },
        [],
      ),
      pathObservation("docs/other.md", [], [], [], present(["REQ-WF-010"])),
    ]),
  ];
});

Given(
  "merge結果にpathが無く親ごとにrename移動先が異なるmerge観測がある",
  function () {
    this.observations = [
      observation([
        pathObservation(
          "docs/old.md",
          [],
          ["REQ-WF-010"],
          ["REQ-WF-010"],
          { kind: "absent" },
          [
            {
              kind: "resolved",
              parent: "1111111111111111111111111111111111111111",
              path: "docs/first.md",
              observation: present(["REQ-WF-010"]),
            },
            {
              kind: "resolved",
              parent: "2222222222222222222222222222222222222222",
              path: "docs/second.md",
              observation: present(["REQ-WF-010"]),
            },
          ],
        ),
      ]),
    ];
  },
);

Given(
  "merge結果にpathが無く片方の親でだけ移動先を特定できたmerge観測がある",
  function () {
    this.observations = [
      observation([
        pathObservation(
          "docs/old.md",
          [],
          ["REQ-WF-010"],
          ["REQ-WF-010"],
          { kind: "absent" },
          [
            {
              kind: "resolved",
              parent: "1111111111111111111111111111111111111111",
              path: "docs/new.md",
              observation: present(["REQ-WF-010"]),
            },
            {
              kind: "unresolved",
              parent: "2222222222222222222222222222222222222222",
            },
          ],
        ),
      ]),
    ];
  },
);

Given("異なる2つの移動元が同じ移動先へ解決されたmerge観測がある", function () {
  this.observations = [
    observation([
      {
        path: "docs/a.md",
        base: { kind: "absent" },
        firstParent: present(["REQ-WF-010"]),
        secondParent: { kind: "absent" },
        merged: { kind: "absent" },
        renameTargets: [
          {
            kind: "resolved",
            parent: "1111111111111111111111111111111111111111",
            path: "docs/c.md",
            observation: present(["REQ-WF-010"]),
          },
        ],
      },
      {
        path: "docs/b.md",
        base: { kind: "absent" },
        firstParent: { kind: "absent" },
        secondParent: present(["REQ-WF-010"]),
        merged: { kind: "absent" },
        renameTargets: [
          {
            kind: "resolved",
            parent: "2222222222222222222222222222222222222222",
            path: "docs/c.md",
            observation: present(["REQ-WF-010"]),
          },
        ],
      },
    ]),
  ];
});

Given("移動先がmerge結果に残る別の要求元であるmerge観測がある", function () {
  this.observations = [
    observation([
      {
        path: "docs/a.md",
        base: { kind: "absent" },
        firstParent: present(["REQ-WF-010"]),
        secondParent: { kind: "absent" },
        merged: { kind: "absent" },
        renameTargets: [
          {
            kind: "resolved",
            parent: "1111111111111111111111111111111111111111",
            path: "docs/c.md",
            observation: present(["REQ-WF-010"]),
          },
        ],
      },
      pathObservation(
        "docs/c.md",
        [],
        [],
        ["REQ-WF-010"],
        present(["REQ-WF-010"]),
      ),
    ]),
  ];
});

Given(
  "保持必須集合が空の移動元が既存pathへ解決されたmerge観測がある",
  function () {
    this.observations = [
      observation([
        {
          path: "docs/old.md",
          base: present(["REQ-WF-010"]),
          firstParent: present(["REQ-WF-010"]),
          secondParent: { kind: "absent" },
          merged: { kind: "absent" },
          renameTargets: [
            {
              kind: "resolved",
              parent: "1111111111111111111111111111111111111111",
              path: "docs/new.md",
              observation: present(["REQ-WF-010"]),
            },
          ],
        },
        pathObservation(
          "docs/new.md",
          [],
          [],
          ["REQ-WF-010"],
          present(["REQ-WF-010"]),
        ),
      ]),
    ];
  },
);

Given("第2親の内容を観測できないmerge観測がある", function () {
  this.observations = [
    observation([
      {
        path: "docs/table.md",
        base: present([]),
        firstParent: present([]),
        secondParent: { kind: "unreadable", reason: "blobを読めません" },
        merged: present([]),
      },
    ]),
  ];
});

Given("親が3個のmerge観測がある", function () {
  this.observations = [
    observation([], {
      parents: [
        "1111111111111111111111111111111111111111",
        "2222222222222222222222222222222222222222",
        "4444444444444444444444444444444444444444",
      ],
    }),
  ];
});

Given(
  "merge-baseが2個のmerge観測とmerge-baseが0個のmerge観測がある",
  function () {
    this.observations = [
      observation([], {
        mergeBases: [
          "3333333333333333333333333333333333333333",
          "5555555555555555555555555555555555555555",
        ],
      }),
      observation([], {
        commit: "6666666666666666666666666666666666666666",
        mergeBases: [],
      }),
    ];
  },
);

Given("merge観測が0件である", function () {
  this.observations = [];
});

Given("判定可能な観測と判定不能な観測が混在するmerge観測列がある", function () {
  this.observations = [
    observation([
      pathObservation(
        "docs/a.md",
        [],
        [],
        ["REQ-WF-010"],
        present(["REQ-WF-010"]),
      ),
      pathObservation("docs/b.md", [], [], [], present([])),
    ]),
    observation([], {
      commit: "6666666666666666666666666666666666666666",
      mergeBases: [],
    }),
  ];
});

When("merge損失を判定する", function () {
  this.integrity = evaluateMergeIntegrity(this.observations);
});

Then("判定は失敗し、失われたtokenを示す", function () {
  assert.equal(this.integrity?.valid, false);
  assert.ok(
    this.integrity?.errors.some((message) =>
      /損失検知tokenを失っています: .*REQ-WF-010/u.test(message),
    ),
    JSON.stringify(this.integrity?.errors),
  );
});

Then("失敗の説明にpathとcommitと安全な次操作が含まれる", function () {
  const message = this.integrity?.errors[0] ?? "";
  assert.match(message, /docs\/table\.md/u);
  assert.match(message, /^01234567 /u);
  assert.match(message, /消す操作はmergeの後の通常commitで行ってください/u);
});

Then("判定は成功する", function () {
  assert.equal(
    this.integrity?.valid,
    true,
    JSON.stringify(this.integrity?.errors),
  );
});

Then("判定は失敗し、判定不能の理由を示す", function () {
  assert.equal(this.integrity?.valid, false);
  assert.ok(
    this.integrity?.errors.some((message) =>
      /判定できません|一意ではありません/u.test(message),
    ),
    JSON.stringify(this.integrity?.errors),
  );
});

Then("両方の観測が判定不能として拒否される", function () {
  assert.equal(this.integrity?.valid, false);
  assert.equal(this.integrity?.errors.length, 2);
  assert.ok(
    this.integrity?.errors.every((message) => /merge-base/u.test(message)),
  );
});

Then("判定は成功し、検査merge件数と検査path件数がともに0である", function () {
  assert.equal(this.integrity?.valid, true);
  assert.equal(this.integrity?.checkedMerges, 0);
  assert.equal(this.integrity?.inspectedPaths, 0);
});

Then(
  "検査merge件数が観測件数に一致し、検査path件数が全観測のpath件数の総和に一致する",
  function () {
    const expectedPaths = this.observations.reduce(
      (total, entry) => total + entry.paths.length,
      0,
    );
    assert.equal(this.integrity?.checkedMerges, this.observations.length);
    assert.equal(this.integrity?.inspectedPaths, expectedPaths);
  },
);

Given("監査検査scriptがある", function () {
  this.documents = ["scripts/check_file_audit.ts"];
});

When("監査検査scriptのsourceを読む", function () {
  this.value = fs.readFileSync(
    path.join(repositoryRoot(), this.documents[0]!),
    "utf8",
  );
});

Then("判定規則の定義を参照し、正規表現を自前で書いていない", function () {
  const source = String(this.value);
  assert.ok(source.includes("extractLossTokens"), "判定規則を参照していません");
  assert.ok(
    !source.includes("[A-Z][A-Z0-9]*"),
    "判定規則の正規表現を自前で書いています",
  );
});

Given("配布される品質基準がある", function () {
  this.documents = [".agent-skill-chain/docs/02_品質基準.md"];
});

When("配布される品質基準を読む", function () {
  this.value = fs.readFileSync(
    path.join(repositoryRoot(), this.documents[0]!),
    "utf8",
  );
});

Then(
  "追随の位置とH_implと比較基点の指し先と個別監査表の再生成が書かれている",
  function () {
    const text = String(this.value);
    assert.match(text, /review artifact commitより前/u);
    assert.match(text, /比較基点.*取り込んだ既定branch tip/u);
    assert.match(text, /H_impl.*artifact直前の最新commit/u);
    assert.match(text, /個別監査表.*再生成/u);
  },
);

Then(
  "意図的な削除をmergeではなく後続commitで行う旨が書かれている",
  function () {
    assert.match(String(this.value), /意図的な削除.*merge commitでは行わず/u);
  },
);

Given(
  "配布されるreviewテンプレートとPR事前確認テンプレートがある",
  function () {
    this.documents = [
      ".agent-skill-chain/templates/issue/04_レビュー.md",
      ".agent-skill-chain/templates/issue/11_プルリクエスト事前確認.md",
    ];
  },
);

When("配布されるreviewテンプレートとPR事前確認テンプレートを読む", function () {
  this.contents = this.documents.map((relative) =>
    fs.readFileSync(path.join(repositoryRoot(), relative), "utf8"),
  );
});

Then("追随時の比較基点とH_implの指し先を確認する項目がある", function () {
  for (const text of this.contents) {
    assert.match(text, /既定branch追随/u);
    assert.match(text, /比較基点/u);
  }
});

Given("追随手順を記載したfileの一覧がある", function () {
  this.documents = PROCEDURE_DOCUMENTS;
});

When("配布対象judgementのためpackage.jsonを読む", function () {
  this.value = fs.readFileSync(
    path.join(repositoryRoot(), "package.json"),
    "utf8",
  );
});

Then("すべてがpackage.jsonのfilesが配布する範囲に含まれる", function () {
  const metadata = JSON.parse(String(this.value)) as { files: string[] };
  for (const relative of this.documents) {
    assert.ok(
      metadata.files.some(
        (entry) => relative === entry || relative.startsWith(entry),
      ),
      `${relative}が配布対象に含まれていません`,
    );
    assert.ok(
      fs.existsSync(path.join(repositoryRoot(), relative)),
      `${relative}がありません`,
    );
  }
});

// ---------- integration ----------

Given(
  "実装後に既定branchを取り込み最後にreview artifactを置いた隔離repository",
  function () {
    startCandidate(this);
    writeFile(this.root, "src/impl.ts", "export const a = 1;\n");
    commit(this.root, "feat: 実装する", ["src/impl.ts"]);
    const tip = advanceDefaultBranch(this, "docs: 既定branchが動く", {
      "docs/table.md": "| id |\n|---|\n| REQ-WF-010 |\n",
    });
    git(this.root, [
      "merge",
      "-q",
      "--no-edit",
      "-m",
      "chore: 既定branchを取り込む",
      "main",
    ]);
    recordArtifact(this, tip, git(this.root, ["rev-parse", "HEAD"]));
  },
);

Given("追随mergeで既定branch側のtokenを落とした隔離repository", function () {
  startCandidate(this, { "docs/table.md": "| id |\n|---|\n" });
  writeFile(this.root, "docs/table.md", "| id |\n|---|\n| REQ-XX-001 |\n");
  commit(this.root, "feat: 自分側が行を足す", ["docs/table.md"]);
  const tip = advanceDefaultBranch(this, "docs: 既定branchが行を足す", {
    "docs/table.md": "| id |\n|---|\n| REQ-WF-010 |\n",
  });
  gitAllowFailure(this.root, [
    "merge",
    "--no-edit",
    "-m",
    "chore: 既定branchを取り込む",
    "main",
  ]);
  writeFile(this.root, "docs/table.md", "| id |\n|---|\n| REQ-XX-001 |\n");
  git(this.root, ["add", "--", "docs/table.md"]);
  git(this.root, ["commit", "-q", "--no-edit"]);
  recordArtifact(this, tip, git(this.root, ["rev-parse", "HEAD"]));
});

Given(
  "同じtokenを2 fileへ持ち片方だけを落とした追随mergeの隔離repository",
  function () {
    startCandidate(this, {
      "docs/a.md": "| id |\n|---|\n",
      "docs/b.md": "| id |\n|---|\n",
    });
    writeFile(this.root, "docs/b.md", "| id |\n|---|\n| REQ-XX-001 |\n");
    commit(this.root, "feat: 自分側が行を足す", ["docs/b.md"]);
    const tip = advanceDefaultBranch(this, "docs: 既定branchが両方へ行を足す", {
      "docs/a.md": "| id |\n|---|\n| REQ-WF-010 |\n",
      "docs/b.md": "| id |\n|---|\n| REQ-WF-010 |\n",
    });
    gitAllowFailure(this.root, [
      "merge",
      "--no-edit",
      "-m",
      "chore: 既定branchを取り込む",
      "main",
    ]);
    // docs/a.mdは既定branch側を保ち、docs/b.mdだけ自分側で解消してtokenを落とす
    writeFile(this.root, "docs/a.md", "| id |\n|---|\n| REQ-WF-010 |\n");
    writeFile(this.root, "docs/b.md", "| id |\n|---|\n| REQ-XX-001 |\n");
    git(this.root, ["add", "--", "docs/a.md", "docs/b.md"]);
    git(this.root, ["commit", "-q", "--no-edit"]);
    recordArtifact(this, tip, git(this.root, ["rev-parse", "HEAD"]));
  },
);

Given(
  "既定branchだけが追加したfileを追随mergeで削除した隔離repository",
  function () {
    startCandidate(this);
    writeFile(this.root, "src/impl.ts", "export const a = 1;\n");
    commit(this.root, "feat: 実装する", ["src/impl.ts"]);
    const tip = advanceDefaultBranch(this, "docs: 既定branchがfileを足す", {
      "docs/new.md": "| id |\n|---|\n| REQ-WF-010 |\n",
    });
    gitAllowFailure(this.root, ["merge", "--no-commit", "--no-ff", "main"]);
    git(this.root, ["rm", "-q", "-f", "--", "docs/new.md"]);
    git(this.root, ["commit", "-q", "-m", "chore: 既定branchを取り込む"]);
    recordArtifact(this, tip, git(this.root, ["rev-parse", "HEAD"]));
  },
);

Given("監査範囲に親が3個のmergeを含む隔離repository", function () {
  startCandidate(this);
  writeFile(this.root, "src/impl.ts", "export const a = 1;\n");
  const forked = commit(this.root, "feat: 実装する", ["src/impl.ts"]);
  git(this.root, ["checkout", "-q", "-b", "side-a", forked]);
  writeFile(this.root, "docs/a.md", "| REQ-AA-001 |\n");
  commit(this.root, "docs: side-a", ["docs/a.md"]);
  git(this.root, ["checkout", "-q", "-b", "side-b", forked]);
  writeFile(this.root, "docs/b.md", "| REQ-BB-001 |\n");
  commit(this.root, "docs: side-b", ["docs/b.md"]);
  git(this.root, ["checkout", "-q", "cand"]);
  // candidate側にもcommitを置かないと、Gitが冗長な親を落として2親mergeになる
  writeFile(this.root, "docs/c.md", "| REQ-CC-001 |\n");
  commit(this.root, "docs: candidateも進む", ["docs/c.md"]);
  git(this.root, [
    "merge",
    "-q",
    "--no-edit",
    "-m",
    "chore: 2本を同時に取り込む",
    "side-a",
    "side-b",
  ]);
  recordArtifact(this, forked, git(this.root, ["rev-parse", "HEAD"]));
});

Given("監査範囲にmerge-baseが2個のmergeを含む隔離repository", function () {
  startCandidate(this);
  writeFile(this.root, "src/impl.ts", "export const a = 1;\n");
  const forked = commit(this.root, "feat: 実装する", ["src/impl.ts"]);
  git(this.root, ["checkout", "-q", "-b", "side-a", forked]);
  writeFile(this.root, "docs/a.md", "| REQ-AA-001 |\n");
  const a1 = commit(this.root, "docs: side-a", ["docs/a.md"]);
  git(this.root, ["checkout", "-q", "-b", "side-b", forked]);
  writeFile(this.root, "docs/b.md", "| REQ-BB-001 |\n");
  const b1 = commit(this.root, "docs: side-b", ["docs/b.md"]);
  git(this.root, ["checkout", "-q", "side-a"]);
  git(this.root, ["merge", "-q", "--no-edit", "-m", "chore: bを取り込む", b1]);
  git(this.root, ["checkout", "-q", "side-b"]);
  git(this.root, ["merge", "-q", "--no-edit", "-m", "chore: aを取り込む", a1]);
  git(this.root, ["checkout", "-q", "cand"]);
  git(this.root, [
    "merge",
    "-q",
    "--no-edit",
    "-m",
    "chore: criss-crossを取り込む",
    "side-a",
  ]);
  git(this.root, [
    "merge",
    "-q",
    "--no-edit",
    "-m",
    "chore: criss-crossの他方を取り込む",
    "side-b",
  ]);
  recordArtifact(this, forked, git(this.root, ["rev-parse", "HEAD"]));
});

Given(
  "release bump除外条件をすべて満たす追随mergeの隔離repository",
  function () {
    startCandidate(this, {
      "package.json": `${JSON.stringify({ name: "fixture", version: "1.0.0", private: true }, null, 2)}\n`,
    });
    const forked = git(this.root, ["rev-parse", "HEAD"]);
    advanceDefaultBranch(this, "chore(release): bump version to 1.0.1", {
      "package.json": `${JSON.stringify({ name: "fixture", version: "1.0.1", private: true }, null, 2)}\n`,
    });
    git(this.root, [
      "merge",
      "-q",
      "--no-ff",
      "--no-edit",
      "-m",
      "chore(release): bump version to 1.0.1",
      "main",
    ]);
    this.value = {
      base: forked,
      implementation: git(this.root, ["rev-parse", "HEAD"]),
    };
  },
);

Given("追随mergeを持たない従来形の隔離repository", function () {
  startCandidate(this);
  const base = git(this.root, ["rev-parse", "HEAD"]);
  writeFile(this.root, "src/impl.ts", "export const a = 1;\n");
  const implementation = commit(this.root, "feat: 実装する", ["src/impl.ts"]);
  recordArtifact(this, base, implementation);
});

Given(
  "追随mergeの後に整理commitを置きH_implを整理commitとした隔離repository",
  function () {
    startCandidate(this, { "docs/table.md": "| id |\n|---|\n" });
    writeFile(this.root, "docs/table.md", "| id |\n|---|\n| REQ-XX-001 |\n");
    commit(this.root, "feat: 自分側が行を足す", ["docs/table.md"]);
    const tip = advanceDefaultBranch(this, "docs: 既定branchが行を足す", {
      "docs/table.md": "| id |\n|---|\n| REQ-WF-010 |\n",
    });
    gitAllowFailure(this.root, [
      "merge",
      "--no-edit",
      "-m",
      "chore: 既定branchを取り込む",
      "main",
    ]);
    writeFile(
      this.root,
      "docs/table.md",
      "| id |\n|---|\n| REQ-WF-010 |\n| REQ-XX-001 |\n",
    );
    git(this.root, ["add", "--", "docs/table.md"]);
    git(this.root, ["commit", "-q", "--no-edit"]);
    writeFile(this.root, "docs/table.md", "| id |\n|---|\n| REQ-WF-010 |\n");
    const reconciled = commit(this.root, "docs: 重複を整理する", [
      "docs/table.md",
    ]);
    recordArtifact(this, tip, reconciled);
  },
);

When("追随を含む隔離repositoryのfile監査を実行する", function () {
  this.audit = checkFileAudit(this.root);
});

When("監査範囲のmerge観測を集める", function () {
  const range = this.value as { base: string; implementation: string };
  this.collected = collectMergeObservations(
    this.root,
    range.base,
    range.implementation,
  );
});

Then("追随を含むfile監査は合格する", function () {
  assert.equal(this.audit?.valid, true, JSON.stringify(this.audit?.errors));
});

Then("file監査は損失検知tokenの消失を理由に失敗する", function () {
  assert.equal(this.audit?.valid, false);
  assert.ok(
    this.audit?.errors.some((message) =>
      /損失検知tokenを失っています: .*REQ-WF-010/u.test(message),
    ),
    JSON.stringify(this.audit?.errors),
  );
});

Then("file監査は判定不能を理由に失敗し、安全な次操作を示す", function () {
  assert.equal(this.audit?.valid, false);
  assert.ok(
    this.audit?.errors.some((message) =>
      /単一のmerge-baseを持つ2親mergeで取り込み直してください/u.test(message),
    ),
    JSON.stringify(this.audit?.errors),
  );
});

Then("観測は1件で、pathが検査対象になっている", function () {
  assert.equal(this.collected.length, 1);
  assert.ok(
    this.collected[0]!.paths.some((entry) => entry.path === "package.json"),
    JSON.stringify(this.collected[0]?.paths.map((entry) => entry.path)),
  );
});

Then("file監査の戻り値のkey集合が従来と一致する", function () {
  assert.deepEqual(
    Object.keys(this.audit ?? {}).sort(),
    [...AUDIT_RESULT_KEYS].sort(),
  );
});

Given(
  "追随mergeがfileをrenameしつつtokenを落とした隔離repository",
  function () {
    startCandidate(this, {
      "docs/old.md": "| id |\n|---|\n| REQ-WF-010 |\n| REQ-KEEP-001 |\n",
    });
    writeFile(this.root, "src/impl.ts", "export const a = 1;\n");
    commit(this.root, "feat: 実装する", ["src/impl.ts"]);
    const tip = advanceDefaultBranch(this, "docs: 既定branchが動く", {
      "docs/other.md": "| REQ-OTHER-001 |\n",
    });
    gitAllowFailure(this.root, ["merge", "--no-commit", "--no-ff", "main"]);
    // renameしつつ既定branch側にもあったREQ-WF-010を落とす
    fs.rmSync(path.join(this.root, "docs/old.md"));
    writeFile(this.root, "docs/new.md", "| id |\n|---|\n| REQ-KEEP-001 |\n");
    git(this.root, ["add", "-A", "--", "docs"]);
    git(this.root, ["commit", "-q", "-m", "chore: 既定branchを取り込む"]);
    recordArtifact(this, tip, git(this.root, ["rev-parse", "HEAD"]));
  },
);

Given("既定branchのrenameを保持した追随mergeの隔離repository", function () {
  startCandidate(this, {
    "docs/old.md": "| id |\n|---|\n| REQ-WF-010 |\n",
  });
  writeFile(this.root, "src/impl.ts", "export const a = 1;\n");
  commit(this.root, "feat: 実装する", ["src/impl.ts"]);
  git(this.root, ["checkout", "-q", "main"]);
  git(this.root, ["mv", "docs/old.md", "docs/new.md"]);
  git(this.root, ["commit", "-q", "-m", "docs: 既定branchがrenameする"]);
  const tip = git(this.root, ["rev-parse", "HEAD"]);
  git(this.root, ["checkout", "-q", "cand"]);
  git(this.root, [
    "merge",
    "-q",
    "--no-edit",
    "-m",
    "chore: 既定branchを取り込む",
    "main",
  ]);
  recordArtifact(this, tip, git(this.root, ["rev-parse", "HEAD"]));
});
