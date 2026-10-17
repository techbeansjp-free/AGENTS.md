/** Release only a merged, CI-verified tree; never replace tags or asset bytes. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const checks=['linux',...['ubuntu-24.04','macos-latest','windows-latest'].map(os=>`Host protocol (${os})`),...['ubuntu-24.04','macos-latest','windows-latest'].map(os=>`worktree (${os})`),'Mac native sandbox and dependencies','base validatorで品質自己緩和を拒否'];
const demand=(ok,message)=>{if(!ok)throw Error(message);};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function releaseVersion(version){
 demand(/^0\.5\.(0|[1-9][0-9]*)(?:-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$/.test(version),'Invalid v0.5 release version');
 return {tag:`v${version}`,prerelease:version.includes('-')};
}
export async function nextVersion({api,repo,sha}){
 const refs=await api(`/repos/${repo}/git/matching-refs/tags/v0.5.`);
 let max=-1,existing;
 for(const ref of refs){
  const match=/^refs\/tags\/v0\.5\.(0|[1-9][0-9]*)$/.exec(ref.ref);
  if(!match)continue;
  const patch=Number(match[1]);demand(Number.isSafeInteger(patch),'Release version overflow');max=Math.max(max,patch);
  let object=ref.object;
  for(let depth=0;object.type==='tag'&&depth<8;depth++)object=(await api(`/repos/${repo}/git/tags/${object.sha}`)).object;
  if(object.type==='commit'&&object.sha===sha){demand(!existing,'Multiple release tags for source');existing=`0.5.${patch}`;}
 }
 demand(Number.isSafeInteger(max+1),'Release version overflow');
 return existing??`0.5.${max+1}`;
}
export async function verify({api,repo,sha,version}){
 releaseVersion(version);demand(/^[0-9a-f]{40}$/.test(sha),'Invalid source SHA');
 const prefix=`/repos/${repo}`;
 const main=await api(`${prefix}/commits/main`);demand(main.sha===sha,'Source must be current main');
 const manifest=await api(`${prefix}/contents/package.json?ref=${sha}`);
 const sourceVersion=JSON.parse(Buffer.from(manifest.content,'base64')).version;
 releaseVersion(sourceVersion);
 demand(Number(version.split('.')[2].split('-')[0])>=Number(sourceVersion.split('.')[2].split('-')[0]),'Distribution version predates source');
 const prs=await api(`${prefix}/commits/${sha}/pulls?per_page=100`);
 const pr=prs.find(p=>p.merged_at&&p.merge_commit_sha===sha&&p.base.ref==='main'&&p.head.repo?.full_name===repo);
 demand(pr,'No merged same-repository PR for source');
 const head=await api(`${prefix}/commits/${pr.head.sha}`);
 demand(head.commit.tree.sha===main.commit.tree.sha,'Merged tree differs from tested PR head');
 // CI checkout must bind to the PR HEAD, not an implicit synthetic merge ref.
 for(const name of ['ci.yml','worktree-execution.yml','native-verification.yml']){
  const file=await api(`${prefix}/contents/.github/workflows/${name}?ref=${sha}`);
  const text=Buffer.from(file.content,'base64').toString();
  const steps=text.split(/\n(?=\s*- uses: actions\/checkout@)/).slice(1);
  demand(steps.length===(name==='ci.yml'?2:1),'Unexpected checkout structure');
  for(const step of steps){
   const checkout=step.split(/\n\s*- (?:uses|name|run):/)[0];
   demand(/^\s+ref: \$\{\{ github.event.pull_request.head.sha \}\}\s*$/m.test(checkout),'CI is not pinned to PR HEAD');
  }
 }
 const runs=[];
 for(let page=1;;page++){
  const batch=await api(`${prefix}/commits/${pr.head.sha}/check-runs?filter=latest&per_page=100&page=${page}`);
  runs.push(...batch.check_runs);if(batch.check_runs.length<100)break;
 }
 const verifiedRuns=new Map();
 for(const name of checks){
  const matching=runs.filter(r=>r.name===name&&r.app?.slug==='github-actions'&&r.head_sha===pr.head.sha).sort((a,b)=>b.id-a.id);
  const check=matching[0];
  demand(check?.status==='completed'&&check?.conclusion==='success',`Required check not successful: ${name}`);
  const runId=/\/actions\/runs\/(\d+)\//.exec(check.details_url??'')?.[1];demand(runId,'Missing workflow run binding');
  if(!verifiedRuns.has(runId))verifiedRuns.set(runId,await api(`${prefix}/actions/runs/${runId}`));
  const run=verifiedRuns.get(runId);
  const workflow=name.startsWith('worktree (')?'worktree-execution.yml':name.startsWith('Mac native')?'native-verification.yml':name.startsWith('base validator')?'trusted-quality.yml':'ci.yml';
  demand(run.path===`.github/workflows/${workflow}`&&run.head_sha===pr.head.sha&&run.event===(workflow==='trusted-quality.yml'?'pull_request_target':'pull_request')&&run.status==='completed'&&run.conclusion==='success','Workflow run binding mismatch');
 }
 return {sha,version,pr:pr.number,testedHead:pr.head.sha,tree:head.commit.tree.sha};
}
export async function publish({api,repo,sha,version,files,notes}){
 const {tag,prerelease}=releaseVersion(version),prefix=`/repos/${repo}`;
 const latest=await api(`${prefix}/releases/latest`,{optional:true});
 if(!prerelease&&latest){
  const current=/^v(\d+)\.(\d+)\.(\d+)$/.exec(latest.tag_name);
  demand(current,'Unknown Latest version; refuse automatic replacement');
  const target=version.split('.').map(Number),previous=current.slice(1).map(Number);
  const delta=target.map((v,i)=>v-previous[i]).find(v=>v!==0)??0;
  demand(delta>=0,'Refuse to downgrade Latest');
 }
 let ref=await api(`${prefix}/git/ref/tags/${tag}`,{optional:true});
 if(ref){
  let object=ref.object;
  for(let depth=0;object.type==='tag'&&depth<8;depth++)object=(await api(`${prefix}/git/tags/${object.sha}`)).object;
  demand(object.type==='commit'&&object.sha===sha,'Existing tag targets another commit');
 }
 const releases=[];
 for(let page=1;;page++){
  const batch=await api(`${prefix}/releases?per_page=100&page=${page}`);
  releases.push(...batch.filter(r=>r.tag_name===tag));if(batch.length<100)break;
 }
 demand(releases.length<=1,'Ambiguous existing release');
 let release=releases[0];
 if(release)demand(release.prerelease===prerelease,'Existing release type mismatch');
 if(!ref)await api(`${prefix}/git/refs`,{method:'POST',body:{ref:`refs/tags/${tag}`,sha}});
 if(!release)release=await api(`${prefix}/releases`,{method:'POST',body:{tag_name:tag,target_commitish:sha,name:`ASC ${tag}`,body:notes,draft:true,prerelease,make_latest:'false'}});
 const assets=[];
 for(let page=1;;page++){
  const batch=await api(`${prefix}/releases/${release.id}/assets?per_page=100&page=${page}`);
  assets.push(...batch);if(batch.length<100)break;
 }
 demand(assets.every(a=>Object.hasOwn(files,a.name)),'Unexpected existing release asset');
 // Check every existing asset before uploading anything. A published release is immutable.
 for(const [name,bytes] of Object.entries(files)){
  const asset=assets.find(a=>a.name===name);
  if(asset){
   const existing=await api(`${prefix}/releases/assets/${asset.id}`,{binary:true});
   demand(digest(existing)===digest(bytes),`Existing asset differs: ${name}`);
  }else demand(release.draft,`Published release missing asset: ${name}`);
 }
 for(const [name,bytes] of Object.entries(files))if(!assets.some(a=>a.name===name)){
  const asset=await api(`/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,{method:'POST',upload:bytes});
  const observed=await api(`${prefix}/releases/assets/${asset.id}`,{binary:true});
  demand(digest(observed)===digest(bytes),`Uploaded asset differs: ${name}`);
 }
 if(release.draft)await api(`${prefix}/releases/${release.id}`,{method:'PATCH',body:{draft:false,prerelease,make_latest:prerelease?'false':'true'}});
 return {tag,sha,status:'published-or-identical',prerelease};
}
export async function githubApi(route,options={}){
 const {method='GET',body,optional=false,binary=false,upload}=options;
 const response=await fetch(`https://${upload?'uploads':'api'}.github.com${route}`,{method,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:binary?'application/octet-stream':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(upload?{'Content-Type':'application/octet-stream'}:body?{'Content-Type':'application/json'}:{})},body:upload??(body?JSON.stringify(body):undefined)});
 if(optional&&response.status===404)return null;
 demand(response.ok,`GitHub API ${method} ${route} failed (${response.status})`);
 return binary?Buffer.from(await response.arrayBuffer()):response.json();
}
async function main(){
 const [mode,directory]=process.argv.slice(2),{GITHUB_REPOSITORY:repo,EXPECTED_SHA:sha,RELEASE_VERSION:version}=process.env;
 demand(['plan','verify','publish'].includes(mode)&&/^[\w.-]+\/[\w.-]+$/.test(repo??''),'Invalid release invocation');
 demand(process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_SHA===sha,'Dispatch must use exact main SHA');
 if(mode==='plan'){
  const next=process.env.REQUESTED_VERSION||await nextVersion({api:githubApi,repo,sha});
  await verify({api:githubApi,repo,sha,version:next});
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`version=${next}\n`);
  console.log(JSON.stringify({sha,version:next}));return;
 }
 const result=await verify({api:githubApi,repo,sha,version});
 if(mode==='verify'){console.log(JSON.stringify(result));return;}
 const filename=`agent-skill-chain-${version}.tgz`,bytes=fs.readFileSync(path.join(directory,filename));
 const files={[filename]:bytes,'SHA256SUMS':Buffer.from(`${digest(bytes)}  ${filename}\n`),'source-commit.txt':Buffer.from(`${sha}\n`)};
 demand(fs.readFileSync(path.join(directory,'source-commit.txt'),'utf8')===files['source-commit.txt'].toString(),'Artifact source mismatch');
 demand(fs.readFileSync(path.join(directory,'SHA256SUMS'),'utf8')===files.SHA256SUMS.toString(),'Artifact checksum mismatch');
 const notes=`ASC v${version}\n\nSource: ${sha}\nVerified PR: #${result.pr}\nTested HEAD: ${result.testedHead}\n\nSee the packaged README and v05/MIGRATION_PLAN.md for usage, compatibility and validation limits. v0.4 commands are not compatible. This release does not grant runtime publication authority.\n\nPackage SHA256: ${digest(bytes)}\n`;
 console.log(JSON.stringify(await publish({api:githubApi,repo,sha,version,files,notes})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
