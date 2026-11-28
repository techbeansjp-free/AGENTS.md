// Shared harness (#1861; not a fixed module, like dry-run.mjs and calibrate.mjs): run Bash commands through the Bash tool of the real Claude Code, inside its own sandbox, with
// no model. Claude Code is pointed (ANTHROPIC_BASE_URL) at a stand-in for the Messages API on 127.0.0.1 that answers each
// main-thread turn with one Bash tool_use from the command list, then ends the turn; the API key is a dummy, so no request
// can reach Anthropic and nothing is billed. Claude Code's interactive Bash mode ("!cmd") is not used: in 2.1.323 it runs
// the command outside the sandbox. The result of each command is the tool_result that Claude Code sends back.
// A command that should keep a program's error text away from the result writes it to a file under "$TMPDIR" (the
// trial's tmp/), which the person running this reads afterwards; nothing here reads or prints that file.
// The environment is built from scratch: HOME is the given test HOME (its .claude/settings.json is the user settings),
// never the real one: --home and --config-dir are refused when their real path is, or is under, the real HOME. Usage:
//   node claude-sandbox-bash.mjs --claude <bin> --cwd <dir> --home <test-home> --tmp <dir> --commands <json> --out <new-dir>
//        [--path <dirs joined by :>] [--config-dir <dir>] [-- <extra claude arguments>]
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const DUMMY_KEY_SUFFIX = 'ZZZZmodelfree1861ZZZ';
export const DUMMY_API_KEY = `sk-ant-api03-${'x'.repeat(60)}${DUMMY_KEY_SUFFIX}`;

/** One assistant message as JSON or as the server-sent events of a streamed reply. */
export function assistantReply(body, content, stop) {
  const msg = {id: `msg_fake_${Date.now()}`, type: 'message', role: 'assistant', model: body.model ?? 'fake', content, stop_reason: stop, stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}};
  if (!body.stream) return {type: 'application/json', text: JSON.stringify(msg)};
  const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify({type: t, ...d})}\n\n`;
  let text = ev('message_start', {message: {...msg, content: [], stop_reason: null, usage: {input_tokens: 1, output_tokens: 0}}});
  content.forEach((c, index) => {
    if (c.type === 'text') text += ev('content_block_start', {index, content_block: {type: 'text', text: ''}}) + ev('content_block_delta', {index, delta: {type: 'text_delta', text: c.text}});
    else text += ev('content_block_start', {index, content_block: {type: 'tool_use', id: c.id, name: c.name, input: {}}}) + ev('content_block_delta', {index, delta: {type: 'input_json_delta', partial_json: JSON.stringify(c.input)}});
    text += ev('content_block_stop', {index});
  });
  text += ev('message_delta', {delta: {stop_reason: stop, stop_sequence: null}, usage: {output_tokens: 1}}) + ev('message_stop', {});
  return {type: 'text/event-stream', text};
}

/** The stand-in: a request that offers the Bash tool gets the next command; any other request gets a short text. */
export function fakeMessagesApi(commands) {
  let next = 0;
  return (body) => {
    const tools = (body.tools ?? []).map((t) => t.name);
    if (!tools.includes('Bash')) return assistantReply(body, [{type: 'text', text: 'ok'}], 'end_turn');
    if (next < commands.length) {
      next += 1;
      return assistantReply(body, [{type: 'tool_use', id: `toolu_fake${next}`, name: 'Bash', input: {command: commands[next - 1], description: `step ${next}`}}], 'tool_use');
    }
    return assistantReply(body, [{type: 'text', text: 'done'}], 'end_turn');
  };
}

/** The tool_result of each step, from Claude Code's stream-json output. */
export function stepResults(streamText) {
  const results = new Map();
  for (const line of streamText.split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    for (const c of event?.type === 'user' && Array.isArray(event.message?.content) ? event.message.content : [])
      if (c.type === 'tool_result') results.set(c.tool_use_id, {isError: c.is_error === true, content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content)});
  }
  return results;
}

/**
 * The real path of `dir`, or of its nearest existing parent with the rest appended (a config directory may not exist yet).
 * A broken link is followed to where it points, since Claude Code would create its files there.
 * #1866 (PR #1864 review Low 1): the target of a broken link is resolved as the system does, one component at a time from
 * the real path of the link's directory: a ".." goes up from the real directory reached so far (not from the text of
 * the path, which differs when a component is itself a link), and each component that is a link is followed.
 */
export function realish(dir, hops = 0) {
  const abs = path.resolve(dir), rest = [];
  for (let at = abs; ; at = path.dirname(at)) {
    try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch (error) { if (error?.code !== 'ENOENT' || path.dirname(at) === at) throw error; }
    let link = null; try { if (fs.lstatSync(at).isSymbolicLink()) link = fs.readlinkSync(at); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (link !== null) {
      if (hops >= 40) throw new Error(`refused: too many links at ${at}`);
      return path.join(resolveLinkTarget(realish(path.dirname(at), hops + 1), link, hops + 1), ...rest.reverse());
    }
    rest.push(path.basename(at));
  }
}
/** The target of a link (its text), from the real directory `from`, component by component (see realish). */
export function resolveLinkTarget(from, target, hops = 0) {
  let cur = path.isAbsolute(target) ? path.parse(from).root : from;
  for (const part of target.split(/[\\/]+/).filter(Boolean)) {
    if (part === '.') continue;
    if (part === '..') { cur = path.dirname(cur); continue; }
    cur = realish(path.join(cur, part), hops);
  }
  return cur;
}

/** Refuse a test HOME or config directory that is, or is under, the real HOME (by real path; the account's HOME, not only $HOME). */
export function assertNotRealHome(dir, label, realHomes = [os.homedir(), os.userInfo().homedir]) {
  const target = realish(dir);
  for (const home of new Set(realHomes.filter(Boolean).map(realish))) {
    const rel = path.relative(home, target);
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))) throw new Error(`refused: ${label} is or is under the real HOME (${home})`);
  }
  return target;
}

export async function runInClaudeSandbox({claude, cwd, home, tmp, commands, out, pathDirs = '/usr/bin:/bin:/usr/sbin:/sbin', configDir = null, extra = []}) {
  if (fs.existsSync(out)) throw new Error(`refused: exists ${out}`);
  // The paths checked are the paths passed on; the default settings under the test HOME are checked too, also through a link.
  home = assertNotRealHome(home, '--home');
  if (configDir) configDir = assertNotRealHome(configDir, '--config-dir');
  for (const own of ['.claude', '.claude.json']) assertNotRealHome(path.join(home, own), `--home/${own}`);
  // #1866 (PR #1864 review Low 2): with --config-dir, Claude Code reads its settings, its .claude.json and the rest from that
  // directory, so every entry in it is checked too (a link in it to the real HOME is refused), as the entries of the test HOME.
  if (configDir) for (const own of new Set(['settings.json', '.claude.json', 'CLAUDE.md', ...(fs.existsSync(configDir) ? fs.readdirSync(configDir) : [])])) assertNotRealHome(path.join(configDir, own), `--config-dir/${own}`);
  fs.mkdirSync(out, {recursive: true});
  const reply = fakeMessagesApi(commands);
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) { res.writeHead(404, {'content-type': 'application/json'}); res.end('{"type":"error","error":{"type":"not_found_error","message":"stand-in"}}'); return; }
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { /* an empty body gets a text reply */ }
      const r = reply(body); res.writeHead(200, {'content-type': r.type}); res.end(r.text);
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const env = {PATH: pathDirs, HOME: home, TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, LANG: 'C.UTF-8', ANTHROPIC_API_KEY: DUMMY_API_KEY,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', ...(configDir ? {CLAUDE_CONFIG_DIR: configDir} : {})};
  const args = ['-p', 'run the steps', '--output-format', 'stream-json', '--verbose', '--max-turns', String(commands.length + 2), '--no-session-persistence', ...extra];
  const exit = await new Promise((ok) => {
    const child = spawn(claude, args, {cwd, env, stdio: ['ignore', fs.openSync(path.join(out, 'stream.jsonl'), 'w'), fs.openSync(path.join(out, 'stderr.txt'), 'w')]});
    child.on('exit', (code, signal) => ok({code, signal}));
  });
  server.close();
  const results = stepResults(fs.readFileSync(path.join(out, 'stream.jsonl'), 'utf8'));
  const record = {schema: 'asc-claude-sandbox-bash/v1', claudeVersion: spawnSync(claude, ['--version'], {encoding: 'utf8', env}).stdout.trim(), exit,
    steps: commands.map((command, i) => ({command, ...(results.get(`toolu_fake${i + 1}`) ?? {missing: true})}))};
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(record, null, 1) + '\n');
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2), dash = argv.indexOf('--');
  const own = dash < 0 ? argv : argv.slice(0, dash), extra = dash < 0 ? [] : argv.slice(dash + 1);
  const opt = (name) => { const i = own.indexOf(`--${name}`); return i < 0 ? null : own[i + 1]; };
  const need = ['claude', 'cwd', 'home', 'tmp', 'commands', 'out'];
  if (need.some((n) => !opt(n))) { console.error('usage: node claude-sandbox-bash.mjs --claude <bin> --cwd <dir> --home <test-home> --tmp <dir> --commands <json> --out <new-dir> [--path <dirs>] [--config-dir <dir>] [-- <claude args>]'); process.exit(2); }
  const record = await runInClaudeSandbox({claude: opt('claude'), cwd: path.resolve(opt('cwd')), home: path.resolve(opt('home')), tmp: path.resolve(opt('tmp')),
    commands: JSON.parse(fs.readFileSync(opt('commands'), 'utf8')), out: path.resolve(opt('out')), pathDirs: opt('path') ?? undefined, configDir: opt('config-dir'), extra});
  console.log(JSON.stringify({claudeVersion: record.claudeVersion, exit: record.exit, steps: record.steps.length, missing: record.steps.filter((s) => s.missing).length}));
}
