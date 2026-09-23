import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileNoReplace } from "../lib/atomic.js";
import { resolveContained, stableJson } from "../lib/security.js";
/** Publishes an immutable generated artifact after rechecking containment. */
export function writeLayaArtifact(root, relative, value) {
    const initial = resolveContained(root, relative, { allowMissingLeaf: true });
    fs.mkdirSync(path.dirname(initial), { recursive: true, mode: 0o700 });
    const destination = resolveContained(root, relative, {
        allowMissingLeaf: true,
    });
    if (destination !== initial)
        throw new Error("artifact pathがdirectory作成中に変更されました");
    const body = `${stableJson(value)}\n`;
    writeFileNoReplace(destination, body);
    return {
        path: relative,
        sha256: crypto.createHash("sha256").update(body).digest("hex"),
        bytes: Buffer.byteLength(body),
    };
}
//# sourceMappingURL=laya-artifact-store.js.map