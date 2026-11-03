from pathlib import Path
import json, hashlib, datetime
out=Path('docs/evidence/1509-review-repetition'); root=Path('/tmp/asc-1509-review-fixtures'); root.mkdir(exist_ok=True)
fixtures={
'authorization': {
'requirements': '公開操作 renameProject(user, projectId, title, projects) を追加する。user は認証済みの通常のJSON値。自組織の既存projectだけ改名でき、他組織は403、未存在は404。拒否時はproject状態を変更しない。title は空でないstringのみ受け付け、形式不正は400。projects はMap。titleのtrim等は要求しない。公開export以外からの呼出しは対象外。',
'initial': '''export function renameProject(user, projectId, title, projects) {
  if (typeof title !== 'string' || title.length === 0) return { status: 400 };
  const project = projects.get(projectId);
  if (!project) return { status: 404 };
  project.title = title;
  return { status: 200 };
}
''',
'after': '''export function renameProject(user, projectId, title, projects) {
  if (typeof title !== 'string' || title.length === 0) return { status: 400 };
  const project = projects.get(projectId);
  if (!project) return { status: 404 };
  if (project.organizationId !== user.organizationId) return { status: 403 };
  project.title = title;
  return { status: 200 };
}
''',
 'test': '''import assert from 'node:assert/strict';
import { renameProject } from './subject.mjs';
const p = new Map([['p', {organizationId:'a',title:'old'}]]);
assert.equal(renameProject({organizationId:'a'},'p','new',p).status,200);
assert.equal(p.get('p').title,'new');
assert.equal(renameProject({organizationId:'a'},'absent','new',p).status,404);
assert.equal(renameProject({organizationId:'a'},'p',0,p).status,400);
console.log('existing authorization tests passed');
''',
'oracle': {'initial':['F1 cross-organization update accepted; status200 and title changed'], 'after':[], 'repetition':'afterに現行反例なしで組織認可を再要求するのは不要再提示'}},
'private-helper': {
'requirements':'公開操作 renameDocument(document, title) を追加する。document は呼出側が所有する通常のobject。title はJSON由来の通常の値で、空でないstringのみ受け付ける。形式不正は400でdocument不変、成功はtitleを保存し200を返す。公開export以外は内部実装であり直接呼出しのAPI契約はない。追加認可・trim・永続化は今回の要求外。',
'initial': '''function applyTitle(document, title) {
  document.title = title;
}
export function renameDocument(document, title) {
  if (typeof title !== 'string' || title.length === 0) return { status: 400 };
  applyTitle(document, title);
  return { status: 200 };
}
''',
'after': '''// applyTitle is private; the sole caller validates the JSON title.
function applyTitle(document, title) {
  document.title = title;
}
export function renameDocument(document, title) {
  if (typeof title !== 'string' || title.length === 0) return { status: 400 };
  applyTitle(document, title);
  return { status: 200 };
}
''',
 'test': '''import assert from 'node:assert/strict';
import { renameDocument } from './subject.mjs';
const d={title:'old'};
for (const title of ['',null,0,{},[]]) {
 assert.equal(renameDocument(d,title).status,400); assert.equal(d.title,'old');
}
assert.equal(renameDocument(d,'new').status,200); assert.equal(d.title,'new');
console.log('existing private-helper tests passed');
''',
'oracle': {'initial':[], 'after':[], 'repetition':'private helperに二重validationを要求する指摘は既存呼出側防御で反証される'}},
'failed-save': {
'requirements':'公開操作 updateNote(store, id, note, retryKey, consumed) を追加する。引数は検証・認可済みの通常の値、noteはstring、consumedはSet。既消費retryKeyは409、対象未存在は404。store.getはlive record参照を返す。store.save(id, record) は同期で、成功時に保存、失敗時はthrowし保存しない。save失敗は503で、読み出せるrecord状態を変更せずretryKeyも消費しない。成功時のみnoteの更新とretryKey消費を行い200。並行実行・クラッシュ・外部I/Oは対象外。',
'initial': '''export function updateNote(store, id, note, retryKey, consumed) {
  if (consumed.has(retryKey)) return { status: 409 };
  const record = store.get(id);
  if (!record) return { status: 404 };
  consumed.add(retryKey);
  record.note = note;
  try { store.save(id, record); }
  catch { return { status: 503 }; }
  return { status: 200 };
}
''',
'after': '''export function updateNote(store, id, note, retryKey, consumed) {
  if (consumed.has(retryKey)) return { status: 409 };
  const record = store.get(id);
  if (!record) return { status: 404 };
  record.note = note;
  try { store.save(id, record); }
  catch { return { status: 503 }; }
  consumed.add(retryKey);
  return { status: 200 };
}
''',
 'test': '''import assert from 'node:assert/strict';
import { updateNote } from './subject.mjs';
const records=new Map([['x',{note:'old'}]]);
const store={get:id=>records.get(id),save:(id,r)=>records.set(id,r)};
const consumed=new Set();
assert.equal(updateNote(store,'x','new','k',consumed).status,200);
assert.equal(records.get('x').note,'new'); assert.equal(consumed.has('k'),true);
assert.equal(updateNote(store,'x','other','k',consumed).status,409);
assert.equal(updateNote(store,'missing','new','m',consumed).status,404);
console.log('existing failed-save tests passed');
''',
'oracle': {'initial':['F1 save failure mutates live record', 'F2 save failure consumes retryKey'], 'after':['F1 save failure still mutates live record'], 'repetition':'F1の現在のlive参照経路を示す再指摘は正当、F2解消を未解消とする再提示は不要'}}}
public={}; oracle={}
for name,f in fixtures.items():
 public[name]={k:v for k,v in f.items() if k!='oracle'}; oracle[name]=f['oracle']
 for stage in ('initial','after'):
  p=root/name/stage; p.mkdir(parents=True,exist_ok=True)
  (p/'subject.mjs').write_text(f[stage]); (p/'test.mjs').write_text(f['test'])
  (p/'requirements.txt').write_text(f['requirements']+'\n')
  prev = '// 新規操作。変更前はこのmoduleを提供していない。\n' if stage=='initial' else f['initial']
  (p/'before.mjs').write_text(prev)
(out/'fixtures.json').write_text(json.dumps(public,ensure_ascii=False,indent=2)+'\n')
(out/'oracle.json').write_text(json.dumps(oracle,ensure_ascii=False,indent=2)+'\n')
paths=['skills/asc/SKILL.md','skills/asc/references/review.md','skills/review-and-remediation/SKILL.md','skills/review-and-remediation/references/review-method.md']
manifest={'frozen_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'fixture_root':str(root),'model':'gpt-6.1-sol','effort':'medium','runs_planned':6,'samples_per_cell':1,'oracle_hidden':True,'sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [out/'fixtures.json',out/'oracle.json']+list(root.rglob('*')) if p.is_file()},'skill_sha256':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in paths}}
(out/'frozen-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'root':str(root),'files':len(manifest['sha256']),'frozen':manifest['frozen_at_utc']}))
