/** Synthetic trial guard: inspect bytes without invoking Agent-controlled Git config. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export function gitControlState(origin){
 const git=path.join(origin,'.git'),state={};
 if(!fs.lstatSync(git).isDirectory())throw Error('Unsafe Git metadata');
 const exists=file=>{try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const read=(file)=>{if(!exists(file))return;if(!fs.lstatSync(file).isFile())throw Error('Unsafe Git control file');state[path.relative(git,file)]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');};
 read(path.join(git,'config'));read(path.join(git,'config.worktree'));
 const walk=dir=>{if(!exists(dir))return;if(!fs.lstatSync(dir).isDirectory())throw Error('Unsafe Git control directory');for(const n of fs.readdirSync(dir)){const f=path.join(dir,n);if(fs.lstatSync(f).isDirectory())walk(f);else read(f);}};
 walk(path.join(git,'hooks'));
 const trees=path.join(git,'worktrees');if(exists(trees)){if(!fs.lstatSync(trees).isDirectory())throw Error('Unsafe worktree metadata');for(const n of fs.readdirSync(trees)){const dir=path.join(trees,n);if(!fs.lstatSync(dir).isDirectory())throw Error('Unsafe worktree metadata');read(path.join(dir,'config.worktree'));}}
 return Object.fromEntries(Object.entries(state).sort(([a],[b])=>a.localeCompare(b)));
}
export function assertGitControlState(origin,expected){if(!expected||JSON.stringify(gitControlState(origin))!==JSON.stringify(expected))throw Error('Agent changed Git configuration or hooks; Host inspection refused');}
