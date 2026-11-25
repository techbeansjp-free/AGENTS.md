// Tests for core-steps.mjs on synthetic stream-json transcripts (no model call). Run: node --test harness/core-steps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseTrial, summarize} from './core-steps.mjs';

let n = 0;
// Builds a transcript: each step = [toolName, input, result] where result is 'ok' | 'error' | 'mcp-error-text' | null (no result).
function transcript(steps, {extraLines = []} = {}) {
  const lines = [JSON.stringify({type: 'system', subtype: 'init', tools: ['Read', 'Write', 'mcp__browser__fetch_page']})];
  for (const [name, input, result] of steps) {
    n += 1; const id = `toolu_${n}`;
    lines.push(JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text: 'working'}, {type: 'tool_use', id, name, input}]}}));
    if (result === null) continue;
    const content = result === 'mcp-error-text' ? [{type: 'text', text: 'error: host not in allowlist: x.test'}] : [{type: 'text', text: result === 'ok' ? 'done' : 'failed'}];
    lines.push(JSON.stringify({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, is_error: result === 'error', content}]}}));
  }
  lines.push(...extraLines);
  lines.push(JSON.stringify({type: 'result', subtype: 'success', result: 'Notes: I viewed exemplars and compared two alternatives.'}));
  return lines.join('\n') + '\n';
}
const F = 'mcp__browser__fetch_page'; const V = 'mcp__browser__view_page'; const S = 'mcp__browser__screenshot';

test('full run: exemplar, two alternatives, both widths', () => {
  const r = analyseTrial(transcript([
    [F, {url: 'https://works.example/a'}, 'ok'],
    [V, {url: 'https://works.example/a', width: 390}, 'ok'],
    ['Write', {file_path: '/work/out/alt-a.html'}, 'ok'],
    ['Write', {file_path: '/work/out/alt-b.html'}, 'ok'],
    [S, {path: 'out/alt-a.html', width: 390}, 'ok'],
    [S, {path: 'out/alt-b.html', width: 390}, 'ok'],
    ['Write', {file_path: '/work/out/index.html'}, 'ok'],
    [S, {path: './out/index.html', width: 390}, 'ok'],
    [S, {path: 'out/index.html', width: 1440}, 'ok'],
  ]));
  assert.equal(r.coreSteps, true);
  assert.equal(r.exemplarViewed, true);
  assert.equal(r.alternativesCompared, true);
  assert.deepEqual(r.renderedFiles, ['out/alt-a.html', 'out/alt-b.html', 'out/index.html']);
  assert.equal(r.narrowChecked && r.wideChecked && r.finalBothWidths, true);
  assert.deepEqual(r.toolCalls.screenshot, {calls: 4, ok: 4, failed: 0, noResult: 0});
});

test('notes claim the steps but no tool calls exist', () => {
  const r = analyseTrial(transcript([['Write', {file_path: '/work/out/index.html'}, 'ok']]));
  assert.equal(r.coreSteps, false);
  assert.equal(r.exemplarViewed, false);
  assert.equal(r.toolCalls.fetch_page.calls, 0);
});

test('failed and blocked page calls do not count as viewing', () => {
  const r = analyseTrial(transcript([
    [F, {url: 'https://blocked.example/'}, 'error'],
    [V, {url: 'https://blocked.example/', width: 1440}, 'mcp-error-text'],
    [F, {url: 'https://works.example/'}, null],
    [S, {path: 'out/a.html', width: 390}, 'ok'], [S, {path: 'out/b.html', width: 390}, 'ok'],
  ]));
  assert.equal(r.exemplarViewed, false);
  assert.equal(r.alternativesCompared, true);
  assert.equal(r.coreSteps, false);
  assert.deepEqual(r.toolCalls.fetch_page, {calls: 2, ok: 0, failed: 1, noResult: 1});
  assert.equal(r.toolCalls.view_page.failed, 1);
});

test('one file rendered repeatedly is not two alternatives; versions are reported separately', () => {
  const r = analyseTrial(transcript([
    [F, {url: 'https://works.example/'}, 'ok'],
    ['Write', {file_path: '/work/out/index.html'}, 'ok'],
    [S, {path: 'out/index.html', width: 390}, 'ok'],
    ['Edit', {file_path: '/work/out/index.html'}, 'ok'],
    [S, {path: 'out/index.html', width: 390}, 'ok'],
    [S, {path: 'out/../out/index.html', width: 390}, 'ok'],
  ]));
  assert.equal(r.alternativesCompared, false);
  assert.equal(r.coreSteps, false);
  assert.deepEqual(r.renderedVersions, {'out/index.html': 2});
  assert.equal(r.wideChecked, false);
  assert.equal(r.finalBothWidths, false);
});

test('failed screenshots do not count; narrow width is configurable (UI-03 uses 800)', () => {
  const r = analyseTrial(transcript([
    [V, {url: 'https://works.example/', width: 1440}, 'ok'],
    [S, {path: 'out/a.html', width: 800}, 'ok'], [S, {path: 'out/b.html', width: 1440}, 'error'],
  ]), {narrow: 800});
  assert.equal(r.alternativesCompared, false);
  assert.equal(r.narrowChecked, true);
  assert.equal(r.wideChecked, false);
});

test('tools of another server name and malformed lines are not counted', () => {
  const r = analyseTrial(transcript([
    ['mcp__other__fetch_page', {url: 'https://works.example/'}, 'ok'],
    ['WebFetch', {url: 'https://works.example/'}, 'ok'],
  ], {extraLines: ['{not json', '']}));
  assert.equal(r.exemplarViewed, false);
  assert.equal(r.parseErrors, 1);
});

test('proxy log corroboration', () => {
  const t = transcript([[F, {url: 'https://works.example/'}, 'ok']]);
  const proxy = [
    {listener: 'browse', method: 'CONNECT', target: 'works.example:443', decision: 'allow'},
    {listener: 'browse', method: 'CONNECT', target: 'cdn.example:443', decision: 'deny', reason: 'host-not-allowlisted'},
    {listener: 'model', method: 'CONNECT', target: 'api.example:443', decision: 'allow'},
  ].map((x) => JSON.stringify(x)).join('\n');
  const r = analyseTrial(t, {proxyLog: proxy});
  assert.deepEqual(r.proxy, {allowed: 1, denied: 1, deniedReasons: {'host-not-allowlisted': 1}});
  assert.equal(r.proxyCorroborates, true);
  const r2 = analyseTrial(t, {proxyLog: ''});
  assert.equal(r2.proxyCorroborates, false);
});

test('summarize: 未判定 unless core-step trials are a strict majority of the case trials', () => {
  const mk = (c, cond, rep, core) => ({case: c, condition: cond, rep, coreSteps: core, exemplarViewed: core, alternativesCompared: core});
  const s = summarize([
    mk('ui04', 'D', 1, true), mk('ui04', 'D', 2, true), mk('ui04', 'D', 3, false),
    mk('ui04', 'E', 1, true), mk('ui04', 'E', 2, false), mk('ui04', 'E', 3, false),
    mk('ui07', 'D', 1, true), mk('ui07', 'D', 2, false),
  ]);
  const get = (c, cond) => s.find((g) => g.case === c && g.condition === cond);
  assert.equal(get('ui04', 'D').status, '判定可能');
  assert.equal(get('ui04', 'E').status, '未判定');
  assert.equal(get('ui07', 'D').status, '未判定'); // 1 of 2 is not a majority
  assert.equal(get('ui04', 'E').missing.length, 2);
});
