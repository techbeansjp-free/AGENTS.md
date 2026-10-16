import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findPackageRoot(moduleUrl: string): string {
  let current = path.dirname(fileURLToPath(moduleUrl));
  while (true) {
    const metadata = path.join(current, "package.json");
    if (fs.existsSync(metadata)) return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error("agent-skill-chain package rootを解決できません");
    current = parent;
  }
}
