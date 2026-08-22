import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoles } from '../../src/lib/roles.js';

const EXPECTED_CONTRACTS = [
  'spec_worker',
  'design_worker',
  'implementation_worker',
  'validation_worker',
  'gate_reviewer',
  'adr_finalization_worker',
  'root_artifact_cleanup_worker',
] as const;

interface ScopedRole {
  lease?: string;
  scope?: string;
  capabilities?: string[];
  forbidden?: string[];
}

const WORKER_CONTRACTS = ['spec_worker', 'design_worker', 'implementation_worker', 'validation_worker'] as const;

test('loadRoles: 実物の .agent-skill-chain/config/roles.yaml を読み込む', () => {
  const roles = loadRoles(process.cwd());
  assert.equal(roles.schema_version, 'agent-skill-chain/config/v1');
  assert.ok(roles.role_contracts);
  assert.ok(roles.roles);
  assert.ok(roles.adapters);
  assert.equal(typeof roles.blocked_report_schema, 'string');
});

test('loadRoles: role_contracts に全必須ロールが存在する', () => {
  const roles = loadRoles(process.cwd());
  for (const role of EXPECTED_CONTRACTS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(roles.role_contracts, role),
      `role_contracts に ${role} が存在しません`,
    );
  }
});

test('loadRoles: 各 role_contract は inputs/outputs/rules/completion/forbidden を持つ', () => {
  const roles = loadRoles(process.cwd());
  for (const role of EXPECTED_CONTRACTS) {
    const contract = roles.role_contracts[role];
    assert.ok(Array.isArray(contract.inputs) && contract.inputs.length > 0, `${role}.inputs`);
    assert.ok(Array.isArray(contract.outputs) && contract.outputs.length > 0, `${role}.outputs`);
    assert.ok(Array.isArray(contract.rules) && contract.rules.length > 0, `${role}.rules`);
    assert.ok(Array.isArray(contract.completion) && contract.completion.length > 0, `${role}.completion`);
    assert.ok(Array.isArray(contract.forbidden) && contract.forbidden.length > 0, `${role}.forbidden`);
  }
});

test('loadRoles: adapters に claude/codex/human が定義されている', () => {
  const roles = loadRoles(process.cwd());
  assert.equal(roles.adapters.claude, '.agent-skill-chain/adapters/claude.sh');
  assert.equal(roles.adapters.codex, '.agent-skill-chain/adapters/codex.sh');
  assert.equal(roles.adapters.human, '.agent-skill-chain/adapters/human.sh');
});

test('loadRoles: 全segment workerの rules に再開時の最新レビュー確認を含む', () => {
  const roles = loadRoles(process.cwd());
  for (const role of WORKER_CONTRACTS) {
    assert.ok(
      roles.role_contracts[role].rules.some(
        (rule) =>
          rule.includes('作業再開時') &&
          rule.includes('最新レビュー・コメント') &&
          rule.includes('review_status') &&
          rule.includes('のみを根拠に完了と判定しない'),
      ),
      `${role}.rules に再開時レビュー確認指示がありません`,
    );
  }
});

test('loadRoles (AC-7): 全4 workerだけに非追記型是正の同一契約を配布する', () => {
  const roles = loadRoles(process.cwd());
  const requiredFragments = ['局所的な条項・例外・分岐・フラグ', '不要な要求・挙動', '非追加手段で達成不能', '真因がIssueの範囲外'];
  for (const role of WORKER_CONTRACTS) {
    const text = roles.role_contracts[role].rules.join('\n');
    for (const fragment of requiredFragments) assert.match(text, new RegExp(fragment), `${role}: ${fragment}`);
  }
  const reviewerText = roles.role_contracts.gate_reviewer.rules.join('\n');
  for (const fragment of requiredFragments) assert.doesNotMatch(reviewerText, new RegExp(fragment));
});

// ISSUE-798 / AC-1: root成果物クリーンアップロールは、既存の scope 限定ロール
// （adr_finalization_worker）と同じ構造で `roles:` と `role_contracts:` の双方に存在する。
test('loadRoles (AC-1): root_artifact_cleanup_worker が scope 限定の書込みロールとして定義されている', () => {
  const roles = loadRoles(process.cwd());
  const role = roles.roles.root_artifact_cleanup_worker as ScopedRole | undefined;
  assert.ok(role, 'roles: 配下に root_artifact_cleanup_worker が存在すること');
  assert.equal(role.lease, 'writer');
  assert.equal(role.scope, 'root_artifacts_only');

  // capabilities は lease 操作と自ブランチへの commit/push だけで構成される。
  assert.deepEqual(
    [...(role.capabilities ?? [])].sort(),
    ['branch.commit', 'branch.push', 'lease.acquire', 'lease.release', 'lease.renew'],
  );

  // forbidden に「対象4ファイル以外への変更」と「ファイル内容の編集」が含まれる。
  assert.ok(role.forbidden?.includes('out_of_scope.change'), 'forbidden に対象4ファイル以外への変更が含まれること');
  assert.ok(
    role.forbidden?.includes('root_artifact.content_edit'),
    'forbidden にファイル内容の編集が含まれること',
  );

  // 既存の scope 限定ロールと同じ構造をとる（宣言されるキー集合が一致する）。
  const adrRole = roles.roles.adr_finalization_worker as ScopedRole;
  assert.deepEqual(Object.keys(role).sort(), Object.keys(adrRole).sort());
});

// ISSUE-798 / AC-12: 進行役の権限は本Issueで一切拡大していない。
test('loadRoles (AC-12): 進行役の forbidden が不変で、新ロールに著述・内容編集能力が無い', () => {
  const roles = loadRoles(process.cwd());
  const orchestrator = roles.roles.orchestrator as ScopedRole;
  assert.ok(orchestrator.forbidden?.includes('artifact_branch.commit'), '成果物branchへのcommit禁止が残ること');
  assert.ok(orchestrator.forbidden?.includes('artifact.author'), '成果物の著述禁止が残ること');
  assert.equal(orchestrator.lease, 'none');
  assert.equal(
    (orchestrator.capabilities ?? []).some((c) => /branch\.(commit|push)/.test(c)),
    false,
    '進行役へ成果物branchへのcommit能力を与えていないこと',
  );

  const role = roles.roles.root_artifact_cleanup_worker as ScopedRole;
  assert.equal(
    (role.capabilities ?? []).some((c) => /artifact\.(author|edit|content)/.test(c) || c === 'worktree.write'),
    false,
    'クリーンアップロールに著述・内容編集に相当する能力が無いこと',
  );
});

// Issue #786 / AC-6: ラウンド値を解決できない経路の有限性非保証は、4 workerとgate_reviewerの
// 双方の契約に現れる必要がある。片方だけでは残りラウンド数を前提にした是正・判定を止められない。
test('loadRoles (AC-6): 全4 workerとgate_reviewerへ有限性保証の対象外である旨を配布する', () => {
  const roles = loadRoles(process.cwd());
  for (const role of [...WORKER_CONTRACTS, 'gate_reviewer'] as const) {
    assert.match(
      roles.role_contracts[role].rules.join('\n'),
      /ラウンド値を解決できない経路のゲートは通常のblocking差し戻しを維持するだけで差し戻し回数の有限性保証の対象外/,
      role,
    );
  }
});
