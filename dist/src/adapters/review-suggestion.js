import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { git } from "../lib/process.js";
import { resolveVerifiedTypeScriptCompilerPath } from "../lib/typescript-vendor.js";
export const MAX_SUGGESTION_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_VERIFICATION_MS = 5000;
const MAX_GIT_MS = 2000;
const SOURCE_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json)$/u;
function isSafeSourcePath(file) {
    return (SOURCE_PATH.test(file) &&
        !file.split("/").some((part) => part === ".." || part === "."));
}
/** Parse only a single, ordinary unified file patch. Git still validates hunk grammar. */
function isSingleFilePatch(patch, file) {
    if (patch.includes("\0") || patch.includes("\r"))
        return false;
    const lines = patch.split("\n");
    if (lines.at(-1) !== "")
        return false;
    lines.pop();
    let index = 0;
    if (lines[index]?.startsWith("diff --git ")) {
        if (lines[index] !== `diff --git a/${file} b/${file}`)
            return false;
        index++;
    }
    if (lines[index]?.startsWith("index ")) {
        if (!/^index [0-9a-f]+\.\.[0-9a-f]+(?: 100644| 100755)?$/u.test(lines[index]))
            return false;
        index++;
    }
    if (lines[index++] !== `--- a/${file}` || lines[index++] !== `+++ b/${file}`)
        return false;
    let hunks = 0;
    for (; index < lines.length; index++) {
        const line = lines[index];
        if (line.startsWith("--- ") || line.startsWith("+++ "))
            return false;
        if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: .*)?$/u.test(line)) {
            hunks++;
            continue;
        }
        if (hunks === 0 || !/^(?:[ +-]|\\ No newline at end of file)/u.test(line))
            return false;
    }
    return hunks > 0;
}
function hasNoWorktreeSymlink(root, file) {
    let current = root;
    for (const part of file.split("/")) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink())
            return false;
    }
    return fs.statSync(current).isFile();
}
const SYNTAX_VALIDATOR = String.raw `
const fs = require("node:fs");
const ts = require(process.argv[1]);
const file = process.argv[2];
const source = fs.readFileSync(0, "utf8");
const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX
  : file.endsWith(".jsx") ? ts.ScriptKind.JSX
  : /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
let valid = Array.isArray(parsed.parseDiagnostics) && parsed.parseDiagnostics.length === 0;
if (valid && /\.(?:js|jsx|mjs|cjs)$/.test(file)) {
  const diagnostics = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { allowJs: true, checkJs: true, jsx: ts.JsxEmit.Preserve },
  }).diagnostics;
  valid = Array.isArray(diagnostics) && diagnostics.length === 0;
  if (valid && !file.endsWith(".jsx")) {
    let jsx = false;
    const walk = (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) jsx = true;
      if (!jsx) ts.forEachChild(node, walk);
    };
    walk(parsed);
    valid = !jsx;
  }
}
process.stdout.write(valid ? "valid" : "invalid");
`;
export function validateReviewSuggestionSyntax(file, source, timeoutMs) {
    if (file.endsWith(".json")) {
        JSON.parse(source);
        return true;
    }
    if (timeoutMs < 1)
        return false;
    const checked = spawnSync(process.execPath, ["-e", SYNTAX_VALIDATOR, resolveVerifiedTypeScriptCompilerPath(), file], {
        input: source,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 1024,
    });
    return !checked.error && checked.status === 0 && checked.stdout === "valid";
}
/** Validate an untrusted patch against the committed blob without changing the repository. */
export function verifyReviewSuggestion(input) {
    if (!/^[0-9a-f]{40}$/u.test(input.headSha) ||
        !isSafeSourcePath(input.file) ||
        Buffer.byteLength(input.patch, "utf8") > MAX_SUGGESTION_BYTES ||
        !isSingleFilePatch(input.patch, input.file))
        return undefined;
    const deadline = Date.now() +
        Math.min(Math.max(input.timeoutMs ?? MAX_VERIFICATION_MS, 0), MAX_VERIFICATION_MS);
    let temporary;
    let accepted;
    const remaining = () => Math.min(MAX_GIT_MS, Math.max(0, deadline - Date.now()));
    const checkedGit = (args) => {
        const timeoutMs = remaining();
        if (timeoutMs < 1)
            return undefined;
        const result = git(args, input.root, {
            allowFailure: true,
            timeoutMs,
            maxBufferBytes: MAX_SOURCE_BYTES,
        });
        return result.status === 0 ? result.stdout : undefined;
    };
    try {
        const validate = () => {
            if (checkedGit(["rev-parse", "HEAD"])?.trim() !== input.headSha)
                return undefined;
            if (!hasNoWorktreeSymlink(input.root, input.file))
                return undefined;
            const entry = checkedGit(["ls-tree", input.headSha, "--", input.file]);
            const [metadata, entryPath, extra] = entry?.split("\t") ?? [];
            if (!metadata ||
                !/^100(?:644|755) blob [0-9a-f]{40}$/u.test(metadata) ||
                entryPath !== `${input.file}\n` ||
                extra !== undefined)
                return undefined;
            const timeoutMs = remaining();
            if (timeoutMs < 1)
                return undefined;
            const blob = spawnSync("git", ["cat-file", "blob", `${input.headSha}:${input.file}`], {
                cwd: input.root,
                timeout: timeoutMs,
                maxBuffer: MAX_SOURCE_BYTES + 1,
            });
            const originalBytes = blob.stdout;
            if (blob.error ||
                blob.status !== 0 ||
                !Buffer.isBuffer(originalBytes) ||
                originalBytes.length > MAX_SOURCE_BYTES)
                return undefined;
            const original = originalBytes.toString("utf8");
            if (!Buffer.from(original, "utf8").equals(originalBytes))
                return undefined;
            temporary = fs.mkdtempSync(path.join(os.tmpdir(), "asc-suggestion-"));
            const copied = path.join(temporary, input.file);
            fs.mkdirSync(path.dirname(copied), { recursive: true });
            fs.writeFileSync(copied, originalBytes, { flag: "wx", mode: 0o600 });
            for (const args of [
                ["apply", "--check", "--whitespace=nowarn", "-"],
                ["apply", "--whitespace=nowarn", "-"],
            ]) {
                const timeoutMs = remaining();
                if (timeoutMs < 1)
                    return undefined;
                const applied = spawnSync("git", args, {
                    cwd: temporary,
                    input: input.patch,
                    encoding: "utf8",
                    timeout: timeoutMs,
                    maxBuffer: MAX_SUGGESTION_BYTES,
                });
                if (applied.error || applied.status !== 0)
                    return undefined;
            }
            const after = fs.readFileSync(copied, "utf8");
            const syntaxTimeoutMs = remaining();
            if (after === original ||
                syntaxTimeoutMs < 1 ||
                !validateReviewSuggestionSyntax(input.file, after, syntaxTimeoutMs))
                return undefined;
            if (Date.now() >= deadline)
                return undefined;
            if (checkedGit(["rev-parse", "HEAD"])?.trim() !== input.headSha)
                return undefined;
            return { headSha: input.headSha, patch: input.patch };
        };
        accepted = validate();
    }
    catch {
        accepted = undefined;
    }
    finally {
        if (temporary) {
            try {
                fs.rmSync(temporary, { recursive: true, force: true });
            }
            catch {
                // Never publish a suggestion if its temporary copy could remain.
                accepted = undefined;
            }
        }
    }
    return accepted;
}
//# sourceMappingURL=review-suggestion.js.map