import type { Diagnostic } from "./types.js";

export const PUBLIC_LIFECYCLE_COMMANDS = Object.freeze([
  "install",
  "update",
  "delete",
  "doctor",
] as const);

export const LEGACY_LIFECYCLE_ALIASES: Readonly<Record<string, string>> =
  Object.freeze({
    init: "install",
    upgrade: "update",
    uninstall: "delete",
  });

export function canonicalLifecycleCommand(command: string): string {
  return LEGACY_LIFECYCLE_ALIASES[command] ?? command;
}

export const CLI_USAGE =
  "npx agent-skill-chain <issue|project|spec|review|trace|conformance|policy|routing|worktree|pr|install|update|delete|doctor> ...";

export function routingDiagnostic(
  ruleId: string,
  reason: string,
  options: {
    purpose?: string;
    risk?: string;
    next?: string;
    requiredAuthority?: string;
    rollback?: string;
  } = {},
): Diagnostic {
  return {
    ruleId,
    purpose: options.purpose ?? "provider routingを安全側に解決する",
    risk: options.risk ?? "routing",
    reasons: [reason],
    scope: ["routing"],
    checks: ["role、provider、model、authority、evidence入力を検証した"],
    autoFixes: [],
    next:
      options.next ??
      "入力とtrusted mappingを確認し、停止点からroutingを再実行してください",
    requiredAuthority: options.requiredAuthority ?? "mapping owner",
    rollback:
      options.rollback ?? "実装を開始せず、既存のscopeとworktreeを保持する",
  };
}
