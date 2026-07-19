#!/usr/bin/env node
import * as issue from './commands/issue.js';
import * as lease from './commands/lease.js';
import * as segment from './commands/segment.js';
import * as gate from './commands/gate.js';
import * as pr from './commands/pr.js';
import * as adr from './commands/adr.js';
import * as checkpoint from './commands/checkpoint.js';
import * as cleanup from './commands/cleanup.js';
import * as doctor from './commands/doctor.js';
import * as reconcile from './commands/reconcile.js';
import * as setup from './commands/setup.js';
import * as sync from './commands/sync.js';
import * as lint from './commands/lint.js';
import * as verify from './commands/verify.js';
import * as report from './commands/report.js';
import * as testing from './commands/testing.js';

type Handler = (args: string[]) => Promise<number> | number;

const routes: Record<string, Handler> = {
  'issue start': issue.start,
  'issue resume': issue.resume,
  'lease acquire': lease.acquire,
  'lease release': lease.release,
  'lease renew': lease.renew,
  'segment start': segment.start,
  'gate review': gate.review,
  'gate publish': gate.publish,
  'gate reconcile': gate.reconcile,
  'pr create': pr.create,
  'adr finalize': adr.finalize,
  'report status': report.status,
  'test run': testing.run,
  'lint vocab': lint.vocab,
  'lint references': lint.references,
  'lint adr': lint.adr,
  'verify ac-coverage': verify.acCoverage,
  'verify adr': verify.adr,
  'verify artifacts': verify.artifacts,
  'verify branch-name': verify.branchName,
  'verify doc-length': verify.docLength,
  'verify gate-report': verify.gateReport,
  'verify template-sync': verify.templateSync,
  'verify worktree-path': verify.worktreePath,
  setup: setup.setup,
  'setup github': setup.github,
  'setup labels': setup.labels,
  'setup ruleset': setup.ruleset,
  'sync templates': sync.templates,
  checkpoint: checkpoint.run,
  cleanup: cleanup.run,
  doctor: doctor.run,
  reconcile: reconcile.run,
};

function printTopUsage(): void {
  const commands = Object.keys(routes).sort();
  process.stdout.write(
    [
      '使い方: agent-skill-chain <command> [subcommand] [args...]',
      '',
      '利用可能なコマンド:',
      ...commands.map((c) => `  ${c}`),
      '',
      '各コマンドの詳細は `agent-skill-chain <command> [subcommand] -h` を参照。',
    ].join('\n') + '\n',
  );
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printTopUsage();
    return 0;
  }

  const twoToken = argv.slice(0, 2).join(' ');
  const twoTokenHandler = routes[twoToken];
  if (twoTokenHandler) {
    return await twoTokenHandler(argv.slice(2));
  }

  const oneToken = argv[0];
  const oneTokenHandler = routes[oneToken];
  if (oneTokenHandler) {
    return await oneTokenHandler(argv.slice(1));
  }

  process.stderr.write(`未知のコマンドです: '${argv.join(' ')}'\n\n`);
  printTopUsage();
  return 1;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`予期しないエラー: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
