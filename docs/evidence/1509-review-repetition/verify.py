"""Execute the frozen behavioral oracle without changing the review subjects."""
from pathlib import Path
import subprocess,json,hashlib
HERE=Path(__file__).resolve().parent
ROOT=Path('/tmp/asc-1509-review-fixtures')
rows=[]
for scenario in ('authorization','private-helper','failed-save'):
 for stage in ('initial','after'):
  target=ROOT/scenario/stage
  if scenario=='authorization':
   js="""import {renameProject} from './subject.mjs';
const projects=new Map([['p',{organizationId:'other',title:'old'}]]);
const response=renameProject({organizationId:'mine'},'p','new',projects);
console.log(JSON.stringify({response,title:projects.get('p').title,contractSatisfied:response.status===403&&projects.get('p').title==='old'}));"""
  elif scenario=='private-helper':
   js="""import {renameDocument} from './subject.mjs';
const d={title:'old'};const rejected=['',null,0,{},[],true].every(title=>renameDocument(d,title).status===400&&d.title==='old');
const accepted=renameDocument(d,'new').status===200&&d.title==='new';
console.log(JSON.stringify({rejected,accepted,contractSatisfied:rejected&&accepted}));"""
  else:
   js="""import {updateNote} from './subject.mjs';
const record={note:'old'};const consumed=new Set();const store={get:id=>record,save:()=>{throw new Error('simulated write failure')}};
const response=updateNote(store,'x','new','k',consumed);
console.log(JSON.stringify({response,note:record.note,retryKeyConsumed:consumed.has('k'),stateContractSatisfied:record.note==='old',keyContractSatisfied:!consumed.has('k'),contractSatisfied:response.status===503&&record.note==='old'&&!consumed.has('k')}));"""
  proc=subprocess.run(['node','--input-type=module','-e',js],cwd=target,text=True,capture_output=True)
  assert proc.returncode==0,proc.stderr
  observation=json.loads(proc.stdout)
  expected = scenario=='private-helper' or scenario=='authorization' and stage=='after'
  assert observation['contractSatisfied']==expected, (scenario,stage,observation)
  if scenario=='failed-save': assert observation['keyContractSatisfied']==(stage=='after')
  rows.append({'scenario':scenario,'stage':stage,'argv':['node','--input-type=module','-e',js],'target':str(target),'exit_code':proc.returncode,'stdout':observation,'stderr':proc.stderr,'oracleMatched':True})
manifest=json.loads((HERE/'frozen-manifest.json').read_text())
repo=HERE.parents[2]
for name,digest in manifest['sha256'].items():
 p=Path(name)
 if not p.is_absolute():p=repo/p
 assert hashlib.sha256(p.read_bytes()).hexdigest()==digest,name
(HERE/'behavior-verification.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'oracle_matches':len(rows),'fixtures_unchanged':True}))
