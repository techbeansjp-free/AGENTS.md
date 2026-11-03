import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options:{fixture:{type:'string'},output:{type:'string'},'disable-skill':{type:'string'},help:{type:'boolean'}}});
if(values.help){
  console.log('node reproduce.mjs --fixture <installed-worktree> --output <new-output-directory> --disable-skill <personal-SKILL.md>');
}else{
  for(const key of ['fixture','output','disable-skill'])if(!values[key])throw Error(`Missing --${key}`);
  const output=path.resolve(values.output);
  fs.mkdirSync(output); // Refuse to overwrite earlier evidence.
  const cases=JSON.parse(fs.readFileSync(new URL('cases.json',import.meta.url),'utf8'));
  const base=['exec','--ephemeral','--ignore-user-config','--sandbox','read-only','-m','gpt-6.1-sol','-c','model_reasoning_effort="medium"','-c',`skills.config=[{path=${JSON.stringify(values['disable-skill'])},enabled=false}]`,'-C',path.resolve(values.fixture),'--json'];
  async function run(entry){
    const [id,prompt]=entry;
    const started=performance.now();
    const stdout=fs.openSync(path.join(output,`${id}.jsonl`),'wx');
    const stderr=fs.openSync(path.join(output,`${id}.stderr`),'wx');
    let timedOut=false;
    const child=spawn('codex',[...base,'-o',path.join(output,`${id}-answer.txt`),prompt],{stdio:['ignore',stdout,stderr]});
    const execution=await new Promise(resolve=>{
      let killTimer;
      const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);};
      const timer=setTimeout(()=>{
        timedOut=true;child.kill('SIGTERM');
        killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
      },300000);
      child.once('error',error=>{cleanup();resolve({exit:null,error:error.message});});
      child.once('close',(code,signal)=>{cleanup();resolve({exit:timedOut?'timeout':code,signal});});
    });
    fs.closeSync(stdout);fs.closeSync(stderr);
    const result={id,...execution,seconds:(performance.now()-started)/1000};
    fs.writeFileSync(path.join(output,`${id}-execution.json`),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  }
  let next=0;
  async function worker(){while(next<cases.length){const entry=cases[next++];await run(entry);}}
  await Promise.all([worker(),worker()]);
}
