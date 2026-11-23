// Counterexample probes for sandbox controls. Prints one JSON line per check.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const out = (check, ok, detail) => console.log(JSON.stringify({ check, enforced: ok, detail: String(detail).slice(0, 200) }));
// External network: enforced only if the fetch fails with ENETUNREACH (no route at all), the only interface
// is loopback and there is no default route. Any other failure (timeout, EHOSTUNREACH) is unverified.
{
  let code = null;
  try { await fetch('http://192.0.2.1/', { signal: AbortSignal.timeout(3000) }); code = 'fetch-succeeded'; } catch (e) { code = e.cause?.code ?? e.name; }
  const ifaces = Object.keys(os.networkInterfaces()).sort().join(',');
  let defaultRoute = 'unreadable';
  try { defaultRoute = fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1).some((line) => line.split(/\s+/)[1] === '00000000') ? 'present' : 'absent'; } catch {}
  const detail = `fetch=${code} interfaces=${ifaces} defaultRoute=${defaultRoute}`;
  if (code === 'fetch-succeeded') out('external-network', false, detail);
  else if (code === 'ENETUNREACH' && ifaces === 'lo' && defaultRoute === 'absent') out('external-network', true, detail);
  else console.log(JSON.stringify({ check: 'external-network', enforced: 'unverified', detail }));
}
try { fs.writeFileSync('/target/pwn.txt', 'x'); out('target-readonly', false, 'write succeeded'); } catch (e) { out('target-readonly', true, e.code); }
try { fs.writeFileSync('/probe/pwn.txt', 'x'); out('probe-readonly', false, 'write succeeded'); } catch (e) { out('probe-readonly', true, e.code); }
try { fs.writeFileSync('/etc/pwn.txt', 'x'); out('rootfs-readonly', false, 'write succeeded'); } catch (e) { out('rootfs-readonly', true, e.code); }
try { fs.writeFileSync('/scratch/ok.txt', 'x'); out('scratch-writable', true, 'ok'); } catch (e) { out('scratch-writable', false, e.code); }
for (const dir of ['/dev/shm', '/tmp', '/var/tmp']) {
  try { fs.writeFileSync(`${dir}/pwn.txt`, 'x'); out(`no-write:${dir}`, false, 'write succeeded'); } catch (e) { out(`no-write:${dir}`, true, e.code); }
}
try { fs.writeFileSync('/scratch/big.bin', Buffer.alloc(8 * 1024 * 1024)); out('file-size-limit', false, 'wrote 8MiB'); } catch (e) { out('file-size-limit', true, e.code); }
out('env-allowlist', Object.keys(process.env).sort().join(',') === 'HOME,HOSTNAME,NODE_VERSION,PATH,YARN_VERSION', Object.keys(process.env).sort().join(','));
out('home-is-scratch', process.env.HOME === '/scratch', process.env.HOME);
out('uid-nonroot', process.getuid() !== 0, process.getuid());
let ok = true; try { fs.readdirSync('/Users'); ok = false; } catch {} out('no-host-home', ok, fs.existsSync('/Users') ? 'exists' : 'absent');
const mem = spawnSync(process.execPath, ['-e', 'const a=[];for(;;)a.push(Buffer.alloc(16*1024*1024,1))'], { encoding: 'utf8', timeout: 20000 });
// Only a kill by the memory cgroup (SIGKILL) counts as enforced; a timeout or spawn error is unverified.
const memDetail = `status=${mem.status} signal=${mem.signal} error=${mem.error?.code ?? null}`;
if (mem.signal === 'SIGKILL' && !mem.error) out('memory-limit', true, memDetail);
else console.log(JSON.stringify({ check: 'memory-limit', enforced: 'unverified', detail: memDetail }));
// File-descriptor limit (nofile=256): opening 300 descriptors must fail with EMFILE.
{
  const fds = [];
  let error = null;
  try { for (let i = 0; i < 300; i++) fds.push(fs.openSync('/probe/limits.mjs', 'r')); } catch (e) { error = e.code; }
  for (const fd of fds) fs.closeSync(fd);
  out('nofile-limit', error === 'EMFILE', `opened=${fds.length} error=${error}`);
}
// CPU quota (--cpus 0.5): the cgroup must expose the quota, and a single busy thread must get about half a CPU.
{
  let quota = null;
  try { quota = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(); } catch (e) { quota = `unreadable:${e.code}`; }
  const busy = spawnSync(process.execPath, ['-e', 'const s=Date.now(),c=process.cpuUsage();while(Date.now()-s<3000);const u=process.cpuUsage(c);console.log(((u.user+u.system)/1000/(Date.now()-s)).toFixed(2))'], { encoding: 'utf8', timeout: 20000 });
  const ratio = Number(String(busy.stdout ?? '').trim());
  out('cpu-limit', quota === '50000 100000' && ratio > 0 && ratio <= 0.6, `cpu.max=${quota} cpu/wall=${String(busy.stdout ?? '').trim() || busy.error?.code}`);
}
// Every writable mount other than /scratch must refuse a new file for this uid.
{
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map((line) => {
    const fields = line.split(' ');
    return { point: fields[4], options: fields[5] };
  }).filter((mount) => mount.options.split(',').includes('rw') && mount.point !== '/scratch');
  const writable = [];
  for (const { point } of mounts) {
    const file = path.join(point, `.probe-${process.pid}`);
    try { fs.writeFileSync(file, 'x', { flag: 'wx' }); writable.push(point); fs.rmSync(file); } catch {}
  }
  out('no-other-writable-mount', writable.length === 0, `rw mounts checked=${mounts.map((m) => m.point).join(',')} writable=${writable.join(',') || 'none'}`);
}
// Run last: the 200 background sleeps exhaust the pids limit (threads count), which would stall later child processes.
const procs = spawnSync('sh', ['-c', 'i=0; while [ $i -lt 200 ]; do sleep 5 & i=$((i+1)); done 2>&1 | head -c 120; echo; jobs | wc -l'], { encoding: 'utf8', timeout: 8000 });
out('pids-limit', /can't fork|Resource temporarily unavailable/i.test(procs.stdout + procs.stderr), (procs.stdout + procs.stderr).replace(/\s+/g, ' '));
