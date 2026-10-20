import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {worktreeFixture} from './helpers/worktree-fixture.mjs';
import {assetHash,validateBrowserRequest,verifyBrowser} from '../scripts/isolated-browser-tool.mjs';
function fixture(t){
 const f=worktreeFixture(t),oracle=path.join(f.root,'oracle.mjs'),driver=path.join(f.root,'driver');
 fs.writeFileSync(oracle,'throw Error("not launched")');fs.mkdirSync(driver);fs.writeFileSync(path.join(driver,'index.mjs'),'export {}');
 return {f,config:{repo:f.work,oracle,driver,timeoutMilliseconds:60000,oracleSha256:createHash('sha256').update(fs.readFileSync(oracle)).digest('hex'),driverSha256:assetHash(driver)},head:f.git(f.work,'rev-parse','HEAD')};
}
test('browser tool accepts only a commit, never commands or alternate workspaces',()=>{
 validateBrowserRequest({head:'a'.repeat(40)});validateBrowserRequest({head:'b'.repeat(64)});
 for(const args of [null,{}, {head:'main'}, {head:'a'.repeat(40),command:'id'}, {head:'a'.repeat(40),repo:'/tmp'}])assert.throws(()=>validateBrowserRequest(args),/exact expected commit/);
});
test('browser tool rejects stale commits, dirty source and changed oracle before launch',t=>{
 const {f,config,head}=fixture(t);
 assert.throws(()=>verifyBrowser(config,{head:f.base}),/unchanged committed/);
 fs.mkdirSync(path.join(f.work,'complex'));fs.writeFileSync(path.join(f.work,'complex','unfinished.mjs'),'unfinished');
 assert.throws(()=>verifyBrowser(config,{head}),/unchanged committed/);
 fs.rmSync(path.join(f.work,'complex'),{recursive:true});fs.appendFileSync(config.oracle,';');
 assert.throws(()=>verifyBrowser(config,{head}),/assets changed/);
});
test('driver digest rejects symlinks and detects byte changes',t=>{
 const {config}=fixture(t);fs.appendFileSync(path.join(config.driver,'index.mjs'),';');assert.notEqual(assetHash(config.driver),config.driverSha256);
 fs.symlinkSync(config.oracle,path.join(config.driver,'escape'));assert.throws(()=>assetHash(config.driver),/regular files/);
});
test('MCP exposes one fixed action and reports invalid requests as failures',t=>{
 const {f,config}=fixture(t),file=path.join(f.root,'config.json');fs.writeFileSync(file,JSON.stringify(config));
 const requests=[{id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},{method:'notifications/initialized'}, {id:2,method:'tools/list'}, {id:3,method:'tools/call',params:{name:'verify_browser',arguments:{head:'main'}}}];
 const p=spawnSync(process.execPath,['scripts/isolated-browser-tool.mjs',file],{input:requests.map(r=>JSON.stringify({jsonrpc:'2.0',...r})).join('\n')+'\n',encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);const messages=p.stdout.trim().split('\n').map(s=>JSON.parse(s));assert.equal(messages.length,3);
 assert.equal(messages[1].result.tools.length,1);assert.equal(messages[1].result.tools[0].name,'verify_browser');assert.equal(messages[2].result.isError,true);
 assert.equal(JSON.parse(messages[2].result.content[0].text).passed,false);
});

test('committed external source symlink and unspecified timeout are rejected',t=>{
 const {f,config,head}=fixture(t);
 assert.throws(()=>verifyBrowser({...config,timeoutMilliseconds:undefined},{head}),/Explicit browser verification time budget/);
 const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.work,'complex'));
 f.git(f.work,'add','complex');f.git(f.work,'commit','-qm','external link');
 assert.throws(()=>verifyBrowser(config,{head:f.git(f.work,'rev-parse','HEAD')}),/real complex directory inside/);
});
