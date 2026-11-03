import json,subprocess,time,concurrent.futures,pathlib
import argparse
parser=argparse.ArgumentParser(description='Run natural-language routing cases against an already installed isolated fixture.')
parser.add_argument('--fixture',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--disable-skill',required=True,help='Absolute duplicate personal SKILL.md path; invocation override only')
args=parser.parse_args()
root=pathlib.Path(args.output).resolve();root.mkdir(parents=True,exist_ok=True)
cases=json.loads(pathlib.Path(__file__).with_name('cases.json').read_text())
base=['codex','exec','--ephemeral','--ignore-user-config','--sandbox','read-only','-m','gpt-6.1-sol','-c','model_reasoning_effort="medium"','-c','skills.config=[{path='+json.dumps(args.disable_skill)+',enabled=false}]','-C',str(pathlib.Path(args.fixture).resolve()),'--json']
def run(case):
 name,prompt,*_=case; start=time.time()
 with (root/(name+'.jsonl')).open('w') as out,(root/(name+'.stderr')).open('w') as err:
  try:r=subprocess.run(base+['-o',str(root/(name+'-answer.txt')),prompt],stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=300);status=r.returncode
  except subprocess.TimeoutExpired:status='timeout'
 result={'id':name,'exit':status,'seconds':round(time.time()-start,2)}
 (root/(name+'-execution.json')).write_text(json.dumps(result)+'\n');print(json.dumps(result),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(run,cases))
