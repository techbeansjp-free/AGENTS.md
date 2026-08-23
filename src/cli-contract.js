export const PUBLIC_LIFECYCLE_COMMANDS = Object.freeze(['install', 'update', 'delete', 'doctor']);

/** @type {Readonly<Record<string, string>>} */
export const LEGACY_LIFECYCLE_ALIASES = Object.freeze({
  init: 'install',
  upgrade: 'update',
  uninstall: 'delete',
});

/** @param {string} command */
export function canonicalLifecycleCommand(command) {
  return LEGACY_LIFECYCLE_ALIASES[command] ?? command;
}

export const CLI_USAGE = 'npx agent-skill-chain <issue|project|spec|review|trace|conformance|policy|worktree|pr|install|update|delete|doctor> ...';
