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
  "npx agent-skill-chain <issue|project|spec|review|trace|conformance|policy|worktree|pr|install|update|delete|doctor> ...";
