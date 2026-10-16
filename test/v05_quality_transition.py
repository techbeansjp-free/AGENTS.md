#!/usr/bin/env python3
"""Exercise the proposed trusted validator without running candidate code.

Pass the unchanged v0.4 base checkout (with tsx installed) and the reviewed
v0.5 candidate checkout. All mutations use disposable copies under /tmp.
This does not approve or activate the proposed policy and changes no GitHub settings.
"""
from pathlib import Path
import re,json,shutil,tempfile,subprocess,hashlib
import argparse
parser = argparse.ArgumentParser(description="Read-only base/candidate CI transition regression")
parser.add_argument("--trusted-root", required=True)
parser.add_argument("--candidate-root", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
r = Path(args.trusted_root).resolve()
w = Path(__file__).resolve().parents[1]
c = Path(args.candidate_root).resolve()
s=(w/'scripts/check_project_quality.ts').read_text();m=json.loads(s.split('const V05_CUTOVER_CONFIGURATION: Readonly<Record<string, string>> = ',1)[1].split(';',1)[0].replace(',\n}', '\n}'))
t=Path(tempfile.mkdtemp(prefix='asc-ci-maintenance-'));base=t/'base';base.mkdir()
for f in m:
 p=base/f;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(c/f,p)
for f in ['scripts/check_project_quality.ts','.github/trusted-quality-proposals.json']:
 p=base/f;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(w/f,p)
metadata = json.loads((c/'package.json').read_text())
metadata['agentSkillChain'] = {'qualityContractVersion': 16}
(base/'package.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
results=[]
def check(name,candidate,trusted,expect):
 args=['node','--import','tsx',str(w/'scripts/check_project_quality.ts'),f'--root={candidate}']
 if trusted:args.append(f'--trusted-root={trusted}')
 p=subprocess.run(args,cwd=r,text=True,capture_output=True)
 result={'case':name,'accepted':p.returncode==0,'expectedAccepted':expect,'output':p.stdout,'error':p.stderr};results.append(result)
 if (p.returncode==0)!=expect:raise AssertionError(result)
def digest(data):return hashlib.sha256(data).hexdigest()
def write(p,obj):p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
try:
 check('legacy remains valid',w,w,True)
 check('first cutover with retained base checker',base,w,True)
 check('no trusted base',base,None,False)
 check('new base unchanged',base,base,True)
 candidate=t/'candidate';shutil.copytree(base,candidate)
 for f in ['package.json','v05/package.json']:
  p=candidate/f;d=json.loads(p.read_text());d['version']='0.5.0';write(p,d)
 p=candidate/'package-lock.json';d=json.loads(p.read_text());d['version']='0.5.0';d['packages']['']['version']='0.5.0';write(p,d)
 check('coordinated version bump',candidate,base,True)
 shutil.rmtree(candidate);shutil.copytree(base,candidate)
 checker=base/'scripts/check_project_quality.ts';after=checker.read_bytes()+b'\n// reviewed maintenance fixture\n'
 registry=json.loads((base/'.github/trusted-quality-proposals.json').read_text())
 proposal={'proposalId':'TQP-V05-MAINTENANCE-TEST','status':'staged','fromVersion':16,'toVersion':17,'owner':'synthetic test owner','rationale':'Synthetic maintenance validates existing approval protocol.','rollback':'Register the prior checker bytes as a new forward approval.','targets':[{'kind':'file','name':'scripts/check_project_quality.ts','beforeSha256':digest(checker.read_bytes()),'afterSha256':digest(after)},{'kind':'packageField','name':'agentSkillChain.qualityContractVersion','beforeSha256':digest(b'16'),'afterSha256':digest(b'17')}]}
 registry['proposals'].append(proposal);write(candidate/'.github/trusted-quality-proposals.json',registry)
 check('new proposal registration',candidate,base,True)
 approved=t/'approved';shutil.copytree(candidate,approved)
 (candidate/'scripts/check_project_quality.ts').write_bytes(after)
 p=candidate/'package.json';d=json.loads(p.read_text());d['agentSkillChain']['qualityContractVersion']=17;write(p,d)
 check('activation cannot register itself',candidate,base,False)
 check('previously registered checker maintenance',candidate,approved,True)
 shutil.rmtree(candidate);shutil.copytree(base,candidate)
 shutil.copyfile(r/'scripts/check_project_quality.ts',candidate/'scripts/check_project_quality.ts')
 check('old checker rollback rejected',candidate,base,False)
 shutil.rmtree(candidate);shutil.copytree(base,candidate)
 p=candidate/'package.json';d=json.loads(p.read_text());d['version']='0.4.99';write(p,d)
 check('legacy version rollback rejected',candidate,base,False)
 for f,a,b in [('package.json','npm --prefix v05 test','echo skipped'),('v05/package.json','node --test','echo'),('.github/workflows/ci.yml','ASC_TEST_CGROUP: "1"','ASC_TEST_CGROUP: "0"'),('.github/workflows/trusted-quality.yml','working-directory: trusted','working-directory: candidate')]:
  shutil.rmtree(candidate);shutil.copytree(base,candidate);p=candidate/f;p.write_text(p.read_text().replace(a,b,1));check('unapproved '+f,candidate,base,False)
 for f in ['package.json','v05/package.json','.github/trusted-quality-proposals.json','.github/workflows/ci.yml']:
  shutil.rmtree(candidate);shutil.copytree(base,candidate);p=candidate/f;p.unlink();p.symlink_to(base/f);check('post-cutover identical symlink '+f,candidate,base,False)
 shutil.rmtree(candidate);shutil.copytree(base,candidate);shutil.rmtree(candidate/'.github');(candidate/'.github').symlink_to(base/'.github',target_is_directory=True);check('post-cutover parent symlink',candidate,base,False)
finally:
 Path(args.output).write_text(json.dumps({'fixture':str(t),'results':results},indent=2)+'\n')
print(json.dumps({'fixture':str(t),'passed':len(results)},indent=2))
