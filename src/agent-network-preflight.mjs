import net from 'node:net';

// Fixed host-owned probe, never candidate code. Missing output is not denial.
const probe=`const net=require('node:net'),fs=require('node:fs');const s=net.connect({host:'127.0.0.1',port:Number(process.argv[1])});let done=false;
function finish(network){if(done)return;done=true;s.destroy();fs.writeSync(1,JSON.stringify({completed:true,network}));}
s.setTimeout(2000,()=>finish('timeout'));s.on('connect',()=>finish('connected'));s.on('error',e=>finish(['EPERM','EACCES','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','ENETDOWN'].includes(e.code)?'denied':'error'));`;
export function assertNetworkPreflight(evidence) {
  if(evidence.positive?.completed!==true || evidence.positive.network!=='connected' ||
    evidence.positiveConnections!==1 || evidence.negative?.completed!==true ||
    evidence.negative.network!=='denied' || evidence.sandboxConnections!==0)
    throw Error('Agent network isolation not established');
}
export async function networkPreflight({executable,sandbox,env,run}) {
  let connections=0;
  const sockets=new Set(),server=net.createServer(socket=>{
    connections++;sockets.add(socket);socket.on('error',()=>{});
    socket.on('close',()=>sockets.delete(socket));socket.end();
  });
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const command=[process.execPath,'-e',probe,String(server.address().port)];
    const positive=JSON.parse((await run(command[0],command.slice(1),{env:{},input:'',timeout:5000})).stdout);
    const positiveConnections=connections;
    if(positive.completed!==true || positive.network!=='connected' || positiveConnections!==1)
      throw Error('Agent network positive control failed');
    const negative=JSON.parse((await run(executable,[...sandbox,...command],{env,input:'',timeout:5000})).stdout);
    const evidence={positive,positiveConnections,negative,sandboxConnections:connections-positiveConnections};
    assertNetworkPreflight(evidence);
    return evidence;
  } finally {
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
  }
}
