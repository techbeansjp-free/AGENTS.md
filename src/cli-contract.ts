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

export interface RoutingRecovery {
  authority: string;
  next: string;
  resume: string;
}

export function routingRecovery(ruleId: string): RoutingRecovery {
  switch (ruleId) {
    case "FR-836-02":
      return {
        authority: "provider operator",
        next: "provider実行入口（Codex）を復旧し、同じscopeでrouting resolveを再実行してください",
        resume:
          "provider実行入口（Codex）のread-only観測がavailableになった時点",
      };
    case "FR-836-10":
      return {
        authority: "mapping owner",
        next: "公式推奨を使うselectionSourceへtrusted mappingを更新し、同じscopeで再実行してください",
        resume: "mapping ownerが版付きselectionSourceを更新した時点",
      };
    case "FR-836-04":
      return {
        authority: "mapping owner",
        next: "providerのcoding能力宣言をtrusted mappingで確認し、同じscopeで再実行してください",
        resume: "mapping ownerがprovider能力を確認した時点",
      };
    case "BR-836-09":
      return {
        authority: "provider operator",
        next: "公式recommended defaultが一意になったことを再観測して再実行してください",
        resume: "provider観測が一意なrecommended defaultを返した時点",
      };
    case "FR-836-05":
      return {
        authority: "project owner",
        next: "project choiceのmodelMappingを許可値で設定して再実行してください",
        resume: "project ownerがmodelMappingを設定した時点",
      };
    case "FR-836-12":
      return {
        authority: "repository maintainer",
        next: "trusted evaluator refを確定して再実行してください",
        resume: "trusted evaluator refを検証できた時点",
      };
    default:
      return {
        authority: "coordinator",
        next: "scopeと独立したrole identityを確定して再実行してください",
        resume: "role assignmentを安全に解決できた時点",
      };
  }
}

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
