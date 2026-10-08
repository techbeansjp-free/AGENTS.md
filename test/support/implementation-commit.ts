import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * **Step 9記録前に実装commitを1件作る**（Issue #1566 OWN-03）。
 *
 * Step 9は計画の基点（`refs/remotes/origin/HEAD`）から1件以上の実装commitを含む
 * HEADだけを記録する。実利用ではStep 9の前に実装をcommitするため、fixtureも同じ
 * 形にする。既に基点より先のcommitがあれば何もしない。
 */
export function ensureImplementationCommit(root: string): string {
  const ahead = Number(
    execFileSync(
      "git",
      ["rev-list", "--count", "refs/remotes/origin/HEAD..HEAD"],
      {
        cwd: root,
        encoding: "utf8",
      },
    ).trim(),
  );
  if (ahead === 0) {
    const file = "implementation-fixture.txt";
    fs.writeFileSync(path.join(root, file), "implementation\n");
    execFileSync("git", ["add", "--", file], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "implementation fixture"], {
      cwd: root,
    });
  }
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}
