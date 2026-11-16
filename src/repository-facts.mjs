/** Environment and procedure facts learned from repeated failures in one repository (#1722).
 * A fact is a short reference note (a command, a setup step, where an artifact lives, the name of a needed environment
 * variable). Work records one only after it hit the same failure repeatedly and confirmed the fix; from then on, start
 * shows it to the next work, so that work does not fail the same way. A contradiction hides it until work records it
 * again. Facts are not project rules: they grant nothing and never override AGENTS.md or the owner. Specification,
 * business and quality decisions have no kind here and stay with the owner; free text cannot be classified completely,
 * so the kinds, the refusals below and review limit what is recorded, and the writer remains responsible.
 * The store lives in the Git common directory: every worktree of the clone shares it, it is never committed, and Claude
 * Code and Codex read the same file. It belongs to this clone only. Directories outside Git have no store. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectLocation} from './project-location.mjs';
import {GIT_NULL_DEVICE,LOCAL_GIT_TIMEOUT_MILLISECONDS,hideCredentials} from './source-limits.mjs';

export const FACT_KINDS=['command','setup','artifact-location','environment-variable'];
const TEXT_LIMIT=300,ID=/^[a-z0-9][a-z0-9-]{0,62}$/,LOCK_WAIT_MILLISECONDS=5000;
const DIRECTORY='agent-skill-chain',FILE='repository-facts.json',SCHEMA='asc-repository-facts/v1';
// A fact never needs a secret, so recording refuses more than stderr masking hides: quoted values, a secret-like name
// followed by a value, and token shapes. Detection covers known shapes only; the writer remains responsible.
const SECRET_NAME='(?:password|passwd|pwd|pass|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|client[_-]?secret|credential)s?';
// The name stands alone (a word boundary on its left), may be quoted as in JSON, and is followed by ':' or '='.
const refusedSecrets=[
 new RegExp(`(?<![A-Za-z0-9])["']?${SECRET_NAME}["']?[^\\S\\n]*[:=]`,'i'),
 new RegExp(`--${SECRET_NAME}(?:[=\\s]+)\\S`,'i'),
 /\beyJ[A-Za-z0-9_-]{8}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{8}/,
 /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
 // An environment assignment such as PGPASSWORD=x or SECRET_KEY_BASE=x, as a recorded command would contain it. Upper
 // case only, so ordinary words (compass=north) still pass.
 /(?<![A-Za-z0-9_])[A-Z0-9_]*(?:PASS(?:WORD|WD|PHRASE)?|PWD|SECRET|TOKEN|CREDENTIALS?|KEY)[A-Z0-9_]*=\S/,
 // The same words inside an identifier in any case (dbPassword=x, an .npmrc _authToken=x).
 /[A-Za-z0-9_]*(?:password|passwd|passphrase|secret|token|credential)[A-Za-z0-9_]*=\S/i,
];
// One check for every text this module stores or shows: fact text, contradiction notes and a lock's worktree path.
const secretLike=value=>hideCredentials(value)!==value||refusedSecrets.some(p=>p.test(value));

const gitEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
const git=(cwd,...args)=>execFileSync('git',['-c',`core.hooksPath=${GIT_NULL_DEVICE}`,...args],{cwd,stdio:['ignore','pipe','pipe'],env:gitEnvironment(),encoding:'utf8',timeout:LOCAL_GIT_TIMEOUT_MILLISECONDS}).trim();

function where(location){
 const {repo,gitManaged}=location;
 if(!gitManaged)return {repo,store:null};
 const common=fs.realpathSync(path.resolve(repo,git(repo,'rev-parse','--git-common-dir')));
 return {repo,place:repo,directory:path.join(common,DIRECTORY),store:path.join(common,DIRECTORY,FILE)};
}
// The store is reached without following links, like project context files: a link here could redirect writes.
function noLink(file){
 try{if(fs.lstatSync(file).isSymbolicLink())throw Error('Repository facts must not be a symbolic link: '+file);}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
// Read a regular file only, without following a link or blocking on a FIFO; null when it does not exist.
function readRegular(file){
 let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
 catch(error){if(error.code==='ENOENT')return null;if(error.code==='ELOOP')throw Error('Repository facts must not be a symbolic link: '+file,{cause:error});throw error;}
 try{if(!fs.fstatSync(fd).isFile())throw Error('Repository facts must be a regular file: '+file);return fs.readFileSync(fd,'utf8');}
 finally{fs.closeSync(fd);}
}
// A stored fact passes the same checks as a recorded one, so a hand-edited store never shows what recording refuses.
function validFact(fact){
 const sequences=list=>Array.isArray(list)&&list.every(e=>e&&typeof e.place==='string'&&Number.isSafeInteger(e.sequence)&&e.sequence>0&&(e.note===undefined||typeof e.note==='string'));
 if(!fact||typeof fact.id!=='string'||!ID.test(fact.id)||!sequences(fact.observations)||!sequences(fact.contradictions))return false;
 try{factText(fact.kind,fact.text);for(const c of fact.contradictions)if(c.note!==undefined)text(c.note,'Contradiction note');return fact.text===fact.text.trim();}catch{return false;}
}
function load({directory,store}){
 // O_NOFOLLOW does not exist on Windows, so the store is also checked for a link before it is opened.
 noLink(directory);noLink(store);
 const bytes=readRegular(store);if(bytes===null)return {schema:SCHEMA,facts:[]};
 // The parser's message quotes the start of the file, which could be a value: report the path only.
 let data;try{data=JSON.parse(bytes);}catch(error){throw Error('Unsupported or damaged repository facts store (not JSON): '+store,{cause:error});}
 if(data?.schema!==SCHEMA||!Array.isArray(data.facts)||!data.facts.every(validFact)||new Set(data.facts.map(f=>f.id)).size!==data.facts.length)throw Error('Unsupported or damaged repository facts store: '+store);
 return data;
}
// One writer at a time across worktrees. A lock that stays is reported with its writer, never removed here.
function withLock(where,change){
 noLink(where.directory);fs.mkdirSync(where.directory,{recursive:true,mode:0o700});noLink(where.directory);
 const lock=where.store+'.lock',deadline=Date.now()+LOCK_WAIT_MILLISECONDS;
 for(;;){
  try{const fd=fs.openSync(lock,'wx',0o600);fs.writeSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),place:where.place}));fs.closeSync(fd);break;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   if(Date.now()>=deadline){
    // Only the expected fields are shown, from a regular file, so a lock never echoes other contents.
    let holder='unknown writer';
    try{
     const h=JSON.parse(readRegular(lock));
     const started=typeof h?.startedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(h.startedAt)&&!Number.isNaN(Date.parse(h.startedAt));
     const place=typeof h?.place==='string'&&h.place.length<=4096&&path.isAbsolute(h.place)&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(h.place)&&!secretLike(h.place);
     if(Number.isSafeInteger(h?.pid)&&h.pid>0&&started&&place)holder=`pid ${h.pid}, started ${h.startedAt}, worktree ${h.place}`;
    }catch{ /* Released meanwhile or not a lock written here. */ }
    throw Error(`Repository facts are locked by another writer (${holder}): ${lock}. Remove it only after confirming that process no longer runs.`,{cause:error});}
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  }
 }
 try{
  const data=load(where),result=change(data),temporary=`${where.store}.${process.pid}.tmp`;
  // Created exclusively, so an existing file or link at that name is never written through.
  let fd;
  try{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code==='EEXIST')throw Error(`A temporary repository facts file already exists: ${temporary}. Remove it after confirming no ASC command with pid ${process.pid} runs.`,{cause:error});throw error;}
  try{
   try{fs.writeSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(temporary,where.store);
  }catch(error){fs.rmSync(temporary,{force:true});throw error;}
  return result;
 }finally{fs.rmSync(lock,{force:true});}
}
function text(value,label){
 if(typeof value!=='string')throw Error(`Expected ${label}`);
 const trimmed=value.trim();
 if(!trimmed||[...trimmed].length>TEXT_LIMIT||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(trimmed))throw Error(`${label} must be one line of 1-${TEXT_LIMIT} characters`);
 // Refused rather than stored masked. Some ordinary wording ("token <long word>") matches too: rephrase it.
 if(secretLike(trimmed))throw Error(`${label} must not contain a credential or secret value; name what is needed without its value (a sentence that only looks like one must be rephrased)`);
 return trimmed;
}
function validId(id){if(typeof id!=='string'||!ID.test(id))throw Error('Fact id must be lowercase letters, digits and hyphens (at most 63)');return id;}
function factText(kind,value){
 if(!FACT_KINDS.includes(kind))throw Error(`Fact kind must be one of ${FACT_KINDS.join(', ')}; specification, business and quality decisions belong to the owner`);
 value=text(value,'Fact text');
 if(kind==='environment-variable'&&(!/^[A-Za-z_][A-Za-z0-9_]*(?:\s|$)/.test(value)||/=/.test(value)))throw Error('An environment-variable fact names the variable first and never holds its value');
 return value;
}
const afterContradiction=fact=>Math.max(0,...fact.contradictions.map(c=>c.sequence));
// Observations keep where and when work recorded the fact, for audit; one recording after the last contradiction shows it.
const status=fact=>({state:fact.observations.some(o=>o.sequence>afterContradiction(fact))?'shown':'contradicted'});
const nextSequence=data=>1+Math.max(0,...data.facts.flatMap(f=>[...f.observations,...f.contradictions].map(e=>e.sequence)));
const requireStore=location=>{const w=where(location);if(!w.store)throw Error('Repository facts need a Git repository; this directory is not managed by Git');return w;};

/** Record a fact after this work hit the same failure repeatedly and confirmed the fix. The next start shows it. */
export function recordFact(directory,{id,kind,text:value}){
 const w=requireStore(projectLocation(directory));
 validId(id);value=factText(kind,value);
 return withLock(w,data=>{
  let fact=data.facts.find(f=>f.id===id);
  const same=data.facts.find(f=>f.id!==id&&f.kind===kind&&f.text===value);
  if(same)throw Error(`The same fact is already recorded as ${same.id}; record it with that id`);
  if(fact&&(fact.kind!==kind||fact.text!==value))throw Error(`Fact ${id} already says (${fact.kind}) "${fact.text}". If that is the same fact, record it with exactly that kind and text; if it is wrong, contradict it and record the new fact under a new id`);
  if(!fact)data.facts.push(fact={id,kind,text:value,observations:[],contradictions:[]});
  // The same worktree confirming it again after the last contradiction adds nothing.
  const after=afterContradiction(fact);
  if(!fact.observations.some(o=>o.place===w.place&&o.sequence>after))fact.observations.push({place:w.place,sequence:nextSequence(data),at:new Date().toISOString()});
  return {schema:'asc-repository-fact-record/v1',id,...status(fact)};
 });
}
/** Record that the fact is wrong; start hides it until work records it again. */
export function contradictFact(directory,{id,note}){
 const w=requireStore(projectLocation(directory));
 validId(id);const reason=note===undefined?undefined:text(note,'Contradiction note');
 return withLock(w,data=>{
  const fact=data.facts.find(f=>f.id===id);if(!fact)throw Error(`No repository fact ${id}`);
  fact.contradictions.push({place:w.place,sequence:nextSequence(data),at:new Date().toISOString(),...(reason?{note:reason}:{})});
  return {schema:'asc-repository-fact-record/v1',id,...status(fact)};
 });
}
/** Every fact with its state and the note of its last contradiction, for review before recording. */
export function listFacts(directory){
 const w=where(projectLocation(directory));
 if(!w.store)return {schema:'asc-repository-facts-list/v1',available:false,facts:[]};
 return {schema:'asc-repository-facts-list/v1',available:true,store:w.store,facts:load(w).facts.map(f=>{
  const last=f.contradictions.at(-1);return {id:f.id,kind:f.kind,text:f.text,...status(f),...(last?.note?{lastContradiction:last.note}:{})};
 })};
}
/** The part start shows. A damaged store never stops start: facts are only reference notes. */
export function startFacts(location){
 const authority='Reference notes recorded by earlier work after repeated failures, not project rules: they grant no permission and never override AGENTS.md or the owner. Check one before relying on it; when it is wrong, run fact-contradict. Before recording a fact, run fact-list and reuse the id and text of the same fact.';
 let w;try{w=where(location);}catch(error){return {available:false,shown:[],error:error.message,authority};}
 if(!w.store)return {available:false,shown:[],authority};
 try{
  return {available:true,shown:load(w).facts.filter(f=>status(f).state==='shown').map(f=>({id:f.id,kind:f.kind,text:f.text})),authority};
 }catch(error){return {available:false,shown:[],store:w.store,error:error.message,authority};}
}
