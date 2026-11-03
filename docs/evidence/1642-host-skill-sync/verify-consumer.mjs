// Run outside the sandbox: node verify-consumer.mjs <baseline-source> <candidate-source> <new-output-directory>
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [baseline,candidate,destination]=process.argv.slice(2);
assert(baseline&&candidate&&destination,'Require baseline source, candidate source, and fresh output directory');
const output=path.resolve(destination);assert(!fs.existsSync(output),'Refuse to reuse output directory');fs.mkdirSync(output,{recursive:true});
const artifacts=path.join(output,'artifacts'),workspace=path.join(output,'workspace');fs.mkdirSync(artifacts);fs.mkdirSync(workspace);
const calls=[];
function command(cmd,args,cwd){const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:300000,maxBuffer:16000000});calls.push({cmd,args,cwd,status:r.status,stderr:r.stderr});assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;}
function pack(source,name){const result=JSON.parse(command('npm',['pack','--ignore-scripts','--json','--pack-destination',artifacts],source));const target=path.join(artifacts,name+'.tgz');fs.renameSync(path.join(artifacts,result[0].filename),target);return target;}
function future(archive,name){
 const folder=path.join(output,name+'-source');fs.mkdirSync(folder);command('tar',['-xzf',archive,'-C',folder]);const pkg=path.join(folder,'package');
 const old='execution-recovery',next='recovery-next';fs.cpSync(path.join(pkg,'skills',old),path.join(pkg,'skills',next),{recursive:true});
 const entry=path.join(pkg,'skills',next,'SKILL.md');fs.writeFileSync(entry,fs.readFileSync(entry,'utf8').replace('name: '+old,'name: '+next));
 const changed=path.join(pkg,'skills/verification-optimization/SKILL.md'),lines=fs.readFileSync(changed,'utf8').split('\n');lines[2]='description: Fixture release updated verification guidance.';fs.writeFileSync(changed,lines.join('\n'));
 const replace=s=>s.replace('skills/'+old+'/','skills/'+next+'/');
 const inventory=path.join(pkg,'src/runtime-files.json');fs.writeFileSync(inventory,JSON.stringify(JSON.parse(fs.readFileSync(inventory)).map(replace),null,2)+'\n');
 const manifest=path.join(pkg,'package.json'),data=JSON.parse(fs.readFileSync(manifest));data.version='0.5.0-fixture.next';data.files=data.files.map(replace);fs.writeFileSync(manifest,JSON.stringify(data,null,2)+'\n');
 return pack(pkg,name);
}
const old=pack(path.resolve(baseline),'baseline');future(old,'baseline-next');const next=pack(path.resolve(candidate),'fixed');future(next,'fixed-next');
const server=net.createServer(socket=>socket.destroy());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const script=fileURLToPath(new URL('run.mjs',import.meta.url)),node=fs.realpathSync(process.execPath);
const args=['--unshare-all','--new-session','--die-with-parent','--clearenv','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/tools','--ro-bind',node,'/tools/node','--ro-bind',artifacts,'/input','--ro-bind',script,'/run.mjs','--bind',workspace,'/workspace','--setenv','PATH','/tools:/usr/bin','--setenv','LANG','C.UTF-8','--setenv','ASC_TEST_HOST_NET',fs.readlinkSync('/proc/self/ns/net'),'--setenv','ASC_TEST_HOST_PORT',String(server.address().port),'--chdir','/workspace','/tools/node','/run.mjs'];
const start=performance.now();const result=spawnSync('bwrap',args,{encoding:'utf8',timeout:300000,maxBuffer:16000000});server.close();
const hashes=Object.fromEntries(fs.readdirSync(artifacts).map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(artifacts,name))).digest('hex')]));
fs.writeFileSync(path.join(output,'isolation.json'),JSON.stringify({node:process.version,baseline:path.resolve(baseline),candidate:path.resolve(candidate),fixture:'Synthetic next version: execution-recovery renamed to recovery-next, verification-optimization description changed; no published release claim',argv:['bwrap',...args],exit:result.status,seconds:(performance.now()-start)/1000,stdout:result.stdout,stderr:result.stderr,error:result.error?.message,hashes,calls},null,2)+'\n');
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
