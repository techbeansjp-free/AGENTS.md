export function field(path, type, options = {}) {
    return Object.freeze({
        path,
        required: options.required ?? true,
        type,
        ...(options.values ? { values: Object.freeze([...options.values]) } : {}),
    });
}
/**
 * `parent`直下の項目名を必須・任意に分けて返す。`parent`は最上位なら空文字、
 * 配列要素なら`a[]`。検証はこの結果だけを受理集合に使い、`--help`と同じ定義を読む（INV-02）。
 */
export function childFields(specs, parent) {
    const prefix = parent === "" ? "" : `${parent}.`;
    const children = specs
        .filter(({ path }) => path.startsWith(prefix))
        .map((spec) => ({ ...spec, name: spec.path.slice(prefix.length) }))
        .filter(({ name }) => !/[.[]/u.test(name));
    if (children.length === 0)
        throw new Error(`入力契約に${parent || "最上位"}の項目がありません`);
    return Object.freeze({
        required: Object.freeze(children.filter(({ required }) => required).map(({ name }) => name)),
        optional: Object.freeze(children.filter(({ required }) => !required).map(({ name }) => name)),
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