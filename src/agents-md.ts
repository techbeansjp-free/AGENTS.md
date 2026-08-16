#!/usr/bin/env node
import { routes } from './lib/cli-routes.js';

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
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`予期しないエラー: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
