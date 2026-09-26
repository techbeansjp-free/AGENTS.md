/** 診断表示用の1行要約。値そのもの（secret等）は含めない。 */
export function describeLocalConfigResolution(resolution) {
    if (resolution.state === "absent")
        return "absent（設定fileなし）";
    if (resolution.state === "enabled")
        return `enabled（source=${resolution.source}）`;
    if (resolution.state === "disabled")
        return `disabled（source=${resolution.source}）`;
    return `invalid（source=${resolution.source}: ${resolution.reason}）`;
}
//# sourceMappingURL=local-config-resolution.js.map