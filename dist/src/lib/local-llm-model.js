/** Only reject empty, control-character, and oversized transport input.
 * Ollama decides whether a model name or tag is valid and available.
 */
export function isValidLocalLlmModel(value) {
    return (typeof value === "string" &&
        value.length <= 256 &&
        value.trim() !== "" &&
        !/\p{Cc}/u.test(value));
}
//# sourceMappingURL=local-llm-model.js.map