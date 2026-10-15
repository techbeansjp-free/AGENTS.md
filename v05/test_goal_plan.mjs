import {test} from 'node:test';import assert from 'node:assert/strict';import {compileGoal,affectedUnits} from './src/goal-plan.mjs';
const pin='a'.repeat(64);
function fixture(){return {schema:'asc-goal/v1',intent:'Deliver shared feature',units:[{id:'api',intent:'API',criteria:['API works'],dependsOn:[],readPaths:['contract.json'],writePaths:['api.js'],contracts:{shared:pin}},{id:'worker',intent:'Worker',criteria:['Worker works'],dependsOn:[],readPaths:['contract.json'],writePaths:['worker.js'],contracts:{shared:pin}},{id:'integration',intent:'Integrate',criteria:['Whole goal works'],dependsOn:['api','worker'],readPaths:['api.js','worker.js'],writePaths:['test.js'],contracts:{shared:pin}}]};}
test('disjoint units share a batch; integration follows both',()=>{assert.deepEqual(compileGoal(fixture()).batches,[['api','worker'],['integration']]);});
test('cycles, missing and duplicate units fail closed',()=>{for(const change of [p=>p.units[0].dependsOn.push('integration'),p=>p.units[0].dependsOn.push('missing'),p=>p.units.push(p.units[0])]){const p=fixture();change(p);assert.throws(()=>compileGoal(p));}});
test('undeclared ordering for read/write and ancestor-path conflicts fails',()=>{for(const paths of [['api.js'],['api.js/child']]){const p=fixture();p.units[1].readPaths=paths;assert.throws(()=>compileGoal(p),/explicit dependency/);p.units[1].dependsOn=['api'];assert.deepEqual(compileGoal(p).batches,[['api'],['worker'],['integration']]);}});
test('shared contract generations must agree even with ordering',()=>{const p=fixture();p.units[1].dependsOn=['api'];p.units[1].contracts.shared='b'.repeat(64);assert.throws(()=>compileGoal(p),/shared contract/);});
test('changed input invalidates only affected unit and dependents',()=>{const p=fixture();assert.deepEqual(affectedUnits(p,p,['api.js']),{affected:['api','integration'],removed:[],unchanged:['worker'],authority:'revalidation candidates only; unchanged does not imply evidence reusable'});});
test('changed intent invalidates all; contract change propagates',()=>{const p=fixture(),q=structuredClone(p);q.intent='Different goal';assert.equal(affectedUnits(p,q).affected.length,3);q.intent=p.intent;q.units[0].criteria.push('new condition');assert.deepEqual(affectedUnits(p,q).affected,['api','integration']);});
test('unsafe paths and unknown contract pins are refused',()=>{const p=fixture();p.units[0].writePaths=['../secret'];assert.throws(()=>compileGoal(p));p.units[0].writePaths=['api.js'];p.units[0].contracts.shared='latest';assert.throws(()=>compileGoal(p));});
test('legal constructor contract name does not invent a shared reference in other units',()=>{
 const p=fixture();p.units[0].contracts={constructor:pin};
 assert.deepEqual(compileGoal(p).batches,[['api','worker'],['integration']]);
 p.units[1].contracts={constructor:'b'.repeat(64)};
 assert.throws(()=>compileGoal(p),/Inconsistent shared contract constructor/);
});
test('removed constructor unit is reported and cannot be mistaken for an inherited digest',()=>{
 const before=fixture();before.units.push({id:'constructor',intent:'Independent constructor work',criteria:['constructor works'],dependsOn:[],readPaths:[],writePaths:['constructor.js'],contracts:{}});
 const after=fixture(),change=affectedUnits(before,after);
 assert.deepEqual(change.removed,['constructor']);assert.deepEqual(change.affected,[]);
 assert.deepEqual(affectedUnits(after,before).affected,['constructor']);
});
