#!/usr/bin/env node
// Runs the pinned SkillSpector image once per directory under <input-root>, static mode only, without network.
// usage: node run-skillspector.mjs <image> <input-root> <new-output-dir> <worktree-label> [extra scan options...]
// Each container is disposable (--rm), has no network, no capabilities, a read-only root and a read-only input mount,
// runs as the image's non-root user (USER scanner in skillspector.Dockerfile) and gets no environment from the caller,
// so no provider credential can reach it. Per fixture it writes <id>.json (the report on stdout) and <id>.stderr
// (the tail of stderr plus `ASC_MEASURE exit=<n> rss_kib=<n> seconds=<n>` measured inside the container).
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const [image, root, out, label, ...extra] = process.argv.slice(2);
if (!image || !root || !out || !label) throw Error('usage: run-skillspector.mjs <image> <input-root> <new-output-dir> <label> [options...]');
fs.mkdirSync(out, {recursive: false});
const measure = `
import resource, subprocess, sys, time
t = time.monotonic()
r = subprocess.run(["skillspector", "scan", "/scan/in", "--no-llm", "--format", "json", *sys.argv[1:]], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
sys.stdout.buffer.write(r.stdout)
sys.stderr.write(r.stderr.decode(errors="replace")[-4000:])
sys.stderr.write("\\nASC_MEASURE exit=%d rss_kib=%d seconds=%.2f\\n" % (r.returncode, resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss, time.monotonic() - t))
sys.exit(r.returncode)
`;
for (const entry of fs.readdirSync(root, {withFileTypes: true}).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = fs.realpathSync(path.join(root, entry.name));
  const started = Date.now();
  const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
    '--tmpfs', '/tmp:rw,size=256m', '--tmpfs', '/home/scanner:rw,size=64m', '--memory', '2g', '--pids-limit', '256',
    '--label', `asc.worktree=${label}`, '-v', `${dir}:/scan/in:ro`, '--entrypoint', 'python', image, '-c', measure, ...extra],
  {env: {PATH: process.env.PATH, HOME: process.env.HOME}, maxBuffer: 64e6, timeout: 1200000});
  fs.writeFileSync(path.join(out, entry.name + '.json'), result.stdout ?? '');
  fs.writeFileSync(path.join(out, entry.name + '.stderr'), result.stderr ?? '');
  console.log(`${entry.name} exit=${result.status ?? result.signal ?? result.error?.code} wall=${Math.round((Date.now() - started) / 1000)}s`);
}
