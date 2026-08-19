// Issue #759 PLAN #10 / DESIGN E7: launcher digest の算出対象を検証する。
// 上限（配布集合の要素のみ）と下限（レビュア起動・prompt 生成・verdict 記録を実際に行う実行コードと
// その実行系が隔離 clone から読み込む配布集合所属 asset）に挟まれた 10 要素の固定列挙が、
// consumer 固有文書に影響されず、かつ 1 要素でも取得できなければ部分集合で算出されないことを固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { LOCAL_REVIEW_LAUNCHER_PATHS, localReviewLauncherDigest } from '../../src/commands/gate.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitAll(cwd: string, message: string): string {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

test('launcher digest: 算出対象は配布集合の10要素であり .agent-skill-chain/project/ を含まない', () => {
  assert.deepEqual([...LOCAL_REVIEW_LAUNCHER_PATHS], [
    '.agent-skill-chain/scripts/gate-local-review.sh',
    '.agent-skill-chain/scripts/gate-launch-reviewer.sh',
    '.agent-skill-chain/scripts/gate-review.sh',
    '.agent-skill-chain/scripts/cli-resolve.sh',
    '.agent-skill-chain/adapters/claude.sh',
    '.agent-skill-chain/adapters/codex.sh',
    '.agent-skill-chain/adapters/human.sh',
    '.agent-skill-chain/config/roles.yaml',
    '.agent-skill-chain/schemas/gate-report.schema.yaml',
    '.agent-skill-chain/schemas/project-policy.schema.yaml',
  ]);
  assert.equal(
    LOCAL_REVIEW_LAUNCHER_PATHS.some((entry) => entry.startsWith('.agent-skill-chain/project/')),
    false,
  );
});

test('launcher digest: consumer固有文書の有無・内容で値が変わらず算出も失敗しない（AC-8, AC-7）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());

  const withProjectDocs = git(repo.dir, ['rev-parse', 'HEAD']);
  const baseline = localReviewLauncherDigest(repo.dir, withProjectDocs);
  assert.match(baseline, /^sha256:[0-9a-f]{64}$/);

  // 状態2: consumer 形状（MODEL_TIER_TABLE.md を持たず、manifest.yaml の内容も異なる）。
  const projectDir = path.join(repo.dir, '.agent-skill-chain', 'project');
  fs.rmSync(path.join(projectDir, 'MODEL_TIER_TABLE.md'), { force: true });
  fs.appendFileSync(path.join(projectDir, 'manifest.yaml'), '\n# consumer固有の追記\n');
  const withoutModelTierTable = commitAll(repo.dir, 'test: consumer shape project docs');
  assert.equal(localReviewLauncherDigest(repo.dir, withoutModelTierTable), baseline);

  // 状態3: `.agent-skill-chain/project/` 自体が存在しない。
  fs.rmSync(projectDir, { recursive: true, force: true });
  const withoutProjectDir = commitAll(repo.dir, 'test: consumer shape without project policy');
  assert.equal(localReviewLauncherDigest(repo.dir, withoutProjectDir), baseline);
});

test('launcher digest: 算出対象の要素が1件でも欠けると部分集合で算出せず欠落要素を示して失敗する（AC-12）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const head = git(repo.dir, ['rev-parse', 'HEAD']);
  assert.match(localReviewLauncherDigest(repo.dir, head), /^sha256:[0-9a-f]{64}$/);

  for (const launcherPath of LOCAL_REVIEW_LAUNCHER_PATHS) {
    const branch = `test/missing-${launcherPath.replace(/[^A-Za-z0-9]/g, '-')}`;
    git(repo.dir, ['checkout', '-q', '-b', branch, head]);
    git(repo.dir, ['rm', '-q', '--', launcherPath]);
    const missingSha = commitAll(repo.dir, `test: drop ${launcherPath}`);
    assert.throws(
      () => localReviewLauncherDigest(repo.dir, missingSha),
      (error: Error) => {
        assert.match(error.message, /trusted baseのlauncher構成を読めません/);
        assert.ok(error.message.includes(launcherPath), `${launcherPath} が診断へ現れること`);
        return true;
      },
      `${launcherPath} の欠落が停止を招くこと（招かないなら算出対象に含まれていない）`,
    );
    git(repo.dir, ['checkout', '-q', 'main']);
  }
});
