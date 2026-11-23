// Counterexample probes for sandbox controls. Prints one JSON line per check.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = (check, ok, detail) => console.log(JSON.stringify({ check, enforced: ok, detail: String(detail).slice(0, 200) }));
try { await fetch('http://192.0.2.1/', { signal: AbortSignal.timeout(3000) }); out('external-network', false, 'fetch succeeded'); } catch (e) { out('external-network', true, e.cause?.code ?? e.name); }
try { fs.writeFileSync('/target/pwn.txt', 'x'); out('target-readonly', false, 'write succeeded'); } catch (e) { out('target-readonly', true, e.code); }
try { fs.writeFileSync('/probe/pwn.txt', 'x'); out('probe-readonly', false, 'write succeeded'); } catch (e) { out('probe-readonly', true, e.code); }
try { fs.writeFileSync('/etc/pwn.txt', 'x'); out('rootfs-readonly', false, 'write succeeded'); } catch (e) { out('rootfs-readonly', true, e.code); }
try { fs.writeFileSync('/scratch/ok.txt', 'x'); out('scratch-writable', true, 'ok'); } catch (e) { out('scratch-writable', false, e.code); }
try { fs.writeFileSync('/scratch/big.bin', Buffer.alloc(8 * 1024 * 1024)); out('file-size-limit', false, 'wrote 8MiB'); } catch (e) { out('file-size-limit', true, e.code); }
out('env-allowlist', Object.keys(process.env).sort().join(',') === 'HOME,HOSTNAME,NODE_VERSION,PATH,YARN_VERSION', Object.keys(process.env).sort().join(','));
out('home-is-scratch', process.env.HOME === '/scratch', process.env.HOME);
out('uid-nonroot', process.getuid() !== 0, process.getuid());
let ok = true; try { fs.readdirSync('/Users'); ok = false; } catch {} out('no-host-home', ok, fs.existsSync('/Users') ? 'exists' : 'absent');
const procs = spawnSync('sh', ['-c', 'i=0; while [ $i -lt 200 ]; do sleep 5 & i=$((i+1)); done 2>&1 | head -c 120; echo; jobs | wc -l'], { encoding: 'utf8', timeout: 8000 });
out('pids-limit', /can't fork|Resource temporarily unavailable|fork/i.test(procs.stdout + procs.stderr), (procs.stdout + procs.stderr).replace(/\s+/g, ' '));
const mem = spawnSync(process.execPath, ['-e', 'const a=[];for(;;)a.push(Buffer.alloc(16*1024*1024,1))'], { encoding: 'utf8', timeout: 20000 });
out('memory-limit', mem.status !== 0, `status=${mem.status} signal=${mem.signal}`);
