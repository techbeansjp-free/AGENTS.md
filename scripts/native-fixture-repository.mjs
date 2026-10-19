/** Evaluation only: transfer the pinned fixture ancestry, never prior trial refs. */
export function prepareFixtureRepository({fixture,origin,base,remote,command}){
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base))throw Error('Pinned fixture commit required');
 command(['git','init','--quiet','--template=',origin]);
 command(['git','-c','fetch.fsckObjects=true','fetch','--no-tags','--no-recurse-submodules',fixture,base],origin);
 command(['git','checkout','--quiet','--detach',base],origin);
 if(command(['git','rev-parse','HEAD'],origin)!==base||command(['git','for-each-ref','--format=%(refname)'],origin))throw Error('Unexpected fixture references');
 command(['git','remote','add','origin',remote],origin);
}
