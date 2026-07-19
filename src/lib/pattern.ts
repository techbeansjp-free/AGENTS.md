export function expandPattern(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`pattern に必要な変数が指定されていません: {${key}}`);
    }
    return vars[key];
  });
}
