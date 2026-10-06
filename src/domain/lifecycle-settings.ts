import fs from "node:fs";
import path from "node:path";
import { isRecord } from "../types.js";
import { parseJsonStrict, resolveContained } from "../lib/security.js";
import { writeFileAtomic, writeFileExclusivePinned } from "../lib/atomic.js";

export const MANAGED_RUNTIME = ".agent-skill-chain/managed-runtime";
export const AGENT_LIFECYCLE_COMMAND =
  'node "$CLAUDE_PROJECT_DIR/.claude/hooks/asc-agent-lifecycle.mjs"';
export const AGENT_LIFECYCLE_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "PostToolBatch",
];
const SETTINGS = ".claude/settings.local.json";
const ownedHook = (hook: unknown): hook is Record<string, unknown> =>
  isRecord(hook) &&
  hook.type === "command" &&
  hook.command === AGENT_LIFECYCLE_COMMAND;

/**
 * host observerのASC-owned entry（Issue #1566）。
 *
 * **shellを介さない形で登録する。** `args`があるとClaude Codeは`command`を
 * PATH上の実行fileとして直接起動し、`${CLAUDE_PROJECT_DIR}`を各要素へ置換する。
 * Windowsでも`.cmd`のshimを経由せず`node`を起動できる。
 */
export const HOST_OBSERVER_ARG =
  "${CLAUDE_PROJECT_DIR}/.claude/hooks/asc-host-observer.mjs";
const HOST_OBSERVER_EVENT = "PreToolUse";
const HOST_OBSERVER_MATCHER = "SendMessage";
const canonicalObserverHook = () => ({
  type: "command",
  command: "node",
  args: [HOST_OBSERVER_ARG],
  timeout: 10,
});

/**
 * 所有判定は完全一致だけで行う。`timeout`・matcher・追加fieldは所有を移さない。
 * path部分一致やwrapperの推測で利用者のhookを奪わない。
 */
const ownedObserverHook = (hook: unknown): hook is Record<string, unknown> =>
  isRecord(hook) &&
  hook.type === "command" &&
  hook.command === "node" &&
  Array.isArray(hook.args) &&
  hook.args.length === 1 &&
  hook.args[0] === HOST_OBSERVER_ARG;

function isCanonicalObserverGroup(entry: Record<string, unknown>): boolean {
  if (entry.matcher !== HOST_OBSERVER_MATCHER) return false;
  if (!Array.isArray(entry.hooks) || entry.hooks.length !== 1) return false;
  const [hook] = entry.hooks as unknown[];
  return (
    isRecord(hook) &&
    JSON.stringify(Object.keys(hook).sort()) ===
      JSON.stringify(["args", "command", "timeout", "type"]) &&
    ownedObserverHook(hook) &&
    hook.timeout === 10
  );
}

/**
 * 設定本文からhost observerの登録状態を返す純関数（Issue #1566）。
 *
 * **filesystemを読まない。** 読取は呼び出し側（doctor）が行う。返すのは観測であり、
 * `doctor`全体の`healthy`へは入れない。
 */
export function inspectHostObserverRegistration(settings: string | undefined): {
  registered: boolean;
  diagnostics: string[];
} {
  const unregistered = `host observerが${SETTINGS}の${HOST_OBSERVER_EVENT}（matcher ${HOST_OBSERVER_MATCHER}）に登録されていません。update --root=. --applyで登録できます`;
  if (settings === undefined)
    return { registered: false, diagnostics: [unregistered] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(settings);
  } catch {
    return {
      registered: false,
      diagnostics: [
        `${SETTINGS}をJSONとして解釈できないため、host observerの登録を確認できません`,
      ],
    };
  }
  const groups =
    isRecord(parsed) && isRecord(parsed.hooks)
      ? parsed.hooks[HOST_OBSERVER_EVENT]
      : undefined;
  const registered =
    Array.isArray(groups) &&
    groups.some(
      (entry: unknown) =>
        isRecord(entry) &&
        entry.matcher === HOST_OBSERVER_MATCHER &&
        Array.isArray(entry.hooks) &&
        entry.hooks.some(ownedObserverHook),
    );
  return registered
    ? { registered: true, diagnostics: [] }
    : { registered: false, diagnostics: [unregistered] };
}

function readSettings(target: string): {
  file: string;
  before: string | undefined;
} {
  // Shared configuration must never follow a symlink, even inside the project.
  let cursor = target;
  for (const segment of SETTINGS.split("/")) {
    cursor = path.join(cursor, segment);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink())
        throw new Error(`${SETTINGS}: symlinkを拒否しました`);
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    }
  }
  const file = resolveContained(target, SETTINGS, { allowMissingLeaf: true });
  try {
    if (!fs.lstatSync(file).isFile())
      throw new Error(`${SETTINGS}: 通常fileが必要です`);
    return { file, before: fs.readFileSync(file, "utf8") };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT")
      return { file, before: undefined };
    throw error;
  }
}

function isLegacyWorkflowCli(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const syntax = path.posix.isAbsolute(value) ? path.posix : path.win32;
  if (!syntax.isAbsolute(value)) return false;
  const segments = syntax.normalize(value).split(syntax.sep).slice(-5);
  return (
    segments.length === 5 &&
    segments[0] === "agent-skill-chain" &&
    /^v\d+\.\d+\.\d+$/u.test(segments[1]!) &&
    segments[2] === "dist" &&
    segments[3] === "bin" &&
    segments[4] === "agent-skill-chain.js"
  );
}

/** Reserved canonical command identifies ASC entries, never a path substring. */
export function planLifecycleSettings(
  target: string,
  operation: "install" | "delete",
  options: { preserveObserver?: boolean } = {},
) {
  const observed = readSettings(target);
  const parsed: unknown = parseJsonStrict(observed.before ?? "{}", SETTINGS);
  if (!isRecord(parsed)) throw new Error(`${SETTINGS}: JSON objectが必要です`);
  for (const key of ["env", "hooks"])
    if (parsed[key] !== undefined && !isRecord(parsed[key]))
      throw new Error(`${SETTINGS}: ${key}はobjectが必要です`);
  const hooks = isRecord(parsed.hooks) ? parsed.hooks : {};
  // Validate every entry and locate host observer hooks before any rewrite.
  const observers: Array<{ event: string; entry: Record<string, unknown> }> =
    [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries))
      throw new Error(`${SETTINGS}: hooks.${event}はarrayが必要です`);
    for (const entry of entries as unknown[]) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks))
        throw new Error(`${SETTINGS}: hooks.${event}のentryが不正です`);
      for (const hook of entry.hooks as unknown[])
        if (ownedObserverHook(hook)) observers.push({ event, entry });
    }
  }
  // Record recovery leaves observer registration exactly as observed: neither
  // added, removed nor converged. The next ordinary update registers it.
  const preserveObserver =
    operation === "install" && options.preserveObserver === true;
  // Convergence (a): exactly one owned observer hook already in canonical form.
  const keepObserver =
    preserveObserver ||
    (operation === "install" &&
      observers.length === 1 &&
      observers[0]!.event === HOST_OBSERVER_EVENT &&
      isCanonicalObserverGroup(observers[0]!.entry));
  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = (entries as Array<Record<string, unknown>>).flatMap(
      (entry) => {
        const current = entry.hooks as unknown[];
        // The exact canonical command is reserved in both directions. Matcher,
        // timeout and extra fields do not transfer ownership of that command.
        const remaining = current.filter(
          (hook: unknown) =>
            !ownedHook(hook) && (keepObserver || !ownedObserverHook(hook)),
        );
        if (remaining.length === current.length) return [entry];
        return remaining.length ? [{ ...entry, hooks: remaining }] : [];
      },
    );
    if ((hooks[event] as unknown[]).length === 0) delete hooks[event];
  }
  // Convergence (b): remove every owned copy, then append one canonical group.
  if (operation === "install" && !keepObserver)
    hooks[HOST_OBSERVER_EVENT] = [
      ...((hooks[HOST_OBSERVER_EVENT] as unknown[] | undefined) ?? []),
      { matcher: HOST_OBSERVER_MATCHER, hooks: [canonicalObserverHook()] },
    ];
  if (operation === "install") {
    // Retired observer: installation also removes old owned registrations.
    const environment = isRecord(parsed.env) ? parsed.env : {};
    if (environment.ASC_EXECUTION_CONTEXT_MODE === "short-lived")
      delete environment.ASC_EXECUTION_CONTEXT_MODE;
    const cli = environment.ASC_WORKFLOW_CLI;
    // Migrate the documented versioned installation only. Arbitrary development
    // or emergency overrides are intentional and remain visible to doctor.
    if (isLegacyWorkflowCli(cli)) delete environment.ASC_WORKFLOW_CLI;
    if (Object.keys(environment).length) parsed.env = environment;
    else delete parsed.env;
  }
  if (Object.keys(hooks).length) parsed.hooks = hooks;
  else delete parsed.hooks;
  const after = JSON.stringify(parsed, null, 2) + "\n";
  const changed =
    JSON.stringify(JSON.parse(observed.before ?? "{}")) !==
    JSON.stringify(parsed);
  return {
    target,
    ...observed,
    after,
    changed,
    report: {
      target: SETTINGS,
      operation,
      changed,
      ownership: "canonical-command-entry",
      restart: "new-session",
    },
  };
}

/** Called under the existing managed mutation lock, before record publication. */
export function applyLifecycleSettings(
  plan: ReturnType<typeof planLifecycleSettings>,
): void {
  if (!plan.changed) return;
  const current = readSettings(plan.target);
  if (current.before !== plan.before)
    throw new Error(
      `${SETTINGS}: 並行変更を検出しました。利用者設定を保持して中止します`,
    );
  fs.mkdirSync(path.dirname(plan.file), { recursive: true });
  if (plan.before === undefined)
    writeFileExclusivePinned(
      path.dirname(plan.file),
      path.basename(plan.file),
      plan.after,
      {},
      0o600,
    );
  else
    writeFileAtomic(plan.file, plan.after, {
      fileMode: fs.statSync(plan.file).mode & 0o777,
      beforePublish: () => {
        if (readSettings(plan.target).before !== plan.before)
          throw new Error(`${SETTINGS}: 公開直前の並行変更を検出しました`);
      },
    });
}
