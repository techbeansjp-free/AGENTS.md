import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const ARTIFACT_DIGEST = `sha256:${'1'.repeat(64)}`;

interface GateReport {
  schema_version: string;
  gate: {
    issue_id?: string;
    id: string;
    target_sha: string;
    conformance: string;
    falsification: string;
    final: string;
    blockers: { severity: string; origin: string; code: string; evidence: string[] }[];
    approved_digest: string;
    approved_artifacts: { path: string; digest: string }[];
    review_profile?: string;
    review_invocation?: {
      issue_id: string;
      gate_id: string;
      target_sha: string;
      profile: string;
      reviewer_slot: string;
      invocation_id: string;
      status: string;
    };
    reviewers?: {
      reviewer_slot: string;
      invocation_id: string;
      status: string;
      final: string;
    }[];
  };
}

interface PreparedSession {
  reportPath: string;
  manifestPath: string;
  reviewer1Path: string;
  reviewer2Path: string;
}

function strictScaffold(): GateReport {
  return {
    schema_version: 'agent-skill-chain/gate-report/v1',
    gate: {
      issue_id: 'ISSUE-1',
      id: 'spec',
      target_sha: 'abc123',
      conformance: 'pending',
      falsification: 'pending',
      final: 'pending',
      blockers: [],
      approved_digest: ZERO_DIGEST,
      approved_artifacts: [],
      review_profile: 'strict',
    },
  };
}

function readReport(reportPath: string): GateReport {
  return parse(fs.readFileSync(reportPath, 'utf8')) as GateReport;
}

function prepare(repoDir: string): PreparedSession {
  const reportPath = path.join(repoDir, 'strict-final.yaml');
  fs.writeFileSync(reportPath, stringify(strictScaffold()), 'utf8');
  const result = runCli(['gate', 'strict-prepare', 'ISSUE-1', reportPath], { cwd: repoDir });
  assert.equal(result.status, 0, result.stderr);
  const value = (key: string): string => {
    const match = new RegExp(`^${key}: (.+)$`, 'm').exec(result.stdout);
    assert.ok(match, `${key} がstrict-prepare出力に存在すること`);
    return match[1];
  };
  return {
    reportPath,
    manifestPath: value('session_manifest_path'),
    reviewer1Path: value('reviewer-1_report_path'),
    reviewer2Path: value('reviewer-2_report_path'),
  };
}

function record(repoDir: string, reportPath: string, final: 'approved' | 'rejected' | 'human_required'): void {
  const verdict =
    final === 'approved'
      ? {
          conformance: 'pass',
          falsification: 'pass',
          blockers: [],
          approved_digest: ZERO_DIGEST,
          approved_artifacts: [{ path: 'SPEC.md', digest: ARTIFACT_DIGEST }],
        }
      : final === 'rejected'
        ? {
            conformance: 'fail',
            falsification: 'pass',
            blockers: [
              {
                severity: 'blocking',
                origin: 'specification',
                code: 'strict-test-reject',
                evidence: ['反例を検出'],
              },
            ],
            approved_digest: ZERO_DIGEST,
            approved_artifacts: [{ path: 'SPEC.md', digest: ARTIFACT_DIGEST }],
          }
        : {
            conformance: 'pass',
            falsification: 'pass',
            blockers: [],
            approved_digest: ZERO_DIGEST,
            approved_artifacts: [{ path: 'SPEC.md', digest: ARTIFACT_DIGEST }],
            inconclusive: true,
          };
  const result = runCli(['gate', 'record-verdict', reportPath], {
    cwd: repoDir,
    input: JSON.stringify(verdict),
  });
  assert.equal(result.status, 0, result.stderr);
}

test('Strict trusted aggregation: 別slot・別invocationの2件がapprovedの場合だけapprovedにする (AC-1)', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const session = prepare(repo.dir);

  record(repo.dir, session.reviewer1Path, 'approved');
  record(repo.dir, session.reviewer2Path, 'approved');
  const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  const report = readReport(session.reportPath);
  assert.equal(report.gate.final, 'approved');
  assert.equal(report.gate.reviewers?.length, 2);
  assert.deepEqual(
    report.gate.reviewers?.map((reviewer) => reviewer.reviewer_slot).sort(),
    ['reviewer-1', 'reviewer-2'],
  );
  assert.equal(new Set(report.gate.reviewers?.map((reviewer) => reviewer.invocation_id)).size, 2);
  assert.ok(report.gate.reviewers?.every((reviewer) => reviewer.status === 'completed'));
  const wrongIssue = runCli(['gate', 'publish', 'ISSUE-2', session.reportPath], { cwd: repo.dir });
  assert.notEqual(wrongIssue.status, 0, '別IssueへStrict承認証跡を流用できないこと');
  const publish = runCli(['gate', 'publish', 'ISSUE-1', session.reportPath], { cwd: repo.dir });
  assert.equal(publish.status, 0, publish.stderr);
});

test('Strict trusted aggregation: 1件のみ・重複・target不一致をhuman_requiredへ倒す (AC-2)', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  {
    const session = prepare(repo.dir);
    record(repo.dir, session.reviewer1Path, 'approved');
    const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReport(session.reportPath).gate.final, 'human_required');
  }

  {
    const session = prepare(repo.dir);
    record(repo.dir, session.reviewer1Path, 'approved');
    record(repo.dir, session.reviewer2Path, 'approved');
    const second = readReport(session.reviewer2Path);
    second.gate.review_invocation!.reviewer_slot = 'reviewer-1';
    fs.writeFileSync(session.reviewer2Path, stringify(second), 'utf8');
    const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReport(session.reportPath).gate.final, 'human_required');
  }

  {
    const session = prepare(repo.dir);
    record(repo.dir, session.reviewer1Path, 'approved');
    record(repo.dir, session.reviewer2Path, 'approved');
    const first = readReport(session.reviewer1Path);
    const second = readReport(session.reviewer2Path);
    second.gate.review_invocation!.invocation_id = first.gate.review_invocation!.invocation_id;
    fs.writeFileSync(session.reviewer2Path, stringify(second), 'utf8');
    const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReport(session.reportPath).gate.final, 'human_required');
  }

  {
    const session = prepare(repo.dir);
    record(repo.dir, session.reviewer1Path, 'approved');
    record(repo.dir, session.reviewer2Path, 'approved');
    const second = readReport(session.reviewer2Path);
    second.gate.target_sha = 'different-sha';
    second.gate.review_invocation!.target_sha = 'different-sha';
    fs.writeFileSync(session.reviewer2Path, stringify(second), 'utf8');
    const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReport(session.reportPath).gate.final, 'human_required');
  }

  {
    const session = prepare(repo.dir);
    record(repo.dir, session.reviewer1Path, 'approved');
    record(repo.dir, session.reviewer2Path, 'approved');
    const second = readReport(session.reviewer2Path);
    second.gate.approved_artifacts[0].digest = `sha256:${'2'.repeat(64)}`;
    fs.writeFileSync(session.reviewer2Path, stringify(second), 'utf8');
    const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReport(session.reportPath).gate.final, 'human_required');
  }
});

test('Strict trusted aggregation: human_requiredはrejectより優先し、valid rejectはrejectedにする (AC-2)', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  {
    const session = prepare(repo.dir);
    record(repo.dir, session.reviewer1Path, 'rejected');
    record(repo.dir, session.reviewer2Path, 'human_required');
    const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReport(session.reportPath).gate.final, 'human_required');
  }

  {
    const session = prepare(repo.dir);
    record(repo.dir, session.reviewer1Path, 'rejected');
    record(repo.dir, session.reviewer2Path, 'approved');
    const result = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReport(session.reportPath).gate.final, 'rejected');
  }
});

test('Strict sessionは一回限りで、replayをhuman_requiredへ倒す (AC-2)', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const session = prepare(repo.dir);
  record(repo.dir, session.reviewer1Path, 'approved');
  record(repo.dir, session.reviewer2Path, 'approved');

  const first = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readReport(session.reportPath).gate.final, 'approved');
  const replay = runCli(['gate', 'aggregate-strict', session.reportPath, session.manifestPath], { cwd: repo.dir });
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(readReport(session.reportPath).gate.final, 'human_required');
});

test('Strictの単一verdict直結と2件証跡なしapproved publishを拒否し、Standard契約は維持する (AC-4)', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const strictPath = path.join(repo.dir, 'strict.yaml');
  fs.writeFileSync(strictPath, stringify(strictScaffold()), 'utf8');

  const direct = runCli(['gate', 'record-verdict', strictPath], {
    cwd: repo.dir,
    input: JSON.stringify({ conformance: 'pass', falsification: 'pass', blockers: [] }),
  });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /trusted aggregation/);

  const missingEvidence = strictScaffold();
  missingEvidence.gate.conformance = 'pass';
  missingEvidence.gate.falsification = 'pass';
  missingEvidence.gate.final = 'approved';
  fs.writeFileSync(strictPath, stringify(missingEvidence), 'utf8');
  const publish = runCli(['gate', 'publish', 'ISSUE-1', strictPath], { cwd: repo.dir });
  assert.notEqual(publish.status, 0);
  assert.match(publish.stderr, /独立した2件の承認証跡/);

  const standard = strictScaffold();
  standard.gate.review_profile = 'standard';
  const standardPath = path.join(repo.dir, 'standard.yaml');
  fs.writeFileSync(standardPath, stringify(standard), 'utf8');
  const standardVerdict = runCli(['gate', 'record-verdict', standardPath], {
    cwd: repo.dir,
    input: JSON.stringify({ conformance: 'pass', falsification: 'pass', blockers: [] }),
  });
  assert.equal(standardVerdict.status, 0, standardVerdict.stderr);
  assert.equal(readReport(standardPath).gate.final, 'approved');
});
