import fs from "node:fs";
import path from "node:path";
const CONTROL = /[\p{Cc}\p{Cf}]/u;
export function safeSlug(title) {
    if (typeof title !== "string" || title.trim() === "")
        throw new Error("タイトルが必要です");
    const normalized = title.normalize("NFC").trim();
    if (CONTROL.test(normalized))
        throw new Error("タイトルに制御文字または書式文字が含まれています");
    if (path.isAbsolute(normalized) ||
        normalized.includes("/") ||
        normalized.includes("\\") ||
        normalized.includes("..")) {
        throw new Error("タイトルにパス構文を含めてはいけません");
    }
    const slug = normalized
        .replace(/\s+/gu, "-")
        .replace(/[^\p{L}\p{N}._-]/gu, "-")
        .replace(/-+/g, "-");
    if (!slug || slug === "." || slug === ".." || slug.length > 80)
        throw new Error("タイトルを安全で長さ制限内のslugへ変換できません");
    return slug;
}
export function resolveContained(root, candidate, options = {}) {
    if (!candidate || path.isAbsolute(candidate) || CONTROL.test(candidate))
        throw new Error("パスは安全な相対パスでなければなりません");
    const rootPath = path.resolve(root);
    const resolved = path.resolve(rootPath, candidate);
    const relative = path.relative(rootPath, resolved);
    if (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative))
        throw new Error("パストラバーサルを拒否しました");
    const realRoot = fs.realpathSync(rootPath);
    let existing = resolved;
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing)
            throw new Error("既存のパス境界がありません");
        existing = parent;
    }
    if (!options.allowMissingLeaf && existing !== resolved)
        throw new Error("パスが存在しません");
    const realExisting = fs.realpathSync(existing);
    const realRelative = path.relative(realRoot, realExisting);
    if (realRelative === ".." ||
        realRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(realRelative)) {
        throw new Error("シンボリックリンクによる境界外移動を拒否しました");
    }
    return resolved;
}
export function redactSecrets(input) {
    return String(input)
        .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
        .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
        .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_GITHUB_TOKEN]")
        .replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
        .replace(/\b(?:token|password|secret|api[_-]?key|apiKey|databaseUrl|connectionString|privateKey)\s*[=:]\s*[^\s,;]+/gi, "[REDACTED_SECRET]");
}
export function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
/** JSON parser that rejects duplicate object keys instead of applying last-key-wins semantics. */
export function parseJsonStrict(source, label = "JSON") {
    let index = 0;
    const fail = (message) => {
        throw new Error(`${label}: ${message} (offset ${index})`);
    };
    const whitespace = () => {
        while (/\s/u.test(source[index] ?? ""))
            index += 1;
    };
    const string = () => {
        if (source[index] !== '"')
            fail("文字列が必要です");
        const start = index++;
        let escaped = false;
        while (index < source.length) {
            const character = source[index++];
            if (!escaped && character === '"')
                return JSON.parse(source.slice(start, index));
            if (!escaped && character === "\\")
                escaped = true;
            else
                escaped = false;
        }
        return fail("文字列が閉じていません");
    };
    const value = () => {
        whitespace();
        if (source[index] === "{") {
            index += 1;
            const object = {};
            const keys = new Set();
            whitespace();
            if (source[index] === "}") {
                index += 1;
                return object;
            }
            while (index < source.length) {
                whitespace();
                const key = string();
                if (keys.has(key))
                    fail(`重複keyを拒否しました: ${key}`);
                keys.add(key);
                whitespace();
                if (source[index++] !== ":")
                    fail("colonが必要です");
                object[key] = value();
                whitespace();
                const separator = source[index++];
                if (separator === "}")
                    return object;
                if (separator !== ",")
                    fail("commaまたはobject終端が必要です");
            }
            fail("objectが閉じていません");
        }
        if (source[index] === "[") {
            index += 1;
            const array = [];
            whitespace();
            if (source[index] === "]") {
                index += 1;
                return array;
            }
            while (index < source.length) {
                array.push(value());
                whitespace();
                const separator = source[index++];
                if (separator === "]")
                    return array;
                if (separator !== ",")
                    fail("commaまたはarray終端が必要です");
            }
            fail("arrayが閉じていません");
        }
        if (source[index] === '"')
            return string();
        const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(source.slice(index))?.[0];
        if (token === undefined)
            return fail("値が不正です");
        index += token.length;
        return JSON.parse(token);
    };
    const parsed = value();
    whitespace();
    if (index !== source.length)
        fail("末尾に余分な入力があります");
    return parsed;
}
//# sourceMappingURL=security.js.map