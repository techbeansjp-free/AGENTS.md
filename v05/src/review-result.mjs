/** Reviewer claims remain claims; this validates shape, not semantic truth. */
const text={type:'string',minLength:1,maxLength:4000};
const properties={location:text,condition:text,evidence:text,impact:text,action:text,counterevidence:text,severity:{type:'string',enum:['P0','P1','P2','P3']},verification:{type:'string',enum:['static-analysis','unverified-risk']},blocking:{type:'boolean'}};
export const reviewSchema={type:'object',properties:{verdict:{type:'string',enum:['pass','fail']},findings:{type:'array',maxItems:64,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},required:['verdict','findings'],additionalProperties:false};
export function parseReview(value){
 const demand=(ok,message)=>{if(!ok)throw Error('Invalid review: '+message);};
 demand(value&&typeof value==='object'&&!Array.isArray(value),'object required');
 demand(Object.keys(value).every(k=>['verdict','findings'].includes(k))&&['pass','fail'].includes(value.verdict)&&Array.isArray(value.findings)&&value.findings.length<=64,'verdict/findings required');
 const findings=value.findings.map(f=>{
  demand(f&&typeof f==='object'&&!Array.isArray(f)&&Object.keys(f).length===Object.keys(properties).length,'finding fields required');
  for(const [key,schema] of Object.entries(properties)){
   const v=f[key];demand(schema.enum?schema.enum.includes(v):schema.type==='boolean'?typeof v==='boolean':typeof v==='string'&&v.trim().length>0&&v.length<=4000,'invalid '+key);
  }
  demand(!['P0','P1'].includes(f.severity)||f.blocking,'major unresolved finding cannot pass');
  return structuredClone(f);
 });
 const blockers=findings.filter(f=>f.blocking);
 demand((value.verdict==='fail')===(blockers.length>0),'verdict contradicts findings');
 return {verdict:value.verdict,findings,blockers:blockers.map(f=>`${f.severity} ${f.location}: ${f.condition}; ${f.impact}; ${f.action}`),evidenceAuthority:'reviewer assessment; not host-reproduced evidence'};
}
