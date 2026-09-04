import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
export const TYPESCRIPT_VENDOR = Object.freeze({
    version: "5.9.3",
    assets: Object.freeze([
        Object.freeze({
            source: "node_modules/typescript/lib/typescript.js",
            destination: "dist/vendor/typescript.cjs",
            sha256: "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675",
        }),
        Object.freeze({
            source: "node_modules/typescript/LICENSE.txt",
            destination: "dist/vendor/typescript/LICENSE.txt",
            sha256: "a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47",
        }),
        Object.freeze({
            source: "node_modules/typescript/ThirdPartyNoticeText.txt",
            destination: "dist/vendor/typescript/ThirdPartyNoticeText.txt",
            sha256: "1af3c68039c57e539422da82a4faada506ce6d0ea6f90e0b699d02dbcdb7a90c",
        }),
    ]),
});
const requireFromModule = createRequire(import.meta.url);
let cachedTypeScript;
export function sha256File(file) {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
}
export function installVerifiedTypeScriptVendorAssets(root) {
    const packageMetadata = JSON.parse(fs.readFileSync(path.resolve(root, "node_modules/typescript/package.json"), "utf8"));
    if (packageMetadata.version !== TYPESCRIPT_VENDOR.version)
        throw new Error("固定TypeScript compilerのversionが一致しません");
    for (const asset of TYPESCRIPT_VENDOR.assets) {
        const source = path.resolve(root, asset.source);
        const destination = path.resolve(root, asset.destination);
        if (!fs.existsSync(source) || sha256File(source) !== asset.sha256)
            throw new Error(`固定TypeScript compiler資産のSHA-256が一致しません: ${asset.source}`);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
        if (sha256File(destination) !== asset.sha256)
            throw new Error(`固定TypeScript compiler資産のcopy後SHA-256が一致しません: ${asset.destination}`);
    }
}
function verifiedCompilerPath() {
    const bundled = path.resolve(import.meta.dirname, "..", "..", "vendor", "typescript.cjs");
    let compiler = bundled;
    if (!fs.existsSync(compiler))
        try {
            compiler = requireFromModule.resolve("typescript");
        }
        catch (error) {
            throw new Error("固定TypeScript compiler runtimeが見つかりません", {
                cause: error,
            });
        }
    const expected = TYPESCRIPT_VENDOR.assets[0].sha256;
    if (sha256File(compiler) !== expected)
        throw new Error("固定TypeScript compiler runtimeのSHA-256が一致しません");
    return compiler;
}
export function loadTypeScriptCompiler() {
    if (cachedTypeScript !== undefined)
        return cachedTypeScript;
    const compiler = requireFromModule(verifiedCompilerPath());
    if (compiler.version !== TYPESCRIPT_VENDOR.version)
        throw new Error("固定TypeScript compiler runtimeのversionが一致しません");
    cachedTypeScript = compiler;
    return compiler;
}
//# sourceMappingURL=typescript-vendor.js.map