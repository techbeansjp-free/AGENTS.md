export function field(path, type, options = {}) {
    return Object.freeze({
        path,
        required: options.required ?? true,
        type,
        ...(options.values ? { values: Object.freeze([...options.values]) } : {}),
    });
}
/** enum違反の診断へ添える受理値の表記。 */
export function acceptedValues(values) {
    return `（受理値: ${values.join("|")}）`;
}
/**
 * 同じobjectの未知fieldと欠落fieldを1件の診断へまとめる。どちらも無ければundefined。
 * 利用者が1回の修正で両方を直せるようにする。
 */
export function unknownAndMissingError(label, unknown, missing) {
    const parts = [];
    if (unknown.length > 0)
        parts.push(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
    if (missing.length > 0)
        parts.push(`${label}の必須fieldがありません: ${missing.join(", ")}`);
    return parts.length > 0 ? parts.join("。") : undefined;
}
//# sourceMappingURL=input-contract.js.map