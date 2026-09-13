import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

/** File-built Git fixture: no Git writes, shared objects, or cleanup operations. */
export function gitWorkspaceFixture() {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-1383-")),
  );
  const primary = path.join(directory, "primary space");
  const root = path.join(directory, "linked space");
  const commonDir = path.join(primary, ".git");
  const gitDir = path.join(commonDir, "worktrees", "linked");
  const write = (file: string, value: string | Buffer): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  const object = (type: string, body: Buffer): string => {
    const data = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
    const sha = createHash("sha1").update(data).digest("hex");
    write(
      path.join(commonDir, "objects", sha.slice(0, 2), sha.slice(2)),
      deflateSync(data),
    );
    return sha;
  };
  const tree = (source: string): string => {
    const entries = fs.readdirSync(source, { withFileTypes: true });
    entries.sort((a, b) =>
      Buffer.compare(
        Buffer.from(a.name + (a.isDirectory() ? "/" : "")),
        Buffer.from(b.name + (b.isDirectory() ? "/" : "")),
      ),
    );
    return object(
      "tree",
      Buffer.concat(
        entries.map((entry) => {
          const file = path.join(source, entry.name);
          const sha = entry.isDirectory()
            ? tree(file)
            : object("blob", fs.readFileSync(file));
          return Buffer.concat([
            Buffer.from(
              `${entry.isDirectory() ? "40000" : "100644"} ${entry.name}\0`,
            ),
            Buffer.from(sha, "hex"),
          ]);
        }),
      ),
    );
  };
  const namespace = path.join(primary, ".agent-skill-chain");
  fs.mkdirSync(namespace, { recursive: true });
  for (const name of ["project", "policy"])
    fs.cpSync(
      path.resolve(".agent-skill-chain", name),
      path.join(namespace, name),
      { recursive: true },
    );
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/project-policy.json"),
    path.join(namespace, "project-policy.json"),
  );
  const policyTree = tree(namespace);
  const rootTree = object(
    "tree",
    Buffer.concat([
      Buffer.from("40000 .agent-skill-chain\0"),
      Buffer.from(policyTree, "hex"),
    ]),
  );
  const commit = object(
    "commit",
    Buffer.from(
      `tree ${rootTree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n`,
    ),
  );
  write(
    path.join(commonDir, "config"),
    '[core]\nrepositoryformatversion = 0\nbare = false\n[remote "origin"]\nurl = https://example.invalid/fixture.git\nfetch = +refs/heads/*:refs/remotes/origin/*\n',
  );
  for (const ref of ["refs/heads/main", "refs/remotes/origin/main"])
    write(path.join(commonDir, ref), commit + "\n");
  write(
    path.join(commonDir, "refs/remotes/origin/HEAD"),
    "ref: refs/remotes/origin/main\n",
  );
  write(path.join(commonDir, "HEAD"), "ref: refs/heads/main\n");
  write(path.join(gitDir, "HEAD"), commit + "\n");
  write(path.join(gitDir, "commondir"), "../..\n");
  write(path.join(gitDir, "gitdir"), path.join(root, ".git") + "\n");
  write(path.join(root, ".git"), `gitdir: ${gitDir}\n`);
  for (const workspace of [primary, root])
    write(
      path.join(workspace, "task.txt"),
      "private-prompt-1383 $(touch forbidden)",
    );
  return { directory, primary, root, gitDir, commonDir, write };
}
