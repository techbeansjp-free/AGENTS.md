import fs from 'node:fs';
import path from 'node:path';
import { commandExists, run as exec, git } from '../lib/exec.js';
import { loadConfig } from '../lib/config.js';
import { repoRoot, resolveAsset } from '../lib/paths.js';
import { readInstalledVersion } from '../lib/version-marker.js';
import { readSettings, isPreToolUseHookWired } from '../lib/claude-settings.js';
import { HOOK_RELATIVE_PATH } from './enforce.js';
import { isHelp, printUsage, guard } from '../lib/cli-io.js';
import { listWorktrees, worktreePathRegex, branchNameRegex, hasUncommittedChanges } from '../lib/worktree.js';
import { computeTemplateSyncDiffs } from '../lib/template-sync.js';
import { readYamlFile, tryReadYamlFile } from '../lib/yaml-io.js';
import { leaseFilePath } from '../lib/local-state.js';
import type { WriterLease } from '../lib/github-lease.js';
import { collectAdrRecords, checkAdrSymmetry } from '../lib/adr-consistency.js';

const USAGE = `
使い方: agent-skill-chain doctor

引数なし。

出力:
  成功時: 終了コード0。検査項目ごとのOK/NGを標準出力へ。
  失敗時（必須依存が欠落）: 終了コード1以上。不足している依存を標準エラー出力へ。
`;

interface Check {
  label: string;
  ok: boolean;
  reason?: string;
}

const ADR_STATUS_ENUM = ['proposed', 'accepted', 'superseded', 'deprecated'];

/**
 * Issue #188 D5（AC-3）: docs/adr/ 配下の全ADR間で supersedes ⇔ superseded-by の対称性、
 * および status enum の妥当性を検査する。verify adr（単一ファイルの構造検査）を補う、
 * 複数ADR間の整合性検査。対称性検査自体は `lint adr check`（src/commands/lint.ts）と
 * 共通ロジック（src/lib/adr-consistency.ts）を再利用し、doctorではstatus enum妥当性を追加する。
 */
export function checkAdrConsistency(root: string): Check {
  const byId = collectAdrRecords(root);
  const errors = checkAdrSymmetry(byId);
  for (const [id, fm] of byId) {
    if (!ADR_STATUS_ENUM.includes(fm.status)) {
      errors.push(`${id}: 不正なstatusです: ${fm.status}`);
    }
  }
  return {
    label: 'ADR整合性',
    ok: errors.length === 0,
    reason: errors.length === 0 ? undefined : errors.join('; '),
  };
}

export async function run(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }

    const checks: Check[] = [];
    checks.push({ label: 'git', ok: commandExists('git') });

    let root: string | undefined;
    try {
      root = repoRoot();
      checks.push({ label: 'git repository', ok: true });
    } catch (error) {
      checks.push({ label: 'git repository', ok: false, reason: (error as Error).message });
    }

    if (root) {
      try {
        const config = loadConfig(root);
        checks.push({ label: '.agent-skill-chain/config/agent-skill-chain.yaml', ok: true });

        // Issue #174 AC-1: worktree一覧が worktree.path_pattern に適合するかを検査する。
        // `git worktree list --porcelain` の先頭は常に主worktree自身であり、Issue用worktreeの
        // 命名規則には決して適合しないため対象から外す（doctorがどのworktreeから実行されても
        // 正しく主worktreeを判定できるよう、cwd由来のrootとのパス比較ではなく先頭要素を除外する）。
        try {
          const regex = worktreePathRegex(config);
          const targets = listWorktrees(root)
            .slice(1)
            .map((w) => w.path);
          const bad = targets.filter((p) => !regex.test(path.basename(p)));
          checks.push({
            label: 'worktree命名規約',
            ok: bad.length === 0,
            reason: bad.length === 0 ? undefined : `${bad.join(', ')} は worktree.path_pattern に適合しません`,
          });
        } catch (error) {
          checks.push({ label: 'worktree命名規約', ok: false, reason: (error as Error).message });
        }

        // Issue #174 AC-3: .github/ が templates/github/.github/（配布元の正本）と同期しているかを検査する。
        try {
          const diffs = computeTemplateSyncDiffs(root);
          checks.push({
            label: 'template-sync',
            ok: diffs.length === 0,
            reason: diffs.length === 0 ? undefined : diffs.join('; '),
          });
        } catch (error) {
          checks.push({ label: 'template-sync', ok: false, reason: (error as Error).message });
        }

        if (config.coordination.backend === 'github') {
          const ghOk = commandExists('gh');
          checks.push({ label: 'gh CLI', ok: ghOk, reason: ghOk ? undefined : 'gh コマンドが見つかりません' });
          if (ghOk) {
            const auth = exec('gh', ['auth', 'status']);
            checks.push({
              label: 'gh auth status',
              ok: auth.status === 0,
              reason: auth.status === 0 ? undefined : auth.stderr.trim() || 'gh 未認証',
            });
          }
        }

        // Issue #188 D1（AC-3）: 各Issue用worktreeのcheckoutブランチがbranch.patternに適合するかを
        // 検査する（worktree命名規約はworktreeの"パス"、本検査はworktreeの"ブランチ名"を見る点で異なる）。
        try {
          const regex = branchNameRegex(config);
          const targets = listWorktrees(root).slice(1);
          const bad = targets.filter((w) => !w.branch || !regex.test(w.branch));
          checks.push({
            label: 'branch名規約',
            ok: bad.length === 0,
            reason:
              bad.length === 0
                ? undefined
                : `${bad.map((w) => `${w.path} (branch: ${w.branch ?? '不明'})`).join(', ')} は branch.pattern に適合しません`,
          });
        } catch (error) {
          checks.push({ label: 'branch名規約', ok: false, reason: (error as Error).message });
        }

        // Issue #188 D2（AC-3）: Durability Backend（durability.backend）への疎通を検査する。
        // remote は origin への ls-remote 到達性、local_mirror は origin が指すミラー先（ローカル
        // パス）の存在を見る（durability.backend自体に別途の宛先フィールドは無く、耐久性の実際の
        // push先である origin remote を対象にする。checkpoint.sh 等が常に origin へ push する実装と整合）。
        try {
          const originUrl = git(['remote', 'get-url', 'origin'], root);
          if (config.durability.backend === 'remote') {
            const reachable = originUrl.status === 0 && git(['ls-remote', 'origin'], root).status === 0;
            checks.push({
              label: 'Durability Backend疎通',
              ok: reachable,
              reason: reachable
                ? undefined
                : `origin（${originUrl.stdout.trim() || '未設定'}）への疎通に失敗しました`,
            });
          } else {
            const url = originUrl.stdout.trim();
            const isNetworkUrl = /^\w+:\/\//.test(url) || /^[\w.-]+@[\w.-]+:/.test(url);
            const mirrorExists = originUrl.status === 0 && url.length > 0 && !isNetworkUrl && fs.existsSync(url);
            checks.push({
              label: 'Durability Backend疎通',
              ok: mirrorExists,
              reason: mirrorExists
                ? undefined
                : `durability.backend=local_mirror のミラー先が見つかりません（origin: ${url || '未設定'}）`,
            });
          }
        } catch (error) {
          checks.push({ label: 'Durability Backend疎通', ok: false, reason: (error as Error).message });
        }

        // Issue #188 D3（AC-3）: local backend のみ対象。writer lease（issues/<id>/.../lease.yaml）の
        // expires_at が失効済みのまま残っていないかを検査する（github backendのgit-ref leaseは対象外。
        // reconcile.sh が本来回収すべき状態が沈黙で放置されていないかを見る）。
        if (config.coordination.backend === 'local') {
          try {
            const issuesRoot = path.join(root, 'issues');
            const stale: string[] = [];
            if (fs.existsSync(issuesRoot)) {
              const now = new Date().toISOString();
              for (const entry of fs.readdirSync(issuesRoot, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const lease = tryReadYamlFile<WriterLease>(leaseFilePath(root, entry.name));
                if (lease && lease.writer_lease.expires_at <= now) {
                  stale.push(`ISSUE-${entry.name} (holder=${lease.writer_lease.holder}, expires_at=${lease.writer_lease.expires_at})`);
                }
              }
            }
            checks.push({
              label: 'writer lease失効',
              ok: stale.length === 0,
              reason: stale.length === 0 ? undefined : `失効済みのwriter leaseが残っています（reconcileが必要です）: ${stale.join(', ')}`,
            });
          } catch (error) {
            checks.push({ label: 'writer lease失効', ok: false, reason: (error as Error).message });
          }
        }
      } catch (error) {
        checks.push({ label: '.agent-skill-chain/config/agent-skill-chain.yaml', ok: false, reason: (error as Error).message });
      }

      // Issue #174 AC-2: main worktree（repoRootが指すworktree）に未commit差分が無いかを検査する。
      // config読込の成否に依存しないため、上記try/catchの外側で独立して実行する。
      try {
        const entries = listWorktrees(root);
        const mainPath = entries[0]?.path;
        if (!mainPath) throw new Error('git worktree list --porcelain の結果が空です');
        const clean = !hasUncommittedChanges(mainPath);
        checks.push({
          label: 'main worktreeのclean状態',
          ok: clean,
          reason: clean ? undefined : `未commitの変更があります: ${mainPath}`,
        });
      } catch (error) {
        checks.push({ label: 'main worktreeのclean状態', ok: false, reason: (error as Error).message });
      }

      // Issue #174 AC-4: .agent-skill-chain/schemas/*.yaml がYAML構文として妥当かを検査する
      // （JSON Schemaとしての意味的妥当性ではなく、YAML構文としてのparse可否のみを見る）。
      // config読込に依存しないため、config読込失敗時も独立して実行する。
      try {
        const schemasDir = resolveAsset('schemas', root);
        const files = fs.readdirSync(schemasDir).filter((f) => f.endsWith('.yaml'));
        const errors: string[] = [];
        for (const file of files) {
          try {
            readYamlFile(path.join(schemasDir, file));
          } catch (error) {
            errors.push(`${file}: ${(error as Error).message}`);
          }
        }
        checks.push({
          label: 'schemas構文妥当性',
          ok: errors.length === 0,
          reason: errors.length === 0 ? undefined : errors.join('; '),
        });
      } catch (error) {
        checks.push({ label: 'schemas構文妥当性', ok: false, reason: (error as Error).message });
      }

      // Issue #188 D4（AC-3）: 各Issue用worktreeのSPEC.md内でAC-IDが重複していないかを検査する
      // （system-spec安定IDの一貫性はsystem-spec未構築のため対象外。SPEC.md内のAC-ID重複のみを見る
      // 軽量版。config読込に依存しないため独立して実行する）。
      try {
        const worktreeEntries = listWorktrees(root).slice(1);
        const findings: string[] = [];
        for (const entry of worktreeEntries) {
          const specPath = path.join(entry.path, 'SPEC.md');
          if (!fs.existsSync(specPath)) continue;
          const text = fs.readFileSync(specPath, 'utf8');
          const ids = [...text.matchAll(/\bAC-[0-9]+\b/g)].map((m) => m[0]);
          const seen = new Set<string>();
          const dups = new Set<string>();
          for (const id of ids) {
            if (seen.has(id)) dups.add(id);
            seen.add(id);
          }
          if (dups.size > 0) findings.push(`${specPath}: ${[...dups].join(', ')}`);
        }
        checks.push({
          label: 'AC-ID重複',
          ok: findings.length === 0,
          reason: findings.length === 0 ? undefined : `SPEC.md内でAC-IDが重複しています: ${findings.join('; ')}`,
        });
      } catch (error) {
        checks.push({ label: 'AC-ID重複', ok: false, reason: (error as Error).message });
      }

      // Issue #188 D5（AC-3）: docs/adr/ 配下の全ADR間で supersedes ⇔ superseded-by の対称性、
      // および status enum の妥当性を surface する（verify adr は単一ファイルの構造検査のみのため、
      // 複数ADR間の整合性はdoctorで補う。config読込に依存しないため独立して実行する）。
      try {
        checks.push(checkAdrConsistency(root));
      } catch (error) {
        checks.push({ label: 'ADR整合性', ok: false, reason: (error as Error).message });
      }
    }

    for (const check of checks) {
      const line = check.ok ? `OK  ${check.label}` : `NG  ${check.label}: ${check.reason ?? '不明な理由'}`;
      process.stdout.write(`${line}\n`);
    }

    // Issue #169 T8: init導入済み・enforce配線状態は情報表示のみ（失敗要因にしない）。
    // 未導入・非配線はいずれも安全な既定状態であり、doctorの成否判定には影響させない。
    if (root) {
      const installedVersion = readInstalledVersion(root);
      process.stdout.write(
        `情報  init 導入済み: ${installedVersion ? `OK (${installedVersion})` : 'NG（未導入）'}\n`,
      );

      let enforceOn = false;
      try {
        const settingsPath = path.join(root, '.claude', 'settings.json');
        const settings = readSettings(settingsPath);
        enforceOn = isPreToolUseHookWired(settings, HOOK_RELATIVE_PATH);
      } catch {
        enforceOn = false;
      }
      process.stdout.write(`情報  enforce の配線状態: ${enforceOn ? 'ON' : 'OFF'}\n`);
    }

    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      process.stderr.write(`不足している依存/条件: ${failed.map((c) => c.label).join(', ')}\n`);
      return 1;
    }
    return 0;
  });
}
