import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checks,verify,publish,nextVersion,releaseVersion} from '../scripts/release.mjs';
const sha='a'.repeat(40),head='b'.repeat(40),repo='example/repo';
const content=value=>({content:Buffer.from(value).toString('base64')});
function verification(overrides={}){
 return async route=>{
  if(Object.hasOwn(overrides,route))return overrides[route];
  if(route.endsWith('/commits/main'))return {sha,commit:{tree:{sha:'tree'}}};
  if(route.includes('/contents/package.json'))return content('{"version":"0.5.0"}');
  if(route.includes('/contents/.github/workflows/'))return content(('\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - uses: actions/setup-node@v4').repeat(route.includes('/ci.yml')?2:1));
  if(route.includes('/pulls?'))return [{number:12,merged_at:'date',merge_commit_sha:sha,base:{ref:'main'},head:{sha:head,repo:{full_name:repo}}}];
  if(route.endsWith(`/commits/${head}`))return {commit:{tree:{sha:'tree'}}};
  if(route.includes('/actions/runs/')){const i=Number(route.split('/').at(-1));const name=checks[i];const file=name.startsWith('worktree (')?'worktree-execution.yml':name.startsWith('Mac native')?'native-verification.yml':name.startsWith('base validator')?'trusted-quality.yml':'ci.yml';return {path:`.github/workflows/${file}`,head_sha:head,event:file==='trusted-quality.yml'?'pull_request_target':'pull_request',status:'completed',conclusion:'success'};}
  if(route.includes('/check-runs?'))return {check_runs:checks.map((name,id)=>({id,name,details_url:`https://github.com/${repo}/actions/runs/${id}/job/1`,app:{slug:'github-actions'},head_sha:head,status:'completed',conclusion:'success'}))};
  throw Error(`Unexpected route ${route}`);
 };
}
test('release reuses only matching merged tree and completed checks',async()=>{
 assert.equal((await verify({api:verification(),repo,sha,version:'0.5.1'})).testedHead,head);
 for(const overrides of [
  {[`/repos/${repo}/commits/main`]:{sha:'c'.repeat(40)}},
  {[`/repos/${repo}/commits/${head}`]:{commit:{tree:{sha:'different'}}}},
  {[`/repos/${repo}/commits/${sha}/pulls?per_page=100`]:[]},
  {[`/repos/${repo}/commits/${head}/check-runs?filter=latest&per_page=100&page=1`]:{check_runs:[]}},
  {[`/repos/${repo}/contents/.github/workflows/ci.yml?ref=${sha}`]:content('implicit merge checkout')}
 ])await assert.rejects(verify({api:verification(overrides),repo,sha,version:'0.5.1'}));
});
test('automatic version increments stable patches and reuses the same source tag',async()=>{
 const refs=[{ref:'refs/tags/v0.5.0',object:{type:'commit',sha:'old'}},{ref:'refs/tags/v0.5.1-alpha.0',object:{type:'commit',sha:'preview'}}];
 assert.equal(await nextVersion({api:async()=>refs,repo,sha}),'0.5.1');
 refs.push({ref:'refs/tags/v0.5.1',object:{type:'commit',sha}});
 assert.equal(await nextVersion({api:async()=>refs,repo,sha}),'0.5.1');
 assert.equal(releaseVersion('0.5.1-rc.0').prerelease,true);
 for(const bad of ['0.5.01','0.6.0','0.5.1/attack'])assert.throws(()=>releaseVersion(bad));
});
function server({published=false,draft=false,wrongTag=false,wrongAsset=false,latest='v0.5.0'}={}){
 const calls=[],assets=[],files={'package.tgz':Buffer.from('package')};let release=published||draft?{id:1,draft:!published,prerelease:false}:null;
 if(published)assets.push({id:2,name:'package.tgz'});
 const api=async(route,options={})=>{
  calls.push({route,...options});
  if(route.endsWith('/releases/latest'))return {tag_name:latest};
  if(route.includes('/git/ref/tags/'))return published||wrongTag?{object:{type:'commit',sha:wrongTag?'wrong':sha}}:null;
  if(route.includes('/releases?per_page'))return release?[{...release,tag_name:'v0.5.1'}]:[];
  if(route.endsWith('/git/refs'))return {};
  if(route.endsWith('/releases')&&options.method==='POST'){release={id:1,...options.body};return release;}
  if(route.includes('/assets?per_page'))return assets;
  if(route.endsWith('/releases/assets/2'))return Buffer.from(wrongAsset?'changed':'package');
  if(route.includes('/assets?name=')){assets.push({id:2,name:'package.tgz'});return {id:2};}
  if(route.endsWith('/releases/1')&&options.method==='PATCH')return {};
  throw Error(route);
 };
 return {api,calls,files};
}
test('publish creates draft, uploads then publishes; identical rerun performs no writes',async()=>{
 for(const published of [false,true]){
  const s=server({published});await publish({...s,repo,sha,version:'0.5.1',notes:'notes'});
  const writes=s.calls.filter(c=>c.method);
  if(published)assert.equal(writes.length,0);
  else{assert.equal(writes[1].body.draft,true);assert.equal(writes.at(-1).body.make_latest,'true');assert.equal(writes.at(-1).body.draft,false);}
 }
});
test('conflicting tags, assets and Latest downgrade never overwrite published data',async()=>{
 for(const options of [{wrongTag:true},{published:true,wrongAsset:true},{latest:'v0.5.2'}]){
  const s=server(options);await assert.rejects(publish({...s,repo,sha,version:'0.5.1',notes:'notes'}));assert.equal(s.calls.filter(c=>c.method).length,0);
 }
});

test('interrupted draft resumes and uploaded-byte mismatch prevents publication',async()=>{
 const recovered=server({draft:true});await publish({...recovered,repo,sha,version:'0.5.1',notes:'notes'});
 assert(!recovered.calls.some(c=>c.route.endsWith('/releases')&&c.method==='POST'));
 assert.equal(recovered.calls.at(-1).body.draft,false);
 const broken=server({wrongAsset:true});await assert.rejects(publish({...broken,repo,sha,version:'0.5.1',notes:'notes'}),/Uploaded asset differs/);
 assert(!broken.calls.some(c=>c.method==='PATCH'));
});
test('lookalike check names from wrong workflows cannot authorize release',async()=>{
 const api=verification({[`/repos/${repo}/actions/runs/0`]:{path:'.github/workflows/other.yml',head_sha:head,event:'pull_request',status:'completed',conclusion:'success'}});
 await assert.rejects(verify({api,repo,sha,version:'0.5.1'}),/Workflow run binding/);
});
