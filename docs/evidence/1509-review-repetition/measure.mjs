// Node port for future reproduction. Original six measurements used Python.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { here, repo, root, scenarios, stages, checkFrozen, runProcess, writeJson } from './harness.mjs';

if (process.argv.length !== 3) throw Error('Usage: node measure.mjs <new-output-directory>');
const output = path.resolve(process.argv[2]);
checkFrozen();
fs.mkdirSync(output); // Refuse to overwrite original or previous measured evidence.
const traces = path.join(output, 'traces'); fs.mkdirSync(traces);
const skill = path.join(repo, 'skills/asc/references/review.md');
const results = [];
for (const scenario of scenarios) {
  for (const stage of stages) {
    const runId = `${scenario}-${stage}`, target = path.join(root, scenario, stage);
    const test = await runProcess(['node', 'test.mjs'], { cwd: target, timeoutMs: 30000 });
    assert.equal(test.exitCode, 0, test.stderr);
    assert.equal(test.timedOut, false);
    let history = '初回レビューのため過去指摘はありません。';
    if (stage === 'after') history = '前回レビューの出力（主張を鵜呑みにせず現在の実体で検証する）:\n' + fs.readFileSync(path.join(traces, `${scenario}-initial.answer.txt`), 'utf8');
    const prompt = `ASCの独立Reviewerとしてレビューのみ実施してください。現在のHostの新規contextです。
手順: ${skill} を読み、参照先の変更のレビューと是正Skillも読んで適用してください。
対象はGit未管理の合成Node fixture: ${target}。base/HEADなし。before.mjsが変更前、subject.mjsがレビュー対象の変更後、requirements.txtが元要求・受入条件、test.mjsが既存テストです。対象の全公開APIと関連経路はこのmodule内で完結しています。レビュー用コピーやworktreeを作らず、この対象実体で確認してください。
適用契約: 要求を満たす操作と失敗時不変性を確認し、要求外の保証・抽象化を追加しない。差分外の既存防御も反証として確認する。指摘は現在成立する根拠・影響・既存対策による反証・必要な是正と検証を示す。以前の指摘でも現在の対象で成立するか確認する。書込み禁止で、node test.mjs と node --input-type=module による無書込みの追加確認は可能です。編集・外部アクセス・追加Agent起動はしないでください。
既存検証: node test.mjs exit=${test.exitCode}; ${test.stdout.trim()}
レビュー履歴:\n${history}
調査対象は上記fixtureと参照Skillのみです。docs/evidence内のfixture生成元・oracle・集計・別試行は参照しないでください。
指摘・確認した重要な振る舞い・未確認事項・現在の対象を日本語で簡潔に報告してください。修正は実施しないでください。
`;
    fs.writeFileSync(path.join(traces, `${runId}.prompt.txt`), prompt);
    const argv = ['codex', '-a', 'never', 'exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--json', '--color', 'never', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="medium"', '-c', 'web_search="disabled"', '-s', 'read-only', '-C', target, '-'];
    const started = new Date().toISOString();
    const run = await runProcess(argv, { cwd: target, input: prompt });
    fs.writeFileSync(path.join(traces, `${runId}.jsonl`), run.stdout);
    fs.writeFileSync(path.join(traces, `${runId}.stderr.txt`), run.stderr);
    const events = []; let parseErrors = 0;
    for (const line of run.stdout.split('\n').filter(Boolean)) {
      try { events.push(JSON.parse(line)); } catch { parseErrors++; }
    }
    const answer = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text).join('\n\n');
    fs.writeFileSync(path.join(traces, `${runId}.answer.txt`), answer);
    const completed = events.filter(e => e.type === 'turn.completed');
    const row = { run_id: runId, started_at_utc: started, wall_seconds: run.wallSeconds, argv, exit_code: run.exitCode, signal: run.signal, error: run.error, timeout: run.timedOut, termination_signals: run.signals, turn_completed: completed.length > 0, usage: completed.at(-1)?.usage ?? null, parse_errors: parseErrors, missing: completed.length ? [] : ['turn.completed', 'token usage'], existing_test: { argv: ['node', 'test.mjs'], exit_code: test.exitCode, stdout: test.stdout }, thread_id: events.find(e => e.type === 'thread.started')?.thread_id ?? null, harness: 'Node port; separate reproduction, not original Python measurement' };
    results.push(row); writeJson(path.join(output, 'measurements.json'), results);
    console.log(JSON.stringify(row));
    checkFrozen();
    if (!answer || run.exitCode !== 0 || run.timedOut || !completed.length) throw Error(`${runId}: incomplete; no automatic retry`);
  }
}
