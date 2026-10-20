/** Evaluation-only host compatibility wrapper. Inner Codex permissions remain authoritative. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
export function evaluationLaunch(c,args,root,mode=process.env.ASC_EVAL_MOUNT_MODE){
 if(!mode||mode==='host')return {binary:c.binary,args};
 if(mode!=='clean-linux'||process.platform!=='linux')throw Error('Unsupported evaluation mount mode');
 const real=fs.realpathSync(root);
 if(real!==root||!/^\/var\/tmp\/asc-native-(?:complex|delivery)-[A-Za-z0-9]+$/.test(real))throw Error('Expected disposable synthetic evaluation root');
 const codexHome=fs.realpathSync(c.env.CODEX_HOME??path.join(c.env.HOME??os.homedir(),'.codex'));
 const mounts=['--unshare-user','--unshare-pid','--die-with-parent','--new-session'];
 // Provider needs network/authentication; the unchanged inner profile denies these to tools.
 for(const dir of [...new Set(['/usr','/lib','/lib64','/etc',fs.realpathSync('/etc/resolv.conf'),path.dirname(path.dirname(c.node)),path.dirname(c.binary)])])mounts.push('--ro-bind',dir,dir);
 mounts.push('--symlink','usr/bin','/bin','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--bind',real,real,'--bind',codexHome,codexHome,'--chdir',c.root);
 return {binary:'/usr/bin/bwrap',args:[...mounts,c.binary,...args]};
}
