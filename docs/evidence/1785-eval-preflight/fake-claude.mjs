// モデルを呼ばない`claude -p`の代役（#1785の事前検査専用）。FAKE_MODEで出力の種類を選ぶ。
// 結果JSONをstdoutへ書き、Claude Codeと同じ場所（$HOME/.claude/projects/<cwd由来のkey>/）へsession記録を書く。
// session記録には、streamingで同じmessageが2回記録される場合（output_tokens 10→100）を含める。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const mode = process.env.FAKE_MODE ?? 'correct';
const args = process.argv.slice(2);
const at = args.indexOf('--session-id');
const sessionId = at >= 0 ? args[at + 1] : randomUUID();
const answers = {
  correct: 'ANSWER: bravo,echo,hotel,kilo,nova',
  wrong: 'ANSWER: alpha,charlie',
  partial: 'ANSWER: bravo,echo',
  empty: '',
};

function writeLog() {
  const key = fs.realpathSync(process.cwd()).replace(/[^A-Za-z0-9]/g, '-');
  const dir = path.join(process.env.HOME, '.claude/projects', key);
  fs.mkdirSync(dir, { recursive: true });
  const usage = (out) => ({ input_tokens: 3, output_tokens: out, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 });
  const lines = [
    { requestId: 'r1', message: { id: 'm1', role: 'assistant', model: 'fake-model', usage: usage(10) } },
    { requestId: 'r1', message: { id: 'm1', role: 'assistant', model: 'fake-model', usage: usage(100) } },
  ];
  fs.writeFileSync(path.join(dir, `${randomUUID()}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const result = (text, extra = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: text, total_cost_usd: 0.05, num_turns: 2, usage: {}, modelUsage: {}, ...extra });

fs.appendFileSync(path.join(process.env.HOME, 'invocations.log'), `${mode}\n`); // 再試行の有無を数える
if (mode === 'missing') process.exit(0); // 出力も記録も無い
writeLog();
if (mode in answers) process.stdout.write(result(answers[mode]));
else if (mode === 'broken') process.stdout.write('{"type":"result","is_error":false,"resu');
else if (mode === 'ratelimit') process.stdout.write(result('API Error: 429 rate_limit_error', { subtype: 'error_during_execution', is_error: true, total_cost_usd: 0 }));
else if (mode === 'stale') process.stdout.write(result(answers.correct, { session_id: randomUUID() }));
else if (mode === 'timeout') {
  if (process.env.FAKE_TIMEOUT_SLEEP) setTimeout(() => process.stdout.write(result(answers.correct)), Number(process.env.FAKE_TIMEOUT_SLEEP));
  else process.kill(process.pid, 'SIGKILL'); // spawnSyncのtimeoutと同じく、statusがnullになる
} else throw Error(`unknown FAKE_MODE ${mode}`);
