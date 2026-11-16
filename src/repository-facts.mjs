/** Environment and procedure facts learned from repeated failures in one repository (#1722).
 * A fact is a short reference note (a command, a setup step, where an artifact lives, the name of a needed environment
 * variable). It is shown at start only after work in two different worktrees has confirmed it, and it is hidden again
 * when later work contradicts it. Facts are not project rules: they grant nothing and never override AGENTS.md or the
 * owner. Specification, business and quality decisions have no kind here and stay with the owner.
 * The store lives in the Git common directory, so every worktree of the clone shares it, it is never committed, and
 * Claude Code and Codex read the same file. Directories outside Git have no store. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectLocation} from './project-location.mjs';
import {GIT_NULL_DEVICE,hideCredentials} from './source-limits.mjs';

export const FACT_KINDS=['command','setup','artifact-location','environment-variable'];
// Confirmation means work in more than one worktree saw it: the smallest count that is not a single observation.
// It is a definition, not a tuned threshold.
const CONFIRMING_PLACES=2,TEXT_LIMIT=300,ID=/^[a-z0-9][a-z0-9-]{0,62}$/,LOCK_WAIT_MILLISECONDS=5000;
const STORE='agent-skill-chain/repository-facts.json',SCHEMA='asc-repository-facts/v1';

const gitEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
const git=(cwd,...args)=>execFileSync('git',['-c',`core.hooksPath=${GIT_NULL_DEVICE}`,...args],{cwd,stdio:['ignore','pipe','pipe'],env:gitEnvironment(),encoding:'utf8'}).trim();

function where(directory){
 const {repo,gitManaged}=projectLocation(directory);
 if(!gitManaged)return {repo,store:null};
 const common=path.resolve(repo,git(repo,'rev-parse','--git-common-dir'));
 return {repo,place:fs.realpathSync(git(repo,'rev-parse','--show-toplevel')),store:path.join(common,STORE)};
}
function load(store){
 let bytes;try{bytes=fs.readFileSync(store,'utf8');}catch(error){if(error.code==='ENOENT')return {schema:SCHEMA,facts:[]};throw error;}
 const data=JSON.parse(bytes);
 if(data?.schema!==SCHEMA||!Array.isArray(data.facts))throw Error('Unsupported repository facts store: '+store);
 return data;
}
// One writer at a time across worktrees. A lock that stays is reported, never removed here: its owner may still run.
function withLock(store,change){
 fs.mkdirSync(path.dirname(store),{recursive:true});
 const lock=store+'.lock',deadline=Date.now()+LOCK_WAIT_MILLISECONDS;
 for(;;){
  try{fs.closeSync(fs.openSync(lock,'wx'));break;}catch(error){
   if(error.code!=='EEXIST')throw error;
   if(Date.now()>=deadline)throw Error(`Repository facts are locked by another writer: ${lock}. Remove it only after confirming no ASC command is running.`,{cause:error});
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  }
 }
 try{
  const data=load(store),result=change(data),temporary=`${store}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,store);
  return result;
 }finally{fs.rmSync(lock,{force:true});}
}
function text(value,label){
 if(typeof value!=='string')throw Error(`Expected ${label}`);
 const trimmed=value.trim();
 if(!trimmed||[...trimmed].length>TEXT_LIMIT||/[\u0000-\u001f\u007f]/.test(trimmed))throw Error(`${label} must be one line of 1-${TEXT_LIMIT} characters`);
 // Any credential-like value is refused rather than stored masked: a fact never needs one.
 if(hideCredentials(trimmed)!==trimmed)throw Error(`${label} must not contain a credential or secret value`);
 return trimmed;
}
function validId(id){if(typeof id!=='string'||!ID.test(id))throw Error('Fact id must be lowercase letters, digits and hyphens (at most 63)');return id;}
function status(fact){
 const after=Math.max(-1,...fact.contradictions.map(c=>c.sequence));
 if(fact.contradictions.length&&after>Math.max(...fact.observations.map(o=>o.sequence)))return {state:'contradicted',places:0};
 const places=new Set(fact.observations.filter(o=>o.sequence>after).map(o=>o.place)).size;
 return {state:places>=CONFIRMING_PLACES?'confirmed':'candidate',places};
}
const nextSequence=data=>1+Math.max(0,...data.facts.flatMap(f=>[...f.observations,...f.contradictions].map(e=>e.sequence)));

/** Record that work in this worktree hit the fact again. The same worktree counts once. */
export function recordFact(directory,{id,kind,text:value}){
 const {place,store}=where(directory);
 if(!store)throw Error('Repository facts need a Git repository; this directory is not managed by Git');
 validId(id);if(!FACT_KINDS.includes(kind))throw Error(`Fact kind must be one of ${FACT_KINDS.join(', ')}; specification, business and quality decisions belong to the owner`);
 value=text(value,'Fact text');
 if(kind==='environment-variable'&&!/^[A-Za-z_][A-Za-z0-9_]*(?:\s|$)/.test(value)||kind==='environment-variable'&&/=/.test(value))throw Error('An environment-variable fact names the variable first and never holds its value');
 return withLock(store,data=>{
  let fact=data.facts.find(f=>f.id===id);
  if(fact&&(fact.kind!==kind||fact.text!==value))throw Error(`Fact ${id} already says something else; contradict it first, then record the new fact under a new id`);
  if(!fact)data.facts.push(fact={id,kind,text:value,observations:[],contradictions:[]});
  fact.observations.push({place,sequence:nextSequence(data),at:new Date().toISOString()});
  return {schema:'asc-repository-fact-record/v1',id,...status(fact)};
 });
}
/** Record that work in this worktree found the fact wrong; it is hidden until new observations confirm it again. */
export function contradictFact(directory,{id,note}){
 const {place,store}=where(directory);
 if(!store)throw Error('Repository facts need a Git repository; this directory is not managed by Git');
 validId(id);const reason=note===undefined?undefined:text(note,'Contradiction note');
 return withLock(store,data=>{
  const fact=data.facts.find(f=>f.id===id);if(!fact)throw Error(`No repository fact ${id}`);
  fact.contradictions.push({place,sequence:nextSequence(data),at:new Date().toISOString(),...(reason?{note:reason}:{})});
  return {schema:'asc-repository-fact-record/v1',id,...status(fact)};
 });
}
/** Every fact with its state, for review. */
export function listFacts(directory){
 const {store}=where(directory);
 if(!store)return {schema:'asc-repository-facts-list/v1',available:false,facts:[]};
 return {schema:'asc-repository-facts-list/v1',available:true,store,facts:load(store).facts.map(f=>({id:f.id,kind:f.kind,text:f.text,...status(f)}))};
}
/** The part start shows: confirmed facts only, as reference notes. */
export function startFacts(directory){
 const {store}=where(directory);
 const authority='Reference notes learned from earlier work, not project rules: they grant no permission and never override AGENTS.md or the owner. Check one before relying on it; contradict it with fact-contradict when it is wrong.';
 if(!store)return {available:false,confirmed:[],authority};
 const facts=load(store).facts.map(f=>({f,s:status(f)}));
 return {available:true,confirmed:facts.filter(({s})=>s.state==='confirmed').map(({f})=>({id:f.id,kind:f.kind,text:f.text})),candidates:facts.filter(({s})=>s.state==='candidate').length,authority};
}
