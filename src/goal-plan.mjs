/** Pure owner-plan analysis. This module never accepts completion evidence or authorizes delivery. */
import {digest,safeName} from './controller.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
const overlap=(a,b)=>{a=a.toLowerCase();b=b.toLowerCase();return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');};
export function compileGoal(input){
 const plan=structuredClone(input);
 demand(plan?.schema==='asc-goal/v1'&&typeof plan.intent==='string'&&plan.intent.trim(),'Goal intent missing');
 demand(Array.isArray(plan.units)&&plan.units.length>0&&plan.units.length<=64,'Goal requires 1..64 units');
 const units=new Map();
 for(const u of plan.units){
  demand(u&&typeof u.id==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(u.id)&&!units.has(u.id),'Invalid or duplicate unit id');
  demand(typeof u.intent==='string'&&u.intent.trim()&&Array.isArray(u.criteria)&&u.criteria.length&&u.criteria.every(x=>typeof x==='string'&&x.trim()),'Unit purpose and acceptance criteria required');
  for(const field of ['dependsOn','readPaths','writePaths'])demand(Array.isArray(u[field])&&u[field].every(x=>typeof x==='string')&&new Set(u[field]).size===u[field].length,'Invalid unit '+field);
  demand(u.writePaths.length>0,'Empty unit write scope');[...u.readPaths,...u.writePaths].forEach(safeName);
  demand(u.contracts&&typeof u.contracts==='object'&&!Array.isArray(u.contracts),'Unit contract references required');
  for(const [name,value] of Object.entries(u.contracts))demand(/^[a-z][a-z0-9-]{0,63}$/.test(name)&&typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Invalid contract pin');
  units.set(u.id,u);
 }
 const ancestors=new Map(),visiting=new Set();
 const visit=id=>{
  demand(units.has(id),'Missing dependency '+id);demand(!visiting.has(id),'Cyclic goal dependency');
  if(ancestors.has(id))return ancestors.get(id);
  visiting.add(id);const all=new Set();for(const dependency of units.get(id).dependsOn){all.add(dependency);for(const parent of visit(dependency))all.add(parent);}
  visiting.delete(id);ancestors.set(id,all);return all;
 };for(const id of units.keys())visit(id);
 const values=[...units.values()];
 for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){
  const a=values[i],b=values[j];
  const conflict=a.writePaths.some(p=>[...b.readPaths,...b.writePaths].some(q=>overlap(p,q)))||b.writePaths.some(p=>a.readPaths.some(q=>overlap(p,q)));
  demand(!conflict||ancestors.get(a.id).has(b.id)||ancestors.get(b.id).has(a.id),'Conflicting units need explicit dependency: '+a.id+', '+b.id);
  for(const name of Object.keys(a.contracts))if(Object.hasOwn(b.contracts,name))demand(a.contracts[name]===b.contracts[name],'Inconsistent shared contract '+name);
 }
 const remaining=new Set(units.keys()),done=new Set(),batches=[];
 while(remaining.size){const batch=[...remaining].filter(id=>units.get(id).dependsOn.every(d=>done.has(d))).sort();demand(batch.length,'Unresolvable dependencies');batches.push(batch);for(const id of batch){done.add(id);remaining.delete(id);}}
 return {schema:'asc-goal-plan/v1',plan,digest:digest(plan),batches,unitDigests:Object.fromEntries(values.map(u=>[u.id,digest(u)])),authority:'planning-only; no completion, review or delivery evidence'};
}
export function affectedUnits(previous,next,changedPaths=[]){
 const before=compileGoal(previous),after=compileGoal(next);changedPaths.forEach(safeName);
 const affected=new Set();
 for(const unit of after.plan.units){
  if(previous.intent!==next.intent||before.unitDigests[unit.id]!==after.unitDigests[unit.id]||changedPaths.some(p=>[...unit.readPaths,...unit.writePaths].some(q=>overlap(p,q))))affected.add(unit.id);
 }
 let changed=true;while(changed){changed=false;for(const unit of after.plan.units)if(!affected.has(unit.id)&&unit.dependsOn.some(id=>affected.has(id))){affected.add(unit.id);changed=true;}}
 return {affected:[...affected].sort(),removed:previous.units.filter(u=>!Object.hasOwn(after.unitDigests,u.id)).map(u=>u.id).sort(),unchanged:after.plan.units.map(u=>u.id).filter(id=>!affected.has(id)).sort(),authority:'revalidation candidates only; unchanged does not imply evidence reusable'};
}
