import path from "node:path";

export async function withProviderPath<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = `${directory}${path.delimiter}${previous ?? ""}`;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
}

export function codexFixtureScript(directory: string): string {
  return (
    `#!${process.execPath}\n` +
    `
const fs = require('node:fs');
const path = require('node:path');
const directory = ${JSON.stringify(directory)};
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
let initializationSent = false;
let catalogSent = false;
process.stdin.on('data', chunk => {
  input += chunk;
  if(args[0] !== 'app-server') return;
  if(!initializationSent && input.includes('"method":"initialize"')) {
    initializationSent = true;
    process.stdout.write(JSON.stringify({ id: 0, result: { userAgent: 'fixture' } })+'\\n');
  }
  if(!catalogSent && input.includes('model/list')) {
    catalogSent = true;
    process.stdout.write(fs.readFileSync(path.join(directory, 'catalog.jsonl'), 'utf8'));
  }
});
process.stdin.on('end', () => {
  if(args[0] === 'exec') {
    fs.appendFileSync(path.join(directory,'calls.jsonl'), JSON.stringify({args,input})+'\\n');
    const behaviorFile = path.join(directory,'behavior');
    const behavior = fs.existsSync(behaviorFile) ? fs.readFileSync(behaviorFile,'utf8') : 'complete';
    if(behavior === 'timeout') { setInterval(() => {}, 1000); return; }
    if(behavior === 'overflow') { process.stdout.write('x'.repeat(100000)); return; }
    process.stderr.write('token=private-test-value');
    process.stdout.write(JSON.stringify({ type: behavior === 'complete' ? 'turn.completed' : behavior === 'failed' ? 'turn.failed' : 'item.completed', text: 'token=private-test-value' })+'\\n');
    process.exitCode = behavior === 'failed' ? 1 : 0;
  }
});
`
  );
}
