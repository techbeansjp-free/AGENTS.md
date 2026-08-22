// ISSUE-798 / AC-10 / AC-11: claude adapter の既定許可コマンド列挙へ `.agent-skill-chain/ci/`
// 実行だけが加わり、削除系・無制限自動承認が加わらないこと。および、既定ブランチの事後清掃自動化と
// root残存検査の外部挙動へ本Issueが干渉していないこと。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const adapterPath = path.join(repoRoot, '.agent-skill-chain', 'adapters', 'claude.sh');
const adapterLines = fs.readFileSync(adapterPath, 'utf8').split('\n');

const assignmentIndex = adapterLines.findIndex((line) => line.startsWith('WORKER_ALLOWED_TOOLS_DEFAULT='));

function allowedTools(): string {
  assert.notEqual(assignmentIndex, -1, 'WORKER_ALLOWED_TOOLS_DEFAULT の定義が見つかること');
  const match = /^WORKER_ALLOWED_TOOLS_DEFAULT='([^']*)'$/.exec(adapterLines[assignmentIndex]);
  assert.ok(match, '既定許可コマンド列挙が単一引用符の1行で定義されていること');
  return match[1];
}

test('AC-10: ci/ 配下の実行が scripts/ 配下と同じ2表記で許可されている', () => {
  const tools = allowedTools();
  for (const suffix of ['.agent-skill-chain/scripts/*', '.agent-skill-chain/ci/*']) {
    assert.ok(tools.includes(`Bash(${suffix})`), `Bash(${suffix}) が列挙されること`);
    assert.ok(tools.includes(`Bash(bash ${suffix})`), `Bash(bash ${suffix}) が列挙されること`);
  }
});

test('AC-10: ファイル削除系のコマンドと無制限自動承認は列挙されていない', () => {
  const tools = allowedTools();
  const forbidden = [
    /Bash\(\s*rm[\s:)]/,
    /Bash\(\s*git rm/,
    /Bash\(\s*find/,
    /Bash\(\s*unlink/,
    /update-index/,
    /--force-remove/,
    /bypassPermissions/,
    /Bash\(\s*\*\s*\)/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(tools, pattern, `${pattern} が既定許可コマンド列挙に含まれないこと`);
  }
  // 無制限自動承認は既定の起動コマンドにも用いない（コメント行の言及は対象外）。
  const executableLines = adapterLines.filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(executableLines, /--permission-mode\s+bypassPermissions/);
});

test('AC-10: 削除系を意図的に列挙しない理由が列挙の近傍に記述されている', () => {
  assert.notEqual(assignmentIndex, -1);
  const nearby = adapterLines.slice(Math.max(0, assignmentIndex - 25), assignmentIndex).join('\n');
  for (const fragment of ['意図的に列挙しない', '責務', 'root_artifact_cleanup_worker', '無制限自動承認', 'read-only']) {
    assert.ok(nearby.includes(fragment), `列挙の近傍に理由 '${fragment}' が記述されていること`);
  }
});

test('AC-11: 既存の事後清掃自動化・root残存検査のラッパーが同じサブコマンドへ委譲し続ける', () => {
  const cases: [string, string][] = [
    ['.agent-skill-chain/scripts/root-cleanup.sh', 'root-cleanup run'],
    ['.agent-skill-chain/ci/verify-root-clean.sh', 'verify root-clean'],
    ['.agent-skill-chain/scripts/root-cleanup-branch.sh', 'root-cleanup branch'],
  ];
  for (const [relative, subcommand] of cases) {
    const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.ok(
      text.includes(`exec "\${ASC_CLI[@]}" ${subcommand} "$@"`),
      `${relative} が '${subcommand}' へ委譲すること`,
    );
  }
});

test('AC-11: 既存の事後清掃自動化・root残存検査の実装が新設モジュールへ依存しない', () => {
  for (const relative of ['src/commands/root-cleanup.ts', 'src/commands/verify.ts']) {
    const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.equal(text.includes('root-cleanup-branch'), false, `${relative} が新設モジュールへ依存しないこと`);
    assert.equal(text.includes('root-artifact-state'), false, `${relative} が新設モジュールへ依存しないこと`);
  }
  // 対象ファイル集合を与える固定リテラルだけを共有する（設定化しない）。
  const shared = fs.readFileSync(path.join(repoRoot, 'src', 'lib', 'root-artifacts.ts'), 'utf8');
  assert.match(shared, /ROOT_ARTIFACT_FILES = \['SPEC\.md', 'DESIGN\.md', 'PLAN\.md', 'VALIDATION\.md'\]/);
});
