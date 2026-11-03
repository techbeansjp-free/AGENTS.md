// node verify.mjs <candidate-source> <fresh-output-directory> <npm-package-root>
// Linux bubblewrap; real npm, no network or user-home mount.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const [candidate,destination,npmRoot,priorTarball]=process.argv.slice(2);assert(candidate&&destination&&npmRoot);
const output=path.resolve(destination);assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const artifacts=path.join(output,'artifacts'),workspace=path.join(output,'workspace');fs.mkdirSync(artifacts);fs.mkdirSync(workspace);
const calls=[];function command(cmd,args,cwd){const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:300000,maxBuffer:16000000});calls.push({cmd,args,cwd,status:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;}
function pack(source,name){const result=JSON.parse(command('npm',['pack','--ignore-scripts','--json','--pack-destination',artifacts],source));const target=path.join(artifacts,name+'.tgz');fs.renameSync(path.join(artifacts,result[0].filename),target);return target;}
function future(archive,name){
 const folder=path.join(output,name+'-source');fs.mkdirSync(folder);command('tar',['-xzf',archive,'-C',folder]);const pkg=path.join(folder,'package');
 const old='execution-recovery',next='recovery-next';fs.cpSync(path.join(pkg,'skills',old),path.join(pkg,'skills',next),{recursive:true});
 const entry=path.join(pkg,'skills',next,'SKILL.md');fs.writeFileSync(entry,fs.readFileSync(entry,'utf8').replace('name: '+old,'name: '+next));
 const changed=path.join(pkg,'skills/verification-optimization/SKILL.md'),lines=fs.readFileSync(changed,'utf8').split('\n');lines[2]='description: Fixture release updated verification guidance.';fs.writeFileSync(changed,lines.join('\n'));
 const replace=s=>s.replace('skills/'+old+'/','skills/'+next+'/');
 const inventory=path.join(pkg,'src/runtime-files.json'),prior=JSON.parse(fs.readFileSync(inventory));
 const retiredPath=path.join(pkg,'src/retired-project-assets.json'),retired=JSON.parse(fs.readFileSync(retiredPath));
 for(const name of prior.filter(p=>p.startsWith('skills/'+old+'/')))for(const prefix of ['.agent-skill-chain/','.agent-skill-chain/managed-runtime/'])retired.push(prefix+name);
 fs.writeFileSync(retiredPath,JSON.stringify([...new Set(retired)].sort(),null,2)+'\n');
 fs.writeFileSync(inventory,JSON.stringify(prior.map(replace),null,2)+'\n');
 const manifest=path.join(pkg,'package.json'),data=JSON.parse(fs.readFileSync(manifest));data.version='0.5.0-fixture.next';data.files=data.files.map(replace);fs.writeFileSync(manifest,JSON.stringify(data,null,2)+'\n');
 return pack(pkg,name);
}

const archive=pack(path.resolve(candidate),'fixed');future(archive,'fixed-next');
if(priorTarball)fs.copyFileSync(path.resolve(priorTarball),path.join(artifacts,'prior.tgz'));
const unpack=path.join(output,'candidate-unpacked');fs.mkdirSync(unpack);command('tar',['-xzf',archive,'-C',unpack]);
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const payload=JSON.parse(fs.readFileSync(path.join(candidate,'src/runtime-files.json'))).map(file=>{const source=sha(path.join(candidate,file)),packed=sha(path.join(unpack,'package',file));assert.equal(packed,source,file);return {file,sha256:packed};});
fs.writeFileSync(path.join(output,'candidate-payload.json'),JSON.stringify(payload,null,2)+'\n');
const passwd=path.join(output,'passwd');fs.writeFileSync(passwd,'fixture:x:'+process.getuid()+':'+process.getgid()+':fixture:/workspace/user-home:/bin/sh\n');
const args=['--unshare-all','--new-session','--die-with-parent','--clearenv','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/etc','--ro-bind',passwd,'/etc/passwd','--dir','/tools','--ro-bind',fs.realpathSync(process.execPath),'/tools/node','--ro-bind',path.resolve(npmRoot),'/tools/npm','--ro-bind',artifacts,'/input','--ro-bind',fileURLToPath(new URL('run.mjs',import.meta.url)),'/run.mjs','--bind',workspace,'/workspace','--setenv','PATH','/tools:/usr/bin','--setenv','LANG','C.UTF-8','--setenv','npm_config_userconfig','/tmp/no-user-npmrc','--setenv','npm_config_globalconfig','/tmp/no-global-npmrc','--chdir','/workspace','/tools/node','/run.mjs'];
const result=spawnSync('bwrap',args,{encoding:'utf8',timeout:300000,maxBuffer:16000000});
fs.writeFileSync(path.join(output,'execution.json'),JSON.stringify({argv:['bwrap',...args],node:process.version,npm:JSON.parse(fs.readFileSync(path.join(npmRoot,'package.json'))).version,exit:result.status,stdout:result.stdout,stderr:result.stderr,calls,tarballs:Object.fromEntries(fs.readdirSync(artifacts).map(n=>[n,sha(path.join(artifacts,n))])),fixture:'Synthetic next release renames a Skill and declares its exact retired asset paths in the trusted package history; not a published release. Real uninstall CLI used, including bundled self-removal.'},null,2)+'\n');
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0,result.error?.message);assert.equal(JSON.parse(fs.readFileSync(path.join(workspace,'results.json'))).passed,true);
