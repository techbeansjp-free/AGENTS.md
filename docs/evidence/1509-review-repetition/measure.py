"""Frozen synthetic fixtures; six independent current-Host review contexts."""
from pathlib import Path
import subprocess, json, time, datetime, hashlib
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
ROOT=Path('/tmp/asc-1509-review-fixtures')
SKILL=REPO/'skills/asc/references/review.md'
TRACES=HERE/'traces'; TRACES.mkdir(exist_ok=True)
manifest=json.loads((HERE/'frozen-manifest.json').read_text())
for name,digest in manifest['sha256'].items():
 p=Path(name)
 if not p.is_absolute(): p=REPO/p
 assert hashlib.sha256(p.read_bytes()).hexdigest()==digest, name
for name,digest in manifest['skill_sha256'].items():
 assert hashlib.sha256((REPO/name).read_bytes()).hexdigest()==digest, name
results=[]
for scenario in ('authorization','private-helper','failed-save'):
 for stage in ('initial','after'):
  run_id=f'{scenario}-{stage}'; target=ROOT/scenario/stage
  test=subprocess.run(['node','test.mjs'],cwd=target,text=True,capture_output=True)
  assert test.returncode==0,(run_id,test.stderr)
  history='初回レビューのため過去指摘はありません。'
  if stage=='after': history='前回レビューの出力（主張を鵜呑みにせず現在の実体で検証する）:\n'+(TRACES/f'{scenario}-initial.answer.txt').read_text()
  prompt=f'''ASCの独立Reviewerとしてレビューのみ実施してください。現在のHostの新規contextです。
手順: {SKILL} を読み、参照先の変更のレビューと是正Skillも読んで適用してください。
対象はGit未管理の合成Node fixture: {target}。base/HEADなし。before.mjsが変更前、subject.mjsがレビュー対象の変更後、requirements.txtが元要求・受入条件、test.mjsが既存テストです。対象の全公開APIと関連経路はこのmodule内で完結しています。レビュー用コピーやworktreeを作らず、この対象実体で確認してください。
適用契約: 要求を満たす操作と失敗時不変性を確認し、要求外の保証・抽象化を追加しない。差分外の既存防御も反証として確認する。指摘は現在成立する根拠・影響・既存対策による反証・必要な是正と検証を示す。以前の指摘でも現在の対象で成立するか確認する。書込み禁止で、node test.mjs と node --input-type=module による無書込みの追加確認は可能です。編集・外部アクセス・追加Agent起動はしないでください。
既存検証: node test.mjs exit={test.returncode}; {test.stdout.strip()}
レビュー履歴:\n{history}
調査対象は上記fixtureと参照Skillのみです。docs/evidence内のfixture生成元・oracle・集計・別試行は参照しないでください。
指摘・確認した重要な振る舞い・未確認事項・現在の対象を日本語で簡潔に報告してください。修正は実施しないでください。
'''
  (TRACES/f'{run_id}.prompt.txt').write_text(prompt)
  argv=['codex','-a','never','exec','--ignore-user-config','--skip-git-repo-check','--ephemeral','--json','--color','never','-m','gpt-6.1-sol','-c','model_reasoning_effort="medium"','-c','web_search="disabled"','-s','read-only','-C',str(target),'-']
  start=datetime.datetime.now(datetime.timezone.utc).isoformat(); t=time.monotonic()
  try:
   proc=subprocess.run(argv,input=prompt,text=True,capture_output=True,timeout=600)
   elapsed=time.monotonic()-t; stdout=proc.stdout; stderr=proc.stderr; code=proc.returncode; timed_out=False
  except subprocess.TimeoutExpired as e:
   elapsed=time.monotonic()-t; stdout=e.stdout or ''; stderr=e.stderr or ''; code=None; timed_out=True
   if isinstance(stdout,bytes):stdout=stdout.decode()
   if isinstance(stderr,bytes):stderr=stderr.decode()
  (TRACES/f'{run_id}.jsonl').write_text(stdout); (TRACES/f'{run_id}.stderr.txt').write_text(stderr)
  events=[]; parse_errors=0
  for line in stdout.splitlines():
   try: events.append(json.loads(line))
   except json.JSONDecodeError: parse_errors+=1
  answers=[e['item']['text'] for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='agent_message']
  answer='\n\n'.join(answers); (TRACES/f'{run_id}.answer.txt').write_text(answer)
  completed=[e for e in events if e.get('type')=='turn.completed']
  result={'run_id':run_id,'started_at_utc':start,'wall_seconds':round(elapsed,3),'argv':argv,'exit_code':code,'timeout':timed_out,'turn_completed':bool(completed),'usage':completed[-1].get('usage') if completed else None,'parse_errors':parse_errors,'missing':([] if completed else ['turn.completed','token usage']),'existing_test':{'argv':['node','test.mjs'],'exit_code':test.returncode,'stdout':test.stdout},'thread_id':next((e.get('thread_id') for e in events if e.get('type')=='thread.started'),None)}
  results.append(result); (HERE/'measurements.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
  print(json.dumps(result,ensure_ascii=False),flush=True)
  if not answer: raise RuntimeError(f'{run_id}: no final answer; no automatic retry')
