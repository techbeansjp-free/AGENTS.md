/** Only reject empty, control-character, and oversized transport input.
 * Ollama decides whether a model name or tag is valid and available.
 */
export function isValidLocalLlmModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    value.trim() !== "" &&
    !/\p{Cc}/u.test(value)
  );
}
