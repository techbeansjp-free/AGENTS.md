import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { consumeTrustedGateSecrets } from '../../src/commands/gate.js';
import { canonicalJson } from '../../src/lib/review-evidence.js';
import { encodeGateCheckExternalId } from '../../src/lib/gate-provenance.js';
import {
  assertTrustedGateAttestationVerification,
  canonicalReportIsOversize,
  createTrustedGatePreparationFailureCheck,
  fetchTrustedGateApiContext,
  finalizeTrustedGateCheck,
  finalizeTrustedGateCheckFailure,
  parseTrustedGateDispatchEvent,
  parseTrustedGateFailureEvent,
  parseTrustedGateWorkflow,
  selectLatestTrustedGateCheck,
  trustedGateExternalId,
  trustedGateRunName,
  type TrustedGateActionRun,
  type TrustedGateAttestationEnvelope,
  type TrustedGateCheckRun,
  type TrustedGatePayload,
  type TrustedGateWorkflow,
} from '../../src/lib/trusted-gate-recorder.js';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const PAYLOAD: TrustedGatePayload = { pr_number: 274, gate: 'implementation', target_sha: SHA };
const WORKFLOW: TrustedGateWorkflow = {
  path: '.github/workflows/agent-skill-chain-trusted-gate.yml',
  ref: 'refs/heads/main',
  sha: BASE_SHA,
  run_id: 9001,
  run_number: 42,
  run_attempt: 1,
};
const EXTERNAL_ID = encodeGateCheckExternalId(trustedGateExternalId(WORKFLOW, PAYLOAD));

test('repository_dispatch受信workflowを配布元と展開先へ同期してCheck Run記録CLIへ結線する', () => {
  const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const relativePath = '.github/workflows/agent-skill-chain-trusted-gate.yml';
  const deployed = fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
  const template = fs.readFileSync(
    path.join(packageRoot, '.agent-skill-chain', 'templates', 'github', relativePath),
    'utf8',
  );

  assert.equal(deployed, template);
  assert.match(deployed, /repository_dispatch:\n\s+types: \[agent-skill-chain-gate-record\]/);
  assert.match(deployed, /gate record-trusted-check prepare/);
  assert.match(deployed, /gate record-trusted-check finalize/);
  assert.match(deployed, /ASC_GATE_APP_PRIVATE_KEY: \$\{\{ secrets\.ASC_GATE_APP_PRIVATE_KEY \}\}/);
});

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

function trustedGateSteps(): WorkflowStep[] {
  const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const workflow = readYamlFile<{ jobs: { record: { steps: WorkflowStep[] } } }>(
    path.join(packageRoot, '.github', 'workflows', 'agent-skill-chain-trusted-gate.yml'),
  );
  return workflow.jobs.record.steps;
}

function trustedGateWorkflow(): {
  permissions: Record<string, string>;
  jobs: { record: { steps: WorkflowStep[] } };
} {
  const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  return readYamlFile(
    path.join(packageRoot, '.github', 'workflows', 'agent-skill-chain-trusted-gate.yml'),
  );
}

function workflowStep(name: string): WorkflowStep {
  const step = trustedGateSteps().find((candidate) => candidate.name === name);
  assert.ok(step, `${name} stepが存在すること`);
  return step;
}

test('trusted gate workflowはnpm構成を検出し、buildとCLI解決をconsumer構成へ適応させる', () => {
  const detect = workflowStep('Detect npm build prerequisites');
  assert.equal(detect.id, 'npm-prereq');
  assert.match(detect.run ?? '', /package-lock\.json/);
  assert.match(detect.run ?? '', /npm-shrinkwrap\.json/);
  assert.match(detect.run ?? '', /build=true/);
  assert.equal(workflowStep('npm ci').if, "steps.npm-prereq.outputs.ci == 'true'");
  assert.equal(workflowStep('npm run build').if, "steps.npm-prereq.outputs.build == 'true'");
  const ensure = workflowStep('Ensure agent-skill-chain CLI').run ?? '';
  assert.match(ensure, /source \.agent-skill-chain\/scripts\/cli-resolve\.sh/);
  assert.match(ensure, /asc_resolve_cli/);

  for (const name of [
    'Validate dispatch payload allowlist',
    'Prepare dedicated-App in-progress Check and envelope',
    'Finalize dedicated-App Check as the last operation',
  ]) {
    const run = workflowStep(name).run ?? '';
    assert.match(run, /asc_resolve_cli/);
    assert.match(run, /"\$\{ASC_CLI\[@\]\}" gate record-trusted-check/);
    assert.doesNotMatch(run, /node bin\/agents-md\.js/);
  }
});

test('trusted gate workflowはattestation失敗後もprepare済みCheckをfail-closedで完了させる', () => {
  assert.equal(trustedGateWorkflow().permissions.actions, 'read');
  assert.equal(workflowStep('Prepare dedicated-App in-progress Check and envelope').id, 'prepare');
  assert.equal(workflowStep('Attest exact gate envelope').id, 'attest');
  assert.equal(workflowStep('Verify signer workflow, ref, digest, and certificate').id, 'verify');
  const finalize = workflowStep('Finalize dedicated-App Check as the last operation');
  assert.match(finalize.if ?? '', /always\(\)/);
  assert.match(finalize.if ?? '', /steps\.prepare\.outcome == 'success'/);
  assert.equal(finalize.env?.ASC_GATE_ATTEST_OUTCOME, '${{ steps.attest.outcome }}');
  assert.equal(finalize.env?.ASC_GATE_VERIFY_OUTCOME, '${{ steps.verify.outcome }}');
});

test('trusted gate workflowはpayloadまたはtarget検証失敗をprepare前にaction_requiredとして記録する', () => {
  const steps = trustedGateSteps();
  const failureIndex = steps.findIndex((step) => step.name === 'Record pre-prepare failure as action_required');
  const prepareIndex = steps.findIndex((step) => step.name === 'Prepare dedicated-App in-progress Check and envelope');
  assert.ok(failureIndex > steps.findIndex((step) => step.name === 'Fetch target as a read-only Git object'));
  assert.ok(failureIndex < prepareIndex);
  const failure = steps[failureIndex];
  assert.equal(failure.if, 'failure()');
  assert.match(failure.run ?? '', /gate record-trusted-check fail-preparation/);
});

test('recorder secretはdirect fetch用に退避後、子process環境から除去される', () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ASC_GATE_APP_ID: '12345',
    ASC_GATE_APP_PRIVATE_KEY: 'private-key-secret',
    GITHUB_TOKEN: 'github-token-secret',
  };
  const consumed = consumeTrustedGateSecrets(env);
  assert.deepEqual(consumed, {
    githubToken: 'github-token-secret',
    credentials: { appId: '12345', privateKey: 'private-key-secret' },
  });
  const child = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(`${process.env.ASC_GATE_APP_PRIVATE_KEY ?? ""}|${process.env.GITHUB_TOKEN ?? ""}`)'],
    { env, encoding: 'utf8' },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '|');
});

function checkRun(overrides: Partial<TrustedGateCheckRun> = {}): TrustedGateCheckRun {
  return {
    id: 501,
    name: 'agent-skill-chain/implementation-gate',
    head_sha: SHA,
    external_id: EXTERNAL_ID,
    status: 'completed',
    conclusion: 'success',
    app: { id: 12345, name: 'Agent Skill Chain Gate', slug: 'agent-skill-chain-gate' },
    ...overrides,
  };
}

function actionRun(overrides: Partial<TrustedGateActionRun> = {}): TrustedGateActionRun {
  return {
    id: 9001,
    run_number: 42,
    run_attempt: 1,
    path: '.github/workflows/agent-skill-chain-trusted-gate.yml',
    head_sha: BASE_SHA,
    head_branch: 'main',
    event: 'repository_dispatch',
    display_title: trustedGateRunName(PAYLOAD),
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

test('dispatch payloadはpr_number integer・gate enum・40hex SHAだけを許可する', () => {
  assert.deepEqual(
    parseTrustedGateDispatchEvent({
      action: 'agent-skill-chain-gate-record',
      sender: { login: 'trusted-recorder' },
      client_payload: PAYLOAD,
    }),
    { actor: 'trusted-recorder', payload: PAYLOAD },
  );
  assert.throws(
    () => parseTrustedGateDispatchEvent({
      action: 'agent-skill-chain-gate-record',
      sender: { login: 'trusted-recorder' },
      client_payload: { ...PAYLOAD, profile: 'standard' },
    }),
    /許可フィールド/,
  );
  assert.throws(
    () => parseTrustedGateDispatchEvent({
      action: 'agent-skill-chain-gate-record',
      sender: { login: 'trusted-recorder' },
      client_payload: { ...PAYLOAD, pr_number: '274' },
    }),
    /integer/,
  );
  assert.deepEqual(
    parseTrustedGateFailureEvent({
      action: 'agent-skill-chain-gate-record',
      sender: { login: 'trusted-recorder' },
      client_payload: { ...PAYLOAD, unexpected: 'rejected-by-strict-validation' },
    }),
    { actor: 'trusted-recorder', payload: PAYLOAD },
  );
});

test('workflow identityはexact path・refs/heads/main・workflow SHA/run tupleへ固定する', () => {
  const env = {
    GITHUB_REPOSITORY: 'techbeansjp-free/AGENTS.md',
    GITHUB_WORKFLOW_REF:
      'techbeansjp-free/AGENTS.md/.github/workflows/agent-skill-chain-trusted-gate.yml@refs/heads/main',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_SHA: BASE_SHA,
    GITHUB_SHA: BASE_SHA,
    GITHUB_RUN_ID: '9001',
    GITHUB_RUN_NUMBER: '42',
    GITHUB_RUN_ATTEMPT: '1',
  };
  assert.deepEqual(parseTrustedGateWorkflow(env), WORKFLOW);
  assert.throws(
    () => parseTrustedGateWorkflow({ ...env, GITHUB_REF: 'refs/heads/feature' }),
    /refs\/heads\/main/,
  );
});

test('API正本はwrite以上actor・current head・default main base・Issue profileを再取得する', async () => {
  const responses = new Map<string, unknown>([
    ['/repos/techbeansjp-free/AGENTS.md', {
      id: 77,
      full_name: 'techbeansjp-free/AGENTS.md',
      default_branch: 'main',
    }],
    ['/repos/techbeansjp-free/AGENTS.md/collaborators/trusted-recorder/permission', { permission: 'write' }],
    ['/repos/techbeansjp-free/AGENTS.md/pulls/274', {
      number: 274,
      state: 'open',
      user: { login: 'writer' },
      head: { sha: SHA, ref: 'process/271-core-audit-model-selection' },
      base: { sha: BASE_SHA, ref: 'main' },
    }],
    ['/repos/techbeansjp-free/AGENTS.md/issues/271', {
      number: 271,
      state: 'open',
      labels: [{ name: 'review:core-audit' }],
    }],
    ['/repos/techbeansjp-free/AGENTS.md/pulls/274/commits?per_page=100&page=1', []],
    ['/repos/techbeansjp-free/AGENTS.md/pulls/274/reviews?per_page=100&page=1', []],
  ]);
  const request = async (input: string | URL | Request): Promise<Response> => {
    const pathname = new URL(String(input)).pathname + new URL(String(input)).search;
    const value = responses.get(pathname);
    return value === undefined
      ? new Response('', { status: 404 })
      : new Response(JSON.stringify(value), { status: 200 });
  };
  const context = await fetchTrustedGateApiContext({
    actor: 'trusted-recorder',
    payload: PAYLOAD,
    repository: 'techbeansjp-free/AGENTS.md',
    githubToken: 'workflow-token',
    fetchImpl: request as typeof fetch,
  });
  assert.equal(context.issueId, 'ISSUE-271');
  assert.equal(context.profile, 'strict');
  assert.equal(context.reviewSubject, 'core_audit');

  responses.set('/repos/techbeansjp-free/AGENTS.md/collaborators/trusted-recorder/permission', {
    permission: 'read',
  });
  await assert.rejects(
    fetchTrustedGateApiContext({
      actor: 'trusted-recorder',
      payload: PAYLOAD,
      repository: 'techbeansjp-free/AGENTS.md',
      githubToken: 'workflow-token',
      fetchImpl: request as typeof fetch,
    }),
    /write以上/,
  );
  responses.set('/repos/techbeansjp-free/AGENTS.md/collaborators/trusted-recorder/permission', {
    permission: 'write',
  });
  responses.set('/repos/techbeansjp-free/AGENTS.md/pulls/274', {
    number: 274,
    state: 'open',
    user: { login: 'writer' },
    head: { sha: 'c'.repeat(40), ref: 'process/271-core-audit-model-selection' },
    base: { sha: BASE_SHA, ref: 'not-main' },
  });
  await assert.rejects(
    fetchTrustedGateApiContext({
      actor: 'trusted-recorder',
      payload: PAYLOAD,
      repository: 'techbeansjp-free/AGENTS.md',
      githubToken: 'workflow-token',
      fetchImpl: request as typeof fetch,
    }),
    /current head.*default base/,
  );
});

test('materializer selectorはActions run tupleを先に最大化しfailureへ旧success fallbackしない', () => {
  const oldAction = actionRun();
  const oldCheck = checkRun();
  const failedRerun = actionRun({ run_attempt: 2, status: 'completed', conclusion: 'failure' });
  assert.throws(
    () => selectLatestTrustedGateCheck({
      actionRuns: [oldAction, failedRerun],
      checkRuns: [oldCheck],
      payload: PAYLOAD,
      expectedAppId: 12345,
      expectedCheckName: oldCheck.name,
    }),
    /latest.*completed success/,
  );

  const rerunWorkflow = { ...WORKFLOW, run_attempt: 2 };
  const replayExternal = encodeGateCheckExternalId(trustedGateExternalId(rerunWorkflow, PAYLOAD));
  const successfulRerun = actionRun({ run_attempt: 2 });
  const rerunCheck = checkRun({ id: 700, external_id: replayExternal });
  assert.throws(
    () => selectLatestTrustedGateCheck({
      actionRuns: [oldAction, successfulRerun],
      checkRuns: [rerunCheck, { ...rerunCheck, id: 701 }],
      payload: PAYLOAD,
      expectedAppId: 12345,
      expectedCheckName: oldCheck.name,
    }),
    /exactly one/,
  );
});

test('標準GitHub Actions Appの同名success Checkは専用sourceとして拒否する', () => {
  assert.throws(
    () => selectLatestTrustedGateCheck({
      actionRuns: [actionRun()],
      checkRuns: [checkRun({ app: { id: 15368, name: 'GitHub Actions', slug: 'github-actions' } })],
      payload: PAYLOAD,
      expectedAppId: 12345,
      expectedCheckName: 'agent-skill-chain/implementation-gate',
    }),
    /exactly one|専用App/,
  );
});

test('attestation certificateはsubject digestとexact workflow run/attemptを再検証する', () => {
  const envelope: TrustedGateAttestationEnvelope = {
    schema_version: 'agent-skill-chain/gate-attestation/v1',
    repository: { full_name: 'techbeansjp-free/AGENTS.md', id: 77 },
    pr_number: 274,
    target_sha: SHA,
    gate: 'implementation',
    review_attempt: {
      attempt_id: 'attempt-1',
      expected_count: 2,
      evidence_digest: `sha256:${'d'.repeat(64)}`,
    },
    workflow: WORKFLOW,
    check: { id: 501, name: 'agent-skill-chain/implementation-gate', app_id: 12345 },
    report_digest: `sha256:${'e'.repeat(64)}`,
  };
  const bytes = `${canonicalJson(envelope)}\n`;
  const verification = [{
    verificationResult: {
      signature: {
        certificate: {
          runInvocationUri: 'https://github.com/techbeansjp-free/AGENTS.md/actions/runs/9001/attempts/1',
        },
      },
      statement: {
        subject: [{
          digest: { sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
        }],
      },
    },
  }];
  assert.doesNotThrow(() =>
    assertTrustedGateAttestationVerification({ verification, envelopeBytes: bytes, envelope }),
  );
  assert.throws(
    () => assertTrustedGateAttestationVerification({
      verification,
      envelopeBytes: canonicalJson(envelope),
      envelope,
    }),
    /subject digest/,
  );
  const wrongSigner = structuredClone(verification);
  wrongSigner[0].verificationResult.signature.certificate.runInvocationUri =
    'https://github.com/techbeansjp-free/AGENTS.md/actions/runs/9001/attempts/2';
  assert.throws(
    () => assertTrustedGateAttestationVerification({ verification: wrongSigner, envelopeBytes: bytes, envelope }),
    /run\/attempt/,
  );
});

test('prepare前の検証失敗はcompleted action_required Checkを1回のCheck API操作で記録する', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/installation')) return new Response(JSON.stringify({ id: 88 }), { status: 200 });
    if (url.endsWith('/access_tokens')) {
      return new Response(JSON.stringify({
        token: 'app-installation-token',
        expires_at: '2026-07-26T01:00:00Z',
      }), { status: 201 });
    }
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: 501,
      name: body.name,
      head_sha: body.head_sha,
      external_id: body.external_id,
      status: body.status,
      conclusion: body.conclusion,
      app: { id: 12345, name: 'Agent Skill Chain Gate', slug: 'agent-skill-chain-gate' },
    }), { status: 201 });
  };

  await createTrustedGatePreparationFailureCheck({
    repository: 'techbeansjp-free/AGENTS.md',
    repositoryId: 77,
    credentials: { appId: '12345', privateKey: privateKeyPem },
    checkName: 'agent-skill-chain/implementation-gate',
    payload: PAYLOAD,
    workflow: WORKFLOW,
    fetchImpl: fetchImpl as typeof fetch,
  });

  const checkCalls = calls.filter((call) => call.url.endsWith('/check-runs'));
  assert.equal(checkCalls.length, 1);
  const body = JSON.parse(String(checkCalls[0].init?.body));
  assert.equal(body.status, 'completed');
  assert.equal(body.conclusion, 'action_required');
  assert.equal(JSON.parse(body.output.text).reason, 'preparation_failed');
});

test('48KiB超reportはaction_requiredとなり、App PATCHが最後のHTTP操作になる', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/installation')) return new Response(JSON.stringify({ id: 88 }), { status: 200 });
    if (url.endsWith('/repos/techbeansjp-free/AGENTS.md')) {
      return new Response(JSON.stringify({ id: 77 }), { status: 200 });
    }
    if (url.endsWith('/access_tokens')) {
      return new Response(JSON.stringify({
        token: 'app-installation-token',
        expires_at: '2026-07-26T01:00:00Z',
      }), { status: 201 });
    }
    return new Response(JSON.stringify({ id: 501 }), { status: 200 });
  };
  const report = {
    gate: {
      final: 'approved',
      blockers: [],
      padding: 'x'.repeat(48 * 1024),
    },
  };
  assert.equal(canonicalReportIsOversize(report), true);
  const attestation = {
    schema_version: 'agent-skill-chain/gate-attestation/v1',
    repository: { full_name: 'techbeansjp-free/AGENTS.md', id: 77 },
    pr_number: 274,
    target_sha: SHA,
    gate: 'implementation',
    review_attempt: {
      attempt_id: 'attempt-1',
      expected_count: 2,
      evidence_digest: `sha256:${'d'.repeat(64)}`,
    },
    workflow: WORKFLOW,
    check: { id: 501, name: 'agent-skill-chain/implementation-gate', app_id: 12345 },
    report_digest: `sha256:${'e'.repeat(64)}`,
  } satisfies TrustedGateAttestationEnvelope;
  await finalizeTrustedGateCheck({
    repository: 'techbeansjp-free/AGENTS.md',
    repositoryId: 77,
    credentials: { appId: '12345', privateKey: privateKeyPem },
    checkId: 501,
    report,
    attestation,
    reportOversize: true,
    fetchImpl: fetchImpl as typeof fetch,
  });
  const last = calls.at(-1);
  assert.ok(last?.url.endsWith('/check-runs/501'));
  assert.equal(last?.init?.method, 'PATCH');
  const patch = JSON.parse(String(last?.init?.body));
  assert.equal(patch.conclusion, 'action_required');
  assert.equal(JSON.parse(patch.output.text).schema_version, 'agent-skill-chain/check-output-error/v1');
});

test('attestation失敗はprepare済みCheckをaction_requiredで完了する', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/installation')) return new Response(JSON.stringify({ id: 88 }), { status: 200 });
    if (url.endsWith('/repos/techbeansjp-free/AGENTS.md')) {
      return new Response(JSON.stringify({ id: 77 }), { status: 200 });
    }
    if (url.endsWith('/access_tokens')) {
      return new Response(JSON.stringify({
        token: 'app-installation-token',
        expires_at: '2026-07-26T01:00:00Z',
      }), { status: 201 });
    }
    return new Response(JSON.stringify({ id: 501 }), { status: 200 });
  };
  const attestation = {
    schema_version: 'agent-skill-chain/gate-attestation/v1',
    repository: { full_name: 'techbeansjp-free/AGENTS.md', id: 77 },
    pr_number: 274,
    target_sha: SHA,
    gate: 'implementation',
    review_attempt: {
      attempt_id: 'attempt-1',
      expected_count: 2,
      evidence_digest: `sha256:${'d'.repeat(64)}`,
    },
    workflow: WORKFLOW,
    check: { id: 501, name: 'agent-skill-chain/implementation-gate', app_id: 12345 },
    report_digest: `sha256:${'e'.repeat(64)}`,
  } satisfies TrustedGateAttestationEnvelope;
  await finalizeTrustedGateCheckFailure({
    repository: 'techbeansjp-free/AGENTS.md',
    repositoryId: 77,
    credentials: { appId: '12345', privateKey: privateKeyPem },
    checkId: 501,
    attestation,
    reason: 'attestation_failed',
    fetchImpl: fetchImpl as typeof fetch,
  });

  const last = calls.at(-1);
  assert.ok(last?.url.endsWith('/check-runs/501'));
  assert.equal(last?.init?.method, 'PATCH');
  const patch = JSON.parse(String(last?.init?.body));
  assert.equal(patch.conclusion, 'action_required');
  assert.equal(JSON.parse(patch.output.text).reason, 'attestation_failed');
});
