/** Read-only v0.4 migration inventory. Never imports legacy approvals. */
import {SOURCE_FILE_BYTES} from './src/source-limits.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {safeName} from './src/controller.mjs';

export function inspectMigration(directory) {
  const root = fs.realpathSync(directory);
  const env = {PATH:process.env.PATH, HOME:root, GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_NO_REPLACE_OBJECTS:'1', GIT_NO_LAZY_FETCH:'1', GIT_ALLOW_PROTOCOL:'',
    GIT_TERMINAL_PROMPT:'0'};
  const git = (...args) => execFileSync('git', ['-c','core.fsmonitor=false','-c',
    'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
    '-c','protocol.allow=never',...args], {cwd:root,env,timeout:20000,maxBuffer:16*1024*1024});
  const head = git('rev-parse','--verify','HEAD^{commit}').toString().trim();
  const policyPath = '.agent-skill-chain/project-policy.json';
  const read = relative => {
    let current=root;
    for (const part of relative.split('/')) {
      if (!part || part==='.' || part==='..') throw Error('Unsafe inventory path');
      current=path.join(current,part);
      const entry=fs.lstatSync(current);
      if (entry.isSymbolicLink()) throw Error('Symlink in inventory');
      if (current===path.join(root,relative) && !entry.isFile()) throw Error('Nonregular inventory file');
    }
    const fd=fs.openSync(current,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      const stat=fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink!==1 || stat.size>SOURCE_FILE_BYTES) throw Error('Unsupported inventory file');
      return fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  };
  const inventory=[]; const configurationInventory=[]; const dirty=[]; const unsupported=[];
  const entries=git('ls-tree','-rz','--full-tree',head).toString('utf8').split('\0').filter(Boolean);
  if (entries.length>10000) throw Error('Inventory limit exceeded');
  const expectedIndex=new Map();
  for (const entry of entries) {
    const tab=entry.indexOf('\t');
    const [mode,kind,oid]=entry.slice(0,tab).split(' '); const name=entry.slice(tab+1);
    expectedIndex.set(name,{mode,oid});
    try { safeName(name); } catch { unsupported.push(name);continue; }
    if (kind!=='blob' || !['100644','100755'].includes(mode)) {unsupported.push(name);continue;}
    const size=Number(git('cat-file','-s',oid).toString());
    if (!Number.isSafeInteger(size) || size>SOURCE_FILE_BYTES) {unsupported.push(name);continue;}
    const expected=git('cat-file','blob',oid);
    try {
      if (!read(name).equals(expected)) dirty.push(name);
      if (process.platform!=='win32' && Boolean(fs.statSync(path.join(root,name)).mode & 0o111)!==(mode==='100755')) dirty.push(name);
    }
    catch { unsupported.push(name); }
    const category=['package.json','package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock'].includes(name)?'cli-dependencies':
      name.startsWith('.github/workflows/')?'ci':
      name.startsWith('.agent-skill-chain/skills/')||name.startsWith('.agent-skill-chain/hooks/')||name.startsWith('.agents/')||name.startsWith('.codex/')||name.startsWith('.claude/')||['AGENTS.md','CLAUDE.md'].includes(name)?'agent-entry':
      name===policyPath||name.startsWith('.agent-skill-chain/project/')?'project-policy':null;
    if(category)configurationInventory.push({path:name,category,sha256:crypto.createHash('sha256').update(expected).digest('hex'),disposition:'owner-reviewed-cutover-required'});
    if (name===policyPath || name.startsWith('.agent-skill-chain/project/') || name.startsWith('docs/') || name.endsWith('.feature') || ['AGENTS.md','CLAUDE.md'].includes(name)) {
      inventory.push({path:name,sha256:crypto.createHash('sha256').update(expected).digest('hex'),
        disposition:'preserve-as-input-not-approval'});
    }
  }
  const indexed=new Set();
  for (const entry of git('ls-files','--stage','-z').toString().split('\0').filter(Boolean)) {
    const tab=entry.indexOf('\t');const [mode,oid,stage]=entry.slice(0,tab).split(' ');const name=entry.slice(tab+1);
    indexed.add(name);const original=expectedIndex.get(name);
    if (stage!=='0' || !original || original.mode!==mode || original.oid!==oid) dirty.push(name);
  }
  for (const name of expectedIndex.keys()) if (!indexed.has(name)) dirty.push(name);
  const untracked=git('ls-files' ,'--others','--exclude-standard','-z').toString().split('\0').filter(Boolean);
  const policy=JSON.parse(read(policyPath).toString());
  const schema=policy?.schemaVersion;
  const flat=['agent-skill-chain/project-policy/v0.3.0','agent-skill-chain/project-policy/v0.3.1'].includes(schema)&&policy.policy===undefined;
  const manifest=schema==='agent-skill-chain/project-policy-manifest/v1';
  const policyReferences=[],invalidPolicyReferences=[];
  if(manifest){
    for(const key of ['choiceFiles','ruleFiles','conformanceFiles','providerFiles']){
      const values=policy[key];
      if(values===undefined&&key==='providerFiles')continue;
      if(!Array.isArray(values)){invalidPolicyReferences.push(key);continue;}
      for(const value of values){
        if(typeof value!=='string'){invalidPolicyReferences.push(key);continue;}
        const name='.agent-skill-chain/'+value;
        try{safeName(value);if(!value.startsWith('project/')||!value.endsWith('.json')||!expectedIndex.has(name))throw Error('Untracked policy reference');policyReferences.push(name);}
        catch{invalidPolicyReferences.push(key+':'+value);}
      }
    }
  }
  const runtimePaths=['.agent-skill-chain/runtime','.agent-skill-chain/tmp','.agent-skill-chain/staging'];
  const runtimePresent=runtimePaths.filter(p=>fs.existsSync(path.join(root,p)));
  if (git('rev-parse','HEAD').toString().trim()!==head) throw Error('HEAD changed during inventory');
  return {schema:'asc-v05-migration-inspection/v1',head,policySchema:schema,
    policyFormat:flat?'flat-policy':manifest?'manifest':'unsupported',embeddedPolicySchema:manifest?policy.policy?.schemaVersion??null:null,
    mode:'read-only',readyToMigrate:false,inventory,configurationInventory,policyReferences,invalidPolicyReferences,dirty:[...new Set(dirty)],untracked,unsupported,runtimePresent,
    blockers:[...(!flat&&!manifest?['unsupported-policy']:[]),...(manifest?['manifest-policy-cutover-required']:[]),...(invalidPolicyReferences.length?['unresolved-policy-references']:[]),...(dirty.length||untracked.length?['worktree-changes']:[]),
      ...(unsupported.length?['unsupported-files']:[]),...(runtimePresent.length?['owner-must-resolve-runtime-state']:[]),
      'migration-execution-not-performed'],
    limitations:['Read-only inventory, not authorization or atomic snapshot',
      'Runtime presence is conservative; does not claim every runtime directory is an active workflow',
      'No legacy Evidence is imported as approval']};
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length!==3) throw Error('Usage: node migration_inspect.mjs <project-root>');
    console.log(JSON.stringify(inspectMigration(process.argv[2]),null,2));
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
