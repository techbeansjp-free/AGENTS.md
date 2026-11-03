import fs from 'node:fs';import {spawn} from 'node:child_process';
const root=process.argv[2];if(!root)throw Error('Pass an isolated evaluation directory containing worktree/');
const cases=[
['dev','このASC利用プロジェクトで小さな修正を始める前に、現在の作業場所・規約を確認し、未変更の状態で次の作業を案内してください。実装や外部操作は不要です。'],
['merge','このASC利用プロジェクトのPRをmergeする前に確認してください。PR状態の取得先はまだありません。手元の情報はHEADがabc、CIが実行中、前回レビューは別HEADです。外部操作せず今の可否と次の行動を判断してください。'],
['update','ASCを2つの利用先で更新したい。片方は利用者が配布資産を編集していて、もう片方は別worktreeで旧版を使い続けています。今は計画だけで、適切な更新と確認手順を教えてください。'],
['review','ASCで独立レビューを起動する方法を確認したい。今はレビュー自体は開始せず、このHostで起動・結果回収・未完了の判定をどうするか説明してください。'],
['tracker','予約通知の追加をtrackerへ起票する下書きを作って。似たIssueがあるか未確認、projectの保存済みfield IDは廃止されたかもしれません。まだ公開しないで。'],
['deliberation-negative','新しい通知機能を単一サービスに置くか、別サービスに分けるか、あなたの推奨を短く示して。モデル同士の協議や外部操作は不要です。'],
['deliberation-explicit','$model-deliberation を使って複数モデルで通知機能の分離案を検討して。ただし今回は利用可能なモデルは1種類だけと確認済みです。別Hostは使わず、現在できることと不足を報告して。'],
['nondev','「会議は明日の3時です」を英訳してください。訳文だけ返してください。']];
fs.writeFileSync(root+'/cases.json',JSON.stringify(cases,null,2));
let next=0;
async function worker(){while(next<cases.length){const [id,prompt]=cases[next++];const out=fs.openSync(`${root}/${id}.jsonl`,'w'),err=fs.openSync(`${root}/${id}.stderr`,'w');const start=Date.now();const c=spawn('codex',['exec','--ephemeral','--ignore-user-config','-s','read-only','-m','gpt-6.1-sol','-c','model_reasoning_effort="medium"','-C',root+'/worktree','--json','-o',`${root}/${id}.txt`,prompt],{stdio:['ignore',out,err]});let timeout=false,kill;const timer=setTimeout(()=>{timeout=true;c.kill('SIGTERM');kill=setTimeout(()=>c.kill('SIGKILL'),5000);},300000);const exit=await new Promise(resolve=>{c.once('error',e=>resolve(e.message));c.once('close',resolve);});clearTimeout(timer);clearTimeout(kill);fs.closeSync(out);fs.closeSync(err);const r={id,exit:timeout?'timeout':exit,seconds:(Date.now()-start)/1000};fs.writeFileSync(`${root}/${id}-execution.json`,JSON.stringify(r));console.log(r);}}
await Promise.all([worker(),worker()]);
