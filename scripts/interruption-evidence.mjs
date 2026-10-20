/** A saved edit alone cannot prove that the process was interrupted. */
export function interruptionCheckpoint({signalSent,status,signal,changed}){
 return signalSent===true&&changed===true&&(signal==='SIGINT'||status===130);
}
