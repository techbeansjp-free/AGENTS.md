import fs from 'node:fs';
import path from 'node:path';

export interface PreToolUseHookCommand {
  type: string;
  command: string;
}

export interface PreToolUseEntry {
  matcher?: string;
  hooks: PreToolUseHookCommand[];
}

export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: PreToolUseEntry[];
    [otherHookEvent: string]: unknown;
  };
  [otherField: string]: unknown;
}

/**
 * `.claude/settings.json` を読み取る。ファイル不在なら空オブジェクトとして扱う。
 * JSON解析に失敗した場合は例外を投げる（呼び出し側はファイルを変更せずエラー終了する）。
 */
export function readSettings(filePath: string): ClaudeSettings {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(text) as ClaudeSettings;
  } catch (error) {
    throw new Error(
      `.claude/settings.json の解析に失敗しました（${filePath}）: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeSettings(filePath: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * hooks.PreToolUse配列へ、同一commandPathのエントリが無ければ追加する（idempotent）。
 * 他のhooksイベント・他のトップレベルフィールドは変更しない。
 */
export function addPreToolUseHook(settings: ClaudeSettings, commandPath: string): ClaudeSettings {
  const hooks = { ...(settings.hooks ?? {}) };
  const preToolUse: PreToolUseEntry[] = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
  const alreadyWired = preToolUse.some((entry) => entry.hooks?.some((h) => h.command === commandPath));
  if (!alreadyWired) {
    preToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: commandPath }] });
  }
  return { ...settings, hooks: { ...hooks, PreToolUse: preToolUse } };
}

/**
 * hooks.PreToolUse配列から、該当commandPathのエントリのみを除去する（他エントリは温存）。
 * 除去後にPreToolUseが空になれば当該キーを削除し、hooksも空になれば削除する（idempotentなoff）。
 */
export function removePreToolUseHook(settings: ClaudeSettings, commandPath: string): ClaudeSettings {
  if (!settings.hooks?.PreToolUse) return settings;
  const hooks = { ...settings.hooks };
  const preToolUse = (hooks.PreToolUse ?? [])
    .map((entry) => ({ ...entry, hooks: entry.hooks.filter((h) => h.command !== commandPath) }))
    .filter((entry) => entry.hooks.length > 0);

  if (preToolUse.length > 0) {
    hooks.PreToolUse = preToolUse;
  } else {
    delete hooks.PreToolUse;
  }

  const next: ClaudeSettings = { ...settings };
  if (Object.keys(hooks).length > 0) {
    next.hooks = hooks;
  } else {
    delete next.hooks;
  }
  return next;
}

/** 指定commandPathが現在配線済みかどうか（doctor拡張用の情報表示に使う）。 */
export function isPreToolUseHookWired(settings: ClaudeSettings, commandPath: string): boolean {
  return !!settings.hooks?.PreToolUse?.some((entry) => entry.hooks?.some((h) => h.command === commandPath));
}
