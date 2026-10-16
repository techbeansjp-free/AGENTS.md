import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {cases} from '../v05/evaluation/scenario-corpus.mjs';
const evaluate=source=>{const context={module:{exports:{}}};vm.runInNewContext(source,context);return context.module.exports;};
test('scenario oracle distinguishes API/document omissions from coordinated update',()=>{
 for(const c of cases.slice(0,2)){
  const api=evaluate(c.after['api.cjs']),ui=evaluate(c.after['ui.cjs']);
  assert.equal(ui(api())==='Hello Ada',!c.defects.includes('stale-caller'));
  assert.equal(c.after['api.md'].includes('displayName'),!c.defects.includes('stale-api-document'));
 }
});
test('original requirement rejects rewritten design; caller guard protects private helper',()=>{
 const c=cases[2];assert.equal(evaluate(c.before['delete.cjs'])('member'),false);assert.equal(evaluate(c.after['delete.cjs'])('member'),true);
 const context={module:{exports:{}},require:()=>evaluate(cases[3].after['delete.cjs'])};vm.runInNewContext(cases[3].after['handler.cjs'],context);
 assert.equal(context.module.exports('admin'),true);assert.throws(()=>context.module.exports('member'),/denied/);
});
