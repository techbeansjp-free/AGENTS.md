#!/usr/bin/env node
// Survey which Git error wordings quote a repo-local config value, and whether gitStderrExcerpt hides it (#1691, #1696).
// For each documented config key (git help --config) and each value shape, it sets the key in a fresh repository and
// runs the Git argument forms that Controller, candidate and migration pass, with their environment and -c options. It prints
// JSON: the Git version, every stderr line form that quoted the value (key and value replaced by <key> and <v>), and
// every excerpt that still showed the value. The exit status is 1 when anything leaked.
//
//   node scripts/survey-git-config-stderr.mjs [--keys core.compression,core.filemode] [--values <json array>]
//
// The full run (about 1000 keys, 4 value shapes, 29 argument forms) takes tens of minutes. The wordings it found on
// Git 2.54 are pinned per key in test/test_git_failure.mjs; rerun it when a new Git version is supported.
import {spawnSync,execFileSync} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitStderrExcerpt} from '../src/source-limits.mjs';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
// Words with a space and a URL, a path that '~' cannot expand, and a bad regular expression; each carries the marker.
const values=JSON.parse(option('--values')??'["S3CRETX https://u:S3CRETY@example.invalid/","~nouser/S3CRETX","[S3CRETX(","S3CRETX\\nS3CRETY it\'s"]');
const keys=option('--keys')?.split(',')??execFileSync('git',['help','--config'],{encoding:'utf8'}).split('\n').map(s=>s.trim())
 .filter(s=>/^[A-Za-z0-9.<>_*-]+$/.test(s)&&s.includes('.')).map(s=>s.replace(/<[^>]*>/g,'x').replace(/\*/g,'x'));
const marker=/S3CRET/;

const work=fs.mkdtempSync(path.join(os.tmpdir(),'asc-config-survey-'));
try{
 const template=path.join(work,'template');fs.mkdirSync(template);
 // The environment of src/migration.mjs; Controller and candidate also set GIT_ALLOW_PROTOCOL and their own index.
 // The template is made in it too, so the user's global config and hooks do not change the survey.
 const env={PATH:process.env.PATH,HOME:work,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'};
 const g=(...a)=>execFileSync('git',['-c','core.hooksPath='+os.devNull,'-c','commit.gpgsign=false','-c','user.name=a','-c','user.email=a@example.invalid',...a],{cwd:template,env,stdio:'pipe',encoding:'utf8'}).trim();
 g('init','-q');fs.writeFileSync(path.join(template,'f'),'a\n');g('add','f');g('commit','-qm','x');fs.writeFileSync(path.join(template,'f'),'b\n');g('commit','-qam','y');
 const blob=g('rev-parse','HEAD:f');
 const base=['-c','core.fsmonitor=false','-c',`core.hooksPath=${os.devNull}`,'-c','protocol.allow=never'];
 // src/migration.mjs also runs in the consumer repository (project-assets checks its location there first, #1702).
 const migration=['-c','core.fsmonitor=false','-c',`core.hooksPath=${os.devNull}`,'-c','uploadpack.packObjectsHook=','-c','core.alternateRefsCommand=','-c','protocol.allow=never','-c','protocol.file.allow=always'];
 const out=path.join(work,'out');
 const migrationCommands=[['rev-parse','--show-toplevel'],['rev-parse','--absolute-git-dir'],['rev-parse','--path-format=absolute','--git-common-dir'],['for-each-ref','--format=%(refname)'],
  ['check-ref-format','--branch','main'],['cat-file','-s','HEAD'],['worktree','add','--no-checkout','-b','survey',out,'HEAD'],['clone','--no-local','--no-hardlinks','--no-checkout','.',out],['remote','remove','origin']];
 // The argument forms of src/controller.mjs and src/candidate.mjs, plus plain forms of the same commands.
 const commands=[['diff','--no-ext-diff','--no-textconv','--binary','HEAD~1','HEAD'],['diff','--name-only','-z','HEAD~1','HEAD'],['rev-parse','--verify','HEAD^{commit}'],['ls-tree','-r','-z','HEAD'],
  ['ls-tree','-rlz','--full-tree','HEAD'],['cat-file','--batch-check'],['cat-file','commit','HEAD'],['ls-files','-s'],['ls-files','--others','--ignored','--exclude-standard','--directory','-z'],
  ['merge-base','HEAD','HEAD~1'],['merge-base','--is-ancestor','HEAD~1','HEAD'],['read-tree','HEAD'],['hash-object','-w','f'],['hash-object','-w','--stdin'],['write-tree'],
  ['-c','commit.gpgsign=false','-c','user.name=n','-c','user.email=e@example.invalid','commit-tree','HEAD^{tree}','-p','HEAD','-m','m'],
  ['update-index','--refresh'],['update-index','--add','--cacheinfo','100644',blob,'g'],['update-index','--force-remove','--','g'],['update-ref','refs/heads/z','HEAD']].map(args=>({args:[...base,...args],controller:true})).concat(migrationCommands.map(args=>({args:[...migration,...args],controller:false})));
 const forms=new Map(),leaked=[];
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const [index,key] of keys.entries()){
  for(const value of values){
   const repo=path.join(work,'repo');fs.rmSync(repo,{recursive:true,force:true});fs.cpSync(template,repo,{recursive:true});
   // Through --file: a bad core.worktree also stops a plain 'git config' inside the repository.
   if(spawnSync('git',['config','--file',path.join(repo,'.git','config'),key,value],{cwd:work,env}).status!==0)continue;
   for(const {args:command,controller} of commands){
    const input=command.includes('--batch-check')?'HEAD\n':command.includes('--stdin')?'content\n':undefined;
    fs.rmSync(out,{recursive:true,force:true});
    const p=spawnSync('git',command,{cwd:repo,env:controller?{...env,GIT_ALLOW_PROTOCOL:'',GIT_INDEX_FILE:path.join(repo,'.git','index')}:env,input,timeout:20000});
    const stderr=p.stderr?.toString()??'';if(!marker.test(stderr))continue;
    for(const line of stderr.split('\n').filter(l=>marker.test(l))){
     const form=line.replace(new RegExp(escape(key),'gi'),'<key>').replace(/S3CRET[XY]/g,'<v>');
     if(!forms.has(form))forms.set(form,{key,command:command.find((a,i)=>command[i-1]!=='-c'&&a!=='-c')});
    }
    const shown=gitStderrExcerpt(p.stderr);if(marker.test(shown))leaked.push({key,value,command:command.filter((a,i)=>a!=='-c'&&command[i-1]!=='-c').join(' '),shown});
   }
  }
  if((index+1)%100===0)console.error(`${index+1}/${keys.length}`);
 }
 const report={git:execFileSync('git',['--version'],{encoding:'utf8'}).trim(),script:path.relative(process.cwd(),fileURLToPath(import.meta.url)),keys:keys.length,values,
  forms:[...forms].map(([form,where])=>({form,...where})),leaked};
 console.log(JSON.stringify(report,null,1));
 process.exitCode=leaked.length?1:0;
}finally{fs.rmSync(work,{recursive:true,force:true});}
