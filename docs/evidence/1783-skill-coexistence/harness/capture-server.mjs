// Minimal stand-in for the model endpoint. It records each request body as one JSON line
// and answers with a fixed one-word reply, so the Host's listing can be observed without a model.
// Usage: node capture-server.mjs <port> <capture.jsonl> [skill-name]
// With [skill-name], the first main-loop request (one that offers the Skill tool and ends with plain user text)
// is answered with a Skill tool call for that name, to observe what the Host loads after the call.
import http from 'node:http';
import fs from 'node:fs';
const [port, out, skillCall] = process.argv.slice(2);
let called = false;
const toolUse = (model, skill) => [
  ['message_start', {type: 'message_start', message: {id: 'msg_capture_tool', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}}}],
  ['content_block_start', {type: 'content_block_start', index: 0, content_block: {type: 'tool_use', id: 'toolu_capture_1', name: 'Skill', input: {}}}],
  ['content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: JSON.stringify({skill})}}],
  ['content_block_stop', {type: 'content_block_stop', index: 0}],
  ['message_delta', {type: 'message_delta', delta: {stop_reason: 'tool_use', stop_sequence: null}, usage: {output_tokens: 1}}],
  ['message_stop', {type: 'message_stop'}],
].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const sse = (model) => [
  ['message_start', {type: 'message_start', message: {id: 'msg_capture', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}}}],
  ['content_block_start', {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}}],
  ['content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'ok'}}],
  ['content_block_stop', {type: 'content_block_stop', index: 0}],
  ['message_delta', {type: 'message_delta', delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 1}}],
  ['message_stop', {type: 'message_stop'}],
].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let json = null;
    try { json = JSON.parse(body); } catch { /* not JSON */ }
    fs.appendFileSync(out, JSON.stringify({method: req.method, path: req.url, body: json}) + '\n');
    const path = req.url.split('?')[0];
    if (path.endsWith('/count_tokens')) { res.writeHead(200, {'content-type': 'application/json'}); return res.end('{"input_tokens":1000}'); }
    if (path.endsWith('/v1/messages') && json) {
      const offersSkill = (json.tools ?? []).some((t) => t.name === 'Skill');
      const last = (json.messages ?? []).filter((m) => m.role !== 'system').at(-1);
      const plainUser = last?.role === 'user' && !(Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result'));
      if (skillCall && !called && offersSkill && plainUser && json.stream) { called = true; res.writeHead(200, {'content-type': 'text/event-stream'}); return res.end(toolUse(json.model, skillCall)); }
      if (json.stream) { res.writeHead(200, {'content-type': 'text/event-stream'}); return res.end(sse(json.model)); }
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(JSON.stringify({id: 'msg_capture', type: 'message', role: 'assistant', model: json.model, content: [{type: 'text', text: 'ok'}], stop_reason: 'end_turn', stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}}));
    }
    res.writeHead(404, {'content-type': 'application/json'}); res.end('{}');
  });
}).listen(Number(port), '127.0.0.1');
