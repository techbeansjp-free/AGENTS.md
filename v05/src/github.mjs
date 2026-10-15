import {setTimeout} from 'node:timers';
/** Host-owned Draft-only adapter; candidate code never receives GitHub credentials. */
import {execFileSync} from 'node:child_process';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function demand(ok,message){if(!ok)throw Error(message);}
export class Github {
  constructor({repository,issue,repo,branch,baseBranch,base,workflowPath,command}) {
    demand(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),'Invalid repository');
    demand(Number.isSafeInteger(issue)&&issue>0,'Invalid Issue');
    demand(/^[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(branch) && /^[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(baseBranch) && branch!==baseBranch,'Invalid branch');
    demand(/^[a-f0-9]{40}$/.test(base),'Invalid base');
    demand(/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(workflowPath),'Invalid workflow');
    Object.assign(this,{repository,issue,repo,branch,baseBranch,base,workflowPath});
    this.command=command ?? ((argv,cwd)=>execFileSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024}).trim());
  }
  api(route){return JSON.parse(this.command(['gh','api',route]));}
  intent(){return this.api(`repos/${this.repository}/issues/${this.issue}`).body;}
  assertPr(data){
    demand(data.state==='open' && data.draft===true && data.merged===false &&
      data.head?.repo?.full_name===this.repository && data.head.ref===this.branch && data.head.sha===this.expectedHead &&
      data.base?.repo?.full_name===this.repository && data.base.ref===this.baseBranch && data.base.sha===this.base,
      'PR identity, target or Draft contract changed');
  }
  assertTransportConfiguration(){
    // Host/global transport credentials are owner-managed. Candidate-local Git
    // config must not replace the explicit destination or execute a transport.
    const names=this.command(['git','config','--null','--local','--no-includes','--name-only','--list'],this.repo).split('\0').filter(Boolean);
    for(const raw of names){
      const key=raw.toLowerCase();
      demand(!['core.sshcommand','core.gitproxy','ssh.variant','extensions.worktreeconfig'].includes(key) &&
        !/^(url|include|includeif)\./.test(key) &&
        (!key.startsWith('remote.') || /^remote\.[a-z0-9_-]+\.(url|fetch)$/.test(key)),
        'Candidate-local Git transport configuration requires owner reconciliation');
    }
  }
  createDraft(head){
    this.assertTransportConfiguration();
    demand(/^[a-f0-9]{40}$/.test(head),'Invalid HEAD');this.expectedHead=head;
    demand(this.command(['git','rev-parse','HEAD'],this.repo)===head,'HEAD changed before submission');
    const matches=JSON.parse(this.command(['gh','pr','list','--repo',this.repository,'--head',this.branch,'--base',this.baseBranch,'--state','all','--limit','2','--json','number']));
    if(matches.length){
      demand(matches.length===1,'Ambiguous prior submission');const pr=matches[0].number;
      this.assertPr(this.api(`repos/${this.repository}/pulls/${pr}`));return pr;
    }
    const observedBase=this.api(`repos/${this.repository}/git/ref/heads/${this.baseBranch}`).object.sha;
    demand(observedBase===this.base,'Remote base changed before submission');
    // Explicit destination; no candidate-controlled origin URL, no hooks, no force.
    this.assertTransportConfiguration();
    this.command(['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','push',
      `git@github.com:${this.repository}.git`,`${head}:refs/heads/${this.branch}`],this.repo);
    demand(this.command(['git','rev-parse','HEAD'],this.repo)===head,'HEAD changed during push');
    const url=this.command(['gh','pr','create','--repo',this.repository,'--base',this.baseBranch,'--head',this.branch,'--draft',
      '--title','Isolated v0.5 Node evaluation','--body',`Isolated evaluation for #${this.issue}. Controller verification and independent fresh review. Draft only; no merge or release.`]);
    const match=url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
    demand(match && match[1]===this.repository,'Unexpected PR response');const pr=Number(match[2]);
    this.assertPr(this.api(`repos/${this.repository}/pulls/${pr}`));return pr;
  }
  async observe(pr,{timeout=300000,interval=5000}={}){
    const started=Date.now(),deadline=started+timeout,transportFailures=[];
    do {
      try {
      const data=this.api(`repos/${this.repository}/pulls/${pr}`);this.assertPr(data);
      const runs=this.api(`repos/${this.repository}/actions/runs?head_sha=${this.expectedHead}&event=pull_request`).workflow_runs;
      const bound=runs.filter(r=>r.head_sha===this.expectedHead && r.event==='pull_request' && r.path===this.workflowPath &&
        r.repository?.full_name===this.repository && r.pull_requests?.some(p=>p.number===pr && p.head?.sha===this.expectedHead && p.base?.sha===this.base));
      if(bound.length){
        const run=bound.sort((a,b)=>b.id-a.id)[0];
        if(run.status==='completed'){
          demand(run.conclusion==='success','PR workflow failed');
          const result=this.api(`repos/${this.repository}/actions/runs/${run.id}/jobs?per_page=100`);
          demand(result.total_count===result.jobs.length && result.jobs.length>0,'Incomplete job coverage');
          const names=new Set();const checks={};
          for(const job of result.jobs){demand(!names.has(job.name) && job.status==='completed','Ambiguous or incomplete jobs');names.add(job.name);checks[job.name]=job.conclusion;}
          this.assertPr(this.api(`repos/${this.repository}/pulls/${pr}`));
          return {head:this.expectedHead,draft:true,merged:false,boundToPr:true,checks,run:run.html_url,transportFailures};
        }
      }
      } catch(error) {
        // Only retry read-only observation on known transport failures. Never
        // retry mutation, authentication, invalid JSON, CI or identity failures.
        const stderr=String(error?.stderr??'');
        const transient=['ETIMEDOUT','ECONNRESET','EAI_AGAIN'].includes(error?.code)||
          /dial tcp [^\n]*i\/o timeout|TLS handshake timeout|connection reset by peer|temporary failure in name resolution/i.test(stderr);
        if(!transient||transportFailures.length>=2||Date.now()>=deadline)throw error;
        transportFailures.push({reason:'transient-read-transport',elapsedMs:Date.now()-started});
      }
      if(Date.now()>=deadline)break;await sleep(Math.min(interval,deadline-Date.now()));
    }while(Date.now()<deadline);
    throw Error('PR-bound CI deadline exceeded');
  }
}
