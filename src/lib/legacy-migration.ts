import fs from 'node:fs';
import path from 'node:path';
import { readSettings } from './claude-settings.js';

/**
 * ゼロベース再設計（Issue #157〜#188, PR #191）以前に存在した旧世代パス。
 * 現行パッケージには存在しない（`ROOT_LEVEL_ENTRIES`/`NAMESPACED_ENTRIES` いずれにも含まれない）
 * ため、`upgrade` は検知しても同期対象にはしない。Issue #352: サイレントに残留させないための検知専用定数。
 */
export const LEGACY_SOURCE_DIR = path.join('.agent-skill-chain', 'source');
export const LEGACY_HOOK_FILE = path.join('.claude', 'hooks', 'PreToolUse.sh');

/** 現行方式のhook配線先（`enforce on` が書き込む相対パス）。`enforce.ts` の `HOOK_RELATIVE_PATH` と同じ値。 */
const CURRENT_HOOK_RELATIVE_PATH = path.join('.agent-skill-chain', 'hooks', 'claude-pretooluse.sh');

export type LegacyAssetKind = 'source-dir' | 'standalone-hook-file' | 'stale-settings-reference';

export interface LegacyAssetFinding {
  kind: LegacyAssetKind;
  relativePath: string;
  message: string;
}

/**
 * 再設計以前の旧世代アセットを検知する（Issue #352）。
 * - `LEGACY_SOURCE_DIR`（`.agent-skill-chain/` 配下の旧`source`ディレクトリ）: 旧`boot/CORE.md`等一式が残留したディレクトリ。
 * - `.claude/hooks/PreToolUse.sh`: 単体ファイルとして配布されていた旧hook本体。
 * - `.claude/settings.json` の `hooks.PreToolUse`: `.claude/hooks/` 配下を指す旧エントリ
 *   （現行方式は `.agent-skill-chain/hooks/claude-pretooluse.sh` を指す）。
 * 検知のみを行い、削除・変更は一切行わない（非破壊）。
 */
export function detectLegacyAssets(targetDir: string): LegacyAssetFinding[] {
  const findings: LegacyAssetFinding[] = [];

  if (fs.existsSync(path.join(targetDir, LEGACY_SOURCE_DIR))) {
    findings.push({
      kind: 'source-dir',
      relativePath: LEGACY_SOURCE_DIR,
      message: `${LEGACY_SOURCE_DIR}/ は再設計以前の旧世代アセットディレクトリです。現行パッケージには存在せず、upgradeの同期対象外です。`,
    });
  }

  if (fs.existsSync(path.join(targetDir, LEGACY_HOOK_FILE)) && !fs.lstatSync(path.join(targetDir, LEGACY_HOOK_FILE)).isDirectory()) {
    findings.push({
      kind: 'standalone-hook-file',
      relativePath: LEGACY_HOOK_FILE,
      message: `${LEGACY_HOOK_FILE} は単体ファイルとして配布されていた旧世代のPreToolUse hookです。現行方式は ${CURRENT_HOOK_RELATIVE_PATH} を 'agent-skill-chain enforce on' で配線します。`,
    });
  }

  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  try {
    const settings = readSettings(settingsPath);
    const preToolUse = settings.hooks?.PreToolUse ?? [];
    const staleCommands = new Set<string>();
    for (const entry of preToolUse) {
      for (const hook of entry.hooks ?? []) {
        const command = hook.command;
        if (typeof command !== 'string') continue;
        const normalized = command.replace(/\\/g, '/');
        const isCurrent = normalized.includes(CURRENT_HOOK_RELATIVE_PATH.replace(/\\/g, '/'));
        const looksLegacy = normalized.includes('.claude/hooks/') || /PreToolUse\.sh$/.test(normalized);
        if (!isCurrent && looksLegacy) {
          staleCommands.add(command);
        }
      }
    }
    for (const command of staleCommands) {
      findings.push({
        kind: 'stale-settings-reference',
        relativePath: path.join('.claude', 'settings.json'),
        message: `.claude/settings.json の hooks.PreToolUse に旧hookパスへの参照が残っています: ${command}`,
      });
    }
  } catch {
    // settings.json自体の解析エラーはupgradeの本責務外（enforce等が別途エラーとして扱う）。ここでは無視する。
  }

  return findings;
}

/** 検知結果を、移行手順を含む日本語警告文へ整形する。findingsが空なら空文字列を返す。 */
export function formatLegacyAssetWarning(findings: LegacyAssetFinding[]): string {
  if (findings.length === 0) return '';
  const lines = [
    '警告: 再設計以前の旧世代アセットが検知されました。サイレントに残留させず、以下に明示します。',
    ...findings.map((f) => `  - ${f.message}`),
    '推奨される移行手順:',
    `  1. ${LEGACY_SOURCE_DIR}/ の内容を確認し、現行方式（AGENTS.md/.agent-skill-chain/config/ 駆動）で不要であれば削除する。`,
    `  2. ${LEGACY_HOOK_FILE} の内容を確認し、現行hookへ移行済みであれば削除する。`,
    "  3. .claude/settings.json の hooks.PreToolUse から旧hookエントリ（.claude/hooks/ 配下を指すもの）を除去し、'agent-skill-chain enforce on' を実行して新hook（.agent-skill-chain/hooks/claude-pretooluse.sh）へ配線し直す。",
    '  旧hookと新hookが同時配線されたままだと、両方が実行され矛盾した拒否判定が発生するおそれがあります。',
  ];
  return lines.join('\n');
}
